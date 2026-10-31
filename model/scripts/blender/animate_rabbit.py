"""Create six compatible Actions on the original rabbit and render key poses."""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rig_rabbit import ROOT, BASE, RIGGED, build_rig, save_rigged

PREVIEWS = ROOT / 'assets/rendered/rabbit/animation_previews'
ACTION_SPECS = {'Rabbit_Idle': (48, 13), 'Rabbit_Bend': (16, 16),
                'Rabbit_Grab': (16, 16), 'Rabbit_Return': (16, 16),
                'Rabbit_Pull': (20, 14), 'Rabbit_Celebrate': (32, 12)}


def state(drop=0, lean=0, head=0, wrist=(0.72, -0.01, 0.865),
          tip=(0.77, -0.012, 0.77), ears=0, sway=0):
    return dict(drop=drop, lean=lean, head=head, wrist=Vector(wrist), tip=Vector(tip), ears=ears, sway=sway)


NEUTRAL = state()
BEND = state(.10, .018, .015, (.67, -.20, .87), (.67, -.29, .80), -.025)
GRAB = state(.10, .050, .055, (.26, -.43, 1.11), (.19, -.51, 1.09), -.035)
RETURN = state(.015, .010, 0, (.26, -.43, 1.275), (.19, -.51, 1.255), -.01)
PULL = state(0, -.035, -.025, (.27, -.43, 1.47), (.20, -.51, 1.45), .018)
PULL_PEAK = state(0, -.045, -.028, (.27, -.42, 1.51), (.20, -.50, 1.49), -.018)
CELEBRATE = state(-.006, -.012, -.012, (.85, -.10, 1.72), (.90, -.11, 1.80), .028, .025)


def blend(a, b, fraction):
    t = max(0, min(1, fraction))
    t = t * t * (3 - 2 * t)
    return {key: a[key] * (1 - t) + b[key] * t for key in a}


def around(point, rotation):
    return Matrix.Translation(point) @ rotation @ Matrix.Translation(-Vector(point))


def solve_joint(start, end, length_a, length_b, pole):
    vector = end - start
    distance = vector.length
    assert abs(length_a - length_b) + 1e-5 < distance < length_a + length_b + 1e-5, 'Unreachable limb target'
    direction = vector.normalized()
    along = (length_a * length_a - length_b * length_b + distance * distance) / (2 * distance)
    height = math.sqrt(max(0, length_a * length_a - along * along))
    side = pole - direction * pole.dot(direction)
    if side.length < 1e-5:
        side = direction.cross(Vector((1, 0, 0)))
    return start + direction * along + side.normalized() * height


def aim(rest, start, end):
    rotation = (rest.tail_local - rest.head_local).rotation_difference(end - start)
    matrix = rotation.to_matrix().to_4x4() @ rest.matrix_local
    matrix.translation = start
    return matrix


def matrices(rig, pose):
    rest = rig.data.bones
    result = {'root': rest['root'].matrix_local.copy()}
    body_transform = Matrix.Translation((0, 0, -pose['drop'])) @ around(rest['body'].head_local, Matrix.Rotation(pose['lean'], 4, 'X'))
    result['body'] = body_transform @ rest['body'].matrix_local
    head_transform = body_transform @ around(rest['head'].head_local,
                                             Matrix.Rotation(pose['head'], 4, 'X') @ Matrix.Rotation(pose['sway'], 4, 'Y'))
    result['head'] = head_transform @ rest['head'].matrix_local
    result['tail'] = body_transform @ rest['tail'].matrix_local
    palms = []
    for suffix, sign in [('L', 1), ('R', -1)]:
        ear = rest['ear.' + suffix]
        ear_transform = around(ear.head_local, Matrix.Rotation(pose['ears'], 4, 'X') @ Matrix.Rotation(sign * pose['ears'] * .45, 4, 'Y'))
        result[ear.name] = head_transform @ ear_transform @ ear.matrix_local
        upper, forearm, hand = [rest[name + '.' + suffix] for name in ('upper_arm', 'forearm', 'hand')]
        shoulder = body_transform @ upper.head_local
        wrist = pose['wrist'].copy()
        tip = pose['tip'].copy()
        wrist.x *= sign
        tip.x *= sign
        pole = Vector((sign, -.22, 0))
        # Use the original bend plane at the exact neutral pose.
        if (wrist - forearm.tail_local).length < 1e-6 and abs(pose['drop']) < 1e-6:
            elbow = upper.tail_local.copy()
        else:
            elbow = solve_joint(shoulder, wrist, upper.length, forearm.length, pole)
        result[upper.name] = aim(upper, shoulder, elbow)
        result[forearm.name] = aim(forearm, elbow, wrist)
        direction = (tip - wrist).normalized()
        hand_end = wrist + direction * hand.length
        result[hand.name] = aim(hand, wrist, hand_end)
        palms.append((wrist + hand_end) * .5)
        thigh, shin, foot = [rest[name + '.' + suffix] for name in ('thigh', 'shin', 'foot')]
        hip = body_transform @ thigh.head_local
        ankle = foot.head_local.copy()
        knee = solve_joint(hip, ankle, thigh.length, shin.length, Vector((0, -1, 0)))
        result[thigh.name] = aim(thigh, hip, knee)
        result[shin.name] = aim(shin, knee, ankle)
        result[foot.name] = foot.matrix_local.copy()
    socket = rest['carrot_socket'].matrix_local.copy()
    socket.translation = (palms[0] + palms[1]) * .5
    result['carrot_socket'] = socket
    return result


def frame_state(action, frame):
    end = ACTION_SPECS[action][0]
    t = (frame - 1) / (end - 1)
    if action == 'Rabbit_Idle':
        pose = state()
        pose['drop'] = -.008 * math.sin(math.pi * t) ** 2
        pose['wrist'].z -= pose['drop']
        pose['tip'].z -= pose['drop']
        pose['head'] = .008 * math.sin(math.tau * t)
        pose['sway'] = .007 * math.sin(math.tau * t)
        pose['ears'] = .012 * math.sin(math.tau * t)
        return pose
    if action == 'Rabbit_Bend':
        return blend(NEUTRAL, BEND, t)
    if action == 'Rabbit_Grab':
        return blend(BEND, GRAB, t)
    if action == 'Rabbit_Return':
        return blend(GRAB, RETURN, t)
    if action == 'Rabbit_Pull':
        if frame <= 5:
            return RETURN.copy()
        if frame <= 14:
            return blend(RETURN, PULL_PEAK, (frame - 5) / 9)
        return blend(PULL_PEAK, PULL, (frame - 14) / 6)
    if frame <= 12:
        return blend(PULL, CELEBRATE, (frame - 1) / 11)
    if frame <= 20:
        pose = CELEBRATE.copy()
        phase = (frame - 12) / 8
        pose['sway'] = .025 * math.cos(math.tau * phase)
        pose['ears'] = .028 + .012 * math.sin(math.tau * phase)
        return pose
    return blend(CELEBRATE, NEUTRAL, (frame - 20) / 12)


def action_curves(action):
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield from bag.fcurves


def select_action(rig, action):
    rig.animation_data_create()
    rig.animation_data.action = action
    if action.slots:
        rig.animation_data.action_slot = action.slots[0]
    if action.get('frame_end'):
        bpy.context.scene.frame_start = 1
        bpy.context.scene.frame_end = int(action['frame_end'])


def create_actions(rig):
    rig.animation_data_clear()
    for action in list(bpy.data.actions):
        if action.name in ACTION_SPECS:
            bpy.data.actions.remove(action)
    scene = bpy.context.scene
    scene.render.fps = 24
    scene.render.fps_base = 1
    for name, (end, preview) in ACTION_SPECS.items():
        action = bpy.data.actions.new(name)
        action.use_fake_user = True
        action['loop'] = name == 'Rabbit_Idle'
        action['preview_frame'] = preview
        action['frame_start'] = 1
        action['frame_end'] = end
        action['fps'] = 24
        action['motion_note'] = 'Fixed foot transforms; deterministic baked FK; no dynamics'
        select_action(rig, action)
        for frame in range(1, end + 1):
            scene.frame_set(frame)
            desired = matrices(rig, frame_state(name, frame))
            for bone in rig.pose.bones:
                bone.matrix = desired[bone.name]
                bpy.context.view_layer.update()
                bone.keyframe_insert('location', frame=frame, group=bone.name)
                bone.keyframe_insert('rotation_quaternion', frame=frame, group=bone.name)
                bone.keyframe_insert('scale', frame=frame, group=bone.name)
        for curve in action_curves(action):
            for key in curve.keyframe_points:
                key.interpolation = 'LINEAR'
        print('RABBIT_ACTION', name, list(action.frame_range))
    select_action(rig, bpy.data.actions['Rabbit_Idle'])
    scene.frame_start, scene.frame_end = 1, 48
    scene.frame_set(1)
    bpy.context.view_layer.update()


def write_report(rig):
    report = {
        'blender_version': bpy.app.version_string,
        'source_base_sha256': rig['source_base_sha256'],
        'source_base_unchanged': rig['source_base_sha256'] == hashlib.sha256(BASE.read_bytes()).hexdigest(),
        'fps': 24, 'front': '-Y', 'bone_count': len(rig.data.bones),
        'bones': [{'name': b.name, 'parent': b.parent.name if b.parent else None,
                   'rest_head': list(b.head_local), 'rest_tail': list(b.tail_local)} for b in rig.data.bones],
        'bone_parent_objects': {o.name: o.parent_bone for o in bpy.data.objects if o.parent == rig and o.parent_type == 'BONE'},
        'armature_modifier_objects': [o.name for o in bpy.data.objects if any(m.type == 'ARMATURE' and m.object == rig for m in o.modifiers)],
        'actions': {name: {'frame_range': list(bpy.data.actions[name].frame_range), 'preview_frame': spec[1],
                           'fcurves': len(list(action_curves(bpy.data.actions[name]))),
                           'keyframes': sum(len(f.keyframe_points) for f in action_curves(bpy.data.actions[name]))}
                    for name, spec in ACTION_SPECS.items()},
        'socket': {'object': 'Carrot_Attach_Point', 'bone': 'carrot_socket',
                   'definition': 'Midpoint of both hand bone centers, updated on every baked frame'},
    }
    positions = {}
    for name, (_, frame) in ACTION_SPECS.items():
        select_action(rig, bpy.data.actions[name])
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        positions[name] = list(bpy.data.objects['Carrot_Attach_Point'].matrix_world.translation)
    report['socket']['world_positions_at_preview_frames'] = positions
    select_action(rig, bpy.data.actions['Rabbit_Idle'])
    bpy.context.scene.frame_set(1)
    (ROOT / 'rabbit_rig_report.json').write_text(json.dumps(report, indent=2) + '\n')


def render_previews(rig):
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    for name, (_, frame) in ACTION_SPECS.items():
        select_action(rig, bpy.data.actions[name])
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        scene.render.filepath = str(PREVIEWS / (name.lower() + '_preview.png'))
        bpy.ops.render.render(write_still=True)
    select_action(rig, bpy.data.actions['Rabbit_Idle'])
    scene.frame_set(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--no-render', action='store_true')
    parser.add_argument('--render-only', action='store_true')
    parser.add_argument('--actions-only', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if args.render_only or args.actions_only:
        bpy.ops.wm.open_mainfile(filepath=str(RIGGED))
        rig = bpy.data.objects['Rabbit_Rig']
    else:
        rig = build_rig()
    if not args.render_only:
        create_actions(rig)
        write_report(rig)
        save_rigged()
    if not args.no_render:
        render_previews(rig)
    assert rig['source_base_sha256'] == hashlib.sha256(BASE.read_bytes()).hexdigest()
    print('RABBIT_TASK_2B_COMPLETE', RIGGED)


if __name__ == '__main__':
    main()
