"""Render sculpted orchard trees and a raspberry as transparent game layers."""
import bpy, math, random, json, shutil
from pathlib import Path
from mathutils import Vector
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'dist/berry_kick'
PUBLIC = ROOT.parent / 'public/assets/berry_kick'
OUT.mkdir(parents=True, exist_ok=True)
PUBLIC.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.film_transparent = True
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.72, .82, .66, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .45

def material(name, color, roughness=.72):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    return m

wood = material('Warm cinnamon heartwood', (.37, .145, .046))
wood_light = material('Honey bark ribbons', (.54, .275, .102))
wood_dark = material('Soft carved bark seams', (.245, .087, .027))
leaves = [material('Orchard foliage %02d' % i, color) for i, color in enumerate([
    (.045, .15, .028), (.075, .245, .035), (.13, .34, .045),
    (.235, .445, .07), (.36, .515, .10), (.16, .30, .035)])]
fruit_mat = material('Raspberry coral velvet', (.72, .025, .065), .42)
fruit_light = material('Raspberry rose sun', (.88, .065, .105), .44)
bsdf = fruit_mat.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Subsurface Weight'].default_value = .09

def sphere(name, pos, scale, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=20, location=pos)
    ob = bpy.context.object
    ob.name = name
    ob.scale = scale
    ob.data.materials.append(mat)
    for face in ob.data.polygons:
        face.use_smooth = True
    return ob

def branch(name, points, radius, mat):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 20
    curve.bevel_depth = radius
    curve.bevel_resolution = 5
    spline = curve.splines.new('BEZIER')
    spline.bezier_points.add(len(points) - 1)
    for i, (p, point) in enumerate(zip(spline.bezier_points, points)):
        p.co = point[:3]
        p.radius = point[3] if len(point) > 3 else 1
        p.handle_left_type = p.handle_right_type = 'AUTO'
    ob = bpy.data.objects.new(name, curve)
    scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob

# A curved, tapered almond surface gives the foliage a botanical silhouette.
def leaf(name, x, y, z, length, width, angle, mat, tilt=0):
    verts, faces = [], []
    rows = 12
    for i in range(rows + 1):
        t = i / rows
        u = length * t
        half = width * math.sin(math.pi * t) ** .8
        for edge in [-1, 0, 1]:
            v = half * edge
            depth = -.055 * math.sin(math.pi * t) * (1 - abs(edge)) + tilt * t
            verts.append((x + v * math.cos(angle) + u * math.sin(angle), y + depth,
                          z - v * math.sin(angle) + u * math.cos(angle)))
    for i in range(rows):
        for j in range(2):
            a = i * 3 + j
            faces.append((a, a + 1, a + 4, a + 3))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(mat)
    ob = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(ob)
    for p in mesh.polygons:
        p.use_smooth = True
    solid = ob.modifiers.new('Rounded leaf edge', 'SOLIDIFY')
    solid.thickness = .008
    sub = ob.modifiers.new('Silky leaf surface', 'SUBSURF')
    sub.levels = 1
    if length > .24:
        branch('Fine leaf midrib', [(x + length*t*math.sin(angle), y-.055*math.sin(math.pi*t)+tilt*t-.009, z + length*t*math.cos(angle), 1-t) for t in [.05,.35,.65,.93]], .004, leaves[2])
    return ob

bpy.ops.object.camera_add(location=(0, -20, 2.8))
cam = bpy.context.object
cam.rotation_euler = (math.pi / 2, 0, 0)
cam.data.type = 'ORTHO'
scene.camera = cam

def light(name, loc, energy, color, size):
    bpy.ops.object.light_add(type='AREA', location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.data.energy = energy
    ob.data.color = color
    ob.data.shape = 'DISK'
    ob.data.size = size
    ob.rotation_euler = (Vector((0, 0, 3)) - ob.location).to_track_quat('-Z', 'Y').to_euler()

light('Broad warm morning sun', (-4, -5, 9), 700, (1, .86, .66), 5)
light('Sky fill', (4, -3, 5), 210, (.8, .9, 1), 6)
light('Leaf rim light', (0, 4, 7), 500, (1, .91, .69), 4)
base = set(scene.objects)

def render(name, width, height, center, ortho):
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    cam.location = (center[0], -20, center[1])
    cam.data.ortho_scale = ortho
    scene.render.filepath = str(OUT / (name + '.png'))
    bpy.ops.render.render(write_still=True)
    shutil.copy2(scene.render.filepath, PUBLIC)

anchors = {}
for side, seed in [('left', 124), ('right', 257)]:
    random.seed(seed)
    flip = 1 if side == 'left' else -1
    # The lowest trunk stays centered to match the established collision zone.
    branch(side + ' sculpted trunk', [(0, 0, .12, 1.12), (-.025, .01, .7, .9), (.015, 0, 1.55, .78),
        (flip * -.07, .025, 2.3, .7), (flip * .05, .04, 3.0, .57), (flip * -.18, .09, 3.85, .12)], .205, wood)
    for sign in [-1, 1]:
        branch('Swept orchard bough', [(flip * -.04, .035, 2.65, 1), (sign * .32, .03, 3.05, .8),
            (sign * .73, .09, 3.56, .5), (sign * 1.1, .14, 4.12, .08)], .13, wood)
        branch('Root flare', [(0, .015, .28, 1), (sign * .17, -.005, .15, .7),
            (sign * .32, -.03, .12, .04)], .12, wood)
    for off in [-.11, -.035, .055, .12]:
        branch('Fine bark contour', [(off, -.16, .34, .55), (off-.025, -.165, 1.05, 1),
            (off+.015, -.14, 1.8, .7), (off-.045*flip, -.12, 2.45, .12)], .009, wood_light if off < 0 else wood_dark)
    # Small side twigs show through between leaf masses rather than ending abruptly.
    for sign in [-1, 1]:
        branch('Curled small twig', [(sign*.57, .02, 3.38, 1), (sign*.93, -.02, 3.52, .5),
            (sign*1.26, 0, 3.65, .03)], .055, wood_light)
    clusters = [(-.96, 4.03, .57), (-.46, 4.62, .68), (.23, 4.78, .65),
                (.89, 4.35, .63), (1.22, 3.92, .41), (-1.28, 3.74, .39),
                (-.65, 3.59, .49), (.05, 3.85, .7), (.64, 3.66, .51)]
    if side == 'right':
        clusters = [(-x, z + random.uniform(-.12, .1), size * random.uniform(.94, 1.05)) for x,z,size in clusters]
    for ci, (x, z, size) in enumerate(clusters):
        y = .15 if ci < 6 else -.25
        sphere('Soft shaded foliage heart', (x,y,z), (size*.88, .28, size*.61), leaves[1 if ci < 6 else 2])
        # Overlapping leafy sprays form a coherent crown, with varied scale and tilt.
        for j in range(32):
            theta = j * 2.399963
            r = math.sqrt((j + .4) / 32)
            px = x + math.cos(theta)*size*r*.93
            pz = z + math.sin(theta)*size*r*.63 + .14
            py = y - .34 - .16 * math.sqrt(max(0,1-r*r))
            angle = math.pi + random.uniform(-1.6,1.6)
            length = random.uniform(.27,.43)
            leaf('Crown almond leaf', px,py,pz,length, length*.28,angle,leaves[random.choice([2,3,3,4,5])],random.uniform(-.035,.035))
        for j in range(7):
            theta = j * math.tau / 7 + .2
            px = x + math.cos(theta)*size*.85
            pz = z + math.sin(theta)*size*.67
            leaf('Silhouette leaf',px,y-.05,pz,.31,.095,math.pi/2-theta,leaves[3 if j<4 else 2])
    # A restrained grass collar grounds the tree without covering the trunk.
    for sign in [-1, 1]:
        for j in range(5):
            leaf('Young ground shoot',sign*.22,-.09,.1,.17+j*.026,.025,sign*(.45+j*.13),leaves[2+j%3])
    cam.location = (0,-20,2.8)
    cam.data.ortho_scale = 5.6
    scene.render.resolution_x = 800
    scene.render.resolution_y = 1120
    if side == 'left':
        source = ROOT / 'assets/blender/scenes/berry_trees_v2.blend'
        source.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(source))
    render('berry_tree_'+side,800,1120,(0,2.8),5.6)
    anchors[side] = [[.24,.265],[.42,.16],[.66,.205],[.78,.31],[.55,.30],[.34,.365],[.63,.385],[.18,.36],[.46,.425]] if side=='left' else [[.25,.235],[.49,.15],[.73,.25],[.82,.355],[.61,.325],[.37,.30],[.22,.385],[.48,.415],[.67,.40]]
    for ob in list(scene.objects):
        if ob not in base:
            bpy.data.objects.remove(ob,do_unlink=True)
# A raspberry has an organic tapered silhouette made from translucent drupelets.
for row, (z, radius, count, lobe) in enumerate([(-.26,.09,4,.115),(-.12,.185,7,.12),(.045,.235,9,.12),(.20,.19,7,.115)]):
    for j in range(count):
        theta = j*math.tau/count + row*.36
        sphere('Ripe raspberry drupelet',(radius*math.cos(theta),radius*math.sin(theta),z),
               (lobe,lobe,lobe*1.08),fruit_light if j%4==0 else fruit_mat)
for j in range(5):
    theta=j*math.tau/5
    leaf('Fresh raspberry calyx',0,-.02,.28,.23,.065,theta,leaves[3],.05)
branch('Short curved berry stem',[(0,.03,.27,1),(.025,.03,.38,.8),(.08,.03,.43,.35)],.027,leaves[2])
render('berry',256,256,(0,.055),1.0)
metadata = {'source':'create_berry_trees_v2.py / Blender Cycles', 'canvas':[800,1120],
    'origin':[.5,1], 'trunkNormalized':[.455,.45,.09,.52], 'groundNormalizedY':.982,
    'fruitAnchors':anchors,'berryCanvas':[256,256],'style':'Sculpted cinnamon boughs, almond leaf sprays, warm orchard light'}
(OUT/'tree-art-v2.json').write_text(json.dumps(metadata,indent=2))
shutil.copy2(OUT/'tree-art-v2.json',PUBLIC)

manifest = {'tree': {'width': 800, 'height': 1120, 'origin': [.5,1],
    'trunkNormalized': [.455,.45,.09,.52], 'fruitAnchors': anchors, 'groundNormalizedY': .982},
    'source': 'Blender Cycles orchard art v2',
    'scripts': ['model/scripts/blender/create_berry_trees_v2.py', 'model/scripts/blender/create_berry_environment_v2.py']}
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
shutil.copy2(OUT / 'manifest.json', PUBLIC)
