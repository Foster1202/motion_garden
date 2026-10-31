"""Check the sampling and metadata rules that prevent asset regressions."""
import struct
import tempfile
import unittest
import zlib
from pathlib import Path

from rabbit_pipeline import SPECS, sample_frames, normalize_png_metadata


class PipelineTests(unittest.TestCase):
    def test_all_feasible_counts_preserve_landmarks(self):
        for name, spec in SPECS.items():
            maximum = spec['end'] - (3 if name == 'pull' else 0)
            for count in range(len(spec['critical']), maximum + 1):
                with self.subTest(action=name, count=count):
                    frames = sample_frames(name, 1, spec['end'], count)
                    self.assertEqual(len(frames), count)
                    self.assertEqual(frames, sorted(set(frames)))
                    self.assertTrue(set(spec['critical']).issubset(frames))
                    self.assertEqual((frames[0], frames[-1]), (1, spec['end']))
                    if name == 'pull':
                        self.assertFalse(set(frames) & {2, 3, 4})

    def test_invalid_sampling_fails(self):
        for args in [('Rabbit_Unknown', 1, 16, 8), ('idle', 2, 48, 12),
                     ('pull', 1, 20, 3), ('pull', 1, 20, 18)]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                sample_frames(*args)

    def test_metadata_removal_preserves_encoded_pixels_and_color(self):
        def chunk(kind, payload):
            return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))
        fixed = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 6, 0, 0, 0))
        fixed += chunk(b'sRGB', b'\x00') + chunk(b'IDAT', zlib.compress(b'\x00\xff\x80\x40\x80'))
        volatile = chunk(b'tEXt', b'Date\x002026/10/03') + chunk(b'tIME', b'1234567')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.png'
            path.write_bytes(fixed + volatile + chunk(b'IEND', b''))
            normalize_png_metadata(path)
            self.assertEqual(path.read_bytes(), fixed + chunk(b'IEND', b''))
            normalize_png_metadata(path)
            self.assertEqual(path.read_bytes(), fixed + chunk(b'IEND', b''))


if __name__ == '__main__':
    unittest.main()
