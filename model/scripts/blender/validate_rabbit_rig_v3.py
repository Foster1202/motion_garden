"""Validate saved rabbit FK geometry using export-equivalent linear skinning."""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import intersect_ray_tri
from mathutils.kdtree import KDTree

ROOT = Path(__file__).resolve().parents[2]
REQUIRED = (
    'root', 'body', 'head', 'ear.L', 'ear.R',
    'upper_arm.L', 'forearm.L', 'hand.L', 'thigh.L', 'shin.L', 'foot.L',
    'upper_arm.R', 'forearm.R', 'hand.R', 'thigh.R', 'shin.R', 'foot.R',
    'tail', 'carrot_socket',
)
DEFAULT_LIMITS = {
    'arm': {'min': -12, 'max': 150}, 'forearm': {'min': 0, 'max': 110},
    'bodySide': 18, 'bodyForward': 16, 'headYaw': 25,
    'headPitch': 18, 'headRoll': 14, 'headMotionEnvelope': 40, 'knee': 24,
}
HEAD_SEAM_RADIUS = 0.12
HEAD_SEAM_DEPTH = 0.005
BODY_ATTACHMENT_RADIUS = 0.24
BODY_ATTACHMENT_DEPTH = 0.08
COLLISION_EPSILON = 1e-5
SEGMENT_LENGTH_TOLERANCE = 1e-4
DECORATIVE_SURFACES = {'Rabbit_InnerEar_L', 'Rabbit_InnerEar_R', 'Rabbit_Cheek_L', 'Rabbit_Cheek_R'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rounded(value):
    return np.asarray(value, dtype=float).round(8).tolist()


def to_blender(value):
    return Vector((value[0], -value[2], value[1]))


def to_gltf(value):
    return Vector((value[0], value[2], -value[1]))


def pose_cases():
    cases = [
        {'name': 'rest', 'category': 1},
        {'name': 'left_lateral_90', 'category': 2, 'left': 90},
        {'name': 'left_lateral_120', 'category': 3, 'left': 120},
        {'name': 'left_lateral_150', 'category': 4, 'left': 150},
        {'name': 'right_lateral_120', 'category': 5, 'right': 120},
        {'name': 'both_lateral_120', 'category': 6, 'left': 120, 'right': 120},
        {'name': 'both_forward_120', 'category': 7, 'left': 120, 'right': 120, 'plane': 90},
        {'name': 'both_diagonal_120', 'category': 8, 'left': 120, 'right': 120, 'plane': 45},
        {'name': 'left_lean', 'category': 10, 'side': 18},
        {'name': 'right_lean', 'category': 11, 'side': -18},
        {'name': 'raise_left_lean', 'category': 12, 'left': 120, 'right': 120, 'side': 18,
         'yaw': 18, 'pitch': 8, 'roll': -7.2},
        {'name': 'raise_right_lean', 'category': 12, 'left': 120, 'right': 120, 'side': -18,
         'yaw': -18, 'pitch': 8, 'roll': 7.2},
        {'name': 'shallow_knee_50', 'category': 13, 'knee': 0.5},
        {'name': 'shallow_knee_100', 'category': 14, 'knee': 1},
        {'name': 'raise_and_knee', 'category': 15, 'left': 120, 'right': 120,
         'plane': 45, 'knee': 1, 'forward': 10},
        {'name': 'rest_recovery', 'category': 16},
    ]
    for elbow in (0, 45, 90, 110):
        cases.append({'name': f'elbow_{elbow}', 'category': 9, 'elbow': elbow})
        cases.append({'name': f'raise_elbow_{elbow}', 'category': 9,
                      'left': 120, 'right': 120, 'plane': 45, 'elbow': elbow})
    for amount in (0, 0.25, 0.5, 0.75, 1):
        cases.append({'name': f'knee_{int(amount * 100)}', 'category': 'knee_sequence', 'knee': amount})
    for plane in (0, 45, 90):
        cases.append({'name': f'both_max_plane_{plane}', 'category': 'maximum',
                      'left': 150, 'right': 150, 'plane': plane, 'elbow': 45})
    for elevation in (90, 120, 150):
        for plane in (0, 45, 90):
            for elbow in (0, 45, 90, 110):
                cases.append({'name': f'range_{elevation}_plane_{plane}_elbow_{elbow}', 'category': 'range_grid',
                              'left': elevation, 'right': elevation, 'plane': plane, 'elbow': elbow})
    return cases


def curve_limit(elevation, curve, maximum):
    if not curve:
        return maximum
    if elevation <= curve[0][0]:
        return min(maximum, curve[0][1])
    for first, second in zip(curve, curve[1:]):
        if elevation <= second[0]:
            fraction = (elevation - first[0]) / (second[0] - first[0])
            return min(maximum, first[1] + fraction * (second[1] - first[1]))
    return min(maximum, curve[-1][1])


# Retain the helper name used by earlier render scripts.
elbow_limit = curve_limit


def read_curve(raw, maximum, name):
    if isinstance(raw, str):
        raw = json.loads(raw)
    curve = [tuple(float(value) for value in point) for point in raw]
    if (any(len(point) != 2 or not all(math.isfinite(value) for value in point) for point in curve)
            or any(second[0] <= first[0] for first, second in zip(curve, curve[1:]))
            or any(point[1] < 0 or point[1] > maximum for point in curve)):
        raise ValueError(f'Invalid {name} metadata')
    return curve


def head_directions(limits):
    directions = [('neutral', {'yaw': 0.0, 'pitch': 0.0, 'roll': 0.0})]
    for key in ('yaw', 'pitch', 'roll'):
        for sign in (-1, 1):
            directions.append((f'{key}_{sign}', {key: float(sign)}))
    for yaw in (-1, 1):
        for pitch in (-1, 1):
            for roll in (-1, 1):
                vector = {'yaw': yaw * limits['headYaw'], 'pitch': pitch * limits['headPitch'],
                          'roll': roll * limits['headRoll']}
                length = math.sqrt(sum(value * value for value in vector.values()))
                directions.append((f'corner_{yaw}_{pitch}_{roll}', {key: value / length for key, value in vector.items()}))
    return directions


def boundary_head(direction, maximum, limits):
    feasible = maximum
    for key in ('yaw', 'pitch', 'roll'):
        component = abs(direction.get(key, 0))
        if component > 1e-12:
            feasible = min(feasible, limits[f'head{key.title()}'] / component)
    return {key: direction.get(key, 0) * feasible for key in ('yaw', 'pitch', 'roll')}


def envelope_cases(curve, maximum, head_curve=(), limits=None):
    if not curve and not head_curve:
        return []
    limits = limits or DEFAULT_LIMITS
    elevations = {point[0] for point in curve} | {point[0] for point in head_curve}
    for points in (curve, head_curve):
        for first, second in zip(points, points[1:]):
            elevations.add((first[0] + second[0]) / 2)
    cases = []
    for elevation in sorted(elevations):
        elbow = curve_limit(elevation, curve, maximum)
        head_maximum = curve_limit(elevation, head_curve, limits['headMotionEnvelope'])
        directions = head_directions(limits) if head_maximum > 0 else [('neutral', {})]
        for plane in (0, 22.5, 45, 67.5, 90):
            for index, (name, direction) in enumerate(directions):
                head = boundary_head(direction, head_maximum, limits)
                cases.append({'name': f'envelope_raise_{elevation:g}_plane_{plane:g}_head_{name}',
                              'category': 'envelope_boundary', 'left': elevation, 'right': elevation,
                              'plane': plane, 'elbow': elbow, 'side': 18 if index % 2 else -18,
                              'forward': 16, 'knee': 1,
                              'head_curve_norm_limit': head_maximum, 'head_direction': name, **head})
    return cases


class Geometry:
    def __init__(self, obj, graph, binding=None):
        evaluated = obj.evaluated_get(graph)
        mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=graph)
        mesh.calc_loop_triangles()
        self.vertices = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
        self.array = np.array(self.vertices, dtype=float)
        self.triangles = binding.triangles if binding else [tuple(triangle.vertices) for triangle in mesh.loop_triangles]
        self.edges = binding.edges if binding else np.array([tuple(edge.vertices) for edge in mesh.edges], dtype=int)
        if binding and len(self.vertices) != len(binding.vertices):
            raise ValueError(f'{obj.name} changed topology after binding')
        self.bounds = {'minimum': rounded(self.array.min(axis=0)), 'maximum': rounded(self.array.max(axis=0))}
        self.tree = BVHTree.FromPolygons(self.vertices, self.triangles, all_triangles=True)
        evaluated.to_mesh_clear()

    def distortions(self, rest, joints):
        edge_lengths = np.linalg.norm(self.array[self.edges[:, 0]] - self.array[self.edges[:, 1]], axis=1)
        rest_lengths = np.linalg.norm(rest.array[self.edges[:, 0]] - rest.array[self.edges[:, 1]], axis=1)
        useful_edges = rest_lengths > 1e-7
        ratios = edge_lengths[useful_edges] / rest_lengths[useful_edges]
        triangles = np.array(rest.triangles, dtype=int)
        def areas(points):
            return np.linalg.norm(np.cross(points[triangles[:, 1]] - points[triangles[:, 0]],
                                           points[triangles[:, 2]] - points[triangles[:, 0]]), axis=1) / 2
        rest_areas = areas(rest.array)
        current_areas = areas(self.array)
        useful_triangles = rest_areas > 1e-9
        area_ratios = current_areas[useful_triangles] / rest_areas[useful_triangles]
        result = {
            'edge_ratio_minimum': float(ratios.min()), 'edge_ratio_maximum': float(ratios.max()),
            'edge_ratio_p01_p50_p99': rounded(np.quantile(ratios, [0.01, 0.5, 0.99])),
            'triangle_area_ratio_minimum': float(area_ratios.min()),
            'triangle_area_ratio_p01_p50_p99': rounded(np.quantile(area_ratios, [0.01, 0.5, 0.99])),
            'severely_collapsed_triangles': int(np.sum(area_ratios < 0.03)),
            'severely_stretched_edges': int(np.sum(ratios > 2.5)),
            'finite': bool(np.isfinite(self.array).all()),
        }
        edge_centers = (rest.array[self.edges[:, 0]] + rest.array[self.edges[:, 1]]) / 2
        triangle_centers = rest.array[triangles].mean(axis=1)
        result['joint_regions'] = {}
        for name, (center, radius) in joints.items():
            edge_mask = np.linalg.norm(edge_centers[useful_edges] - np.array(center), axis=1) <= radius
            triangle_mask = np.linalg.norm(triangle_centers[useful_triangles] - np.array(center), axis=1) <= radius
            result['joint_regions'][name] = {
                'radius': radius,
                'edge_ratio_minimum': float(ratios[edge_mask].min()) if edge_mask.any() else None,
                'edge_ratio_maximum': float(ratios[edge_mask].max()) if edge_mask.any() else None,
                'triangle_area_ratio_minimum': float(area_ratios[triangle_mask].min()) if triangle_mask.any() else None,
            }
        return result


def segment_triangle(start, end, triangle):
    direction = end - start
    length = direction.length
    if length < 1e-10:
        return None
    hit = intersect_ray_tri(*triangle, direction / length, start, True)
    if hit is None or (hit - start).dot(direction) < -COLLISION_EPSILON or (hit - start).length > length + COLLISION_EPSILON:
        return None
    return hit


def surface_crossings(first, second, attachment, radius):
    candidates = first.tree.overlap(second.tree)
    crossings = []
    distal = 0
    for first_index, second_index in candidates:
        a = [first.vertices[index] for index in first.triangles[first_index]]
        b = [second.vertices[index] for index in second.triangles[second_index]]
        hits = []
        for triangle, other in ((a, b), (b, a)):
            for index in range(3):
                hit = segment_triangle(triangle[index], triangle[(index + 1) % 3], other)
                if hit is not None:
                    hits.append(hit)
        if hits:
            crossings.append((first_index, second_index))
            if any((hit - attachment).length > radius for hit in hits):
                distal += 1
    return {'candidate_triangle_pairs': len(candidates), 'crossing_triangle_pairs': len(crossings),
            'crossings_outside_attachment': distal}


def penetration(first, second, attachment, radius, depth_tolerance):
    inside_count = 0
    allowed_count = 0
    severe_count = 0
    maximum = 0.0
    deepest_distal = 0.0
    minimum_bounds = second.array.min(axis=0)
    maximum_bounds = second.array.max(axis=0)
    ray_direction = Vector((0.953, 0.123, 0.278)).normalized()
    for vertex in first.vertices:
        if any(vertex[index] < minimum_bounds[index] or vertex[index] > maximum_bounds[index] for index in range(3)):
            continue
        origin = vertex.copy()
        crossing_count = 0
        for crossing in range(20):
            location, normal, index, distance = second.tree.ray_cast(origin, ray_direction, 10)
            if location is None:
                break
            crossing_count += 1
            origin = location + ray_direction * COLLISION_EPSILON
        if crossing_count % 2 == 0:
            continue
        nearest, normal, index, distance = second.tree.find_nearest(vertex)
        if nearest is None or distance < COLLISION_EPSILON:
            continue
        inside_count += 1
        maximum = max(maximum, distance)
        attached = (vertex - attachment).length <= radius
        if attached and distance <= depth_tolerance:
            allowed_count += 1
        else:
            severe_count += 1
            deepest_distal = max(deepest_distal, distance)
    return {'inside_vertices': inside_count, 'allowed_attachment_vertices': allowed_count,
            'severe_vertices': severe_count, 'maximum_depth': maximum,
            'maximum_unallowed_depth': deepest_distal}


class RigAudit:
    def __init__(self, source):
        bpy.ops.wm.open_mainfile(filepath=str(source))
        self.rig = bpy.data.objects['Rabbit_Rig']
        self.collection = bpy.data.collections['Rabbit_Character']
        self.meshes = [obj for obj in self.collection.all_objects if obj.type == 'MESH']
        for obj in bpy.data.objects:
            obj.animation_data_clear()
        for obj in self.meshes:
            for modifier in obj.modifiers:
                if modifier.type == 'ARMATURE':
                    modifier.use_deform_preserve_volume = False
                    # Apply rest topology before LBS, as the exported skin bind mesh does.
                    bpy.context.view_layer.objects.active = obj
                    while obj.modifiers.find(modifier.name) < len(obj.modifiers) - 1:
                        bpy.ops.object.modifier_move_down(modifier=modifier.name)
        self.reset()
        self.bones = self.rig.data.bones
        self.rest_world = {name: (self.rig.matrix_world @ self.bones[name].matrix_local).copy() for name in REQUIRED}
        self.rest_local = {name: (self.bones[name].parent.matrix_local.inverted() @ self.bones[name].matrix_local
                                 if self.bones[name].parent else self.bones[name].matrix_local).to_quaternion()
                           for name in REQUIRED}
        self.rest_segments = {}
        for side in ('L', 'R'):
            hip = self.world_point(f'thigh.{side}')
            knee = self.world_point(f'shin.{side}')
            ankle = self.world_point(f'foot.{side}')
            self.rest_segments[side] = (to_gltf(knee - hip), to_gltf(ankle - knee))
        self.rest_geometry = self.geometry()
        raw_limits = self.rig.get('rig_motion_limits', '{}')
        supplied_limits = json.loads(raw_limits)
        self.limits = {**DEFAULT_LIMITS, **supplied_limits}
        for key in ('arm', 'forearm'):
            self.limits[key] = {**DEFAULT_LIMITS[key], **supplied_limits.get(key, {})}
        self.version = self.rig.get('rig_version', self.rig.get('proportion_version', 'unversioned'))
        if self.version != 'v3' and raw_limits == '{}':
            self.limits.update(arm={'min': -12, 'max': 90}, forearm={'min': 0, 'max': 100}, headMotionEnvelope=12)
        self.elbow_curve = read_curve(self.limits.get('elbow_limits_by_raise', self.rig.get('elbow_limits_by_raise', [])),
                                      self.limits['forearm']['max'], 'elbow_limits_by_raise')
        self.head_curve = read_curve(self.limits.get('head_limits_by_raise', self.rig.get('head_limits_by_raise', [])),
                                     self.limits['headMotionEnvelope'], 'head_limits_by_raise')

    def reset(self):
        for bone in self.rig.pose.bones:
            bone.rotation_mode = 'QUATERNION'
            bone.matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()

    def world_point(self, name):
        return self.rig.matrix_world @ self.rig.pose.bones[name].head

    def delta(self, name, rotations):
        rotation = Quaternion()
        inverse_rest = self.rest_world[name].to_quaternion().inverted()
        for axis, degrees in rotations:
            local_axis = to_blender(axis)
            local_axis.rotate(inverse_rest)
            rotation @= Quaternion(local_axis, math.radians(degrees))
        self.rig.pose.bones[name].rotation_quaternion = rotation

    def pose(self, case):
        self.reset()
        plane = math.radians(case.get('plane', 0))
        for side, sign, key in (('L', 1, 'left'), ('R', -1, 'right')):
            self.delta(f'upper_arm.{side}', [((-math.sin(plane), 0, sign * math.cos(plane)), case.get(key, 0))])
            self.delta(f'forearm.{side}', [((-1, 0, 0), case.get('elbow', 0))])
        self.delta('body', [((1, 0, 0), case.get('forward', 0)), ((0, 0, 1), case.get('side', 0))])
        self.delta('head', [((1, 0, 0), case.get('pitch', 0)), ((0, 1, 0), case.get('yaw', 0)),
                            ((0, 0, 1), case.get('roll', 0))])
        angle = self.limits['knee'] * case.get('knee', 0)
        compensation = Vector()
        axis = Vector((1, 0, 0))
        for side in ('L', 'R'):
            self.delta(f'thigh.{side}', [((1, 0, 0), -angle)])
            self.delta(f'shin.{side}', [((1, 0, 0), 2 * angle)])
            thigh = self.rest_local[f'thigh.{side}'] @ self.rig.pose.bones[f'thigh.{side}'].rotation_quaternion
            shin = self.rest_local[f'shin.{side}'] @ self.rig.pose.bones[f'shin.{side}'].rotation_quaternion
            rest_chain = self.rest_local[f'thigh.{side}'] @ self.rest_local[f'shin.{side}'] @ self.rest_local[f'foot.{side}']
            target_foot = (thigh @ shin).inverted() @ rest_chain
            self.rig.pose.bones[f'foot.{side}'].rotation_quaternion = self.rest_local[f'foot.{side}'].inverted() @ target_foot
            upper, lower = self.rest_segments[side]
            delta = Quaternion(axis, -math.radians(angle)) @ upper - upper
            delta += Quaternion(axis, math.radians(angle)) @ lower - lower
            compensation -= delta / 2
        root_inverse = self.rest_world['root'].to_3x3().inverted()
        self.rig.pose.bones['root'].location = root_inverse @ to_blender(compensation)
        bpy.context.view_layer.update()

    def geometry(self):
        graph = bpy.context.evaluated_depsgraph_get()
        bindings = getattr(self, 'rest_geometry', {})
        return {obj.name: Geometry(obj, graph, bindings.get(obj.name)) for obj in self.meshes}

    def structure(self):
        issues = []
        if set(self.bones.keys()) != set(REQUIRED):
            issues.append('Required bone set differs from the 19-bone API')
        parents = {name: self.bones[name].parent.name if self.bones[name].parent else None for name in REQUIRED}
        expected = {'root': None, 'body': 'root', 'head': 'body', 'tail': 'body', 'carrot_socket': 'root'}
        for side in ('L', 'R'):
            expected.update({f'ear.{side}': 'head', f'upper_arm.{side}': 'body',
                             f'forearm.{side}': f'upper_arm.{side}', f'hand.{side}': f'forearm.{side}',
                             f'thigh.{side}': 'root', f'shin.{side}': f'thigh.{side}', f'foot.{side}': f'shin.{side}'})
        if parents != expected:
            issues.append('Primary bone hierarchy differs from the compatible V2 hierarchy')
        objects = {}
        for obj in self.meshes:
            edge_uses = Counter(tuple(sorted(edge)) for polygon in obj.data.polygons for edge in polygon.edge_keys)
            boundary = sum(count == 1 for count in edge_uses.values())
            nonmanifold = sum(count > 2 for count in edge_uses.values())
            weight_sums = [sum(group.weight for group in vertex.groups) for vertex in obj.data.vertices]
            influences = [sum(group.weight > 1e-6 for group in vertex.groups) for vertex in obj.data.vertices]
            armatures = [modifier for modifier in obj.modifiers if modifier.type == 'ARMATURE']
            item = {'vertices': len(obj.data.vertices), 'faces': len(obj.data.polygons),
                    'boundary_edges': boundary, 'nonmanifold_edges': nonmanifold,
                    'materials': [material.name for material in obj.data.materials],
                    'parent_type': obj.parent_type, 'parent_bone': obj.parent_bone,
                    'armature_modifiers': len(armatures)}
            if armatures:
                item.update(weight_sum_minimum=min(weight_sums), weight_sum_maximum=max(weight_sums),
                            maximum_influences=max(influences), preserve_volume=any(m.use_deform_preserve_volume for m in armatures))
                if min(weight_sums) < 0.9999 or max(weight_sums) > 1.0001 or max(influences) > 4:
                    issues.append(f'{obj.name} has invalid or excessive skin weights')
            item['intentional_decorative_surface'] = obj.name in DECORATIVE_SURFACES
            if nonmanifold or (boundary and obj.name not in DECORATIVE_SURFACES):
                issues.append(f'{obj.name} is not a closed manifold surface')
            if not item['materials']:
                issues.append(f'{obj.name} has no material')
            objects[obj.name] = item
        return {'issues': issues, 'bone_count': len(self.bones), 'parents': parents, 'objects': objects,
                'rest_bones_blender': {name: {'head': rounded(self.rest_world[name].translation),
                                            'length': self.bones[name].length} for name in REQUIRED}}

    def supports(self, case):
        return (all(self.limits['arm']['min'] <= case.get(side, 0) <= self.limits['arm']['max'] for side in ('left', 'right'))
                and self.limits['forearm']['min'] <= case.get('elbow', 0)
                and all(case.get('elbow', 0) <= elbow_limit(case.get(side, 0), self.elbow_curve,
                                                          self.limits['forearm']['max']) + 1e-6 for side in ('left', 'right'))
                and abs(case.get('side', 0)) <= self.limits['bodySide']
                and abs(case.get('forward', 0)) <= self.limits['bodyForward']
                and abs(case.get('yaw', 0)) <= self.limits['headYaw'] + 1e-6
                and abs(case.get('pitch', 0)) <= self.limits['headPitch'] + 1e-6
                and abs(case.get('roll', 0)) <= self.limits['headRoll'] + 1e-6
                and math.sqrt(sum(case.get(key, 0) ** 2 for key in ('yaw', 'pitch', 'roll'))) <= curve_limit(max(case.get('left', 0), case.get('right', 0), 0), self.head_curve, self.limits['headMotionEnvelope']) + 1e-6
                and 0 <= case.get('knee', 0) <= 1)

    def audit_pose(self, case):
        self.pose(case)
        geometry = self.geometry()
        issues = []
        collisions = {}
        for side in ('L', 'R'):
            arm = geometry[f'Rabbit_Arm_{side}']
            attachment = self.world_point(f'upper_arm.{side}')
            collisions[side] = {}
            for mesh_name, radius, depth in [('Rabbit_Head', HEAD_SEAM_RADIUS, HEAD_SEAM_DEPTH),
                                            ('Rabbit_Body', BODY_ATTACHMENT_RADIUS, BODY_ATTACHMENT_DEPTH)]:
                other = geometry[mesh_name]
                result = penetration(arm, other, attachment, radius, depth)
                result.update(surface_crossings(arm, other, attachment, radius))
                collisions[side][mesh_name] = result
                if result['severe_vertices'] or result['crossings_outside_attachment']:
                    issues.append(f'{side} arm intersects {mesh_name} outside allowed proximal attachment')
        distortion = {}
        for name, current in geometry.items():
            if name.startswith(('Rabbit_Arm_', 'Rabbit_Leg_')):
                side = name[-1]
                joints = {f'elbow.{side}': (self.rest_world[f'forearm.{side}'].translation, 0.16),
                          f'wrist.{side}': (self.rest_world[f'hand.{side}'].translation, 0.12)} if name.startswith('Rabbit_Arm_') else {
                              f'knee.{side}': (self.rest_world[f'shin.{side}'].translation, 0.16),
                              f'ankle.{side}': (self.rest_world[f'foot.{side}'].translation, 0.15)}
                result = current.distortions(self.rest_geometry[name], joints)
                distortion[name] = result
                if not result['finite'] or result['severely_collapsed_triangles'] or result['severely_stretched_edges']:
                    issues.append(f'{name} has severe deformation')
        rotations = {name: self.rig.pose.bones[name].rotation_quaternion for name in REQUIRED}
        if any(not math.isfinite(value) for quaternion in rotations.values() for value in quaternion):
            issues.append('A bone quaternion is nonfinite')
        if any(abs(quaternion.magnitude - 1) > 1e-5 for quaternion in rotations.values()):
            issues.append('A bone quaternion is not normalized')
        segment_errors = {}
        for side in ('L', 'R'):
            for first, second in ((f'upper_arm.{side}', f'forearm.{side}'),
                                  (f'forearm.{side}', f'hand.{side}'),
                                  (f'thigh.{side}', f'shin.{side}'), (f'shin.{side}', f'foot.{side}')):
                rest_length = (self.rest_world[first].translation - self.rest_world[second].translation).length
                actual_length = (self.world_point(first) - self.world_point(second)).length
                segment_errors[f'{first}->{second}'] = abs(actual_length - rest_length)
        if max(segment_errors.values()) > SEGMENT_LENGTH_TOLERANCE:
            issues.append('An articulated segment changed length')
        actual = {key: math.degrees(rotations[name].angle) for key, name in
                  [('left', 'upper_arm.L'), ('right', 'upper_arm.R'), ('elbow_left', 'forearm.L'), ('elbow_right', 'forearm.R')]}
        supported = self.supports(case)
        bounds = np.concatenate([mesh.array for mesh in geometry.values()])
        feet = {side: {'ankle': rounded(to_gltf(self.world_point(f'foot.{side}'))),
                       'ankle_rest_displacement': (self.world_point(f'foot.{side}') - self.rest_world[f'foot.{side}'].translation).length,
                       'sole_minimum': float(geometry[f'Rabbit_Leg_{side}'].array[:, 2].min()),
                       'sole_rest_difference': float(geometry[f'Rabbit_Leg_{side}'].array[:, 2].min()
                                                     - self.rest_geometry[f'Rabbit_Leg_{side}'].array[:, 2].min())}
                for side in ('L', 'R')}
        if any(foot['ankle_rest_displacement'] > 1e-5 for foot in feet.values()):
            issues.append('An ankle pivot drifted during the symmetric FK support compensation')
        if any(abs(foot['sole_rest_difference']) > 0.02 for foot in feet.values()):
            issues.append('A sole moved more than 0.02 model units during shallow FK')
        wrist_midpoint = (self.world_point('hand.L') + self.world_point('hand.R')) / 2
        socket = self.world_point('carrot_socket')
        return {
            'name': case['name'], 'category': case['category'], 'requested': case,
            'actual_rest_relative_degrees': actual, 'supported_by_profile': supported,
            'allowed_elbow_degrees': {side: elbow_limit(case.get(key, 0), self.elbow_curve, self.limits['forearm']['max'])
                                      for side, key in (('L', 'left'), ('R', 'right'))},
            'allowed_head_norm_degrees': curve_limit(max(case.get('left', 0), case.get('right', 0), 0), self.head_curve, self.limits['headMotionEnvelope']),
            'requested_head_norm_degrees': math.sqrt(sum(case.get(key, 0) ** 2 for key in ('yaw', 'pitch', 'roll'))),
            'status': 'FAIL' if issues else 'PASS' if supported else 'UNSUPPORTED', 'issues': issues,
            'collisions': collisions, 'deformation': distortion,
            'segment_length_maximum_error': max(segment_errors.values()),
            'bounds_blender': {'minimum': rounded(bounds.min(axis=0)), 'maximum': rounded(bounds.max(axis=0))},
            'feet': feet,
            'carrot_socket': {'position': rounded(to_gltf(socket)), 'wrist_midpoint': rounded(to_gltf(wrist_midpoint)),
                              'distance_to_wrist_midpoint': (socket - wrist_midpoint).length,
                              'parent': self.bones['carrot_socket'].parent.name,
                              'scope': 'Independent attachment marker; live grip following is a future controller concern'},
        }

    def symmetry(self):
        pairs = []
        for elevation, plane, elbow in [(0, 0, 0), (90, 0, 45), (120, 45, 90), (150, 90, 110)]:
            self.pose({'left': elevation, 'plane': plane, 'elbow': elbow})
            first = {part: self.world_point(f'{part}.L') for part in ('upper_arm', 'forearm', 'hand')}
            self.pose({'right': elevation, 'plane': plane, 'elbow': elbow})
            errors = []
            for part in first:
                mirrored = first[part].copy()
                mirrored.x *= -1
                errors.append((mirrored - self.world_point(f'{part}.R')).length)
            pairs.append({'elevation': elevation, 'plane': plane, 'elbow': elbow, 'maximum_joint_error': max(errors)})
            self.pose({'left': elevation, 'right': elevation, 'plane': plane, 'elbow': elbow})
            geometry = self.geometry()
            for part in ('Arm', 'Leg'):
                left = geometry[f'Rabbit_{part}_L'].array.copy()
                left[:, 0] *= -1
                right = geometry[f'Rabbit_{part}_R'].array
                tree = KDTree(len(right))
                for index, point in enumerate(right):
                    tree.insert(point, index)
                tree.balance()
                pairs[-1][f'{part.lower()}_mesh_mirror_error'] = max(tree.find(point)[2] for point in left)
        maximum = max(max(pair['maximum_joint_error'], pair['arm_mesh_mirror_error'], pair['leg_mesh_mirror_error']) for pair in pairs)
        return {'status': 'PASS' if maximum < SEGMENT_LENGTH_TOLERANCE else 'FAIL', 'maximum_error': maximum, 'pairs': pairs}

    def recovery(self):
        self.pose({'left': 120, 'right': 120, 'plane': 45, 'elbow': 90, 'knee': 1, 'side': 18, 'forward': 10})
        self.reset()
        restored = self.geometry()
        errors = {name: float(np.max(np.linalg.norm(mesh.array - self.rest_geometry[name].array, axis=1)))
                  for name, mesh in restored.items()}
        return {'status': 'PASS' if max(errors.values()) < 1e-6 else 'FAIL',
                'maximum_vertex_error': max(errors.values()), 'per_mesh': errors}

    def continuous(self):
        maximum = 0.0
        previous = None
        nonfinite = False
        for step in range(21):
            amount = step / 20
            supported_elbow = min(90 * amount, elbow_limit(120 * amount, self.elbow_curve, self.limits['forearm']['max']))
            self.pose({'left': 120 * amount, 'right': 120 * amount, 'plane': 45 * amount,
                       'elbow': supported_elbow, 'knee': amount, 'side': 18 * amount})
            current = self.geometry()
            if previous is not None:
                maximum = max(maximum, max(float(np.max(np.linalg.norm(mesh.array - previous[name].array, axis=1)))
                                           for name, mesh in current.items()))
            nonfinite |= any(not np.isfinite(mesh.array).all() for mesh in current.values())
            previous = current
        return {'status': 'FAIL' if nonfinite else 'PASS', 'steps': 21,
                'maximum_vertex_step_model_units': maximum,
                'elbow_envelope_used': bool(self.elbow_curve), 'head_envelope_used': bool(self.head_curve),
                'scope': 'Continuous FK targets, not a timing or human-mocap measurement'}


def validate(source):
    source_hash = digest(source)
    audit = RigAudit(source)
    structure = audit.structure()
    cases = pose_cases() + envelope_cases(audit.elbow_curve, audit.limits['forearm']['max'], audit.head_curve, audit.limits)
    poses = [audit.audit_pose(case) for case in cases]
    symmetry = audit.symmetry()
    recovery = audit.recovery()
    continuous = audit.continuous()
    supported_failures = [pose['name'] for pose in poses if pose['supported_by_profile'] and pose['issues']]
    unsupported = [pose['name'] for pose in poses if not pose['supported_by_profile']]
    failed = bool(structure['issues'] or supported_failures or symmetry['status'] == 'FAIL'
                  or recovery['status'] == 'FAIL' or continuous['status'] == 'FAIL')
    assert digest(source) == source_hash, 'Validator modified the input Blender file'
    return {
        'status': 'FAIL' if failed else 'PASS_WITH_LIMITS' if unsupported else 'PASS',
        'source': str(source), 'source_sha256': source_hash, 'blender_version': bpy.app.version_string,
        'rig_version': audit.version, 'limits': audit.limits, 'elbow_limits_by_raise': audit.elbow_curve,
        'head_limits_by_raise': audit.head_curve,
        'evaluation': 'Linear blend skinning with rest-topology modifiers before Armature and fixed evaluated-rest triangle/edge indices for all posed BVHs and strain. Three.js GLB parity is checked separately.',
        'request_scope': 'Nominal FK requests are applied without controller clamps. Profile metadata classifies support. Legacy V2 elbow/head workarounds are intentionally not reproduced in the geometric comparison.',
        'tolerances': {'head_attachment_radius': HEAD_SEAM_RADIUS, 'head_attachment_depth': HEAD_SEAM_DEPTH,
                       'body_attachment_radius': BODY_ATTACHMENT_RADIUS, 'body_attachment_depth': BODY_ATTACHMENT_DEPTH,
                       'edge_stretch_limit': 2.5, 'triangle_area_collapse_ratio': 0.03,
                       'segment_length_and_symmetry_tolerance': SEGMENT_LENGTH_TOLERANCE},
        'structure': structure, 'poses': poses, 'symmetry': symmetry, 'rest_recovery': recovery,
        'continuous': continuous, 'supported_pose_failures': supported_failures,
        'unsupported_requested_poses': unsupported,
        'limitations': ['Sampled poses do not prove all-pose collision freedom.',
                       'Allowed proximal attachment contacts are separately quantified.',
                       'This FK audit does not implement a foot-locking solver or human validation.'],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=ROOT / 'assets/blender/rabbit/rabbit_realtime_v3.blend')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'qa/rig-v3/geometry')
    parser.add_argument('--comparison-source', type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report = validate(args.source)
    if args.comparison_source:
        report['comparison'] = validate(args.comparison_source)
    path = args.output_dir / 'rig-geometry-report.json'
    path.write_text(json.dumps(report, indent=2) + '\n')
    summary = {'status': report['status'], 'source': str(args.source), 'report': str(path),
               'poses': len(report['poses']), 'supported_pose_failures': report['supported_pose_failures'],
               'unsupported_requested_poses': report['unsupported_requested_poses'],
               'symmetry': report['symmetry']['status'], 'rest_recovery': report['rest_recovery']['status']}
    (args.output_dir / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print('RABBIT_V3_GEOMETRY', json.dumps(summary))
    if report['status'] == 'FAIL':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
