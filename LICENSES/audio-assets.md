# Audio asset provenance

Updated 2026-11-20.

The runtime files in `public/assets/audio/` combine four original procedural effects, a CC0 crowd celebration recording and the supplied Cantonese recordings under `voice/`.

## Original effects

`click.wav`, `grab.wav`, `success.wav` and `berry.wav` are original procedural compositions generated for Motion Garden by `scripts/generate-audio.py`. Their waveforms use sine harmonics with a smooth attack, exponential decay and release envelope. Attribution is Motion Garden contributors. These four files follow the project's CC BY-NC 4.0 artwork license, with full terms in `CC-BY-NC-4.0.txt`. The generator follows the project's PolyForm Noncommercial 1.0.0 software license. Rights apply to the extent held by contributors.

## Third-party audio register

`complete.wav` is a 2.8-second edited excerpt of **Crowd.Yay.Applause.25ppl.Short.wav** by **jessepash**, published on Freesound on 2011-12-28. The author describes approximately 25 people cheering with some applause, recorded indoors with a fairly dry sound on a Zoom H4. The author's page explicitly marks the work CC0. Attribution is retained here for provenance. [Original author page](https://freesound.org/people/jessepash/sounds/139972/)

The recording and its edited excerpt retain **CC0 1.0 Universal** terms. CC0 permits copying, editing and redistribution, including commercial use. [CC0 deed and legal code](https://creativecommons.org/publicdomain/zero/1.0/)

The publicly supplied HQ MP3 preview is saved at `assets/audio-sources/139972_968325-hq.mp3`, 173568 bytes, duration 7.424 seconds. Its SHA-256 is `51a08430d441f5c29fef03b2820f0650179b9b449a965e9beb2b379f14b100f8`. The runtime WAV SHA-256 is `37042ba07156edbea51dab7bf9d0abc16c0900d7f8205e389500d9b91d383bba`. The source was retrieved on 2026-11-18. [Public HQ source file](https://cdn.freesound.org/previews/139/139972_968325-hq.mp3)

Processing uses the source's first 2.8 seconds, mono downmix, resampling to 44100 Hz, a 100 Hz high-pass and 6000 Hz low-pass, DC removal, 35 ms fade-in, 450ms fade-out and peak limiting to 0.23 full scale. The output is signed 16-bit PCM WAV. The saved source supports offline reproduction with Python 3 and FFmpeg by running `python3 scripts/generate-audio.py`. The same command regenerates the four original effects and prints all measurements.

## Runtime measurements

| File | Event | Duration | Peak dBFS | RMS dBFS |
| --- | --- | --- | --- | --- |
| `click.wav` | UI button | 0.13 s | −18.67 | −29.66 |
| `grab.wav` | Carrot grasp | 0.32 s | −16.00 | −27.83 |
| `success.wav` | Carrot pull | 0.78 s | −15.52 | −26.55 |
| `berry.wav` | Accepted three-berry harvest | 0.46 s | −17.82 | −28.66 |
| `complete.wav` | Completed round applause and cheering | 2.80 s | −12.77 | −27.31 |

All runtime files are mono, 44100 Hz, signed 16-bit little-endian PCM, totaling 396238 bytes. Default SFX gain is 0.6. Six-source bounded overlap and a compressor control summed transients. These measurements describe the digital signal. Playback-device volume also affects perceived loudness.


## User-supplied Cantonese voice recordings

The project owner supplied eight M4A files under `assets/audio-sources/` and authorized their preparation, game integration and commit on 2026-11-20. The speaker and recording method were not separately specified. The supplied recordings retain their applicable rights. Their project-use authorization is recorded here independently of the original procedural effects and CC0 crowd recording.

Seven recordings are selected for gameplay. The generic `好叻呀.m4a` remains a source reserve because both selected success recordings already contain encouragement. File labels are taken from the names supplied by the user. The preparation pipeline preserves all eight M4A source hashes. Detailed source/output SHA-256 values, trim coordinates, added padding, applied gain and measurements are recorded in `assets/audio-sources/voice-processing.json`.

The processing script uses a 90 Hz high-pass, 8,500 Hz low-pass, adaptive 10 ms activity windows, 80 ms leading and 120 ms trailing signal padding, 5 ms fade-in and 15 ms fade-out. Linear gain targets −20 LUFS, bounded by a 20 dB gain ceiling and 0.65 sample/true peak ceiling. Actual outputs retain speech dynamics and measure −24.01 to −20.64 LUFS. Quiet-window measurements did not establish stationary noise, so the pipeline uses frequency filtering and edge trimming for cleanup. The manifest distinguishes these signal measurements from verified room-noise or speech labels.

| Runtime file | Supplied source M4A | Duration | LUFS | Peak dBFS |
| --- | --- | --- | --- | --- |
| `carrot-ready.wav` | `慢慢踎低 幫阿兔捉住蘿蔔.m4a` | 2.78s | -22.47 | -3.75 |
| `carrot-grabbed.wav` | `捉實啦 慢慢企返起身.m4a` | 2.22s | -23.73 | -3.76 |
| `carrot-success.wav` | `成功抆到蘿蔔好叻呀.m4a` | 2.25s | -21.80 | -4.14 |
| `carrot-complete.wav` | `完成啦.m4a` | 0.88s | -21.69 | -3.75 |
| `berry-ready.wav` | `左右兩邊都可以！慢慢伸腳掂下樹幹，再收返隻腳.m4a` | 4.59s | -22.60 | -3.75 |
| `berry-success.wav` | `好叻呀！莓果跌落嚟喇.m4a` | 2.14s | -20.64 | -3.76 |
| `berry-complete.wav` | `挑戰完成.m4a` | 1.25s | -24.01 | -3.75 |

The seven voice WAVs total 1421210 bytes and use mono 44,100 Hz signed 16-bit PCM. Run `npm run prepare:voices` with Python 3 and FFmpeg to reproduce the recordings and manifest. The existing `scripts/generate-audio.py` continues to reproduce the five sound effects. Default runtime speech volume is 80%, with independent persisted voice controls. During speech, SFX gain is multiplied by 0.35 and BGM by 0.3.
