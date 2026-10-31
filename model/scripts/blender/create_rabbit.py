"""Build the Motion Garden rabbit with separate, pivot-ready mesh parts."""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
FRONT = '-Y'
HEAD_CENTER = Vector((0, -0.015, 2.015))
HEAD_RADII = (0.86, 0.59, 0.68)


def arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-root', type=Path, default=ROOT)
    parser.add_argument('--no-render', action='store_true')
    parser.add_argument('--render-only', action='store_true')
    return parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])


def linear(hex_color):
    c = hex_color.lstrip('#')
    values = [int(c[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v < 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in values)


def material(name, color, roughness=0.65):
    mat = bpy.data.materials.new(name)
    rgba = (*linear(color), 1)
    mat.diffuse_color = rgba
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = 0
    return mat


def mesh_object(name, vertices, faces, mat, collection, pivot=(0, 0, 0), subdiv=False):
    pivot = Vector(pivot)
    mesh = bpy.data.meshes.new(name + '_Mesh')
    mesh.from_pydata([Vector(v) - pivot for v in vertices], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.location = pivot
    obj.data.materials.append(mat)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    if subdiv:
        modifier = obj.modifiers.new('Soft_Subdivision', 'SUBSURF')
        modifier.subdivision_type = 'CATMULL_CLARK'
        modifier.levels = 1
        modifier.render_levels = 1
    return obj


def ellipsoid(name, center, radii, mat, collection, pivot=None, segments=32, rings=20,
              pear=0, lean=0, rotation=0, subdiv=True, foot=False):
    center = Vector(center)
    rx, ry, rz = radii

    def point(theta, phi):
        z = math.cos(theta)
        x = rx * math.sin(theta) * math.cos(phi) * (1 - pear * z)
        y = ry * math.sin(theta) * math.sin(phi) * (1 - pear * z * 0.35)
        if foot:
            cap = max(0, math.sin(theta)) ** 0.72
            x = rx * cap * math.cos(phi)
            y = ry * cap * math.sin(phi) - 0.065 * (1 - z)
        local_z = rz * z
        rotated_x = x * math.cos(rotation) + local_z * math.sin(rotation)
        rotated_z = -x * math.sin(rotation) + local_z * math.cos(rotation)
        return center + Vector((rotated_x + lean * z, y, rotated_z))

    vertices = [point(0, 0)]
    for row in range(1, rings):
        for column in range(segments):
            vertices.append(point(math.pi * row / rings, math.tau * column / segments))
    bottom = len(vertices)
    vertices.append(point(math.pi, 0))
    faces = []
    for col in range(segments):
        faces.append((0, 1 + col, 1 + (col + 1) % segments))
    for row in range(rings - 2):
        for col in range(segments):
            a = 1 + row * segments + col
            b = 1 + row * segments + (col + 1) % segments
            faces.append((a, a + segments, b + segments, b))
    last = 1 + (rings - 2) * segments
    for col in range(segments):
        faces.append((bottom, last + (col + 1) % segments, last + col))
    return mesh_object(name, vertices, faces, mat, collection, pivot or center, subdiv)


def attach(child, parent):
    bpy.context.view_layer.update()
    world_matrix = child.matrix_world.copy()
    child.parent = parent
    child.matrix_world = world_matrix


def surface_patch(name, cx, cz, rx, rz, surface, mat, collection, parent, blush=False):
    segments, rings = 48, 8
    vertices = [surface(cx, cz)]
    weights = [1.0]
    for row in range(1, rings + 1):
        r = row / rings
        for col in range(segments):
            angle = math.tau * col / segments
            vertices.append(surface(cx + rx * r * math.cos(angle), cz + rz * r * math.sin(angle)))
            weights.append((1 - r * r) ** 2)
    faces = [(0, 1 + i, 1 + (i + 1) % segments) for i in range(segments)]
    for row in range(rings - 1):
        for col in range(segments):
            a = 1 + row * segments + col
            b = 1 + row * segments + (col + 1) % segments
            faces.append((a, a + segments, b + segments, b))
    obj = mesh_object(name, vertices, faces, mat, collection, vertices[0])
    if blush:
        attr = obj.data.color_attributes.new(name='BlushTint', type='FLOAT_COLOR', domain='POINT')
        cream, pink = linear('#F5EFE4'), linear('#EBA99E')
        for datum, weight in zip(attr.data, weights):
            datum.color = (*[cream[i] * (1 - weight * 0.8) + pink[i] * weight * 0.8 for i in range(3)], 1)
    attach(obj, parent)
    return obj


def head_surface(x, z, offset=0.006):
    local_z = (z - HEAD_CENTER.z) / HEAD_RADII[2]
    rx = HEAD_RADII[0] * (1 - 0.075 * local_z)
    ry = HEAD_RADII[1] * (1 - 0.075 * local_z * 0.35)
    y = HEAD_CENTER.y - ry * math.sqrt(max(0.001, 1 - (x / rx) ** 2 - local_z ** 2))
    return (x, y - offset, z)


def smile(name, points, mat, collection, head):
    data = bpy.data.curves.new(name + '_Curve', 'CURVE')
    data.dimensions = '3D'
    data.resolution_u = 16
    data.bevel_depth = 0.010
    data.bevel_resolution = 3
    data.use_fill_caps = True
    spline = data.splines.new('BEZIER')
    spline.bezier_points.add(len(points) - 1)
    for point, (x, z) in zip(spline.bezier_points, points):
        point.co = head_surface(x, z, 0.012)
        point.handle_left_type = 'AUTO'
        point.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.data.materials.append(mat)
    attach(obj, head)
    return obj


def light(name, position, target, energy, size, collection, color):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = energy
    data.shape = 'DISK'
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.location = position
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    return obj


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    character = bpy.data.collections.new('Rabbit_Character')
    studio = bpy.data.collections.new('Studio_Preview')
    scene.collection.children.link(character)
    scene.collection.children.link(studio)
    root = bpy.data.objects.new('Rabbit_Root', None)
    character.objects.link(root)
    root.empty_display_type = 'PLAIN_AXES'
    root.empty_display_size = 0.25
    root['front_axis'] = FRONT
    root['task'] = 'Task 2A: separate base meshes, no armature or animation'
    root['left_right_convention'] = 'Character anatomical left = +X; right = -X'

    cream = material('Rabbit_WarmIvory', '#F5EFE4', 0.68)
    pink = material('Rabbit_InnerEarPink', '#E8AEA4', 0.72)
    dark = material('Rabbit_EyeEspresso', '#38251F', 0.30)
    nose_mat = material('Rabbit_NoseRoseBrown', '#B76F64', 0.60)
    mouth_mat = material('Rabbit_SmileBrown', '#885046', 0.70)
    glint = material('Rabbit_EyeCatchlight', '#FFF6E5', 0.45)
    blush = material('Rabbit_SoftBlush', '#EBA99E', 0.68)
    attr = blush.node_tree.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'BlushTint'
    blush.node_tree.links.new(attr.outputs['Color'], blush.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])

    body = ellipsoid('Rabbit_Body', (0, 0.025, 0.985), (0.55, 0.405, 0.72), cream, character,
                     pivot=(0, 0.025, 0.57), pear=0.18)
    attach(body, root)
    head = ellipsoid('Rabbit_Head', HEAD_CENTER, HEAD_RADII, cream, character,
                     pivot=(0, 0, 1.48), pear=0.075, segments=40, rings=24)
    attach(head, body)

    def blush_surface(x, z):
        bpy.context.view_layer.update()
        evaluated_head = head.evaluated_get(bpy.context.evaluated_depsgraph_get())
        origin = head.matrix_world.inverted() @ Vector((x, -3, z))
        hit, position, normal, _ = evaluated_head.ray_cast(origin, Vector((0, 1, 0)))
        if not hit:
            raise RuntimeError('Cheek projection missed the head')
        return head.matrix_world @ (position + normal * 0.00065)

    for suffix, sign in [('L', 1), ('R', -1)]:
        ear_x, ear_z, ear_y = sign * 0.38, 3.015, 0.025
        lean = sign * 0.105
        ear = ellipsoid('Rabbit_Ear_' + suffix, (ear_x, ear_y, ear_z), (0.188, 0.145, 0.59),
                        cream, character, pivot=(ear_x - lean, ear_y, 2.47), lean=lean, segments=28, rings=20)
        attach(ear, head)

        def ear_surface(x, z):
            local_z = z / 0.59
            y = ear_y - 0.145 * math.sqrt(max(0.001, 1 - (x / 0.188) ** 2 - local_z ** 2)) - 0.006
            return (ear_x + x + lean * local_z, y, ear_z + z)

        surface_patch('Rabbit_InnerEar_' + suffix, 0, 0.02, 0.105, 0.445,
                      ear_surface, pink, character, ear)
        arm = ellipsoid('Rabbit_Arm_' + suffix, (sign * 0.615, -0.012, 1.10), (0.15, 0.17, 0.355),
                        cream, character, pivot=(sign * 0.515, -0.005, 1.37),
                        rotation=-sign * math.radians(23), segments=28, rings=16)
        attach(arm, body)
        leg = ellipsoid('Rabbit_Leg_' + suffix, (sign * 0.265, 0.060, 0.223), (0.224, 0.235, 0.219),
                        cream, character, pivot=(sign * 0.265, 0, 0.51), segments=28, rings=20, foot=True)
        attach(leg, body)
        eye_x, eye_z = sign * 0.35, 2.045
        eye_center = Vector(head_surface(eye_x, eye_z, 0.022))
        eye = ellipsoid('Rabbit_Eye_' + suffix, eye_center, (0.069, 0.036, 0.081), dark,
                        character, segments=28, rings=16, subdiv=False)
        attach(eye, head)
        catchlight = ellipsoid('Rabbit_EyeHighlight_' + suffix,
                              eye_center + Vector((-0.018, -0.034, 0.026)), (0.014, 0.006, 0.018),
                              glint, character, segments=16, rings=12, subdiv=False)
        attach(catchlight, eye)
        surface_patch('Rabbit_Cheek_' + suffix, sign * 0.54, 1.91, 0.137, 0.081,
                      blush_surface, blush, character, head, blush=True)
    tail = ellipsoid('Rabbit_Tail', (0, 0.44, 0.64), (0.205, 0.205, 0.205), cream, character,
                     pivot=(0, 0.35, 0.64), segments=28, rings=16)
    attach(tail, body)
    nose = ellipsoid('Rabbit_Nose', head_surface(0, 1.935, 0.020), (0.052, 0.026, 0.032),
                     nose_mat, character, pear=-0.25, segments=24, rings=16, subdiv=False)
    attach(nose, head)
    smile('Rabbit_Mouth_Stem', [(0, 1.917), (0, 1.885), (0, 1.865)], mouth_mat, character, head)
    smile('Rabbit_Mouth_L', [(0, 1.865), (0.027, 1.839), (0.064, 1.829), (0.092, 1.844), (0.104, 1.864)], mouth_mat, character, head)
    smile('Rabbit_Mouth_R', [(0, 1.865), (-0.027, 1.839), (-0.064, 1.829), (-0.092, 1.844), (-0.104, 1.864)], mouth_mat, character, head)

    floor_mat = material('Studio_GroundCream', '#E7DDCB', 0.85)
    floor = mesh_object('Studio_Ground', [(-100, -100, -0.008), (100, -100, -0.008),
                                        (100, 100, -0.008), (-100, 100, -0.008)],
                        [(0, 1, 2, 3)], floor_mat, studio)
    floor.hide_render = True
    floor['note'] = 'Viewport ground only; excluded from transparent sprite preview'
    light('Studio_Key', (-3.6, -4.8, 6), (0, 0, 1.8), 470, 4.0, studio, (1.0, 0.93, 0.84))
    light('Studio_Fill', (3.5, -3, 3.8), (0, 0, 1.8), 290, 3.5, studio, (0.87, 0.94, 1.0))
    light('Studio_Rim', (1.8, 3.2, 5), (0, 0, 2), 520, 3.0, studio, (1.0, 0.94, 0.87))
    world = bpy.data.worlds.new('Studio_World')
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.78, 0.82, 0.88, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.30
    scene.world = world
    data = bpy.data.cameras.new('Camera_Front_Orthographic')
    camera = bpy.data.objects.new('Camera_Front_Orthographic', data)
    studio.objects.link(camera)
    camera.location = (0, -8, 1.805)
    camera.rotation_euler = (Vector((0, 0, 1.805)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    data.type = 'ORTHO'
    data.ortho_scale = 4.20
    data.lens = 70
    scene.camera = camera
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.render.film_transparent = True
    scene.render.image_settings.compression = 30
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.exposure = 0.65
    scene.render.fps = 24
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0
    scene['asset_version'] = 'Task 2A / 1.0'
    scene['model_units'] = 'Stylized asset units; not a real rabbit scale'
    scene['front'] = FRONT
    scene['reference'] = 'Motion Garden Concept Board: original toy-like rabbit interpretation'
    scene['rig_status'] = 'Unrigged. Separate overlapping volumes prepared for a rigid-part rigging pass.'
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    head.select_set(True)
    bpy.context.view_layer.objects.active = head
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                area.spaces.active.region_3d.view_perspective = 'CAMERA'
    return scene


def audit(scene, destination):
    graph = bpy.context.evaluated_depsgraph_get()
    rows = []
    bounds = []
    for obj in bpy.data.collections['Rabbit_Character'].all_objects:
        if obj.type not in {'MESH', 'CURVE'}:
            continue
        evaluated = obj.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        vertices = [obj.matrix_world @ v.co for v in mesh.vertices]
        bounds.extend(vertices)
        rows.append({
            'name': obj.name, 'type': obj.type,
            'parent': obj.parent.name if obj.parent else None,
            'pivot_world': list(obj.matrix_world.translation),
            'base_vertices': len(obj.data.vertices) if obj.type == 'MESH' else None,
            'base_polygons': len(obj.data.polygons) if obj.type == 'MESH' else None,
            'evaluated_polygons': len(mesh.polygons),
            'evaluated_triangles': len(mesh.loop_triangles),
            'materials': [slot.material.name for slot in obj.material_slots],
            'modifiers': [{'name': mod.name, 'type': mod.type, 'viewport': mod.levels,
                           'render': mod.render_levels} for mod in obj.modifiers if mod.type == 'SUBSURF'],
        })
        evaluated.to_mesh_clear()
    report = {
        'blender_version': bpy.app.version_string, 'blender_executable': bpy.app.binary_path,
        'engine': scene.render.engine, 'front': FRONT,
        'base_mesh_polygons': sum(row['base_polygons'] or 0 for row in rows),
        'evaluated_polygons_including_curves': sum(row['evaluated_polygons'] for row in rows),
        'evaluated_triangles_including_curves': sum(row['evaluated_triangles'] for row in rows),
        'bounds_min': [min(v[i] for v in bounds) for i in range(3)],
        'bounds_max': [max(v[i] for v in bounds) for i in range(3)],
        'objects': rows,
    }
    destination.write_text(json.dumps(report, indent=2) + '\n')
    print('RABBIT_AUDIT', json.dumps({k: v for k, v in report.items() if k != 'objects'}))
    return report


def main():
    args = arguments()
    root = args.output_root.resolve()
    blend = root / 'assets/blender/rabbit/rabbit_base.blend'
    preview = root / 'assets/rendered/rabbit/rabbit_front_preview.png'
    blend.parent.mkdir(parents=True, exist_ok=True)
    preview.parent.mkdir(parents=True, exist_ok=True)
    if args.render_only:
        bpy.ops.wm.open_mainfile(filepath=str(blend))
        scene = bpy.context.scene
    else:
        scene = build()
        scene.render.filepath = str(preview)
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    audit(scene, root / 'rabbit_model_report.json')
    if not args.no_render:
        scene.render.filepath = str(preview)
        bpy.ops.render.render(write_still=True)
        print('RABBIT_PREVIEW', str(preview))


if __name__ == '__main__':
    main()
