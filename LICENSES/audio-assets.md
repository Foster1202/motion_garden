# Audio asset provenance

Updated 2026-11-18.

The runtime files in `public/assets/audio/` combine four original procedural effects and a CC0 crowd celebration recording.

## Original effects

`click.wav`, `grab.wav`, `success.wav` and `berry.wav` are original procedural compositions generated for Motion Garden by `scripts/generate-audio.py`. Their waveforms use sine harmonics with a smooth attack, exponential decay and release envelope. Attribution is Motion Garden contributors. These four files follow the project's CC BY-NC 4.0 artwork license, with full terms in `CC-BY-NC-4.0.txt`. The generator follows the project's PolyForm Noncommercial 1.0.0 software license. Rights apply to the extent held by contributors.

## Third-party audio register

`complete.wav` is a 2.8-second edited excerpt of **Crowd.Yay.Applause.25ppl.Short.wav** by **jessepash**, published on Freesound on 2011-12-28. The author describes approximately 25 people cheering with some applause, recorded indoors with a fairly dry sound on a Zoom H4. The author's page explicitly marks the work CC0. Attribution is retained here for provenance. [Original author page](https://freesound.org/people/jessepash/sounds/139972/)

The recording and its edited excerpt retain **CC0 1.0 Universal** terms. CC0 permits copying, editing and redistribution, including commercial use. [CC0 deed and legal code](https://creativecommons.org/publicdomain/zero/1.0/)

The publicly supplied HQ MP3 preview is saved at `assets/audio-sources/139972_968325-hq.mp3`, 173568 bytes, duration 7.424 seconds. Its SHA-256 is `51a08430d441f5c29fef03b2820f0650179b9b449a965e9beb2b379f14b100f8`. The runtime WAV SHA-256 is `37042ba07156edbea51dab7bf9d0abc16c0900d7f8205e389500d9b91d383bba`. The source was retrieved on 2026-11-18. [Public HQ source file](https://cdn.freesound.org/previews/139/139972_968325-hq.mp3)

Processing uses the source's first 2.8 seconds, mono downmix, resampling to 44100 Hz, a 100 Hz high-pass and 6000 Hz low-pass, DC removal, 35ms fade-in, 450ms fade-out and peak limiting to 0.23 full scale. The output is signed 16-bit PCM WAV. The saved source supports offline reproduction with Python 3 and FFmpeg by running `python3 scripts/generate-audio.py`. The same command regenerates the four original effects and prints all measurements.

## Runtime measurements

| File | Event | Duration | Peak dBFS | RMS dBFS |
| --- | --- | --- | --- | --- |
| `click.wav` | UI button | 0.13 s | −18.67 | −29.66 |
| `grab.wav` | Carrot grasp | 0.32 s | −16.00 | −27.83 |
| `success.wav` | Carrot pull | 0.78 s | −15.52 | −26.55 |
| `berry.wav` | Accepted three-berry harvest | 0.46 s | −17.82 | −28.66 |
| `complete.wav` | Completed round applause and cheering | 2.80 s | −12.77 | −27.31 |

All runtime files are mono, 44100 Hz, signed 16-bit little-endian PCM, totaling 396238 bytes. Default SFX gain is 0.6. Six-source bounded overlap and a compressor control summed transients. These measurements describe the digital signal. Playback-device volume also affects perceived loudness.
