"""Export and audit the saved hybrid rabbit rig without saving either source file."""
import argparse
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix
from mathutils.kdtree import KDTree

ROOT = Path(__file__).resolve().parents[2]
CONVERSION = np.array([[1., 0., 0.], [0., 0., 1.], [0., -1., 0.]])


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rounded(value):
    return np.asarray(value, dtype=float).round(8).tolist()


def read_glb(path):
    data = path.read_bytes()
    magic, version, length = struct.unpack_from('<4sII', data)
    assert magic == b'glTF' and version == 2 and length == len(data)
    offset, document, binary = 12, None, b''
    while offset < len(data):
        size, kind = struct.unpack_from('<I4s', data, offset)
        chunk = data[offset + 8:offset + 8 + size]
        if kind == b'JSON':
            document = json.loads(chunk)
        elif kind == b'BIN\x00':
            binary = chunk
        offset += 8 + size
    return document, binary


def accessor(doc, binary, index):
    item = doc['accessors'][index]
    view = doc['bufferViews'][item['bufferView']]
    dtype = {5120: '<i1', 5121: '<u1', 5122: '<i2', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[item['componentType']]
    width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[item['type']]
    start = view.get('byteOffset', 0) + item.get('byteOffset', 0)
    stride = view.get('byteStride', np.dtype(dtype).itemsize * width)
    result = np.ndarray((item['count'], width), dtype=dtype, buffer=binary,
                        offset=start, strides=(stride, np.dtype(dtype).itemsize)).copy()
    if item.get('normalized') and item['componentType'] != 5126:
        result = result.astype(float) / np.iinfo(np.dtype(dtype)).max
    return result


def local_matrix(node):
    if 'matrix' in node:
        return np.array(node['matrix'], dtype=float).reshape((4, 4)).T
    q = node.get('rotation', [0., 0., 0., 1.])
    x, y, z, w = q
    matrix = np.eye(4)
    matrix[:3, :3] = np.array([
        [1 - 2*y*y - 2*z*z, 2*x*y - 2*z*w, 2*x*z + 2*y*w],
        [2*x*y + 2*z*w, 1 - 2*x*x - 2*z*z, 2*y*z - 2*x*w],
        [2*x*z - 2*y*w, 2*y*z + 2*x*w, 1 - 2*x*x - 2*y*y],
    ]) @ np.diag(node.get('scale', [1., 1., 1.]))
    matrix[:3, 3] = node.get('translation', [0., 0., 0.])
    return matrix


def audit_glb(path, bone_names, source_bindings, source_positions, source_materials, source_colors):
    doc, binary = read_glb(path)
    nodes = doc['nodes']
    names = {node.get('name'): i for i, node in enumerate(nodes)}
    parents = {child: index for index, node in enumerate(nodes) for child in node.get('children', [])}
    assert set(bone_names) <= names.keys(), 'A source bone was lost during export'
    assert not doc.get('animations') and not doc.get('cameras')
    assert not any('KHR_lights_punctual' in node.get('extensions', {}) for node in nodes)
    joints = set(j for skin in doc.get('skins', []) for j in skin['joints'])
    assert {names[name] for name in bone_names} == joints, 'Export must retain exactly the 19 bones'
    for object_name, bone_name in source_bindings.items():
        assert parents[names[object_name]] == names[bone_name], object_name + ': lost bone parent'
    locals_ = [local_matrix(node) for node in nodes]

    def globals_(override=None):
        cache = {}
        def visit(index):
            if index not in cache:
                local = override.get(index, locals_[index]) if override else locals_[index]
                cache[index] = visit(parents[index]) @ local if index in parents else local
            return cache[index]
        return [visit(i) for i in range(len(nodes))]

    def positions(matrices):
        result = {}
        for i, node in enumerate(nodes):
            if 'mesh' not in node:
                continue
            arrays = []
            for primitive in doc['meshes'][node['mesh']]['primitives']:
                attrs = primitive['attributes']
                coords = accessor(doc, binary, attrs['POSITION'])
                homo = np.column_stack([coords, np.ones(len(coords))])
                if 'skin' in node:
                    assert 'JOINTS_0' in attrs and 'WEIGHTS_0' in attrs
                    skin = doc['skins'][node['skin']]
                    ids = accessor(doc, binary, attrs['JOINTS_0']).astype(int)
                    weights = accessor(doc, binary, attrs['WEIGHTS_0'])
                    assert np.max(abs(weights.sum(axis=1) - 1)) < 1e-4
                    inverses = accessor(doc, binary, skin['inverseBindMatrices']).reshape((-1, 4, 4)).transpose(0, 2, 1)
                    skin_matrices = np.array([matrices[joint] @ inverse for joint, inverse in zip(skin['joints'], inverses)])
                    points = np.zeros((len(coords), 4))
                    for slot in range(ids.shape[1]):
                        points += np.einsum('nij,nj->ni', skin_matrices[ids[:, slot]], homo) * weights[:, slot:slot+1]
                    arrays.append(points[:, :3])
                else:
                    arrays.append((homo @ matrices[i].T)[:, :3])
            result[node['name']] = np.concatenate(arrays)
        return result

    rest_matrices = globals_()
    rest = positions(rest_matrices)
    all_points = np.concatenate(list(rest.values()))
    rest_errors = {}
    for name, expected in source_positions.items():
        actual = rest[name]
        def nearest_error(first, second):
            tree = KDTree(len(second))
            for index, point in enumerate(second):
                tree.insert(point, index)
            tree.balance()
            return max(tree.find(point)[2] for point in first)
        error = max(nearest_error(expected, actual), nearest_error(actual, expected))
        assert error < 1e-5, name + ': exported rest geometry differs from source'
        rest_errors[name] = error
    color_errors = {}
    for name, colors in source_colors.items():
        node = nodes[names[name]]
        exported = np.concatenate([accessor(doc, binary, primitive['attributes']['COLOR_0'])
                                   for primitive in doc['meshes'][node['mesh']]['primitives']])
        width = exported.shape[1]
        error = max(float(np.max(abs(exported.min(axis=0) - colors[:, :width].min(axis=0)))),
                    float(np.max(abs(exported.max(axis=0) - colors[:, :width].max(axis=0)))))
        assert error < 1e-4, name + ': vertex-color range changed'
        color_errors[name] = error
    exported_materials = {material['name']: material for material in doc.get('materials', [])}
    for name, source in source_materials.items():
        material = exported_materials[name]['pbrMetallicRoughness']
        assert np.max(np.abs(np.array(material.get('baseColorFactor', [1., 1., 1., 1.])) - source['base_color_factor'])) < 1e-6
        assert abs(material.get('roughnessFactor', 1.) - source['roughness']) < 1e-6
        assert abs(material.get('metallicFactor', 1.) - source['metallic']) < 1e-6
    meshes = []
    vertex_count, triangle_count = 0, 0
    for i, node in enumerate(nodes):
        if 'mesh' not in node:
            continue
        primitives = doc['meshes'][node['mesh']]['primitives']
        count = sum(doc['accessors'][primitive['attributes']['POSITION']]['count'] for primitive in primitives)
        triangles = sum(doc['accessors'][primitive['indices']]['count'] // 3 for primitive in primitives)
        vertex_count += count
        triangle_count += triangles
        meshes.append({'name': node['name'], 'vertices': count, 'triangles': triangles,
                       'skin': node.get('skin'), 'parent': nodes[parents[i]]['name'] if i in parents else None})
    probes = {}
    for bone, mesh, axis in [('upper_arm.L', 'Rabbit_Arm_L', 2), ('upper_arm.R', 'Rabbit_Arm_R', 2),
                             ('forearm.L', 'Rabbit_Arm_L', 2), ('forearm.R', 'Rabbit_Arm_R', 2),
                             ('thigh.L', 'Rabbit_Leg_L', 0), ('thigh.R', 'Rabbit_Leg_R', 0),
                             ('shin.L', 'Rabbit_Leg_L', 0), ('shin.R', 'Rabbit_Leg_R', 0),
                             ('head', 'Rabbit_Head', 0), ('ear.L', 'Rabbit_Ear_L', 2),
                             ('body', 'Rabbit_Body', 0)]:
        angle = .3
        c, s = math.cos(angle), math.sin(angle)
        rotation = np.eye(4)
        if axis == 0:
            rotation[1:3, 1:3] = [[c, -s], [s, c]]
        else:
            rotation[:2, :2] = [[c, -s], [s, c]]
        changed = positions(globals_({names[bone]: locals_[names[bone]] @ rotation}))
        maximum = float(np.max(np.linalg.norm(changed[mesh] - rest[mesh], axis=1)))
        assert maximum > .005, bone + ': exported mesh did not deform'
        unaffected = 'Rabbit_Arm_R' if bone == 'upper_arm.L' else 'Rabbit_Arm_L' if bone == 'upper_arm.R' else None
        other_error = float(np.max(np.linalg.norm(changed[unaffected] - rest[unaffected], axis=1))) if unaffected else None
        if unaffected:
            assert other_error < 1e-7, bone + ': independent arm changed'
        probes[bone] = {'local_axis': 'X' if axis == 0 else 'Z', 'radians': angle,
                        'mesh': mesh, 'maximum_vertex_displacement': maximum,
                        'unaffected_mesh': unaffected, 'unaffected_maximum_displacement': other_error}
    return {
        'status': 'PASS', 'bone_count': len(joints), 'skin_count': len(doc.get('skins', [])),
        'animation_count': len(doc.get('animations', [])), 'camera_count': len(doc.get('cameras', [])),
        'light_count': 0, 'mesh_count': len(meshes), 'vertex_count': vertex_count,
        'triangle_count': triangle_count, 'meshes': meshes, 'materials': doc.get('materials', []),
        'mesh_bounds_gltf': {name: {'minimum': rounded(points.min(axis=0)), 'maximum': rounded(points.max(axis=0))} for name, points in rest.items()},
        'bounds_gltf': {'minimum': rounded(all_points.min(axis=0)), 'maximum': rounded(all_points.max(axis=0))},
        'rest_position_sha256': hashlib.sha256(all_points.astype('<f4').tobytes()).hexdigest(),
        'node_hierarchy': {node.get('name', str(i)): nodes[parents[i]].get('name') if i in parents else None for i, node in enumerate(nodes)},
        'bones_gltf': {name: {'local_matrix': rounded(locals_[names[name]]),
                              'world_pivot': rounded(rest_matrices[names[name]][:3, 3]),
                              'world_local_axes_columns': rounded(rest_matrices[names[name]][:3, :3])} for name in bone_names},
        'deformation_probes': probes,
        'source_rest_geometry_bidirectional_nearest_vertex_error': rest_errors,
        'source_rest_geometry_maximum_error': max(rest_errors.values()),
        'material_values_preserved': True, 'source_materials': source_materials,
        'vertex_color_range_errors': color_errors,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=ROOT / 'assets/blender/rabbit/rabbit_realtime_v2.blend')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'dist/rabbit3d')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    source = args.source
    original = ROOT / 'assets/blender/rabbit/rabbit_rigged.blend'
    base = ROOT / 'assets/blender/rabbit/rabbit_base.blend'
    before = {path.name: digest(path) for path in (base, original, source)}
    bpy.ops.wm.open_mainfile(filepath=str(source))
    rig = bpy.data.objects['Rabbit_Rig']
    assert len(rig.data.bones) == 19
    rig.animation_data_clear()
    for obj in bpy.data.objects:
        obj.animation_data_clear()
    for pose in rig.pose.bones:
        pose.matrix_basis = Matrix.Identity(4)
        pose.bone['originalBoneName'] = pose.name
    rig.data.pose_position = 'POSE'
    bpy.context.view_layer.update()
    bones = []
    for bone in rig.data.bones:
        matrix = rig.matrix_world @ bone.matrix_local
        bones.append({'name': bone.name, 'parent': bone.parent.name if bone.parent else None,
                      'use_deform': bone.use_deform,
                      'head_blender': rounded(rig.matrix_world @ bone.head_local),
                      'tail_blender': rounded(rig.matrix_world @ bone.tail_local),
                      'rest_matrix_blender': rounded(matrix),
                      'pivot_gltf': rounded(CONVERSION @ np.array(matrix.translation)),
                      'axes_gltf_columns': rounded(CONVERSION @ np.array(matrix.to_3x3()))})
    collection = bpy.data.collections['Rabbit_Character']
    bindings = {obj.name: obj.parent_bone for obj in collection.all_objects if obj.parent_type == 'BONE'}
    source_positions = {}
    graph = bpy.context.evaluated_depsgraph_get()
    source_materials = {}
    source_colors = {}
    for obj in collection.all_objects:
        if obj.type not in {'MESH', 'CURVE'}:
            continue
        evaluated = obj.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        source_positions[obj.name] = np.array([CONVERSION @ np.array(evaluated.matrix_world @ vertex.co) for vertex in mesh.vertices])
        attribute = mesh.color_attributes.get('BlushTint')
        if attribute:
            source_colors[obj.name] = np.array([entry.color[:] for entry in attribute.data])
        evaluated.to_mesh_clear()
        for slot in obj.material_slots:
            material = slot.material
            bsdf = material.node_tree.nodes.get('Principled BSDF')
            source_materials[material.name] = {'base_color': list(bsdf.inputs['Base Color'].default_value),
                                               'roughness': bsdf.inputs['Roughness'].default_value,
                                               'metallic': bsdf.inputs['Metallic'].default_value,
                                               'base_color_factor': list(bsdf.inputs['Base Color'].default_value)}
            if bsdf.inputs['Base Color'].is_linked:
                linked = bsdf.inputs['Base Color'].links[0].from_node
                assert linked.bl_idname == 'ShaderNodeVertexColor', 'Unsupported material color source'
                source_materials[material.name]['vertex_color_attribute'] = linked.layer_name
                source_materials[material.name]['base_color_factor'] = [1., 1., 1., 1.]
    bpy.ops.object.select_all(action='DESELECT')
    for obj in collection.all_objects:
        obj.select_set(True)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    path = args.output_dir / '.rabbit_realtime.export.glb'
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
                              export_apply=True, export_animations=False, export_cameras=False,
                              export_lights=False, export_skins=True, export_def_bones=False,
                              export_leaf_bone=False, export_armature_object_remove=False,
                              export_rest_position_armature=True, export_yup=True, export_extras=True,
                              export_materials='EXPORT', export_morph=False)
    report = audit_glb(path, [bone['name'] for bone in bones], bindings, source_positions, source_materials, source_colors)
    for bone in bones:
        assert report['node_hierarchy'][bone['name']] == (bone['parent'] or 'Rabbit_Rig'), 'Changed bone hierarchy: ' + bone['name']
    after = {file.name: digest(file) for file in (base, original, source)}
    assert before == after, 'Source blend files changed'
    path = path.replace(args.output_dir / 'rabbit_realtime.glb')
    report.update({'blender_version': bpy.app.version_string, 'source_sha256': before,
                   'source_files_unchanged': before == after, 'glb_sha256': digest(path),
                   'glb_bytes': path.stat().st_size, 'bones_blender': bones,
                   'rigid_bone_bindings': bindings,
                   'proportions': json.loads(rig.get('proportion_metrics', '{}')),
                   'leg_parenting': 'Thighs attach to root so torso lean preserves standing legs.' if rig.data.bones['thigh.L'].parent.name == 'root' else 'Original body-parented legs',
                   'coordinate_system': {'blender_up': '+Z', 'blender_front': '-Y',
                                         'gltf_up': '+Y', 'gltf_front': '+Z',
                                         'conversion': 'gltf(x,y,z) = blender(x,z,-y)'},
                   'limitations': ['glTF uses linear blend skinning; source preserve-volume dual quaternion deformation is approximated.',
                                   'FK knee controls do not implement planted-foot IK.']})
    destination = args.output_dir / 'rabbit_realtime.report.json'
    destination.write_text(json.dumps(report, indent=2) + '\n')
    print('RABBIT_GLTF_EXPORT', json.dumps({'status': 'PASS', 'glb': str(path), 'report': str(destination),
                                          'vertices': report['vertex_count'], 'triangles': report['triangle_count']}))


if __name__ == '__main__':
    main()
