"""Render equal-height, export-equivalent V2/V3 pose evidence."""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_rabbit_rig_v3 import RigAudit

ROOT = Path(__file__).resolve().parents[2]
POSES = [
    {'name': 'rest'},
    {'name': 'both_90', 'left': 90, 'right': 90},
    {'name': 'both_120', 'left': 120, 'right': 120},
    {'name': 'both_150', 'left': 150, 'right': 150},
    {'name': 'forward_120', 'left': 120, 'right': 120, 'plane': 90},
    {'name': 'diagonal_120', 'left': 120, 'right': 120, 'plane': 45},
    {'name': 'elbow_110', 'elbow': 110},
    {'name': 'raised_elbow_45', 'left': 120, 'right': 120, 'plane': 45, 'elbow': 45},
    {'name': 'lean', 'side': 18, 'yaw': 18, 'pitch': 8, 'roll': -7.2},
    {'name': 'knee_50', 'knee': 0.5},
    {'name': 'knee_100', 'knee': 1},
    {'name': 'combined', 'left': 120, 'right': 120, 'plane': 45, 'elbow': 45,
     'side': -18, 'forward': 10, 'knee': 1, 'yaw': -5, 'roll': 5},
    {'name': 'unsupported_150_elbow_110', 'left': 150, 'right': 150, 'plane': 45, 'elbow': 110},
]
VIEWS = {'front': 0, 'quarter': 35, 'side': 90}


def material(name, color):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    shader = result.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = 0.85
    return result


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def stage(audit, size, samples):
    scene = bpy.context.scene
    characters = set(audit.collection.all_objects)
    for obj in list(bpy.data.objects):
        if obj not in characters:
            bpy.data.objects.remove(obj, do_unlink=True)
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 4
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = -0.35
    scene.world = bpy.data.worlds.new('Rig_QA_World')
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get('Background')
    background.inputs['Color'].default_value = (0.78, 0.82, 0.73, 1)
    background.inputs['Strength'].default_value = 0.65
    for name, location, energy, radius in [
            ('Rig_QA_Key', (-3, -4, 6), 650, 4),
            ('Rig_QA_Fill', (4, -2, 4), 400, 4),
            ('Rig_QA_Rim', (1, 3, 5), 550, 3)]:
        data = bpy.data.lights.new(name, 'AREA')
        data.energy = energy
        data.shape = 'DISK'
        data.size = radius
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = location
        look_at(obj, (0, 0, 1.7))
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
    floor = bpy.context.object
    floor.name = 'Rig_QA_Ground'
    floor.data.materials.append(material('Rig_QA_Ground_Material', (0.71, 0.76, 0.65)))
    data = bpy.data.cameras.new('Rig_QA_Camera')
    data.type = 'ORTHO'
    camera = bpy.data.objects.new('Rig_QA_Camera', data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    return scene, camera


def render(args):
    manifest = {'rendering': 'Cycles CPU, LBS, identical view angles/light rig, equal standing pixel height',
                'samples': args.samples, 'resolution': args.size, 'images': [],
                'sources': {},
                'scope': 'Unclamped asset pose requests, including V2 diagnostic poses above its runtime limit'}
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for version in args.versions.split(','):
        source = ROOT / f'assets/blender/rabbit/rabbit_realtime_{version}.blend'
        source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
        manifest['sources'][version] = {'path': str(source.relative_to(ROOT)), 'sha256': source_hash}
        audit = RigAudit(source)
        bounds = [coordinate for geometry in audit.rest_geometry.values() for coordinate in geometry.vertices]
        minimum = min(point.z for point in bounds)
        maximum = max(point.z for point in bounds)
        height = maximum - minimum
        scene, camera = stage(audit, args.size, args.samples)
        cases = [case for case in POSES if not args.poses or case['name'] in args.poses.split(',')]
        for case in cases:
            audit.pose(case)
            for view in args.views.split(','):
                angle = math.radians(VIEWS[view])
                target = Vector((0, 0, minimum + height * 0.5))
                camera.location = target + Vector((8 * math.sin(angle), -8 * math.cos(angle), 0.15))
                camera.data.ortho_scale = height * 1.24
                look_at(camera, target)
                image_path = args.output_dir / f'{version}-{case["name"]}-{view}.png'
                scene.render.filepath = str(image_path)
                bpy.ops.render.render(write_still=True)
                manifest['images'].append({'version': version, 'pose': case, 'view': view,
                                           'image': image_path.name, 'standing_height': height,
                                           'supported_by_profile': audit.supports(case),
                                           'camera_ortho_scale': camera.data.ortho_scale})
                print('RABBIT_RIG_RENDER', version, case['name'], view, flush=True)
        for case, target_z, scale in [({'name': 'elbow_detail', 'elbow': 110}, 1.35, 1.9),
                                      ({'name': 'knee_detail', 'knee': 1}, 0.35, 1.1)]:
            if args.poses:
                continue
            audit.pose(case)
            for view in ['quarter', 'side']:
                angle = math.radians(VIEWS[view])
                target = Vector((0, 0, target_z))
                camera.location = target + Vector((8 * math.sin(angle), -8 * math.cos(angle), 0))
                camera.data.ortho_scale = scale
                look_at(camera, target)
                image_path = args.output_dir / f'{version}-{case["name"]}-{view}.png'
                scene.render.filepath = str(image_path)
                bpy.ops.render.render(write_still=True)
                manifest['images'].append({'version': version, 'pose': case, 'view': view,
                                           'image': image_path.name, 'camera_ortho_scale': scale,
                                           'supported_by_profile': audit.supports(case)})
        assert hashlib.sha256(source.read_bytes()).hexdigest() == source_hash
    (args.output_dir / 'render-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'qa/rig-v3/renders')
    parser.add_argument('--versions', default='v2,v3')
    parser.add_argument('--views', default='front,quarter,side')
    parser.add_argument('--poses', default='')
    parser.add_argument('--size', type=int, default=512)
    parser.add_argument('--samples', type=int, default=24)
    arguments = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    render(arguments)
