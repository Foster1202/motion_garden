"""Build a hybrid rig from the saved Task 2A asset without changing its geometry."""
import hashlib
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'assets/blender/rabbit/rabbit_base.blend'
RIGGED = ROOT / 'assets/blender/rabbit/rabbit_rigged.blend'


def smoothstep(low, high, value):
    t = max(0.0, min(1.0, (value - low) / (high - low)))
    return t * t * (3 - 2 * t)


def bone_parent(obj, rig, bone_name):
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = rig
    obj.parent_type = 'BONE'
    obj.parent_bone = bone_name
    bpy.context.view_layer.update()
    obj.matrix_world = world
    bpy.context.view_layer.update()


def weight_limb(obj, rig, names, arm):
    world = obj.matrix_world.copy()
    obj.parent = rig
    obj.parent_type = 'OBJECT'
    obj.parent_bone = ''
    obj.matrix_world = world
    obj.vertex_groups.clear()
    groups = [obj.vertex_groups.new(name=name) for name in names]
    for vertex in obj.data.vertices:
        z = (world @ vertex.co).z
        if arm:
            upper = smoothstep(0.98, 1.25, z)
            hand = 1 - smoothstep(0.77, 0.97, z)
            weights = (upper, max(0, 1 - upper - hand), hand)
        else:
            thigh = smoothstep(0.31, 0.44, z)
            foot = 1 - smoothstep(0.10, 0.31, z)
            weights = (thigh, max(0, 1 - thigh - foot), foot)
        for group, weight in zip(groups, weights):
            if weight > 0:
                group.add([vertex.index], weight, 'REPLACE')
    modifier = obj.modifiers.new('Rabbit_Limb_Deform', 'ARMATURE')
    modifier.object = rig
    modifier.use_deform_preserve_volume = True
    obj.modifiers.move(len(obj.modifiers) - 1, 0)
    obj['binding'] = 'Manual normalized vertex weights; Armature then Subdivision'


def build_rig():
    # Reloading the untouched source makes regeneration independent of scene state.
    base_hash = hashlib.sha256(BASE.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    scene = bpy.context.scene
    bpy.ops.object.select_all(action='DESELECT')
    collection = bpy.data.collections['Rabbit_Character']
    armature = bpy.data.armatures.new('Rabbit_Rig_Data')
    rig = bpy.data.objects.new('Rabbit_Rig', armature)
    collection.objects.link(rig)
    rig.parent = bpy.data.objects['Rabbit_Root']
    rig.show_in_front = True
    armature.display_type = 'OCTAHEDRAL'
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')

    def bone(name, head, tail, parent=None, deform=True):
        b = armature.edit_bones.new(name)
        b.head, b.tail = head, tail
        b.use_deform = deform
        if parent:
            b.parent = armature.edit_bones[parent]
        return b

    bone('root', (0, 0, 0), (0, 0, 0.25), deform=False)
    bone('body', (0, 0.025, 0.57), (0, 0.025, 1.45), 'root')
    bone('head', (0, 0, 1.48), (0, 0, 2.43), 'body')
    for suffix, sign in [('L', 1), ('R', -1)]:
        bone('ear.' + suffix, (sign * 0.275, 0.025, 2.47), (sign * 0.47, 0.025, 3.48), 'head')
        bone('upper_arm.' + suffix, (sign * 0.515, -0.005, 1.37), (sign * 0.625, -0.008, 1.11), 'body')
        bone('forearm.' + suffix, (sign * 0.625, -0.008, 1.11), (sign * 0.72, -0.01, 0.865), 'upper_arm.' + suffix)
        bone('hand.' + suffix, (sign * 0.72, -0.01, 0.865), (sign * 0.77, -0.012, 0.77), 'forearm.' + suffix)
        bone('thigh.' + suffix, (sign * 0.265, 0, 0.51), (sign * 0.265, -0.07, 0.32), 'body')
        bone('shin.' + suffix, (sign * 0.265, -0.07, 0.32), (sign * 0.265, -0.04, 0.13), 'thigh.' + suffix)
        bone('foot.' + suffix, (sign * 0.265, -0.04, 0.13), (sign * 0.265, -0.25, 0.13), 'shin.' + suffix)
    bone('tail', (0, 0.35, 0.64), (0, 0.62, 0.64), 'body')
    bone('carrot_socket', (0, -0.50, 1.10), (0, -0.50, 1.25), 'root', deform=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for pose_bone in rig.pose.bones:
        pose_bone.rotation_mode = 'QUATERNION'
    for object_name, bone_name in [('Rabbit_Body', 'body'), ('Rabbit_Head', 'head'),
                                    ('Rabbit_Ear_L', 'ear.L'), ('Rabbit_Ear_R', 'ear.R'),
                                    ('Rabbit_Tail', 'tail')]:
        bone_parent(bpy.data.objects[object_name], rig, bone_name)
    for suffix in ('L', 'R'):
        weight_limb(bpy.data.objects['Rabbit_Arm_' + suffix], rig,
                    ['upper_arm.' + suffix, 'forearm.' + suffix, 'hand.' + suffix], True)
        weight_limb(bpy.data.objects['Rabbit_Leg_' + suffix], rig,
                    ['thigh.' + suffix, 'shin.' + suffix, 'foot.' + suffix], False)
    socket = bpy.data.objects.new('Carrot_Attach_Point', None)
    collection.objects.link(socket)
    socket.empty_display_type = 'SPHERE'
    socket.empty_display_size = 0.055
    socket.matrix_world = Matrix.Translation((0, -0.50, 1.10))
    bone_parent(socket, rig, 'carrot_socket')
    socket['purpose'] = 'Future carrot attachment; animated midpoint of hand bone centers'
    rig['binding_strategy'] = 'Hybrid: rigid bone parents and four manually weighted limbs'
    rig['source_base_sha256'] = base_hash
    rig['foot_contact'] = 'Analytic two-link solve baked to FK; constant foot matrices'
    scene['asset_version'] = 'Task 2B / 1.0'
    scene['rig_status'] = 'Hybrid rig with deterministic baked FK animation'
    bpy.data.objects['Rabbit_Root']['task'] = 'Task 2B: rig and six basic Actions'
    bpy.context.view_layer.update()
    return rig


def save_rigged():
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(RIGGED))


if __name__ == '__main__':
    build_rig()
    save_rigged()
    print('RABBIT_RIG_SAVED', RIGGED)
