"""Render the existing rabbit Actions without saving or rebuilding the blend."""
import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from rabbit_pipeline import SPECS, sample_frames, normalize_png_metadata
from validate_rig import geometry_snapshot, select_action, camera_snapshot


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def pixel(scene, point):
    p = world_to_camera_view(scene, scene.camera, Vector(point))
    if p.z <= 0:
        raise ValueError('Attachment or anchor is behind the camera')
    return {'x': float(p.x * 512), 'y': float((1 - p.y) * 512)}


def transform_signature(scene):
    return dict(camera=camera_snapshot(scene),
                root=[list(r) for r in bpy.data.objects['Rabbit_Root'].matrix_world],
                rig=[list(r) for r in bpy.data.objects['Rabbit_Rig'].matrix_world])


def measure_source(scene, rig):
    """Validate all source poses before rendering and derive one fixed anchor."""
    select_action(rig, bpy.data.actions['Rabbit_Idle'])
    scene.frame_set(1)
    bpy.context.view_layer.update()
    reference = geometry_snapshot()
    sole_ids = {}
    lowest = []
    for side in ('L', 'R'):
        name = 'Rabbit_Leg_' + side
        points = reference[name]
        sole_ids[name] = np.where(points[:, 2] <= points[:, 2].min() + .01)[0]
        lowest.append(points[np.argmin(points[:, 2])])
    foot_world = (lowest[0] + lowest[1]) * .5
    anchor = pixel(scene, foot_world)
    anchor.update(origin={'x': anchor['x'] / 512, 'y': anchor['y'] / 512},
                  world=foot_world.tolist(),
                  definition='Midpoint of lowest evaluated sole vertices at Idle 1; fixed for all frames',
                  canvasBottomOffset=512 - anchor['y'])
    fixed = transform_signature(scene)
    endpoints, reports, frame_data = {}, {}, {}
    max_drift = 0.0
    for name, spec in SPECS.items():
        action_name = 'Rabbit_' + name.title()
        action = bpy.data.actions.get(action_name)
        if action is None or tuple(action.frame_range) != (1, spec['end']):
            raise ValueError('Missing Action or wrong range: ' + action_name)
        select_action(rig, action)
        series = []
        previous = None
        max_hand_step = 0.0
        max_socket_error = 0.0
        for frame in range(1, spec['end'] + 1):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            if transform_signature(scene) != fixed:
                raise ValueError('Camera, render settings, root or rig transform changed')
            vertices = geometry_snapshot()
            for leg, ids in sole_ids.items():
                difference = vertices[leg][ids] - reference[leg][ids]
                # Orthographic projection preserves distances under this scale.
                drift = float(np.linalg.norm(difference, axis=1).max()) * 512 / scene.camera.data.ortho_scale
                max_drift = max(max_drift, drift)
                if drift > .05:
                    raise ValueError('Sole movement exceeds 0.05 pixel')
            graph = bpy.context.evaluated_depsgraph_get()
            evaluated_rig = rig.evaluated_get(graph)
            socket = bpy.data.objects['Carrot_Attach_Point'].evaluated_get(graph)
            hands = [evaluated_rig.matrix_world @ ((evaluated_rig.pose.bones['hand.' + side].head
                     + evaluated_rig.pose.bones['hand.' + side].tail) * .5) for side in ('L', 'R')]
            hand_pixels = [pixel(scene, h) for h in hands]
            midpoint = (hands[0] + hands[1]) * .5
            error = (socket.matrix_world.translation - midpoint).length
            max_socket_error = max(max_socket_error, error)
            if error > .0001:
                raise ValueError('Carrot socket no longer follows hand midpoint')
            attachment = pixel(scene, socket.matrix_world.translation)
            if not 0 <= attachment['x'] <= 512 or not 0 <= attachment['y'] <= 512:
                raise ValueError('Attachment outside frame')
            if previous:
                max_hand_step = max(max_hand_step, max(
                    ((h['x'] - p['x']) ** 2 + (h['y'] - p['y']) ** 2) ** .5
                    for h, p in zip(hand_pixels, previous)))
            previous = hand_pixels
            series.append(dict(sourceFrame=frame, attachment=attachment, hands=hand_pixels))
            if frame in (1, spec['end']):
                endpoints[(name, frame)] = vertices
        frame_data[name] = series
        reports[name] = dict(sourceFramesEvaluated=len(series),
                             maxHandStepPixelsAt24fps=max_hand_step,
                             socketMidpointMaxErrorWorld=max_socket_error)
    transitions = {}
    pairs = list(zip(SPECS, list(SPECS)[1:] + ['idle']))
    for before, after in pairs + [('idle', 'idle')]:
        a, b = endpoints[(before, SPECS[before]['end'])], endpoints[(after, 1)]
        error = max(float(np.linalg.norm(a[n] - b[n], axis=1).max()) for n in a)
        transitions[f'{before}:{SPECS[before]["end"]}->{after}:1'] = error
        if error > .0001:
            raise ValueError('Action endpoints do not match')
    pull = frame_data['pull']
    peak = min(pull, key=lambda item: item['attachment']['y'])['sourceFrame']
    if peak != 14:
        raise ValueError('Pull peak changed; review mandatory sampling')
    report = dict(status='PASS', allSourceFramesEvaluated=sum(s['end'] for s in SPECS.values()),
                  maximumSoleDriftPixelsUpperBound=max_drift, actions=reports,
                  transitionVertexMaxErrorsWorld=transitions, pullPeakSourceFrame=peak,
                  fixedTransforms=fixed, sourceFrameTrajectories=frame_data)
    return anchor, report, frame_data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--action', choices=['all', *SPECS], default='all')
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--inspect-only', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    root = args.root.resolve()
    source = root / 'assets/blender/rabbit/rabbit_rigged.blend'
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene = bpy.context.scene
    original_camera = camera_snapshot(scene)
    if scene.camera.name != 'Camera_Front_Orthographic' or scene.camera.data.type != 'ORTHO':
        raise ValueError('Expected the Task 2B fixed preview camera')
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = scene.render.pixel_aspect_y = 1
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.render.film_transparent = True
    scene.render.use_border = False
    scene.render.use_file_extension = True
    scene.render.fps = 24
    scene.render.fps_base = 1
    if hasattr(scene.render, 'use_motion_blur'):
        scene.render.use_motion_blur = False
    # Retain the stored lighting, Eevee sampling and view transform.
    rig = bpy.data.objects['Rabbit_Rig']
    anchor, report, trajectory = measure_source(scene, rig)
    render = dict(width=512, height=512, engine=scene.render.engine, colorMode='RGBA',
                  colorDepth=8, transparent=True, sourceFps=24,
                  camera=camera_snapshot(scene), blenderVersion=bpy.app.version_string)
    report.update(sourceSha256=source_hash, anchor=anchor, originalPreviewCamera=original_camera)
    report['sampling'] = {name: sample_frames(name, 1, spec['end'], spec['count'])
                          for name, spec in SPECS.items()}
    write_json(root / 'qa/rabbit/render_validation.json', report)
    print('RABBIT_SOURCE_QA_PASS', json.dumps(report['sampling']), flush=True)
    if args.inspect_only:
        return
    actions = list(SPECS) if args.action == 'all' else [args.action]
    for name in actions:
        spec = SPECS[name]
        action_name = 'Rabbit_' + name.title()
        select_action(rig, bpy.data.actions[action_name])
        output = root / 'assets/rendered/rabbit/frames' / name
        staging = output.with_name('.' + name + '-rendering')
        if staging.exists():
            shutil.rmtree(staging)
        staging.mkdir(parents=True)
        records = []
        fixed = transform_signature(scene)
        for index, source_frame in enumerate(report['sampling'][name]):
            scene.frame_set(source_frame)
            bpy.context.view_layer.update()
            if transform_signature(scene) != fixed:
                raise ValueError('Per-frame camera/scale change detected')
            filename = f'rabbit_{name}_{index:03d}.png'
            scene.render.filepath = str(staging / filename)
            bpy.ops.render.render(write_still=True)
            normalize_png_metadata(staging / filename)
            records.append(dict(index=index, name=filename, sourceFrame=source_frame,
                                durationMs=1000 / spec['fps'],
                                attachment=trajectory[name][source_frame - 1]['attachment']))
            print(f'RABBIT_FRAME {name} {index + 1}/{spec["count"]} source={source_frame}', flush=True)
        manifest = dict(schemaVersion=1, action=name, blenderAction=action_name,
                        sourceSha256=source_hash, render=render, anchor=anchor,
                        frameRate=spec['fps'], repeat=spec['repeat'], frames=records,
                        sourceRange=[1, spec['end']], mandatoryFrames=list(spec['critical']),
                        timing='Uniform recommended game timing; intentional retiming of sampled source poses')
        write_json(staging / 'manifest.json', manifest)
        # Replace only this action after every new frame has rendered successfully.
        if output.exists():
            shutil.rmtree(output)
        staging.rename(output)
    if hashlib.sha256(source.read_bytes()).hexdigest() != source_hash:
        raise ValueError('Source blend changed during render')
    print('RABBIT_RENDER_COMPLETE', ','.join(actions), flush=True)


if __name__ == '__main__':
    main()
