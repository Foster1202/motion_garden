"""Export the saved Task 2E carrot without changing its Blender scene."""

import argparse
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils.kdtree import KDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_rabbit_glb import CONVERSION, accessor, digest, local_matrix, read_glb, rounded

ROOT = Path(__file__).resolve().parents[2]


def audit_glb(path, source_positions, source_materials, expected_names):
    document, binary = read_glb(path)
    nodes = document['nodes']
    names = {node['name']: index for index, node in enumerate(nodes)}
    parents = {child: index for index, node in enumerate(nodes) for child in node.get('children', [])}
    assert set(names) == expected_names, 'Unexpected or missing exported carrot nodes'
    assert not document.get('animations') and not document.get('cameras')
    assert not document.get('skins') and not document.get('images')
    assert not any('KHR_lights_punctual' in node.get('extensions', {}) for node in nodes)
    matrices = {}

    def world_matrix(index):
        if index not in matrices:
            local = local_matrix(nodes[index])
            matrices[index] = world_matrix(parents[index]) @ local if index in parents else local
        return matrices[index]

    grip_index = names['Carrot_Grip_Point']
    grip_matrix = world_matrix(grip_index)
    assert np.max(abs(grip_matrix - np.eye(4))) < 1e-6, 'Grip must retain the authored leaf-root pivot'
    assert nodes[parents[grip_index]]['name'] == 'Carrot_Grip_Root'
    positions = {}
    meshes = []
    errors = {}
    for index, node in enumerate(nodes):
        if 'mesh' not in node:
            continue
        primitives = document['meshes'][node['mesh']]['primitives']
        coordinates = np.concatenate([accessor(document, binary, primitive['attributes']['POSITION'])
                                      for primitive in primitives])
        points = (np.column_stack([coordinates, np.ones(len(coordinates))]) @ world_matrix(index).T)[:, :3]
        positions[node['name']] = points
        expected = source_positions[node['name']]
        maximum_error = 0.
        for first, second in ((points, expected), (expected, points)):
            tree = KDTree(len(second))
            for vertex_index, point in enumerate(second):
                tree.insert(point, vertex_index)
            tree.balance()
            maximum_error = max(maximum_error, max(tree.find(point)[2] for point in first))
        assert maximum_error < 1e-5, node['name'] + ': exported geometry differs from source'
        errors[node['name']] = maximum_error
        meshes.append({'name': node['name'], 'vertices': len(coordinates),
                       'triangles': sum(document['accessors'][primitive['indices']]['count'] // 3
                                        for primitive in primitives),
                       'parent': nodes[parents[index]]['name'] if index in parents else None})
    exported_materials = {material['name']: material for material in document['materials']}
    assert set(exported_materials) == set(source_materials)
    for name, source in source_materials.items():
        material = exported_materials[name]['pbrMetallicRoughness']
        assert np.max(abs(np.array(material.get('baseColorFactor', [1., 1., 1., 1.])) - source['base_color_factor'])) < 1e-6
        assert abs(material.get('roughnessFactor', 1.) - source['roughness']) < 1e-6
        assert abs(material.get('metallicFactor', 1.) - source['metallic']) < 1e-6
    all_points = np.concatenate(list(positions.values()))
    bounds = {'minimum': rounded(all_points.min(axis=0)), 'maximum': rounded(all_points.max(axis=0))}
    taproot = positions[next(name for name in positions if name.startswith('Carrot_Taproot'))]
    assert taproot[:, 1].min() < -1. and taproot[:, 1].max() < .03
    for name, points in positions.items():
        if name.startswith('Carrot_Leaf_'):
            assert points[:, 1].max() > .4 and points[:, 1].min() > -.03
    return {
        'status': 'PASS', 'mesh_count': len(meshes), 'meshes': meshes,
        'vertex_count': sum(mesh['vertices'] for mesh in meshes),
        'triangle_count': sum(mesh['triangles'] for mesh in meshes),
        'material_count': len(exported_materials), 'materials': document['materials'],
        'material_values_preserved': True,
        'node_hierarchy': {node['name']: nodes[parents[index]]['name'] if index in parents else None
                           for index, node in enumerate(nodes)},
        'bounds_gltf': bounds,
        'mesh_bounds_gltf': {name: {'minimum': rounded(points.min(axis=0)), 'maximum': rounded(points.max(axis=0))}
                             for name, points in positions.items()},
        'grip_point': {'name': 'Carrot_Grip_Point', 'parent': 'Carrot_Grip_Root',
                       'local_position': nodes[grip_index].get('translation', [0., 0., 0.]),
                       'world_position': rounded(grip_matrix[:3, 3]),
                       'world_local_axes_columns': rounded(grip_matrix[:3, :3]),
                       'description': 'Leaf-root junction. Leaves +Y, taproot -Y, front +Z.'},
        'source_geometry_maximum_error': max(errors.values()), 'source_geometry_errors': errors,
        'animation_count': 0, 'camera_count': 0, 'light_count': 0, 'skin_count': 0, 'texture_count': 0,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / 'assets/blender/scenes/carrot_pull_scene.blend')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'dist/carrot3d')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    source = args.source.resolve()
    source_hash = digest(source)
    bpy.ops.wm.open_mainfile(filepath=str(source))
    collection = bpy.data.collections['carrot']
    collection.hide_render = False
    collection.hide_viewport = False
    root = collection.objects['Carrot_Grip_Root']
    assert root.type == 'EMPTY' and root.parent is None
    assert np.max(abs(np.array(root.matrix_world) - np.eye(4))) < 1e-6
    source_positions = {}
    source_materials = {}
    graph = bpy.context.evaluated_depsgraph_get()
    for obj in list(collection.all_objects):
        obj.animation_data_clear()
        obj.hide_set(False)
        obj.hide_render = False
        if obj.type != 'MESH':
            continue
        assert obj.parent == root, 'Expected the saved standalone carrot hierarchy'
        evaluated = obj.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        source_positions[obj.name] = np.array([CONVERSION @ np.array(evaluated.matrix_world @ vertex.co)
                                               for vertex in mesh.vertices])
        evaluated.to_mesh_clear()
        for material in obj.data.materials:
            shader = material.node_tree.nodes['Principled BSDF']
            assert not shader.inputs['Base Color'].is_linked
            source_materials[material.name] = {
                'base_color_factor': list(shader.inputs['Base Color'].default_value),
                'roughness': shader.inputs['Roughness'].default_value,
                'metallic': shader.inputs['Metallic'].default_value,
            }
    assert len(source_positions) == 8 and len(source_materials) == 5, (list(source_positions), list(source_materials))
    grip = bpy.data.objects.new('Carrot_Grip_Point', None)
    collection.objects.link(grip)
    grip.parent = root
    grip.empty_display_type = 'PLAIN_AXES'
    grip.empty_display_size = .1
    grip['purpose'] = 'Runtime leaf-root grip attachment point'
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    for obj in collection.all_objects:
        obj.select_set(True)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    staging = args.output_dir / '.carrot_realtime.export.glb'
    bpy.ops.export_scene.gltf(filepath=str(staging), export_format='GLB', use_selection=True,
                              export_apply=True, export_animations=False, export_cameras=False,
                              export_lights=False, export_skins=False, export_yup=True,
                              export_extras=True, export_materials='EXPORT', export_morph=False)
    report = audit_glb(staging, source_positions, source_materials, {obj.name for obj in collection.all_objects})
    assert digest(source) == source_hash, 'Source Blender scene changed'
    destination = staging.replace(args.output_dir / 'carrot_realtime.glb')
    report.update({
        'blender_version': bpy.app.version_string,
        'source': 'model/assets/blender/scenes/carrot_pull_scene.blend',
        'source_collection': 'carrot', 'source_sha256': source_hash, 'source_file_unchanged': True,
        'source_materials': source_materials,
        'glb_sha256': digest(destination), 'glb_bytes': destination.stat().st_size,
        'coordinate_system': {'blender_up': '+Z', 'blender_front': '-Y',
                              'gltf_up': '+Y', 'gltf_front': '+Z',
                              'conversion': 'gltf(x,y,z) = blender(x,z,-y)'},
        'limitations': ['Original evaluated geometry and proportions are retained. Runtime supplies scene placement and uniform scale.'],
    })
    report_path = args.output_dir / 'carrot_realtime.report.json'
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print('CARROT_GLTF_EXPORT', json.dumps({'status': 'PASS', 'glb': str(destination),
                                          'report': str(report_path), 'bytes': report['glb_bytes'],
                                          'vertices': report['vertex_count'], 'triangles': report['triangle_count']}))


if __name__ == '__main__':
    main()
