"""Prepare the supplied Cantonese voice recordings with Python 3 and FFmpeg."""
from array import array
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import wave

REPOSITORY = Path(__file__).resolve().parents[1]
SOURCES = REPOSITORY / 'assets' / 'audio-sources'
OUTPUT = REPOSITORY / 'public' / 'assets' / 'audio' / 'voice'
MANIFEST = SOURCES / 'voice-processing.json'
RATE = 44100
WINDOW = 441
FILTERS = 'highpass=f=90,lowpass=f=8500'
TARGET_LUFS = -20.0
MAX_GAIN_DB = 20.0
PEAK_LIMIT = 0.65
LEADING_PADDING = round(0.08 * RATE)
TRAILING_PADDING = round(0.12 * RATE)
FADE_IN = round(0.005 * RATE)
FADE_OUT = round(0.015 * RATE)
CLIPS = (
    ('carrot-ready', '慢慢踎低 幫阿兔捉住蘿蔔.m4a'),
    ('carrot-grabbed', '捉實啦 慢慢企返起身.m4a'),
    ('carrot-success', '成功抆到蘿蔔好叻呀.m4a'),
    ('carrot-complete', '完成啦.m4a'),
    ('berry-ready', '左右兩邊都可以！慢慢伸腳掂下樹幹，再收返隻腳.m4a'),
    ('berry-success', '好叻呀！莓果跌落嚟喇.m4a'),
    ('berry-complete', '挑戰完成.m4a'),
)
RESERVE = '好叻呀.m4a'


def run_ffmpeg(arguments, data=None):
    result = subprocess.run(
        ['ffmpeg', '-hide_banner', '-nostdin', *arguments],
        input=data, capture_output=True, check=False,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.decode('utf-8', errors='replace').strip())
    return result


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def floats(raw):
    samples = array('f')
    samples.frombytes(raw)
    if sys.byteorder != 'little':
        samples.byteswap()
    if not samples or not all(math.isfinite(value) for value in samples):
        raise ValueError('Decoded recording must contain finite audio samples')
    return samples


def float_bytes(samples):
    values = array('f', samples)
    if sys.byteorder != 'little':
        values.byteswap()
    return values.tobytes()


def decode(path, filtered=False):
    arguments = ['-v', 'error', '-i', str(path), '-vn', '-ac', '1', '-ar', str(RATE)]
    if filtered:
        arguments.extend(['-af', FILTERS])
    return floats(run_ffmpeg([*arguments, '-f', 'f32le', 'pipe:1']).stdout)


def dbfs(value):
    return 20 * math.log10(max(value, 1e-6))


def rms(samples):
    return math.sqrt(sum(value * value for value in samples) / len(samples))


def window_levels(samples):
    return [rms(samples[start:start + WINDOW]) for start in range(0, len(samples), WINDOW)]


def activity(samples):
    levels = window_levels(samples)
    ordered = sorted(levels)
    quiet = dbfs(ordered[int((len(ordered) - 1) * 0.1)])
    strong = dbfs(ordered[int((len(ordered) - 1) * 0.99)])
    threshold = min(-38.0, max(-60.0, quiet + 10.0, strong - 28.0))
    mask = [dbfs(value) >= threshold for value in levels]
    active = [index for index, present in enumerate(mask) if present and (
        (index > 0 and mask[index - 1]) or (index + 1 < len(mask) and mask[index + 1])
    )]
    if not active:
        raise ValueError('Recording has no sustained signal above the trim threshold')
    first = active[0] * WINDOW
    last = min(len(samples), (active[-1] + 1) * WINDOW)
    active_samples = [value for index in active for value in samples[index * WINDOW:(index + 1) * WINDOW]]
    return first, last, threshold, quiet, rms(active_samples)


def loudness(samples):
    result = run_ffmpeg([
        '-v', 'info', '-f', 'f32le', '-ar', str(RATE), '-ac', '1', '-i', 'pipe:0',
        '-af', 'loudnorm=I=-20:TP=-3.7:LRA=7:print_format=json', '-f', 'null', '-',
    ], float_bytes(samples))
    log = result.stderr.decode('utf-8', errors='replace')
    data, _ = json.JSONDecoder().raw_decode(log[log.rfind('{'):])
    integrated = float(data['input_i'])
    true_peak = float(data['input_tp'])
    if not math.isfinite(integrated) or not math.isfinite(true_peak):
        raise ValueError('Recording loudness could not be measured')
    return integrated, true_peak


def measurements(samples):
    integrated, true_peak = loudness(samples)
    _, _, threshold, quiet, active_rms = activity(samples)
    peak = max(abs(value) for value in samples)
    return {
        'frames': len(samples), 'duration_seconds': round(len(samples) / RATE, 6),
        'sample_peak_linear': round(peak, 8), 'peak_dbfs': round(dbfs(peak), 2),
        'rms_dbfs': round(dbfs(rms(samples)), 2), 'integrated_lufs': round(integrated, 2),
        'true_peak_dbfs': round(true_peak, 2), 'quiet_window_p10_dbfs': round(quiet, 2),
        'active_window_rms_dbfs': round(dbfs(active_rms), 2),
        'activity_threshold_dbfs': round(threshold, 2),
    }


def source_record(path, samples):
    return {'path': str(path.relative_to(REPOSITORY)), 'sha256': digest(path),
            'bytes': path.stat().st_size, 'decoded_mono_metrics': measurements(samples)}


def prepare(samples):
    first, last, threshold, _, _ = activity(samples)
    start = max(0, first - LEADING_PADDING)
    end = min(len(samples), last + TRAILING_PADDING)
    added_leading = max(0, LEADING_PADDING - first)
    added_trailing = max(0, TRAILING_PADDING - (len(samples) - last))
    trimmed = [0.0] * added_leading + list(samples[start:end]) + [0.0] * added_trailing
    integrated, true_peak = loudness(trimmed)
    peak = max(abs(value) for value in trimmed)
    wanted_gain = TARGET_LUFS - integrated
    normalization_gain = min(wanted_gain, MAX_GAIN_DB)
    scale = min(10 ** (normalization_gain / 20), PEAK_LIMIT / peak,
                PEAK_LIMIT / (10 ** (true_peak / 20)))
    output = [value * scale * min(1.0, index / FADE_IN, (len(trimmed) - 1 - index) / FADE_OUT)
              for index, value in enumerate(trimmed)]
    return output, {
        'filters': FILTERS, 'spectral_denoise': False,
        'denoise_reason': 'No stationary noise was established by the level/edge analysis. Natural consonants and breaths are retained.',
        'activity_window_ms': 10, 'minimum_adjacent_active_windows': 2,
        'activity_threshold_dbfs': round(threshold, 2),
        'detected_activity_start_frame': first, 'detected_activity_end_frame': last,
        'source_keep_start_frame': start, 'source_keep_end_frame': end,
        'trimmed_leading_frames': start, 'trimmed_trailing_frames': len(samples) - end,
        'added_leading_silence_frames': added_leading, 'added_trailing_silence_frames': added_trailing,
        'requested_leading_padding_ms': 80, 'requested_trailing_padding_ms': 120,
        'fade_in_ms': 5, 'fade_out_ms': 15, 'fade_shape': 'linear',
        'pre_gain_integrated_lufs': round(integrated, 2),
        'requested_gain_db': round(wanted_gain, 3), 'applied_gain_db': round(20 * math.log10(scale), 3),
        'normalization_peak_limited': scale < 10 ** (normalization_gain / 20),
    }


def write_wave(path, samples):
    pcm = array('h', [round(value * 32767) for value in samples])
    if sys.byteorder != 'little':
        pcm.byteswap()
    with wave.open(str(path), 'wb') as output:
        output.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        output.writeframes(pcm.tobytes())
    return array('f', (value / 32768 for value in pcm)) if sys.byteorder == 'little' else decode(path)


def main():
    source_paths = [SOURCES / name for _, name in CLIPS] + [SOURCES / RESERVE]
    source_hashes = {path: digest(path) for path in source_paths}
    version = subprocess.check_output(['ffmpeg', '-version'], text=True).splitlines()[0]
    manifest = {
        'schema_version': 1, 'locale': 'yue-HK',
        'provenance': 'User-supplied recordings authorized for Motion Garden integration on 2026-11-20.',
        'content_labels_basis': 'Source filenames supplied by the user. No independent audition or speech transcription was performed.',
        'toolchain': {'ffmpeg': version, 'python': '.'.join(map(str, sys.version_info[:3]))},
        'settings': {'sample_rate_hz': RATE, 'channels': 1, 'pcm_bits': 16,
                     'target_integrated_lufs': TARGET_LUFS, 'max_gain_db': MAX_GAIN_DB,
                     'sample_and_true_peak_limit_linear': PEAK_LIMIT, 'max_duration_seconds': 6,
                     'filters': FILTERS, 'spectral_denoise': False},
        'measurement_notes': 'RMS and sample peak use decoded mono PCM. Quiet-window P10 and active-window RMS are signal-level estimates, not verified room-noise or speech labels. Values below -120 dBFS are reported as -120. LUFS and true peak use FFmpeg loudnorm analysis only.',
        'clips': [], 'reserves': [],
    }
    with tempfile.TemporaryDirectory(prefix='.voice-prepare-', dir=OUTPUT.parent) as temporary:
        staging = Path(temporary)
        for clip_id, filename in CLIPS:
            source = SOURCES / filename
            original = decode(source)
            samples, operations = prepare(decode(source, filtered=True))
            staged = staging / f'{clip_id}.wav'
            quantized = write_wave(staged, samples)
            metrics = measurements(quantized)
            if metrics['duration_seconds'] > 6 or metrics['sample_peak_linear'] > PEAK_LIMIT:
                raise ValueError(f'{clip_id} exceeds duration or peak limits')
            target = OUTPUT / staged.name
            manifest['clips'].append({
                'id': clip_id, 'label': source.stem, 'status': 'runtime',
                'source': source_record(source, original), 'processing': operations,
                'output': {'path': str(target.relative_to(REPOSITORY)), 'sha256': digest(staged),
                           'bytes': staged.stat().st_size, 'metrics': metrics},
            })
        reserve = SOURCES / RESERVE
        manifest['reserves'].append({
            'id': 'praise', 'label': reserve.stem, 'status': 'source-reserve',
            'reason': 'Generic praise duplicates wording already present in both selected success recordings.',
            'source': source_record(reserve, decode(reserve)), 'output': None,
        })
        if any(digest(path) != expected for path, expected in source_hashes.items()):
            raise ValueError('A source recording changed during preparation')
        staged_manifest = staging / MANIFEST.name
        staged_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        OUTPUT.mkdir(parents=True, exist_ok=True)
        for clip_id, _ in CLIPS:
            os.replace(staging / f'{clip_id}.wav', OUTPUT / f'{clip_id}.wav')
        os.replace(staged_manifest, MANIFEST)
    print(json.dumps({clip['id']: clip['output']['metrics'] for clip in manifest['clips']}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
