"""Build reusable soft garden props in a caller-owned Blender collection."""

import math

import bpy
from mathutils import Vector


def _material(name, color):
    material = bpy.data.materials.get(name)
    if material is not None:
        return material
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    values = [int(color[index:index + 2], 16) / 255 for index in (1, 3, 5)]
    linear = [value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4
              for value in values]
    rgba = (*linear, 1)
    material.diffuse_color = rgba
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = rgba
    shader.inputs['Roughness'].default_value = 0.75
    shader.inputs['Metallic'].default_value = 0
    return material


def _root(name, collection):
    root = bpy.data.objects.new(name, None)
    collection.objects.link(root)
    root.empty_display_type = 'PLAIN_AXES'
    root.empty_display_size = 0.2
    return root


def _mesh(name, vertices, faces, material, collection, root, subdivide=False):
    mesh = bpy.data.meshes.new(name + '_Mesh')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.data.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    # Both transforms are identity; parenting preserves the authored world pose.
    obj.parent = root
    if subdivide:
        modifier = obj.modifiers.new('Soft_Edges', 'SUBSURF')
        modifier.levels = 1
        modifier.render_levels = 1
    return obj


def _revolve(name, profile, material, collection, root, aspect=1, segments=48,
             subdivide=False):
    vertices = []
    for radius, height in profile:
        vertices.extend((radius * math.cos(math.tau * column / segments),
                         radius * aspect * math.sin(math.tau * column / segments), height)
                        for column in range(segments))
    faces = []
    for row in range(len(profile) - 1):
        for column in range(segments):
            a = row * segments + column
            b = row * segments + (column + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    faces.append(tuple(reversed(range(segments))))
    faces.append(tuple((len(profile) - 1) * segments + column for column in range(segments)))
    return _mesh(name, vertices, faces, material, collection, root, subdivide)


def _tube(name, points, radius, material, collection, root, closed=False, sides=8):
    points = [Vector(point) for point in points]
    vertices = []
    for index, point in enumerate(points):
        previous = points[(index - 1) % len(points)] if closed or index else point
        following = points[(index + 1) % len(points)] if closed or index < len(points) - 1 else point
        tangent = (following - previous).normalized()
        reference = Vector((0, 0, 1)) if abs(tangent.z) < 0.9 else Vector((0, 1, 0))
        normal = tangent.cross(reference).normalized()
        binormal = tangent.cross(normal).normalized()
        for side in range(sides):
            angle = math.tau * side / sides
            vertices.append(point + radius * (math.cos(angle) * normal + math.sin(angle) * binormal))
    faces = []
    for row in range(len(points) if closed else len(points) - 1):
        following = (row + 1) % len(points)
        for side in range(sides):
            a = row * sides + side
            b = row * sides + (side + 1) % sides
            faces.append((a, b, following * sides + (side + 1) % sides, following * sides + side))
    if not closed:
        faces.extend([tuple(reversed(range(sides))),
                      tuple((len(points) - 1) * sides + side for side in range(sides))])
    return _mesh(name, vertices, faces, material, collection, root)


def _leaf(name, direction, reach, height, width, material, collection, root):
    outward = Vector((math.cos(direction), math.sin(direction), 0))
    lateral = Vector((-math.sin(direction), math.cos(direction), 0))
    vertices = []
    rows, sides = 16, 8
    for row in range(rows + 1):
        t = row / rows
        center = outward * (reach * t * t) + Vector((0, 0, height * math.sin(t * math.pi * 0.58)))
        half_width = max(0.004, width * math.sin(math.pi * t) ** 0.8)
        thickness = max(0.003, 0.025 * math.sin(math.pi * t))
        for side in range(sides):
            angle = math.tau * side / sides
            vertices.append(center + lateral * (half_width * math.cos(angle))
                            + outward * (thickness * math.sin(angle)))
    faces = []
    for row in range(rows):
        for side in range(sides):
            a = row * sides + side
            b = row * sides + (side + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    faces.extend([tuple(reversed(range(sides))),
                  tuple(rows * sides + side for side in range(sides))])
    return _mesh(name, vertices, faces, material, collection, root, subdivide=True)


def build_carrot(collection):
    """Return a carrot rooted at its leaf grip, with the taproot below z=0."""
    root = _root('Carrot_Grip_Root', collection)
    orange = _material('Garden_Carrot_Orange', '#F47720')
    crease = _material('Garden_Carrot_Crease', '#D9681C')
    greens = [_material('Garden_Leaf_Sage', '#79A84C'),
              _material('Garden_Leaf_Green', '#669442'),
              _material('Garden_Leaf_Light', '#8CB65A')]
    profile = [(0.005, -1.1), (0.035, -1.075), (0.07, -0.98),
               (0.12, -0.79), (0.175, -0.53), (0.22, -0.3),
               (0.23, -0.17), (0.205, -0.075), (0.13, -0.02), (0.025, 0.005)]
    _revolve('Carrot_Taproot', [(radius * 1.13, height) for radius, height in profile],
             orange, collection, root, subdivide=True)
    for index, (height, radius, half_width, center_x) in enumerate([
            (-0.30, 0.244, 0.070, -0.025), (-0.60, 0.180, 0.055, 0.020)]):
        points = []
        for step in range(13):
            t = step / 12 * 2 - 1
            x = center_x + half_width * t
            points.append((x, -math.sqrt(radius * radius - x * x) - 0.002,
                           height + 0.008 * t * t))
        _tube(f'Carrot_Soft_Crease_{index + 1:02}', points, 0.006,
              crease, collection, root)
    for index, (angle, reach, height, width) in enumerate([
            (-2.8, 0.37, 0.52, 0.115), (-1.55, 0.30, 0.59, 0.12),
            (-0.3, 0.38, 0.53, 0.12), (0.8, 0.31, 0.6, 0.10),
            (2.0, 0.22, 0.65, 0.105)]):
        _leaf(f'Carrot_Leaf_{index + 1:02}', angle, reach, height, width,
              greens[index % len(greens)], collection, root)
    root['pivot_description'] = 'Leaf grip at local (0, 0, 0); taproot points down -Z.'
    return root


def build_soil_patch(collection):
    """Return a low oval soil mound with a small central planting depression."""
    root = _root('Soil_Patch_Root', collection)
    soil = _material('Garden_Soil_Warm', '#956D4F')
    pebble = _material('Garden_Soil_Clumps', '#A37A58')
    opening = _material('Garden_Soil_Opening', '#62422D')
    _revolve('Soil_Rounded_Mound', [(0.008, -0.18), (0.78, -0.18), (1.015, -0.135),
                                   (1.1, -0.065), (1.08, -0.012), (0.95, 0.025),
                                   (0.57, 0.035), (0.28, 0.015), (0.19, -0.035),
                                   (0.12, -0.09), (0.008, -0.095)],
             soil, collection, root, aspect=0.78, subdivide=True)
    _revolve('Soil_Recessed_Opening', [(0.008, -0.09), (0.14, -0.065),
                                      (0.16, -0.032), (0.145, -0.025),
                                      (0.09, -0.035), (0.008, -0.05)],
             opening, collection, root, aspect=0.78, segments=32, subdivide=True)
    for index in range(8):
        angle = math.tau * index / 8 + 0.14
        radius = 0.052 + 0.015 * (index % 3)
        obj = _revolve(f'Soil_Edge_Clump_{index + 1:02}',
                       [(0.004, -0.035), (radius * 0.8, -0.025),
                        (radius, 0.005), (radius * 0.7, 0.035), (0.004, 0.045)],
                       pebble, collection, root, aspect=0.8, segments=16, subdivide=True)
        obj.location = (0.92 * math.cos(angle), 0.71 * math.sin(angle), -0.015)
    root['pivot_description'] = 'Ground surface center at local (0, 0, 0).'
    return root


def build_basket(collection):
    """Return an open oval basket on z=0 with soft woven bands and a handle."""
    root = _root('Basket_Root', collection)
    wood = _material('Garden_Basket_Honey', '#BA8B56')
    bands = _material('Garden_Basket_Bands', '#D5AB73')
    dark = _material('Garden_Basket_Inside', '#A97C4C')
    # The continuous shell is open at the top, with a recessed interior floor.
    _revolve('Basket_Open_Shell', [(0.008, 0.025), (0.56, 0.025), (0.64, 0.09),
                                  (0.78, 0.73), (0.78, 0.79), (0.73, 0.79),
                                  (0.72, 0.73), (0.59, 0.15), (0.008, 0.15)],
             dark, collection, root, aspect=0.72, subdivide=True)
    for index in range(7):
        height = 0.15 + index * 0.102
        radius = 0.65 + (height - 0.15) * 0.215
        points = [(radius * math.cos(math.tau * step / 64),
                   radius * 0.72 * math.sin(math.tau * step / 64), height)
                  for step in range(64)]
        _tube(f'Basket_Woven_Band_{index + 1:02}', points, 0.036,
              bands if index % 2 == 0 else wood, collection, root, closed=True)
    for index in range(16):
        angle = math.tau * index / 16
        points = []
        for step in range(15):
            t = step / 14
            radius = 0.65 + 0.132 * t + 0.009 * math.cos(t * math.pi * 12)
            points.append((radius * math.cos(angle), radius * 0.72 * math.sin(angle), 0.12 + 0.65 * t))
        _tube(f'Basket_Vertical_Reed_{index + 1:02}', points, 0.022, wood, collection, root)
    rim = [(0.78 * math.cos(math.tau * step / 64),
            0.562 * math.sin(math.tau * step / 64), 0.795) for step in range(64)]
    _tube('Basket_Rounded_Rim', rim, 0.045, bands, collection, root, closed=True, sides=10)
    handle = [(0.74 * math.cos(math.pi * step / 32), 0.045,
               0.76 + 0.60 * math.sin(math.pi * step / 32)) for step in range(33)]
    _tube('Basket_Arched_Handle', handle, 0.05, wood, collection, root, sides=10)
    root['pivot_description'] = 'Base center at local (0, 0, 0); open rim at z=0.84.'
    return root
