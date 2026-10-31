"""Pack unmodified RGBA rabbit frames into Phaser atlases and inspectable QA assets."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rabbit_pipeline import SPECS, sample_frames


ROOT = Path(__file__).resolve().parents[2]
SIZE = 512
ALPHA_THRESHOLD = 16


class AssetError(ValueError):
    """An input or generated asset violates the fixed-frame contract."""


@dataclass
class ActionInput:
    action: str
    manifest_path: Path
    manifest: dict[str, Any]
    images: list[Image.Image]
    measurements: list[dict[str, Any]]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssetError(message)


def finite_number(value: Any, label: str) -> float:
    require(isinstance(value, (int, float)) and not isinstance(value, bool),
            f"{label} must be numeric")
    require(math.isfinite(value), f"{label} must be finite")
    return float(value)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n")


def point(value: Any, label: str, limit: float = SIZE) -> dict[str, float]:
    require(isinstance(value, dict), f"{label} must be an object")
    x = finite_number(value.get("x"), f"{label}.x")
    y = finite_number(value.get("y"), f"{label}.y")
    require(0 <= x <= limit and 0 <= y <= limit,
            f"{label} ({x}, {y}) is outside [0, {limit}]")
    return {"x": x, "y": y}


def load_action(root: Path, action: str) -> ActionInput:
    directory = root / "assets/rendered/rabbit/frames" / action
    path = directory / "manifest.json"
    require(path.is_file(), f"Missing {path}; render {action} first")
    try:
        manifest = json.loads(path.read_text())
    except (ValueError, OSError) as exc:
        raise AssetError(f"Cannot read {path}: {exc}") from exc
    require(isinstance(manifest, dict), f"{action}: manifest must be an object")
    require(manifest.get("schemaVersion") == 1, f"{action}: unsupported schemaVersion")
    require(manifest.get("action") == action, f"{action}: mismatched action")
    require(manifest.get("blenderAction") == f"Rabbit_{action.capitalize()}",
            f"{action}: unexpected Blender Action")
    source_hash = manifest.get("sourceSha256", "")
    require(isinstance(source_hash, str) and re.fullmatch(r"[a-fA-F0-9]{64}", source_hash) is not None,
            f"{action}: sourceSha256 must be a SHA-256 hex digest")
    render = manifest.get("render")
    require(isinstance(render, dict), f"{action}: render must be an object")
    require(render.get("width") == SIZE and render.get("height") == SIZE,
            f"{action}: render dimensions must be {SIZE}x{SIZE}")
    spec = SPECS[action]
    count, fps, repeat = spec["count"], spec["fps"], spec["repeat"]
    sampled_frames = sample_frames(action, 1, spec["end"], count)
    require(manifest.get("frameRate") == fps, f"{action}: recommended frameRate must be {fps}")
    require(manifest.get("repeat") == repeat, f"{action}: repeat must be {repeat}")
    anchor = point(manifest.get("anchor"), f"{action}.anchor")
    origin = point(manifest["anchor"].get("origin"), f"{action}.anchor.origin", 1)
    require(abs(origin["x"] - anchor["x"] / SIZE) < 1e-9 and
            abs(origin["y"] - anchor["y"] / SIZE) < 1e-9,
            f"{action}: normalized origin does not match the exact pixel anchor")
    frames = manifest.get("frames")
    require(isinstance(frames, list) and len(frames) == count,
            f"{action}: expected exactly {count} frames")
    expected_names = {f"rabbit_{action}_{index:03d}.png" for index in range(count)}
    actual_names = {item.name for item in directory.glob("*.png")}
    require(actual_names == expected_names,
            f"{action}: missing or stale PNG frames; missing={sorted(expected_names - actual_names)}, "
            f"extra={sorted(actual_names - expected_names)}")
    images = []
    measurements = []
    last_source_frame = -math.inf
    for index, frame in enumerate(frames):
        require(isinstance(frame, dict), f"{action}: frame {index} must be an object")
        name = f"rabbit_{action}_{index:03d}.png"
        require(frame.get("index") == index and frame.get("name") == name,
                f"{action}: frame {index} index/name/order mismatch")
        source_frame = finite_number(frame.get("sourceFrame"), f"{action}.{name}.sourceFrame")
        require(source_frame >= 1 and source_frame > last_source_frame,
                f"{action}: source frames must be positive and strictly increasing")
        require(source_frame == sampled_frames[index],
                f"{action}: source frame {source_frame:g} at index {index} does not match the shared sampler ({sampled_frames[index]})")
        last_source_frame = source_frame
        duration = finite_number(frame.get("durationMs"), f"{action}.{name}.durationMs")
        require(abs(duration - 1000 / fps) < 1e-6,
                f"{action}: frame {index} duration must equal 1000/frameRate; no temporal resampling is performed")
        point(frame.get("attachment"), f"{action}.{name}.attachment")
        image_path = directory / name
        try:
            with Image.open(image_path) as opened:
                require(opened.format == "PNG", f"{image_path}: expected PNG")
                require(opened.mode == "RGBA", f"{image_path}: expected RGBA, got {opened.mode}")
                require(opened.size == (SIZE, SIZE), f"{image_path}: expected {SIZE}x{SIZE}")
                image = opened.copy()
        except OSError as exc:
            raise AssetError(f"Cannot read {image_path}: {exc}") from exc
        alpha = image.getchannel("A")
        bbox = alpha.getbbox()
        require(bbox is not None, f"{image_path}: blank alpha channel")
        require(bbox[0] > 0 and bbox[1] > 0 and bbox[2] < SIZE and bbox[3] < SIZE,
                f"{image_path}: nontransparent pixels touch the canvas boundary (possible crop)")
        solid_bbox = alpha.point(lambda value: 255 if value >= ALPHA_THRESHOLD else 0).getbbox()
        require(solid_bbox is not None, f"{image_path}: no alpha >= {ALPHA_THRESHOLD}")
        images.append(image)
        measurements.append({
            "index": index, "name": name, "sourceFrame": frame["sourceFrame"],
            "sha256": sha256(image_path), "rgbaSha256": hashlib.sha256(image.tobytes()).hexdigest(),
            "alphaBounds": list(bbox), "alphaThresholdBounds": list(solid_bbox),
            "alphaBottomPixel": solid_bbox[3] - 1,
        })
    return ActionInput(action, path, manifest, images, measurements)


def validate_compatibility(actions: dict[str, ActionInput], tolerance: float) -> dict[str, Any]:
    require(bool(actions), "No manifests found")
    first = next(iter(actions.values()))
    for action, data in actions.items():
        for field in ("sourceSha256", "render", "anchor"):
            require(data.manifest[field] == first.manifest[field],
                    f"{action}: {field} differs from {first.action}; rerender all actions from one source and camera")
    bottoms = [frame["alphaBottomPixel"] for data in actions.values() for frame in data.measurements]
    spread = max(bottoms) - min(bottoms)
    require(spread <= tolerance,
            f"Alpha baseline varies by {spread}px (allowed {tolerance}px); inspect the rendered feet")
    return {"alphaThreshold": ALPHA_THRESHOLD, "minimumBottomPixel": min(bottoms),
            "maximumBottomPixel": max(bottoms), "spreadPixels": spread,
            "tolerancePixels": tolerance, "passed": True}


def pack_action(root: Path, data: ActionInput) -> dict[str, Any]:
    count = len(data.images)
    cols = math.ceil(math.sqrt(count))
    rows = math.ceil(count / cols)
    width, height = cols * SIZE, rows * SIZE
    require(width <= 2048 and height <= 2048, f"{data.action}: atlas exceeds 2048px")
    sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    frames = {}
    for index, (image, metadata) in enumerate(zip(data.images, data.manifest["frames"])):
        x, y = index % cols * SIZE, index // cols * SIZE
        # No mask: retain all straight-alpha RGBA bytes, including transparent RGB.
        sheet.paste(image, (x, y))
        frames[metadata["name"]] = {
            "frame": {"x": x, "y": y, "w": SIZE, "h": SIZE},
            "rotated": False, "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": SIZE, "h": SIZE},
            "sourceSize": {"w": SIZE, "h": SIZE},
            "pivot": dict(data.manifest["anchor"]["origin"]),
            "duration": metadata["durationMs"], "sourceFrame": metadata["sourceFrame"],
        }
    basename = f"rabbit_{data.action}"
    directory = root / "dist/rabbit"
    directory.mkdir(parents=True, exist_ok=True)
    image_path = directory / f"{basename}.png"
    atlas_path = directory / f"{basename}.json"
    sheet.save(image_path, optimize=False)
    atlas = {
        "frames": frames,
        "meta": {
            "app": "Motion Garden rabbit sprite pipeline", "version": "1",
            "image": image_path.name, "format": "RGBA8888", "size": {"w": width, "h": height},
            "scale": "1", "sourceSha256": data.manifest["sourceSha256"],
            "frameRate": data.manifest["frameRate"], "repeat": data.manifest["repeat"],
            "anchor": data.manifest["anchor"], "alphaMode": "straight",
            "durationNote": "frame.duration is custom metadata in milliseconds; Phaser playback must use rabbit_animations.json frameRate.",
        },
    }
    save_json(atlas_path, atlas)
    return validate_atlas(root, data)


def validate_atlas(root: Path, data: ActionInput) -> dict[str, Any]:
    directory = root / "dist/rabbit"
    image_path = directory / f"rabbit_{data.action}.png"
    atlas_path = directory / f"rabbit_{data.action}.json"
    require(image_path.is_file() and atlas_path.is_file(), f"{data.action}: missing packed output")
    atlas = json.loads(atlas_path.read_text())
    require(set(atlas["frames"]) == {item["name"] for item in data.manifest["frames"]},
            f"{data.action}: atlas frame set differs from the manifest")
    with Image.open(image_path) as sheet:
        require(sheet.mode == "RGBA", f"{data.action}: packed sheet must be RGBA")
        require(max(sheet.size) <= 2048, f"{data.action}: packed sheet exceeds 2048px")
        require(atlas["meta"]["size"] == {"w": sheet.width, "h": sheet.height},
                f"{data.action}: JSON sheet dimensions are incorrect")
        require(atlas["meta"]["sourceSha256"] == data.manifest["sourceSha256"],
                f"{data.action}: stale atlas source hash; repack this action")
        for image, metadata in zip(data.images, data.manifest["frames"]):
            entry = atlas["frames"][metadata["name"]]
            rect = entry["frame"]
            x, y, w, h = (rect[key] for key in ("x", "y", "w", "h"))
            require(all(type(value) is int for value in (x, y, w, h)),
                    f"{data.action}: atlas bounds must be integers")
            require(w == SIZE and h == SIZE and 0 <= x <= sheet.width - w and 0 <= y <= sheet.height - h,
                    f"{data.action}: frame rectangle outside atlas")
            require(entry["rotated"] is False and entry["trimmed"] is False,
                    f"{data.action}: rotation or trimming is forbidden")
            require(entry["spriteSourceSize"] == {"x": 0, "y": 0, "w": SIZE, "h": SIZE} and
                    entry["sourceSize"] == {"w": SIZE, "h": SIZE},
                    f"{data.action}: frame source dimensions changed")
            require(entry["pivot"] == data.manifest["anchor"]["origin"],
                    f"{data.action}: exact foot pivot changed")
            require(entry["duration"] == metadata["durationMs"] and
                    entry["sourceFrame"] == metadata["sourceFrame"],
                    f"{data.action}: frame timing/source metadata changed")
            require(sheet.crop((x, y, x + w, y + h)).tobytes() == image.tobytes(),
                    f"{data.action}: packed pixels differ from {metadata['name']}; repack this action")
        size = {"w": sheet.width, "h": sheet.height}
    return {"image": str(image_path.relative_to(root)), "atlas": str(atlas_path.relative_to(root)),
            "imageSha256": sha256(image_path), "atlasSha256": sha256(atlas_path),
            "size": size, "frameCount": len(data.images), "exactPixelRoundTrip": True,
            "jsonBoundsValid": True, "untrimmed": True}


def checkerboard(width: int, height: int, tile: int = 32) -> Image.Image:
    background = Image.new("RGB", (width, height), (232, 232, 232))
    draw = ImageDraw.Draw(background)
    for y in range(0, height, tile):
        for x in range(0, width, tile):
            if (x // tile + y // tile) % 2:
                draw.rectangle((x, y, x + tile - 1, y + tile - 1), fill=(188, 188, 188))
    return background


def composite(image: Image.Image, background: Image.Image) -> Image.Image:
    return Image.alpha_composite(background.convert("RGBA"), image).convert("RGB")


def get_font(size: int = 16) -> ImageFont.ImageFont:
    return ImageFont.load_default(size=size)


def gif_durations(count: int, fps: int) -> list[int]:
    # GIF stores centiseconds; round cumulative time to avoid systematic drift.
    boundaries = [round(index * 100 / fps) * 10 for index in range(count + 1)]
    return [boundaries[index + 1] - boundaries[index] for index in range(count)]


def write_qa(root: Path, data: ActionInput) -> dict[str, Any]:
    directory = root / "qa/rabbit"
    directory.mkdir(parents=True, exist_ok=True)
    action = data.action
    count = len(data.images)
    fps = data.manifest["frameRate"]
    background = checkerboard(SIZE, SIZE)
    opaque = [composite(image, background) for image in data.images]
    durations = gif_durations(count, fps)
    gif_path = directory / f"rabbit_{action}_preview.gif"
    options = {"save_all": True, "append_images": opaque[1:], "duration": durations,
               "disposal": 2, "optimize": False}
    if data.manifest["repeat"] == -1:
        options["loop"] = 0
    opaque[0].save(gif_path, **options)
    cols = math.ceil(math.sqrt(count))
    rows = math.ceil(count / cols)
    header = 36
    contact = Image.new("RGB", (cols * SIZE, rows * (SIZE + header)), "#eeeeee")
    draw = ImageDraw.Draw(contact)
    font = get_font()
    anchor = data.manifest["anchor"]
    for index, (image, metadata) in enumerate(zip(opaque, data.manifest["frames"])):
        x, y = index % cols * SIZE, index // cols * (SIZE + header)
        contact.paste(image, (x, y + header))
        draw.text((x + 10, y + 9), f"{action} #{index:03d} | source {metadata['sourceFrame']:g}",
                  fill="#222222", font=font)
        baseline = y + header + anchor["y"]
        draw.line((x, baseline, x + SIZE - 1, baseline), fill="#1678cb", width=1)
        sx = x + metadata["attachment"]["x"]
        sy = y + header + metadata["attachment"]["y"]
        draw.line((sx - 8, sy, sx + 8, sy), fill="#db1749", width=2)
        draw.line((sx, sy - 8, sx, sy + 8), fill="#db1749", width=2)
        draw.ellipse((x + anchor["x"] - 3, baseline - 3, x + anchor["x"] + 3, baseline + 3),
                     outline="#1678cb", width=1)
    contact_path = directory / f"rabbit_{action}_contact_sheet.png"
    contact.save(contact_path)
    key_indexes = sorted({0, count // 2, count - 1})
    if action == "pull":
        peak_index = next(index for index, frame in enumerate(data.manifest["frames"])
                          if frame["sourceFrame"] == 14)
        key_indexes = sorted(set(key_indexes) | {peak_index})
    edge = Image.new("RGB", (SIZE * 3, (SIZE + header) * len(key_indexes)), "#e8e8e8")
    draw = ImageDraw.Draw(edge)
    backgrounds = [("white", Image.new("RGB", (SIZE, SIZE), "white")),
                   ("dark", Image.new("RGB", (SIZE, SIZE), "#20242a")),
                   ("checker", background)]
    for row, index in enumerate(key_indexes):
        for col, (label, bg) in enumerate(backgrounds):
            x, y = col * SIZE, row * (SIZE + header)
            edge.paste(composite(data.images[index], bg), (x, y + header))
            draw.text((x + 10, y + 9), f"{action} #{index:03d} | {label} | 1:1 pixels",
                      fill="#222222", font=font)
    edge_path = directory / f"rabbit_{action}_edges.png"
    edge.save(edge_path)
    return {
        "gif": str(gif_path.relative_to(root)), "gifSha256": sha256(gif_path),
        "gifFrameDurationsMs": durations,
        "gifTimingNote": "GIF delays are rounded to 10 ms; checkerboard is opaque. One-shots have no loop extension.",
        "contactSheet": str(contact_path.relative_to(root)), "contactSheetSha256": sha256(contact_path),
        "edgeComposites": str(edge_path.relative_to(root)), "edgeCompositesSha256": sha256(edge_path),
        "edgeFrameIndexes": key_indexes, "scale": 1,
        "overlayLegend": {"redCross": "Carrot_Attach_Point / carrot_socket projection", "blueLineAndCircle": "fixed foot anchor"},
    }


def write_aggregates(root: Path, actions: dict[str, ActionInput]) -> None:
    first = next(iter(actions.values()))
    animation_config = {}
    attachment_actions = {}
    for action, data in actions.items():
        key = f"rabbit_{action}"
        animation_config[action] = {
            "key": key, "texture": key, "atlas": f"{key}.json", "image": f"{key}.png",
            "frameRate": data.manifest["frameRate"], "repeat": data.manifest["repeat"],
            "frames": [{"key": key, "frame": frame["name"]} for frame in data.manifest["frames"]],
            "frameNames": [frame["name"] for frame in data.manifest["frames"]],
            "origin": data.manifest["anchor"]["origin"],
            "durationNote": "Use frameRate for uniform Phaser playback. Atlas frame.duration is custom metadata, not automatic playback timing.",
        }
        attachment_actions[action] = [{
            "index": frame["index"], "name": frame["name"], "sourceFrame": frame["sourceFrame"],
            "x": frame["attachment"]["x"], "y": frame["attachment"]["y"],
        } for frame in data.manifest["frames"]]
    directory = root / "dist/rabbit"
    save_json(directory / "rabbit_animations.json", animation_config)
    save_json(directory / "rabbit_attachment_points.json", {
        "schemaVersion": 1, "object": "Carrot_Attach_Point", "socketBone": "carrot_socket",
        "socket": "carrot_socket", "sourceSha256": first.manifest["sourceSha256"],
        "coordinateSystem": {"units": "frame-local pixels", "x": "right", "y": "down",
                             "origin": "top-left of the untrimmed 512x512 frame",
                             "precision": "floating point", "frameWidth": SIZE, "frameHeight": SIZE},
        "anchor": first.manifest["anchor"],
        "worldPositionNote": "For an unrotated sprite: world = sprite position + (socket pixels - anchor pixels) * sprite scale. Apply the sprite transform for rotation or flips.",
        "actions": attachment_actions,
    })
    cards = []
    for action, data in actions.items():
        cards.append(f'''<article><h2>{action.title()}</h2>
<p>{len(data.images)} frames · {data.manifest['frameRate']} fps · repeat {data.manifest['repeat']}</p>
<img width="512" height="512" src="rabbit_{action}_preview.gif" alt="{action} animation">
<p><a href="rabbit_{action}_contact_sheet.png">Contact sheet</a> ·
<a href="rabbit_{action}_edges.png">Alpha edges</a> ·
<a href="../../dist/rabbit/rabbit_{action}.json">Atlas JSON</a></p></article>''')
    page = '''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Rabbit · Task 2C QA</title>
<style>body{font:16px system-ui,sans-serif;background:#f5f2eb;color:#292725;margin:28px}
h1{font-size:30px;margin-bottom:8px}p{line-height:1.5}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:20px}
article{background:white;padding:16px;border:1px solid #ddd9cf;border-radius:12px}h2{margin:0}a{color:#2d6256}
img{width:100%;height:auto;max-width:512px;display:block}button{padding:10px 16px;margin:0 0 22px;font:inherit;cursor:pointer}</style>
<h1>Rabbit · Task 2C QA</h1><p>512 × 512 fixed frames. GIFs use an opaque checkerboard; PNG assets retain RGBA.
Idle loops; other GIFs play once. Contact sheets mark the fixed foot anchor in blue and hand attachment in red.</p>
<button id="replay">Replay all GIFs</button><main>''' + ''.join(cards) + '''</main>
<script>document.getElementById('replay').addEventListener('click',()=>{
for(const img of document.querySelectorAll('img'))img.src=img.src.split('?')[0]+'?replay='+Date.now();
});</script></html>'''
    (root / 'qa/rabbit').mkdir(parents=True, exist_ok=True)
    (root / 'qa/rabbit/index.html').write_text(page)


def build(root: Path, requested: str = "all", baseline_tolerance: float = 1) -> dict[str, Any]:
    root = root.resolve()
    require(math.isfinite(baseline_tolerance) and 0 <= baseline_tolerance <= 3,
            "Baseline tolerance must be between 0 and 3 pixels")
    required = list(SPECS) if requested == "all" else [requested]
    require(all(action in SPECS for action in required), f"Unknown action {requested}")
    available = [action for action in SPECS if action in required or
                 (root / "assets/rendered/rabbit/frames" / action / "manifest.json").is_file()]
    actions = {action: load_action(root, action) for action in available}
    baseline = validate_compatibility(actions, baseline_tolerance)
    packed = {}
    qa = {}
    rebuilt = []
    for action, data in actions.items():
        atlas_path = root / "dist/rabbit" / f"rabbit_{action}.json"
        image_path = atlas_path.with_suffix(".png")
        if action in required or not (atlas_path.is_file() and image_path.is_file()):
            packed[action] = pack_action(root, data)
            qa[action] = write_qa(root, data)
            rebuilt.append(action)
        else:
            packed[action] = validate_atlas(root, data)
            qa[action] = write_qa(root, data)
    write_aggregates(root, actions)
    report = {
        "schemaVersion": 1, "status": "passed", "requestedAction": requested,
        "availableActions": available, "rebuiltActions": rebuilt,
        "completeSixActionSet": len(available) == len(SPECS),
        "sourceSha256": next(iter(actions.values())).manifest["sourceSha256"],
        "frameSize": {"w": SIZE, "h": SIZE}, "alphaMode": "straight",
        "packing": "Untrimmed, unrotated, no resizing, direct RGBA paste without a mask",
        "timing": "Uniform 1000/frameRate milliseconds per frame; no temporal resampling during packing",
        "baseline": baseline,
        "actions": {action: {"manifest": str(data.manifest_path.relative_to(root)),
                             "manifestSha256": sha256(data.manifest_path),
                             "frames": data.measurements, "packed": packed[action], "qa": qa[action]}
                    for action, data in actions.items()},
        "manualReviewRequired": ["Inspect GIFs and contact sheets for pose continuity and foot stability.",
                                 "Inspect original-scale white, dark, and checkerboard composites for edge halos; this is not automated halo detection."],
    }
    save_json(root / "qa/rabbit/asset_validation.json", report)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT, help="Model root (default: game/model)")
    parser.add_argument("--action", choices=["all", *SPECS], default="all")
    parser.add_argument("--baseline-tolerance", type=float, default=1,
                        help="Maximum alpha-bottom spread, 0-3px (default: 1)")
    args = parser.parse_args()
    try:
        report = build(args.root, args.action, args.baseline_tolerance)
    except (AssetError, OSError, KeyError, TypeError, ValueError) as exc:
        failure = {"schemaVersion": 1, "status": "failed", "requestedAction": args.action,
                   "error": str(exc)}
        save_json(args.root / "qa/rabbit/asset_validation.json", failure)
        print(f"Asset validation failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({"status": report["status"], "rebuiltActions": report["rebuiltActions"],
                      "baseline": report["baseline"], "report": str(args.root / "qa/rabbit/asset_validation.json")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
