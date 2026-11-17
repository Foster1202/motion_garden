# Audio asset provenance

Updated 2026-11-17.

The five WAV files in `public/assets/audio/` are original procedural compositions generated for Motion Garden by `scripts/generate-audio.py`. The generator uses Python standard-library mathematics, arrays and WAV encoding. Every waveform is built from sine harmonics with a smooth attack, exponential decay and release envelope. No external recording, sample library, melody transcription, voice recording or third-party sound effect contributes to these files.

Attribution is Motion Garden contributors. Original generated audio follows the project's CC BY-NC 4.0 artwork license, with full terms in `CC-BY-NC-4.0.txt`. The generator follows the project's PolyForm Noncommercial 1.0.0 software license. Rights apply to the extent held by contributors.

| File | Event | Duration | Peak dBFS | RMS dBFS |
| --- | --- | --- | --- | --- |
| `click.wav` | UI button | 0.13 s | −18.67 | −29.66 |
| `grab.wav` | Carrot grasp | 0.32 s | −16.00 | −27.83 |
| `success.wav` | Carrot pull | 0.78 s | −15.52 | −26.55 |
| `berry.wav` | Accepted three-berry harvest | 0.46 s | −17.82 | −28.66 |
| `complete.wav` | Completed round | 2.45 s | −12.77 | −28.19 |

All files are mono, 44,100 Hz, signed 16-bit little-endian PCM. Their combined size is 365,368 bytes. Run `python3 scripts/generate-audio.py` from the repository to reproduce the files and print their measurements. The generator caps peak amplitude at 0.23 full scale. Default runtime SFX gain is 0.6, overlapping effects are bounded to six sources, and a compressor controls summed transients. These digital measurements describe the assets and signal chain. Perceived loudness also depends on the playback device and its volume.

## Third-party audio register

No third-party audio is included in this delivery. Future externally supplied recordings, sound effects and music require an entry here with filename, author, original source URL, exact license and required attribution. Original recordings and compositions added by the project owner should record their creator and date. The voice/BGM integration examples use the project's existing original WAV files only in QA.
