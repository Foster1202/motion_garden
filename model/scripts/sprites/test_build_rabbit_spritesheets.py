"""Regression checks for alpha preservation and invalid rendered inputs."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

import build_rabbit_spritesheets as packer


class SpritePackingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="rabbit-packer-test-")
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def fixture(self, action="idle"):
        spec = packer.SPECS[action]
        count, fps, repeat = spec["count"], spec["fps"], spec["repeat"]
        sampled_frames = packer.sample_frames(action, 1, spec["end"], count)
        directory = self.root / "assets/rendered/rabbit/frames" / action
        directory.mkdir(parents=True)
        manifest = {
            "schemaVersion": 1, "action": action,
            "blenderAction": f"Rabbit_{action.capitalize()}", "sourceSha256": "a" * 64,
            "render": {"width": 512, "height": 512, "camera": "fixed"},
            "frameRate": fps, "repeat": repeat,
            "anchor": {"x": 256.0, "y": 475.5, "origin": {"x": .5, "y": 475.5 / 512}},
            "frames": [],
        }
        for index in range(count):
            name = f"rabbit_{action}_{index:03d}.png"
            image = Image.new("RGBA", (512, 512), (19, 37, 71, 0))
            draw = ImageDraw.Draw(image)
            draw.rectangle((128, 80, 383, 475), fill=(240, 220, 190, 255))
            image.putpixel((200 + index, 180), (240, 180, 120, 64))
            image.putpixel((201 + index, 181), (117, 97, 77, 1))
            image.save(directory / name)
            manifest["frames"].append({
                "index": index, "name": name, "sourceFrame": sampled_frames[index],
                "durationMs": 1000 / fps, "attachment": {"x": 255.25 + index, "y": 260.75},
            })
        self.write_manifest(action, manifest)
        return manifest

    def write_manifest(self, action, manifest):
        path = self.root / "assets/rendered/rabbit/frames" / action / "manifest.json"
        path.write_text(json.dumps(manifest))

    def frame_path(self, action="idle", index=0):
        return self.root / "assets/rendered/rabbit/frames" / action / f"rabbit_{action}_{index:03d}.png"

    def test_straight_alpha_and_transparent_rgb_round_trip(self):
        self.fixture()
        data = packer.load_action(self.root, "idle")
        result = packer.pack_action(self.root, data)
        self.assertTrue(result["exactPixelRoundTrip"])
        with Image.open(self.root / result["image"]) as image:
            self.assertEqual(image.size, (2048, 1536))
            self.assertEqual(image.getpixel((0, 0)), (19, 37, 71, 0))
            self.assertEqual(image.getpixel((200, 180)), (240, 180, 120, 64))
        atlas = json.loads((self.root / result["atlas"]).read_text())
        first = atlas["frames"]["rabbit_idle_000.png"]
        self.assertEqual(first["pivot"], {"x": .5, "y": 475.5 / 512})
        self.assertFalse(first["trimmed"])
        self.assertEqual(first["duration"], 1000 / 6)

    @patch.object(packer, "write_qa", return_value={})
    def test_single_action_works_alone_and_preserves_other_aggregate_actions(self, _qa):
        self.fixture()
        first_report = packer.build(self.root, "idle")
        self.assertEqual(first_report["availableActions"], ["idle"])
        self.assertFalse(first_report["completeSixActionSet"])
        self.fixture("bend")
        packer.build(self.root, "bend")
        idle_path = self.root / "dist/rabbit/rabbit_idle.png"
        old_hash = packer.sha256(idle_path)
        last_report = packer.build(self.root, "bend")
        self.assertEqual(last_report["rebuiltActions"], ["bend"])
        self.assertEqual(packer.sha256(idle_path), old_hash)
        animations = json.loads((self.root / "dist/rabbit/rabbit_animations.json").read_text())
        points = json.loads((self.root / "dist/rabbit/rabbit_attachment_points.json").read_text())
        self.assertEqual(set(animations), {"idle", "bend"})
        self.assertEqual(set(points["actions"]), {"idle", "bend"})
        self.assertEqual(points["actions"]["idle"][0]["x"], 255.25)
        self.assertEqual(animations["idle"]["repeat"], -1)
        self.assertEqual(animations["bend"]["repeat"], 0)

    def test_incompatible_manifest_rejected_before_packing(self):
        self.fixture()
        manifest = self.fixture("bend")
        manifest["sourceSha256"] = "b" * 64
        self.write_manifest("bend", manifest)
        with self.assertRaisesRegex(packer.AssetError, "sourceSha256 differs"):
            packer.build(self.root, "idle")
        self.assertFalse((self.root / "dist/rabbit/rabbit_idle.png").exists())

    def test_stale_extra_png_rejected(self):
        self.fixture()
        extra = self.frame_path().with_name("rabbit_idle_099.png")
        extra.write_bytes(self.frame_path().read_bytes())
        with self.assertRaisesRegex(packer.AssetError, "stale PNG"):
            packer.load_action(self.root, "idle")

    def test_blank_crop_mode_and_size_rejected(self):
        self.fixture()
        path = self.frame_path()
        original = path.read_bytes()
        bad_images = [
            (Image.new("RGBA", (512, 512)), "blank alpha"),
            (Image.new("RGBA", (512, 512), "white"), "boundary"),
            (Image.new("RGB", (512, 512), "white"), "expected RGBA"),
            (Image.new("RGBA", (256, 512)), "expected 512x512"),
        ]
        for image, message in bad_images:
            with self.subTest(message=message):
                image.save(path)
                with self.assertRaisesRegex(packer.AssetError, message):
                    packer.load_action(self.root, "idle")
                path.write_bytes(original)

    def test_invalid_frame_metadata_rejected(self):
        original = self.fixture()
        changes = [
            (lambda manifest: manifest["frames"].pop(), "exactly 12"),
            (lambda manifest: manifest["frames"][0].update(durationMs=1), "duration must equal"),
            (lambda manifest: manifest["frames"][0]["attachment"].update(x=float("nan")), "finite"),
            (lambda manifest: manifest["frames"][0]["attachment"].update(y=513), "outside"),
            (lambda manifest: manifest["anchor"]["origin"].update(y=1), "normalized origin"),
            (lambda manifest: manifest["frames"][1].update(sourceFrame=1), "strictly increasing"),
            (lambda manifest: manifest["frames"][1].update(sourceFrame=2), "shared sampler"),
        ]
        for change, message in changes:
            with self.subTest(message=message):
                manifest = copy.deepcopy(original)
                change(manifest)
                self.write_manifest("idle", manifest)
                with self.assertRaisesRegex(packer.AssetError, message):
                    packer.load_action(self.root, "idle")

    def test_moving_baseline_rejected(self):
        self.fixture()
        with Image.open(self.frame_path()) as opened:
            image = opened.copy()
        ImageDraw.Draw(image).rectangle((128, 476, 383, 478), fill="white")
        image.save(self.frame_path())
        data = packer.load_action(self.root, "idle")
        with self.assertRaisesRegex(packer.AssetError, "baseline varies by 3px"):
            packer.validate_compatibility({"idle": data}, 1)

    def test_changed_packed_pixel_rejected(self):
        self.fixture()
        data = packer.load_action(self.root, "idle")
        report = packer.pack_action(self.root, data)
        path = self.root / report["image"]
        with Image.open(path) as opened:
            image = opened.copy()
        image.putpixel((200, 180), (0, 0, 0, 0))
        image.save(path)
        with self.assertRaisesRegex(packer.AssetError, "packed pixels differ"):
            packer.validate_atlas(self.root, data)

    def test_qa_gif_is_opaque_and_uses_rounded_timing(self):
        self.fixture()
        data = packer.load_action(self.root, "idle")
        report = packer.write_qa(self.root, data)
        self.assertEqual(sum(report["gifFrameDurationsMs"]), 2000)
        with Image.open(self.root / report["gif"]) as gif:
            self.assertEqual(gif.info["loop"], 0)
            self.assertEqual(gif.n_frames, 12)
            total_duration = 0
            for index in range(gif.n_frames):
                gif.seek(index)
                self.assertNotIn("transparency", gif.info)
                total_duration += gif.info["duration"]
            self.assertEqual(total_duration, 2000)
        with Image.open(self.root / report["edgeComposites"]) as image:
            self.assertEqual(image.size, (1536, 1644))


if __name__ == "__main__":
    unittest.main()
