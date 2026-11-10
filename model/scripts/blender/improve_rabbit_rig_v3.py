"""Derive the articulated V3 rig from the preserved V2 source."""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'assets/blender/rabbit/rabbit_realtime_v2.blend'
OUTPUT = ROOT / 'assets/blender/rabbit/rabbit_realtime_v3.blend'
SHOULDER_X = 0.77
SHOULDER_Z = 1.65
ARM_REST_SPLAY = 6.0
HEAD_LIFT = 0.18
LIMITS = {
    'arm': {'min': -12, 'max': 150}, 'forearm': {'min': 0, 'max': 110},
    'bodySide': 18, 'bodyForward': 16, 'headYaw': 25, 'headPitch': 18,
    'headRoll': 14, 'headMotionEnvelope': 40, 'knee': 24, 'legExtension': 32,
    'root': {'x': 0.45, 'y': 0.04, 'z': 0.12},
}
ELBOW_ENVELOPE = [[0, 110], [75, 110], [90, 75], [105, 60], [120, 45], [135, 20], [150, 0]]
HEAD_ENVELOPE = [[0, 40], [75, 25], [90, 20], [105, 15], [120, 10], [135, 5], [150, 0]]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def smoothstep(low, high, value):
    amount = max(0.0, min(1.0, (value - low) / (high - low)))
    return amount * amount * (3.0 - 2.0 * amount)


def bind_surface(obj, surface, vertices, weights, names, rig):
    old_mesh = obj.data
    mesh = bpy.data.meshes.new(obj.name + '_JointSurfaceV3')
    mesh.from_pydata(vertices, [], surface['faces'])
    mesh.update()
    mesh.materials.append(surface['material'])
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj.data = mesh
    obj.matrix_world = Matrix.Identity(4)
    obj.vertex_groups.clear()
    groups = [obj.vertex_groups.new(name=name) for name in names]
    for index, values in enumerate(weights):
        total = sum(values)
        for group, weight in zip(groups, values):
            if weight > 0.0:
                group.add([index], weight / total, 'REPLACE')
    obj.modifiers.clear()
    modifier = obj.modifiers.new('Rabbit_LBS_Deform_V3', 'ARMATURE')
    modifier.object = rig
    modifier.use_deform_preserve_volume = False
    obj['binding'] = 'V2 rounded rest surface with static subdivision before joint-aligned linear skinning'
    if old_mesh.users == 0:
        bpy.data.meshes.remove(old_mesh)


def rebuild_arm(obj, rig, side, surface, original_bones):
    shoulder = rig.data.bones['upper_arm.' + side].head_local.copy()
    elbow = rig.data.bones['forearm.' + side].head_local.copy()
    wrist = rig.data.bones['hand.' + side].head_local.copy()
    direction = (elbow - shoulder).normalized()
    original = original_bones['upper_arm.' + side]
    original_shoulder = Vector(original['head'])
    original_direction = (Vector(original['tail']) - original_shoulder).normalized()
    rotation = original_direction.rotation_difference(direction)
    vertices = [shoulder + rotation @ (point - original_shoulder) for point in surface['vertices']]
    upper_length = (elbow - shoulder).length
    wrist_distance = (wrist - shoulder).dot(direction)
    weights = []
    for point in vertices:
        parameter = (point - shoulder).dot(direction)
        upper = 1.0 - smoothstep(upper_length - 0.15, upper_length + 0.15, parameter)
        hand = smoothstep(wrist_distance - 0.05, wrist_distance + 0.05, parameter)
        weights.append((upper, max(0.0, 1.0 - upper - hand), hand))
    bind_surface(obj, surface, vertices, weights,
                 [name + '.' + side for name in ['upper_arm', 'forearm', 'hand']], rig)


def rebuild_leg(obj, rig, side, surface):
    knee = rig.data.bones['shin.' + side].head_local
    ankle = rig.data.bones['foot.' + side].head_local
    weights = []
    for point in surface['vertices']:
        thigh = smoothstep(knee.z - 0.095, knee.z + 0.095, point.z)
        foot = 1.0 - smoothstep(ankle.z - 0.06, ankle.z + 0.10, point.z)
        weights.append((thigh, max(0.0, 1.0 - thigh - foot), foot))
    bind_surface(obj, surface, surface['vertices'], weights,
                 [name + '.' + side for name in ['thigh', 'shin', 'foot']], rig)


def shoulder_connector(rig, side, sign):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=28, ring_count=16, radius=1,
                                       location=(sign * 0.530, -0.015, SHOULDER_Z - 0.025))
    obj = bpy.context.object
    obj.name = 'Rabbit_Shoulder_' + side
    obj.scale = (0.260, 0.145, 0.135)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    bpy.data.collections['Rabbit_Character'].objects.link(obj)
    obj.data.materials.append(bpy.data.objects['Rabbit_Body'].data.materials[0])
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    world = obj.matrix_world.copy()
    obj.parent = rig
    obj.parent_type = 'BONE'
    obj.parent_bone = 'body'
    bpy.context.view_layer.update()
    obj.matrix_world = world
    obj['purpose'] = 'Rounded body-side shoulder connection around the movable upper-arm pivot'


def build(output):
    protected = [ROOT / 'assets/blender/rabbit' / name for name in
                 ['rabbit_base.blend', 'rabbit_rigged.blend', 'rabbit_realtime_v2.blend']]
    protected.append(ROOT / 'dist/rabbit3d/rabbit_realtime.glb')
    if output.resolve() in {path.resolve() for path in protected}:
        raise ValueError('V3 output must be separate from all preserved assets')
    before = {str(path.relative_to(ROOT)): digest(path) for path in protected}
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    rig = bpy.data.objects['Rabbit_Rig']
    for obj in bpy.data.objects:
        obj.animation_data_clear()
    for pose in rig.pose.bones:
        pose.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    collection = bpy.data.collections['Rabbit_Character']
    worlds = {obj.name: obj.matrix_world.copy() for obj in collection.all_objects}
    original_bones = {bone.name: {'head': list(bone.head_local), 'tail': list(bone.tail_local),
                                  'length': bone.length, 'parent': bone.parent.name if bone.parent else None}
                      for bone in rig.data.bones}

    def head_part(obj):
        current = obj
        while current:
            if current.parent_type == 'BONE':
                return current.parent_bone in {'head', 'ear.L', 'ear.R'}
            current = current.parent
        return False

    surfaces = {}
    graph = bpy.context.evaluated_depsgraph_get()
    for name in ['Rabbit_Arm_L', 'Rabbit_Arm_R', 'Rabbit_Leg_L', 'Rabbit_Leg_R']:
        obj = bpy.data.objects[name]
        evaluated = obj.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        surfaces[name] = {'vertices': [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices],
                          'faces': [tuple(polygon.vertices) for polygon in mesh.polygons],
                          'material': obj.data.materials[0]}
        evaluated.to_mesh_clear()
    head_names = {obj.name for obj in collection.all_objects if head_part(obj)}
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    for name in ['head', 'ear.L', 'ear.R']:
        bone = rig.data.edit_bones[name]
        bone.head.z += HEAD_LIFT
        bone.tail.z += HEAD_LIFT
    for side, sign in [('L', 1), ('R', -1)]:
        direction = Vector((sign * math.sin(math.radians(ARM_REST_SPLAY)), 0,
                            -math.cos(math.radians(ARM_REST_SPLAY))))
        position = Vector((sign * SHOULDER_X, -0.025, SHOULDER_Z))
        for name in ['upper_arm', 'forearm', 'hand']:
            bone = rig.data.edit_bones[name + '.' + side]
            bone.use_connect = False
            bone.head = position
            bone.tail = position + direction * original_bones[bone.name]['length']
            bone.align_roll(Vector((0, -1, 0)))
            position = bone.tail.copy()
        rig.data.edit_bones['forearm.' + side].use_connect = True
        rig.data.edit_bones['hand.' + side].use_connect = True
    socket = rig.data.edit_bones['carrot_socket']
    socket.head = (0, -0.50, 1.30)
    socket.tail = (0, -0.50, 1.468)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.update()

    def depth(obj):
        return 1 + depth(obj.parent) if obj.parent else 0

    lift = Matrix.Translation((0, 0, HEAD_LIFT))
    for obj in sorted(collection.all_objects, key=depth):
        if obj.name in head_names:
            obj.matrix_world = lift @ worlds[obj.name]
            bpy.context.view_layer.update()
    for side, sign in [('L', 1), ('R', -1)]:
        rebuild_arm(bpy.data.objects['Rabbit_Arm_' + side], rig, side, surfaces['Rabbit_Arm_' + side], original_bones)
        rebuild_leg(bpy.data.objects['Rabbit_Leg_' + side], rig, side, surfaces['Rabbit_Leg_' + side])
        shoulder_connector(rig, side, sign)
    bpy.data.objects['Carrot_Attach_Point'].matrix_world = Matrix.Translation((0, -0.50, 1.30))
    rig['rig_version'] = 'v3'
    rig['rig_motion_limits'] = json.dumps(LIMITS, sort_keys=True)
    rig['elbow_limits_by_raise'] = json.dumps(ELBOW_ENVELOPE)
    rig['head_limits_by_raise'] = json.dumps(HEAD_ENVELOPE)
    rig['rig_v3_source_sha256'] = before['assets/blender/rabbit/rabbit_realtime_v2.blend']
    rig['binding_strategy'] = 'V2 proportions and rounded rest surfaces with joint-aligned linear blend skinning'
    rig['carrot_socket_semantics'] = 'Root-parented nominal two-hand grasp at front of lower chest; independently controllable for future hand midpoint updates'
    metrics = {
        'version': 'rabbit-realtime-v3', 'source': str(SOURCE.relative_to(ROOT)),
        'protected_sha256': before, 'v2_proportions_preserved': json.loads(rig['proportion_metrics']),
        'shoulder_x': SHOULDER_X, 'shoulder_height': SHOULDER_Z,
        'arm_rest_splay_degrees': ARM_REST_SPLAY, 'head_translation_z': HEAD_LIFT,
        'head_scale_change': 1.0, 'arm_chain_scale_change': 1.0, 'leg_chain_scale_change': 1.0,
        'bone_count': len(rig.data.bones), 'bones_before': original_bones,
        'bones_after': {bone.name: {'head': list(bone.head_local), 'tail': list(bone.tail_local),
                                  'length': bone.length, 'parent': bone.parent.name if bone.parent else None}
                        for bone in rig.data.bones},
        'mesh_strategy': 'Preserved evaluated V2 rest surfaces with static subdivision before LBS',
        'weight_blend_spans': {'elbow': 0.30, 'wrist': 0.10, 'knee': 0.19, 'ankle': 0.16},
        'runtime_limits': LIMITS,
        'elbow_limits_by_raise': ELBOW_ENVELOPE,
        'head_limits_by_raise': HEAD_ENVELOPE,
        'limits_status': 'Sampled joint envelope, rerun Blender and exported Three.js acceptance after generation',
    }
    assert len(rig.data.bones) == 19
    for name, original in original_bones.items():
        parent = rig.data.bones[name].parent
        assert (parent.name if parent else None) == original['parent']
        if name.startswith(('upper_arm', 'forearm', 'hand', 'thigh', 'shin', 'foot')):
            assert abs(rig.data.bones[name].length - original['length']) < 1e-5
    bpy.context.scene['asset_version'] = 'Realtime V3 shoulder and skin improvement'
    bpy.context.preferences.filepaths.save_version = 0
    bpy.context.view_layer.update()
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output))
    assert all(digest(path) == before[str(path.relative_to(ROOT))] for path in protected)
    report = ROOT / 'dist/rabbit3d/rabbit_v3_rig_changes.json'
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(metrics, indent=2) + '\n')
    print('RABBIT_V3', json.dumps({'source': str(SOURCE), 'output': str(output),
                                  'bones': len(rig.data.bones), 'report': str(report)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=OUTPUT)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if args.output.resolve() == SOURCE.resolve():
        raise ValueError('V3 output must be separate from its preserved V2 source')
    build(args.output)
