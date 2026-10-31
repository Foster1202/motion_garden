"""Validate scene layers and compose review-only previews with the existing rabbit."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
LAYERS = ('background_far', 'background_mid', 'platform', 'foreground',
          'soil_patch', 'carrot', 'basket')
CANVAS = (1920, 1080)
RABBIT_SCALE = 0.9348519362
RABBIT_ORIGIN = (0.5, 0.928719)
RABBIT_FEET = (1072.8, 817.2)


def font(size: int):
    for path in ('/System/Library/Fonts/Supplemental/Arial.ttf',
                 '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def checker(size: tuple[int, int], cell: int = 24) -> Image.Image:
    result = Image.new('RGBA', size, '#F0F0EA')
    draw = ImageDraw.Draw(result)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill='#D5D8D2')
    return result


def scale_image(image: Image.Image, scale: float) -> Image.Image:
    if not math.isfinite(scale) or scale <= 0:
        raise ValueError(f'Invalid displayScale: {scale}')
    size = tuple(max(1, round(value * scale)) for value in image.size)
    return image.resize(size, Image.Resampling.LANCZOS)


def place(canvas: Image.Image, image: Image.Image, spec: dict):
    position = spec['placement']
    displayed = scale_image(image, float(spec.get('displayScale', 1)))
    canvas.alpha_composite(displayed, (round(position['x']), round(position['y'])))


def composite(root: Path, images: dict, specs: dict) -> Image.Image:
    canvas = Image.new('RGBA', CANVAS)
    for name in ('background_far', 'background_mid', 'platform', 'soil_patch'):
        place(canvas, images[name], specs[name])
    # A preview-only contact shadow helps assess the sprite against the platform.
    shadow = Image.new('RGBA', CANVAS)
    shadow_draw = ImageDraw.Draw(shadow)
    x, y = RABBIT_FEET
    shadow_draw.ellipse((x - 50, y - 6, x + 50, y + 8), fill=(70, 53, 34, 48))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(3)))
    rabbit_path = root / 'assets/rendered/rabbit/frames/idle/rabbit_idle_000.png'
    with Image.open(rabbit_path) as source:
        rabbit = scale_image(source.convert('RGBA'), RABBIT_SCALE)
    position = tuple(round(RABBIT_FEET[i] - 512 * RABBIT_ORIGIN[i] * RABBIT_SCALE)
                     for i in range(2))
    canvas.alpha_composite(rabbit, position)
    carrot_spec = specs['carrot']
    pivot = carrot_spec['pivotPixels']
    grip = carrot_spec['anchorCanvasPixels']
    scale = float(carrot_spec.get('displayScale', 1))
    carrot = images['carrot'].copy()
    # Preview the crown above the soil while keeping the full exported carrot intact.
    cutoff = max(0, min(carrot.height, round(pivot['y'] + 22)))
    carrot.paste((0, 0, 0, 0), (0, cutoff, carrot.width, carrot.height))
    carrot = scale_image(carrot, scale)
    canvas.alpha_composite(carrot, (round(grip['x'] - pivot['x'] * scale),
                                   round(grip['y'] - pivot['y'] * scale)))
    for name in ('basket', 'foreground'):
        place(canvas, images[name], specs[name])
    return canvas


def hud_guide(preview: Image.Image) -> Image.Image:
    overlay = Image.new('RGBA', CANVAS)
    draw = ImageDraw.Draw(overlay)
    regions = (
        ('HUD', (85, 42, 1750, 92)),
        ('Instruction', (345, 195, 1230, 130)),
        ('Steps', (600, 334, 720, 55)),
        ('Hold indicator', (768, 842, 425, 65)),
    )
    for label, (x, y, width, height) in regions:
        draw.rectangle((x, y, x + width, y + height),
                       fill=(70, 130, 185, 42), outline=(39, 85, 125, 210), width=2)
        draw.text((x + 12, y + 8), label, fill=(27, 55, 80, 255), font=font(22))
    x, y = RABBIT_FEET
    draw.line((x - 175, y, x + 175, y), fill='#B64466', width=3)
    draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill='#B64466')
    draw.text((x + 185, y - 12), 'Rabbit feet', fill='#8E2846', font=font(20))
    return Image.alpha_composite(preview, overlay)


def thumbnail(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    image = image.copy()
    image.thumbnail(size, Image.Resampling.LANCZOS)
    return image


def contact_sheet(images: dict) -> Image.Image:
    width, height = 480, 340
    sheet = Image.new('RGBA', (width * 3, height * 3), '#F9F7EF')
    draw = ImageDraw.Draw(sheet)
    for index, name in enumerate(LAYERS):
        x, y = index % 3 * width, index // 3 * height
        tile = checker((width - 24, height - 62))
        image = thumbnail(images[name], (tile.width - 12, tile.height - 12))
        tile.alpha_composite(image, ((tile.width - image.width) // 2,
                                     (tile.height - image.height) // 2))
        sheet.alpha_composite(tile, (x + 12, y + 48))
        draw.text((x + 15, y + 10), f'{name}  {images[name].width} x {images[name].height}',
                  font=font(20), fill='#344A36')
    return sheet


def edges_preview(images: dict) -> Image.Image:
    names = ('soil_patch', 'carrot', 'basket', 'platform')
    tile_size = (512, 330)
    sheet = Image.new('RGBA', (tile_size[0] * 3, tile_size[1] * len(names)))
    for row, name in enumerate(names):
        for column, background in enumerate(('light', 'dark', 'checker')):
            tile = checker(tile_size) if background == 'checker' else Image.new(
                'RGBA', tile_size, '#FFF9EB' if background == 'light' else '#283346')
            source = images[name]
            bounds = source.getchannel('A').getbbox()
            if bounds:
                source = source.crop((max(0, bounds[0] - 12), max(0, bounds[1] - 12),
                                      min(source.width, bounds[2] + 12),
                                      min(source.height, bounds[3] + 12)))
            image = thumbnail(source, (tile_size[0] - 24, tile_size[1] - 54))
            tile.alpha_composite(image, ((tile.width - image.width) // 2,
                                         45 + (tile.height - 54 - image.height) // 2))
            ImageDraw.Draw(tile).text((15, 12), f'{name} / {background}', font=font(20),
                                     fill='#FFF9EB' if background == 'dark' else '#344A36')
            sheet.alpha_composite(tile, (column * tile_size[0], row * tile_size[1]))
    return sheet


def run(root: Path) -> dict:
    directory = root / 'assets/rendered/carrot_pull'
    manifest_path = directory / 'carrot_scene_assets.json'
    manifest = json.loads(manifest_path.read_text())
    specs = manifest['layers']
    qa = root / 'qa/carrot_pull'
    qa.mkdir(parents=True, exist_ok=True)
    images, measurements, errors = {}, {}, []
    for name in LAYERS:
        spec = specs[name]
        path = directory / Path(spec['file']).name
        with Image.open(path) as source:
            mode, size = source.mode, source.size
            image = source.convert('RGBA')
        images[name] = image
        alpha = image.getchannel('A')
        bbox = alpha.getbbox()
        extrema = alpha.getextrema()
        if mode != 'RGBA':
            errors.append(f'{name}: expected RGBA, found {mode}')
        if list(size) != spec['size']:
            errors.append(f'{name}: size differs from manifest')
        if name in ('background_far', 'background_mid', 'foreground') and size != CANVAS:
            errors.append(f'{name}: expected 1920 x 1080')
        if name in ('carrot', 'basket', 'soil_patch') and size != (512, 512):
            errors.append(f'{name}: expected 512 x 512')
        if not bbox:
            errors.append(f'{name}: empty alpha')
        if name != 'background_far' and extrema[0] == 255:
            errors.append(f'{name}: no transparent pixels')
        margins = None if bbox is None else [bbox[0], bbox[1], size[0] - bbox[2], size[1] - bbox[3]]
        measurements[name] = dict(file=str(path.relative_to(root)), mode=mode,
                                  size=list(size), nonemptyAlpha=bool(bbox),
                                  alphaExtrema=list(extrema), alphaBounds=bbox,
                                  transparentMarginsLeftTopRightBottom=margins,
                                  touchesCanvasEdge=bool(margins is not None and min(margins) == 0))
    preview = composite(root, images, specs)
    preview.save(qa / 'carrot_pull_scene_preview.png')
    hud_guide(preview).save(qa / 'carrot_pull_scene_hud_guide.png')
    contact_sheet(images).save(qa / 'carrot_pull_layers_contact_sheet.png')
    edges_preview(images).save(qa / 'carrot_pull_props_edges.png')
    report = dict(status='PASS' if not errors else 'FAIL', errors=errors,
                  layers=measurements, compositeSize=list(CANVAS),
                  rabbit=dict(source='rabbit_idle_000.png', origin=list(RABBIT_ORIGIN),
                              scale=RABBIT_SCALE, feet=list(RABBIT_FEET)),
                  plantedCarrot=dict(grip=specs['carrot']['anchorCanvasPixels'],
                                     cropBelowPivotSourcePixels=22),
                  notes=['The full carrot export is preserved; only the composite preview buries its root.',
                         'Alpha bounds and edge backgrounds support visual QA; they cannot prove no color halo.',
                         'Sky geometry may make background_far fully opaque; it remains an RGBA layer.',
                         'A subtle blurred 100 x 14 pixel contact shadow beneath rabbit feet exists only in QA.'])
    (qa / 'carrot_scene_validation.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    report = run(args.root.resolve())
    print(json.dumps({'status': report['status'], 'errors': report['errors']}, indent=2))
    raise SystemExit(0 if report['status'] == 'PASS' else 1)


if __name__ == '__main__':
    main()
