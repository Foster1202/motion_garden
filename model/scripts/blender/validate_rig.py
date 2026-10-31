"""Reopen the Task 2B asset and verify bindings, animation, and preview files."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
ACTION_ENDS = {
    'Rabbit_Idle': 48, 'Rabbit_Bend': 16, 'Rabbit_Grab': 16,
    'Rabbit_Return': 16, 'Rabbit_Pull': 20, 'Rabbit_Celebrate': 32,
}
BONES = {'root', 'body', 'head', 'ear.L', 'ear.R', 'tail', 'carrot_socket'}
for SIDE in ('L', 'R'):
    BONES.update(part + '.' + SIDE for part in
                 ('upper_arm', 'forearm', 'hand', 'thigh', 'shin', 'foot'))
SOLE_TOLERANCE = 0.005
POSE_TOLERANCE = 0.0001


def arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-root', type=Path, default=ROOT)
    parser.add_argument('--skip-previews', action='store_true')
    return parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])


def world_vertices(obj, graph):
    evaluated = obj.evaluated_get(graph)
    mesh = evaluated.to_mesh()
    try:
        vertices = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
        mesh.vertices.foreach_get('co', vertices)
        vertices = vertices.reshape((-1, 3))
        matrix = np.array(evaluated.matrix_world, dtype=np.float64)
        return vertices @ matrix[:3, :3].T + matrix[:3, 3]
    finally:
        evaluated.to_mesh_clear()


def geometry_snapshot():
    graph = bpy.context.evaluated_depsgraph_get()
    return {obj.name: world_vertices(obj, graph)
            for obj in bpy.data.collections['Rabbit_Character'].all_objects
            if obj.type in {'MESH', 'CURVE'}}


def camera_snapshot(scene):
    return {
        'name': scene.camera.name,
        'matrix_world': [list(row) for row in scene.camera.matrix_world],
        'type': scene.camera.data.type,
        'ortho_scale': scene.camera.data.ortho_scale,
        'lens': scene.camera.data.lens,
        'engine': scene.render.engine,
        'resolution': [scene.render.resolution_x, scene.render.resolution_y,
                       scene.render.resolution_percentage],
        'color_mode': scene.render.image_settings.color_mode,
        'film_transparent': scene.render.film_transparent,
        'view_transform': scene.view_settings.view_transform,
        'exposure': scene.view_settings.exposure,
    }


def material_snapshot():
    result = {}
    for mat in bpy.data.materials:
        if not mat.name.startswith('Rabbit_'):
            continue
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        assert bsdf, 'Missing Principled material: ' + mat.name
        result[mat.name] = {
            'diffuse': list(mat.diffuse_color),
            'base_color': list(bsdf.inputs['Base Color'].default_value),
            'roughness': bsdf.inputs['Roughness'].default_value,
            'metallic': bsdf.inputs['Metallic'].default_value,
            'nodes': sorted(node.bl_idname for node in mat.node_tree.nodes),
            'links': sorted((link.from_node.bl_idname, link.from_socket.name,
                             link.to_node.bl_idname, link.to_socket.name)
                            for link in mat.node_tree.links),
        }
    return result


def action_curves(action):
    """Read Blender's layered channel bags, with a legacy fallback."""
    curves = []
    for layer in getattr(action, 'layers', ()):
        for strip in layer.strips:
            for bag in getattr(strip, 'channelbags', ()):
                curves.extend(bag.fcurves)
    if not curves:
        curves.extend(getattr(action, 'fcurves', ()))
    return curves


def select_action(rig, action):
    rig.animation_data_create()
    rig.animation_data.action = action
    if getattr(action, 'slots', None):
        rig.animation_data.action_slot = action.slots[0]


def camera_bounds(scene, vertices):
    matrix = np.array(scene.camera.matrix_world.inverted(), dtype=np.float64)
    points = vertices @ matrix[:3, :3].T + matrix[:3, 3]
    corners = scene.camera.data.view_frame(scene=scene)
    x0, x1 = min(v.x for v in corners), max(v.x for v in corners)
    y0, y1 = min(v.y for v in corners), max(v.y for v in corners)
    normalized = np.column_stack(((points[:, 0] - x0) / (x1 - x0),
                                  (points[:, 1] - y0) / (y1 - y0)))
    assert np.max(points[:, 2]) < 0, 'Geometry is behind the camera'
    return np.min(normalized, axis=0), np.max(normalized, axis=0)


def preview_report(path):
    assert path.is_file(), 'Missing preview: ' + str(path)
    image = bpy.data.images.load(str(path), check_existing=False)
    try:
        assert tuple(image.size) == (1024, 1024), 'Wrong PNG size: ' + path.name
        assert image.channels == 4, 'Missing PNG alpha: ' + path.name
        pixels = np.empty(1024 * 1024 * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        alpha = pixels.reshape((1024, 1024, 4))[:, :, 3]
        assert np.max(alpha[0]) == np.max(alpha[-1]) == 0, path.name + ': vertical clipping'
        assert np.max(alpha[:, 0]) == np.max(alpha[:, -1]) == 0, path.name + ': horizontal clipping'
        assert np.max(alpha) == 1, path.name + ': empty or translucent render'
        ys, xs = np.where(alpha > 0.01)
        assert len(xs) > 10000, path.name + ': unexpectedly small silhouette'
        return {
            'path': str(path), 'resolution': [1024, 1024], 'channels': 4,
            'all_border_pixels_transparent': True,
            'transparent_fraction': float(np.mean(alpha == 0)),
            'silhouette_bounds_pixels_bottom_origin':
                [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        }
    finally:
        bpy.data.images.remove(image)


def validate(root, skip_previews=False):
    base = root / 'assets/blender/rabbit/rabbit_base.blend'
    rigged = root / 'assets/blender/rabbit/rabbit_rigged.blend'
    base_digest = hashlib.sha256(base.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(base))
    base_vertices = geometry_snapshot()
    base_camera = camera_snapshot(bpy.context.scene)
    base_materials = material_snapshot()
    base_objects = set(bpy.data.objects.keys())
    base_mesh_counts = {name: (len(bpy.data.objects[name].data.vertices),
                               len(bpy.data.objects[name].data.polygons))
                        for name in base_vertices if bpy.data.objects[name].type == 'MESH'}
    base_slots = {name: [slot.material.name for slot in bpy.data.objects[name].material_slots]
                  for name in base_vertices}
    sole_indices = {side: np.where(base_vertices['Rabbit_Leg_' + side][:, 2]
                                  <= base_vertices['Rabbit_Leg_' + side][:, 2].min() + 0.01)[0]
                    for side in ('L', 'R')}

    bpy.ops.wm.open_mainfile(filepath=str(rigged))
    scene = bpy.context.scene
    rig = bpy.data.objects.get('Rabbit_Rig')
    assert rig and rig.type == 'ARMATURE', 'Missing Rabbit_Rig armature'
    assert rig.get('source_base_sha256') == base_digest, 'Rig source does not match current base file'
    assert len([obj for obj in bpy.data.objects if obj.type == 'ARMATURE']) == 1
    assert BONES <= set(rig.data.bones.keys()), 'Missing required bones'
    assert set(bpy.data.actions.keys()) == set(ACTION_ENDS), 'Unexpected or missing Actions'
    assert set(bpy.data.objects.keys()) == base_objects | {'Rabbit_Rig', 'Carrot_Attach_Point'}, \
        'Unexpected, duplicated, or missing objects'
    assert all(obj.users_collection for obj in bpy.data.objects), 'Unlinked orphan object'
    assert camera_snapshot(scene) == base_camera, 'Camera or render settings changed from Task 2A'
    assert scene.render.fps == 24 and scene.render.fps_base == 1
    assert scene.render.engine == 'BLENDER_EEVEE'
    assert scene.render.resolution_x == scene.render.resolution_y == 1024
    assert scene.render.film_transparent and scene.render.image_settings.color_mode == 'RGBA'
    assert bpy.data.objects['Studio_Ground'].hide_render
    assert material_snapshot() == base_materials, 'Original rabbit material changed or missing'
    assert not any(image.source == 'FILE' for image in bpy.data.images), 'Unexpected external textures'

    binding = {'bone_parent': {}, 'armature_modifier': {}, 'inherited_parent': {}}
    for name in base_vertices:
        obj = bpy.data.objects[name]
        assert obj.parent is not None, name + ': unparented character part'
        assert [slot.material.name for slot in obj.material_slots] == base_slots[name]
        if name in base_mesh_counts:
            assert (len(obj.data.vertices), len(obj.data.polygons)) == base_mesh_counts[name], \
                name + ': base topology changed'
        for modifier in obj.modifiers:
            assert modifier.show_viewport and modifier.show_render, name + ': disabled modifier'
            assert modifier.type in {'SUBSURF', 'ARMATURE'}, name + ': unexpected modifier'
            if modifier.type == 'SUBSURF':
                assert modifier.levels == modifier.render_levels == 1
        modifiers = [modifier for modifier in obj.modifiers if modifier.type == 'ARMATURE']
        if modifiers:
            assert len(modifiers) == 1 and modifiers[0].object == rig
            # Subdivision smooths the deformed base mesh at the short limb joints.
            assert obj.modifiers[0] == modifiers[0], name + ': Armature must precede subdivision'
            groups = {group.index: group.name for group in obj.vertex_groups}
            for vertex in obj.data.vertices:
                weights = [group.weight for group in vertex.groups
                           if groups[group.group] in rig.data.bones]
                assert abs(sum(weights) - 1) < 0.00001, name + ': unnormalized deformation weights'
            binding['armature_modifier'][name] = list(groups.values())
        elif obj.parent_type == 'BONE':
            assert obj.parent == rig and obj.parent_bone in rig.data.bones
            binding['bone_parent'][name] = obj.parent_bone
        else:
            binding['inherited_parent'][name] = obj.parent.name
    for side in ('L', 'R'):
        assert bpy.data.objects['Rabbit_InnerEar_' + side].parent.name == 'Rabbit_Ear_' + side
        assert bpy.data.objects['Rabbit_Eye_' + side].parent.name == 'Rabbit_Head'
        assert bpy.data.objects['Rabbit_Cheek_' + side].parent.name == 'Rabbit_Head'
        assert bpy.data.objects['Rabbit_EyeHighlight_' + side].parent.name == 'Rabbit_Eye_' + side
    socket = bpy.data.objects.get('Carrot_Attach_Point')
    assert socket and socket.type == 'EMPTY'
    assert socket.parent == rig and socket.parent_type == 'BONE'
    assert socket.parent_bone == 'carrot_socket'

    rig.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    rest_vertices = geometry_snapshot()
    rest_error = max(float(np.max(np.linalg.norm(rest_vertices[name] - base_vertices[name], axis=1)))
                     for name in base_vertices)
    assert rest_error <= POSE_TOLERANCE, 'Rig changed original rest geometry: ' + str(rest_error)
    rig.data.pose_position = 'POSE'
    actions, endpoints = {}, {}
    total_frames, max_sole_drift, max_socket_error = 0, 0.0, 0.0
    for name, end in ACTION_ENDS.items():
        action = bpy.data.actions[name]
        assert action.use_fake_user, name + ': Action is not retained'
        curves = action_curves(action)
        assert curves and all(len(curve.keyframe_points) >= 2 for curve in curves), name + ': empty channels'
        frames = [float(key.co.x) for curve in curves for key in curve.keyframe_points]
        assert min(frames) == 1 and max(frames) == end, name + ': keyframe range mismatch'
        assert tuple(action.frame_range) == (1, end), name + ': Action range mismatch'
        assert all(np.isfinite(key.co.y) for curve in curves for key in curve.keyframe_points)
        select_action(rig, action)
        minimum, maximum = np.ones(2), np.zeros(2)
        drift, socket_error, minimum_z = 0.0, 0.0, float('inf')
        motion_extent, starting_vertices = 0.0, None
        for frame in range(1, end + 1):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            vertices = geometry_snapshot()
            all_vertices = np.concatenate(list(vertices.values()), axis=0)
            assert np.all(np.isfinite(all_vertices)), name + ': nonfinite deformation'
            if starting_vertices is None:
                starting_vertices = all_vertices.copy()
            motion_extent = max(motion_extent, float(np.max(np.linalg.norm(
                all_vertices - starting_vertices, axis=1))))
            minimum_z = min(minimum_z, float(np.min(all_vertices[:, 2])))
            low, high = camera_bounds(scene, all_vertices)
            minimum, maximum = np.minimum(minimum, low), np.maximum(maximum, high)
            for side in ('L', 'R'):
                leg = 'Rabbit_Leg_' + side
                ids = sole_indices[side]
                drift = max(drift, float(np.max(np.linalg.norm(vertices[leg][ids] - base_vertices[leg][ids], axis=1))))
            midpoint = rig.matrix_world @ ((rig.pose.bones['hand.L'].head
                                           + rig.pose.bones['hand.L'].tail
                                           + rig.pose.bones['hand.R'].head
                                           + rig.pose.bones['hand.R'].tail) * 0.25)
            socket_error = max(socket_error, (socket.matrix_world.translation - midpoint).length)
            if frame in (1, end):
                endpoints[(name, frame)] = vertices
            total_frames += 1
        assert np.min(minimum) > 0.01 and np.max(maximum) < 0.99, name + ': camera cropping'
        assert minimum_z >= -0.001, name + ': geometry penetrates ground'
        assert motion_extent > 0.001, name + ': no meaningful evaluated mesh movement'
        assert drift <= SOLE_TOLERANCE, name + ': foot slide/contact drift ' + str(drift)
        assert socket_error <= POSE_TOLERANCE, name + ': socket not between hand controls ' + str(socket_error)
        max_sole_drift, max_socket_error = max(max_sole_drift, drift), max(max_socket_error, socket_error)
        actions[name] = {
            'range': [1, end], 'frames_evaluated': end, 'fcurve_count': len(curves),
            'keyframe_count': len(frames), 'sole_max_drift': drift,
            'maximum_vertex_movement_from_first_frame': motion_extent,
            'feet_and_geometry_minimum_z': minimum_z, 'socket_max_midpoint_error': socket_error,
            'camera_normalized_bounds': {'minimum': minimum.tolist(), 'maximum': maximum.tolist()},
        }
    transitions = {}
    names = list(ACTION_ENDS)
    pairs = [((names[index], ACTION_ENDS[names[index]]), (names[(index + 1) % len(names)], 1))
             for index in range(len(names))]
    pairs.append((('Rabbit_Idle', 1), ('Rabbit_Idle', 48)))
    for first, second in pairs:
        error = max(float(np.max(np.linalg.norm(endpoints[first][name] - endpoints[second][name], axis=1)))
                    for name in base_vertices)
        label = f'{first[0]}:{first[1]} -> {second[0]}:{second[1]}'
        transitions[label] = error
        assert error <= POSE_TOLERANCE, label + ': pose mismatch ' + str(error)

    previews = {}
    if not skip_previews:
        for name in ACTION_ENDS:
            path = root / 'assets/rendered/rabbit/animation_previews' / (name.lower() + '_preview.png')
            previews[name] = preview_report(path)
        assert len({item['sha256'] for item in previews.values()}) == 6, 'Duplicate action previews'
    assert hashlib.sha256(base.read_bytes()).hexdigest() == base_digest, 'Base asset modified during validation'
    return {
        'status': 'PASS', 'blender_version': bpy.app.version_string,
        'saved_blend_reopened': str(rigged), 'base_sha256': base_digest,
        'bone_count': len(rig.data.bones),
        'bone_hierarchy': {bone.name: bone.parent.name if bone.parent else None for bone in rig.data.bones},
        'bindings': binding, 'rest_geometry_max_error': rest_error,
        'materials_unchanged': True, 'base_topology_unchanged': True, 'camera_unchanged': True,
        'camera': camera_snapshot(scene), 'fps': scene.render.fps, 'actions': actions,
        'evaluated_animation_frames': total_frames, 'maximum_sole_drift': max_sole_drift,
        'sole_drift_tolerance': SOLE_TOLERANCE, 'maximum_socket_midpoint_error': max_socket_error,
        'transition_max_vertex_errors': transitions, 'transition_tolerance': POSE_TOLERANCE,
        'previews': previews, 'previews_checked': not skip_previews,
        'limitations': ['Vertex and binding checks do not replace visual review of self-intersection or silhouette.'],
    }


def main():
    args = arguments()
    root = args.output_root.resolve()
    destination = root / 'rabbit_rig_validation.json'
    try:
        report = validate(root, args.skip_previews)
    except Exception as error:
        destination.write_text(json.dumps({'status': 'FAIL', 'error': str(error)}, indent=2) + '\n')
        raise
    destination.write_text(json.dumps(report, indent=2) + '\n')
    print('RABBIT_RIG_VALIDATION', json.dumps(report))


if __name__ == '__main__':
    main()
