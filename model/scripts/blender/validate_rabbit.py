"""Reopen and validate the saved base asset and its transparent preview."""
import json
from pathlib import Path

import bmesh
import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view

ROOT = Path(__file__).resolve().parents[2]
BLEND = ROOT / 'assets/blender/rabbit/rabbit_base.blend'
PNG = ROOT / 'assets/rendered/rabbit/rabbit_front_preview.png'

bpy.ops.wm.open_mainfile(filepath=str(BLEND))
scene = bpy.context.scene
collection = bpy.data.collections['Rabbit_Character']
objects = list(collection.all_objects)
required = {'Rabbit_Root', 'Rabbit_Head', 'Rabbit_Body', 'Rabbit_Tail', 'Rabbit_Nose',
            'Rabbit_Mouth_Stem', 'Rabbit_Mouth_L', 'Rabbit_Mouth_R'}
for suffix in ('L', 'R'):
    required.update('Rabbit_' + part + '_' + suffix for part in
                    ('Ear', 'InnerEar', 'Arm', 'Leg', 'Eye', 'Cheek'))
assert required <= {obj.name for obj in objects}, 'Missing named parts'
assert not any(obj.type == 'ARMATURE' for obj in objects), 'Unexpected rig'
assert not bpy.data.actions, 'Unexpected animation'
assert scene.render.engine == 'BLENDER_EEVEE'
assert scene.camera.data.type == 'ORTHO'
assert scene.render.film_transparent
assert scene.render.image_settings.color_mode == 'RGBA'
assert scene.render.resolution_x == scene.render.resolution_y == 1024
assert bpy.data.objects['Studio_Ground'].hide_render
assert all(not obj.animation_data for obj in objects)

geometry = [obj for obj in objects if obj.type in {'MESH', 'CURVE'}]
assert all(obj.material_slots and all(slot.material for slot in obj.material_slots) for obj in geometry)
assert all(obj.name.startswith('Rabbit_') for obj in objects)
assert all(not obj.particle_systems for obj in geometry)
assert not any(image.source == 'FILE' for image in bpy.data.images), 'Unexpected external texture'
assert all(slot.material.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value == 0
           for obj in geometry for slot in obj.material_slots)

projected, world_z = [], []
closed_meshes, surface_overlays = [], []
graph = bpy.context.evaluated_depsgraph_get()
for obj in geometry:
    assert obj.parent is not None, obj.name
    for modifier in obj.modifiers:
        assert modifier.type == 'SUBSURF', obj.name
        assert modifier.levels == modifier.render_levels == 1
        assert modifier.show_viewport and modifier.show_render
    evaluated = obj.evaluated_get(graph)
    mesh = evaluated.to_mesh()
    for vertex in mesh.vertices:
        world = obj.matrix_world @ vertex.co
        world_z.append(world.z)
        projected.append(world_to_camera_view(scene, scene.camera, world))
    evaluated.to_mesh_clear()
    if obj.type == 'MESH':
        assert all(poly.use_smooth for poly in obj.data.polygons)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        if 'Cheek' in obj.name or 'InnerEar' in obj.name:
            assert all(face.normal.y < 0 for face in bm.faces), obj.name + ': reversed overlay normal'
            surface_overlays.append(obj.name)
        else:
            assert all(edge.is_manifold for edge in bm.edges), obj.name + ': non-manifold volume'
            assert bm.calc_volume(signed=True) > 0, obj.name + ': inward normals'
            closed_meshes.append(obj.name)
        bm.free()
assert min(world_z) >= -0.001 and min(world_z) < 0.01
assert all(0.03 < v.x < 0.97 and 0.03 < v.y < 0.97 and v.z > 0 for v in projected)
for suffix in ('L', 'R'):
    assert bpy.data.objects['Rabbit_InnerEar_' + suffix].parent.name == 'Rabbit_Ear_' + suffix
    assert bpy.data.objects['Rabbit_Eye_' + suffix].parent.name == 'Rabbit_Head'
    assert bpy.data.objects['Rabbit_Cheek_' + suffix].parent.name == 'Rabbit_Head'

image = bpy.data.images.load(str(PNG), check_existing=False)
assert tuple(image.size) == (1024, 1024)
assert image.channels == 4
pixels = np.empty(1024 * 1024 * 4, dtype=np.float32)
image.pixels.foreach_get(pixels)
alpha = pixels.reshape((1024, 1024, 4))[:, :, 3]
assert np.max(alpha[0]) == np.max(alpha[-1]) == np.max(alpha[:, 0]) == np.max(alpha[:, -1]) == 0
assert np.count_nonzero(alpha == 0) > 1024 * 1024 * 0.5
assert np.max(alpha) == 1
ys, xs = np.where(alpha > 0.01)
report = {
    'status': 'PASS',
    'blender_version': bpy.app.version_string,
    'saved_blend_reopened': True,
    'engine': scene.render.engine,
    'character_objects_including_root': len(objects),
    'renderable_character_parts': len(geometry),
    'closed_manifold_meshes': len(closed_meshes),
    'open_surface_overlays': surface_overlays,
    'missing_materials': 0,
    'external_textures': 0,
    'unexpected_or_disabled_modifiers': 0,
    'armatures': 0,
    'animation_actions': 0,
    'feet_min_z': min(world_z),
    'camera_normalized_bounds': {
        'x': [min(v.x for v in projected), max(v.x for v in projected)],
        'y': [min(v.y for v in projected), max(v.y for v in projected)],
    },
    'png': {
        'resolution': list(image.size),
        'channels': image.channels,
        'all_border_pixels_transparent': True,
        'fully_transparent_pixel_fraction': float(np.mean(alpha == 0)),
        'silhouette_bounds_pixels_bottom_origin': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
    },
}
(ROOT / 'rabbit_validation.json').write_text(json.dumps(report, indent=2) + '\n')
print('RABBIT_VALIDATION', json.dumps(report))
