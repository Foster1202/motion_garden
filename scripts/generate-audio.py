"""Reproduce four original effects and the licensed completion excerpt with FFmpeg."""
from array import array
import json
import math
from pathlib import Path
import subprocess
import sys
import wave

RATE = 44100
REPOSITORY = Path(__file__).resolve().parents[1]
ROOT = REPOSITORY / 'public' / 'assets' / 'audio'
APPLAUSE_SOURCE = REPOSITORY / 'assets' / 'audio-sources' / '139972_968325-hq.mp3'


def tone(samples, start, duration, frequency, amplitude, glide=0):
    offset = round(start * RATE)
    length = round(duration * RATE)
    for index in range(length):
        t = index / RATE
        attack = min(1, t / 0.012)
        release = min(1, (duration - t) / 0.05)
        envelope = attack * release * math.exp(-3.8 * t / duration)
        phase = 2 * math.pi * (frequency * t + glide * t * t / (2 * duration))
        value = math.sin(phase) + 0.12 * math.sin(2 * phase) + 0.025 * math.sin(3 * phase)
        samples[offset + index] += amplitude * envelope * value


SCORES = {
    'click': (0.13, [(0, .12, 660, .17, -90)]),
    'grab': (.32, [(0, .25, 300, .19, 130), (.075, .22, 450, .07, 60)]),
    'success': (.78, [(0, .36, 523.25, .16, 0), (.13, .4, 659.25, .15, 0), (.29, .46, 783.99, .16, 0)]),
    'berry': (.46, [(0, .21, 587.33, .14, 35), (.085, .25, 739.99, .13, 25), (.18, .26, 880, .12, 15)]),
}


def completion_excerpt():
    decoded = subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', str(APPLAUSE_SOURCE),
        '-af', 'highpass=f=100,lowpass=f=6000', '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-',
    ])
    samples = array('f')
    samples.frombytes(decoded)
    if sys.byteorder != 'little':
        samples.byteswap()
    length = round(2.8 * RATE)
    if len(samples) < length:
        raise ValueError('Applause source is shorter than the required excerpt')
    samples = samples[:length]
    mean = sum(samples) / length
    return [
        (value - mean) * min(1, index / (.035 * RATE), (length - 1 - index) / (.45 * RATE))
        for index, value in enumerate(samples)
    ]


def write_effect(name, samples):
    peak = max(abs(value) for value in samples)
    scale = min(1, .23 / peak)
    samples = [value * scale for value in samples]
    pcm = array('h', [round(value * 32767) for value in samples])
    if sys.byteorder != 'little':
        pcm.byteswap()
    with wave.open(str(ROOT / f'{name}.wav'), 'wb') as output:
        output.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        output.writeframes(pcm.tobytes())
    rms = math.sqrt(sum(value * value for value in samples) / len(samples))
    return {'seconds': len(samples) / RATE, 'peak_dbfs': round(20 * math.log10(peak * scale), 2),
            'rms_dbfs': round(20 * math.log10(rms), 2), 'bytes': (ROOT / f'{name}.wav').stat().st_size}


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    metrics = {}
    for name, (duration, notes) in SCORES.items():
        samples = [0.0] * round(duration * RATE)
        for note in notes:
            tone(samples, *note)
        metrics[name] = write_effect(name, samples)
    metrics['complete'] = write_effect('complete', completion_excerpt())
    print(json.dumps(metrics, indent=2))


if __name__ == '__main__':
    main()
