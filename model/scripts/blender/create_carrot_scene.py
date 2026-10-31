"""Build the reusable, layered Motion Garden Carrot Pull environment."""
import argparse
import json
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
LAYERS = ('background_far', 'background_mid', 'platform', 'foreground', 'soil_patch', 'carrot', 'basket')
SIZE = (1920, 1080)


def material(name, color, roughness=.72, emission=False):
    mat = bpy.data.materials.new(name)
    rgb = [int(color[i:i+2], 16) / 255 for i in (1, 3, 5)]
    rgba = tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb) + (1,)
    mat.diffuse_color = rgba
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Roughness'].default_value = roughness
    if emission:
        bsdf.inputs['Emission Color'].default_value = rgba
        bsdf.inputs['Emission Strength'].default_value = .65
    return mat


def move(obj, collection, name, mat):
    obj.name = name
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    collection.objects.link(obj)
    if mat:
        obj.data.materials.append(mat)
    return obj


def ellipsoid(name, location, scale, mat, collection):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=24, location=location)
    obj = move(bpy.context.object, collection, name, mat)
    obj.scale = scale
    for face in obj.data.polygons:
        face.use_smooth = True
    return obj


def box(name, location, scale, mat, collection, bevel=.08):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = move(bpy.context.object, collection, name, mat)
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mod = obj.modifiers.new('Rounded edges', 'BEVEL')
    mod.width = bevel
    mod.segments = 4
    obj.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
    return obj


def curve(name, coords, radius, mat, collection):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.resolution_u = 16
    data.bevel_depth = radius
    data.bevel_resolution = 4
    spline = data.splines.new('BEZIER')
    spline.bezier_points.add(len(coords)-1)
    for p, co in zip(spline.bezier_points, coords):
        p.co = co
        p.handle_left_type = p.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    data.materials.append(mat)
    return obj


def pixel_world(camera, x, y, depth):
    width = depth * camera.data.sensor_width / camera.data.lens
    return camera.matrix_world @ Vector(((x/1920-.5)*width, (.5-y/1080)*width*1080/1920, -depth))


def ground_point(camera, x, y, z=0):
    direction = pixel_world(camera, x, y, 1) - camera.location
    return camera.location + direction * ((z-camera.location.z)/direction.z)


def screen_ball(name, x, y, rx, ry, depth, mat, col, camera):
    ratio = depth * camera.data.sensor_width / camera.data.lens / 1920
    obj = ellipsoid(name, pixel_world(camera,x,y,depth), (rx*ratio, ry*ratio, ry*ratio*.55), mat,col)
    obj.rotation_euler = camera.rotation_euler
    return obj


def flower(name, pos, scale, mats, col):
    x,y,z = pos
    curve(name+'_Stem', [(x,y,z),(x+.04*scale,y,z+.3*scale)], .025*scale,mats['leaf'],col)
    for i in range(5):
        a = i*math.tau/5
        ellipsoid(name+'_Petal', (x+math.cos(a)*.1*scale,y-.025,z+(.34+math.sin(a)*.1)*scale),(.105*scale,.04*scale,.09*scale),mats['petal'],col)
    ellipsoid(name+'_Heart',(x,y-.07,z+.34*scale),(.065*scale,.045*scale,.065*scale),mats['yellow'],col)
    leaf=ellipsoid(name+'_Leaf',(x-.07*scale,y,z+.14*scale),(.12*scale,.04*scale,.06*scale),mats['leaf'],col)
    leaf.rotation_euler.y=-.5


def grass(name, pos, scale, mat, col):
    for i in range(3):
        x,y,z=pos
        leaf=ellipsoid(name+str(i),(x+(i-1)*.1*scale,y,z+.17*scale),(.06*scale,.055*scale,(.23-.045*abs(i-1))*scale),mat,col)
        leaf.rotation_euler.y=(i-1)*.38


def tree(name, px, py, height, col, camera, mats):
    base = ground_point(camera,px,py)
    x,y,z=base
    curve(name+'_Trunk',[(x,y,z),(x-.12,y,z+height*.35),(x+.05,y,z+height*.78)],height*.067,mats['trunk'],col)
    for side in (-1,1):
        curve(name+'_Branch',[(x,y,z+height*.42),(x+side*.35,y,z+height*.65)],height*.035,mats['trunk'],col)
    for i,(dx,dy,dz,r) in enumerate([(-.22,0,.70,.28),(.22,.02,.72,.30),(0,.02,.94,.30),(0,-.15,.70,.27)]):
        ellipsoid(name+'_Canopy'+str(i),(x+height*dx,y+height*dy,z+height*dz),(height*r,height*r*.78,height*r*.90),mats['canopy'+str(i%3)],col)


def build(root=ROOT):
    from carrot_scene_props import build_carrot, build_soil_patch, build_basket
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene
    cols={name:bpy.data.collections.new(name) for name in LAYERS}
    for col in cols.values(): scene.collection.children.link(col)
    studio=bpy.data.collections.new('Studio'); scene.collection.children.link(studio)
    helpers=bpy.data.collections.new('Layout_Guides'); scene.collection.children.link(helpers)
    helpers.hide_render=True
    mats={key:material('Garden_'+key,value) for key,value in {
        'sky':'#81D1F2','cloud':'#FFF9EF','hill_far':'#80B6C5','hill_near':'#8CBE8B',
        'grass':'#94BD55','leaf':'#528D32','canopy0':'#639B37','canopy1':'#83AD44','canopy2':'#95BC55',
        'trunk':'#B87B40','wood':'#D49D5E','wood_alt':'#DFB374','wood_edge':'#B98043',
        'path':'#E8D6AB','soil':'#B18560','petal':'#FFF6DE','yellow':'#ECC677','pink':'#ECC4C5',
        'grain':'#BE935F'}.items()}
    data=bpy.data.cameras.new('Camera_Scene_65mm')
    camera=bpy.data.objects.new('Camera_Scene_65mm',data); studio.objects.link(camera)
    camera.location=(0,-40,16)
    camera.rotation_euler=(Vector((0,1,2.5))-camera.location).to_track_quat('-Z','Y').to_euler()
    data.type='PERSP'; data.lens=65; data.sensor_width=36; data.clip_end=250
    scene.camera=camera
    bpy.context.view_layer.update()
    sky=material('Garden_Sky_Backdrop','#81D1F2', emission=True)
    mesh=bpy.data.meshes.new('Sky_Backdrop_Mesh')
    mesh.from_pydata([pixel_world(camera,x,y,110) for x,y in [(-20,-20),(1940,-20),(1940,1100),(-20,1100)]],[],[(0,1,2,3)])
    ob=bpy.data.objects.new('Sky_Backdrop',mesh);cols['background_far'].objects.link(ob);mesh.materials.append(sky)
    far=cols['background_far']
    for i,(x,y,rx,ry) in enumerate([(-50,720,580,275),(600,735,520,240),(1300,755,610,270),(1990,710,520,280)]):
        screen_ball('Distant_Rounded_Mountain'+str(i),x,y,rx,ry,94,mats['hill_far'],far,camera)
    for i,(x,y,rx,ry) in enumerate([(100,780,600,230),(870,810,670,250),(1770,800,660,250)]):
        screen_ball('Soft_Hill'+str(i),x,y,rx,ry,78,mats['hill_near'],far,camera)
    for j,(x,y,s) in enumerate([(175,395,.9),(1700,395,1),(510,425,.55)]):
        for i,(dx,dy,r) in enumerate([(-65,5,49),(-20,-11,63),(37,0,48),(77,11,34)]):
            screen_ball(f'Cloud{j}_Puff{i}',x+dx*s,y+dy*s,r*s,r*.57*s,85,mats['cloud'],far,camera)
    for j in range(3):
        bpy.ops.object.select_all(action='DESELECT')
        puffs=[o for o in far.objects if o.name.startswith(f'Cloud{j}_Puff')]
        for ob in puffs:ob.select_set(True)
        bpy.context.view_layer.objects.active=puffs[0]
        bpy.ops.object.join()
        cloud=bpy.context.object;cloud.name=f'Cloud{j}_Soft_Cluster'
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        remesh=cloud.modifiers.new('Soft joined cloud','REMESH');remesh.mode='VOXEL';remesh.voxel_size=.075;remesh.use_smooth_shade=True
        smooth=cloud.modifiers.new('Cloud smoothing','SMOOTH');smooth.factor=1.3;smooth.iterations=4
    cloud_bsdf=mats['cloud'].node_tree.nodes.get('Principled BSDF')
    cloud_bsdf.inputs['Emission Color'].default_value=mats['cloud'].diffuse_color
    cloud_bsdf.inputs['Emission Strength'].default_value=.28
    mid=cols['background_mid']
    # A broad rounded lawn fills the lower canvas without a sharp horizon.
    ellipsoid('Meadow',(0,-4,-.6),(24,8,.60),mats['grass'],mid)
    path_points=[(480,1130,112),(525,1040,105),(555,950,96),(525,866,87),(437,792,72),(411,730,57),(471,677,42)]
    verts=[]
    for x,y,w in path_points:
        verts.extend([ground_point(camera,x-w,y,.028),ground_point(camera,x+w,y,.028)])
    mesh=bpy.data.meshes.new('Path_Mesh');mesh.from_pydata(verts,[],[(i*2,i*2+1,i*2+3,i*2+2) for i in range(len(path_points)-1)]);mesh.materials.append(mats['path'])
    path=bpy.data.objects.new('Soft_Garden_Path',mesh);mid.objects.link(path)
    sub=path.modifiers.new('Soft path curves','SUBSURF');sub.levels=2
    for i,(x,y) in enumerate([(500,1025),(545,928),(480,831),(430,761)]):
        p=ground_point(camera,x,y,.045)
        stone=ellipsoid('Path_Stepping_Stone'+str(i),p,(.29,.19,.035),mats['wood_alt'],mid)
        stone.rotation_euler.z=(-.15 if i%2 else .2)
    # Keep the fence below the rabbit's face and the instruction band.
    for px in range(-120,2100,180):
        p=ground_point(camera,px,697,0)
        box('Fence_Post',p+Vector((0,0,.56)),(.16,.18,1.12),mats['wood'],mid,.07)
        ellipsoid('Fence_Post_Cap',p+Vector((0,0,1.12)),(.105,.12,.08),mats['wood_alt'],mid)
    left=ground_point(camera,-120,697);right=ground_point(camera,2100,697)
    for z in (.39,.81):
        box('Fence_Rail',((left+right)*.5)+Vector((0,.04,z)),(right.x-left.x,.13,.14),mats['wood_alt'],mid,.055)
    tree('Tree_Left',120,764,3.5,mid,camera,mats)
    tree('Tree_Right',1790,768,3.85,mid,camera,mats)
    tree('Tree_Left_Back',340,655,1.45,mid,camera,mats)
    tree('Tree_Right_Back',1580,650,1.6,mid,camera,mats)
    for i,(px,py,s) in enumerate([(220,843,1.3),(1660,850,1.15),(1850,889,1.6),(100,933,1.3)]):
        p=ground_point(camera,px,py)
        for j in range(3):
            ellipsoid(f'Shrub{i}_{j}',p+Vector(((j-1)*.3,0,.23)),(.42*s,.32*s,.35*s),mats['canopy'+str(j)],mid)
    # The left bed uses its own small planted carrot crowns.
    p=ground_point(camera,350,827,.02)
    ellipsoid('Left_Carrot_Bed',p,(1.55,.62,.12),mats['soil'],mid)
    for i in range(4):
        q=p+Vector(((i-1.5)*.61,0,.12))
        crown=build_carrot(mid);crown.name='Left_Patch_Carrot'+str(i);crown.scale=(.43,)*3;crown.location=q-Vector((0,0,.055))
        # Soil hides the root in the actual 3D scene.
    platform=cols['platform'];p=ground_point(camera,1073,849,.16)
    bpy.ops.mesh.primitive_cylinder_add(vertices=128,radius=1,depth=.28,location=p)
    base=move(bpy.context.object,platform,'Platform_Rounded_Rim',mats['wood_edge']);base.scale=(3.75,1.87,1)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    mod=base.modifiers.new('Soft rim','BEVEL');mod.width=.13;mod.segments=5;base.modifiers.new('Normals','WEIGHTED_NORMAL')
    # Rounded fitted planks follow an ellipse; subtle grooves remain geometric.
    for i in range(11):
        xx=(i-5)*.64;extent=1.73*math.sqrt(max(.01,1-(xx/3.64)**2))
        outline=[]
        for side in (-1,1):
            for k in range(9):
                x=xx+(-.3075+.615*k/8)*(1 if side==-1 else -1)
                y=side*1.73*math.sqrt(max(.01,1-(x/3.67)**2))
                outline.append((p.x+x,p.y+y,p.z+.25))
        n=len(outline);v=outline+[(x,y,z-.15) for x,y,z in outline]
        faces=[tuple(range(n)),tuple(reversed(range(n,n*2)))]+[(k,k+n,(k+1)%n+n,(k+1)%n) for k in range(n)]
        mesh=bpy.data.meshes.new('Plank_Mesh');mesh.from_pydata(v,[],faces);mesh.materials.append(mats['wood_alt' if i%3 else 'wood'])
        plank=bpy.data.objects.new('Platform_Plank'+str(i),mesh);platform.objects.link(plank)
        bevel=plank.modifiers.new('Rounded plank edges','BEVEL');bevel.width=.035;bevel.segments=3
        plank.modifiers.new('Plank normals','WEIGHTED_NORMAL')
        for j in range(2):
            x=xx+(j-.5)*.25
            curve('Subtle_Wood_Grain',[(p.x+x,p.y-extent*.66,p.z+.248),(p.x+x+.025,p.y,p.z+.251),(p.x+x-.02,p.y+extent*.66,p.z+.248)],.008,mats['grain'],platform)
    fg=cols['foreground'];rng=random.Random(21)
    for i,(px,py) in enumerate([(62,1060),(170,1025),(340,1038),(1580,1039),(1740,1028),(1870,1047),(1850,980),(90,968)]):
        p=ground_point(camera,px,py)
        flower('Foreground_Flower'+str(i),p,rng.uniform(.8,1.3),{**mats,'petal':mats['pink' if i%3==0 else 'petal']},fg)
        grass('Foreground_Grass'+str(i),p+Vector((.22,.04,0)),1.0,mats['leaf'],fg)
    for i,(px,py) in enumerate([(170,792),(500,746),(1565,790),(1750,843)]):
        flower('Meadow_Flower'+str(i),ground_point(camera,px,py),.65,mats,mid)
    roots={'carrot':build_carrot(cols['carrot']),'soil_patch':build_soil_patch(cols['soil_patch']),'basket':build_basket(cols['basket'])}
    # Separate product collections stay at their local origins for export.
    for col in ('carrot','soil_patch','basket'):cols[col].hide_render=True
    def area(name,loc,target,power,size,color):
        d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;d.color=color
        o=bpy.data.objects.new(name,d);studio.objects.link(o);o.location=loc;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
    area('Outdoor_Key',(-10,-12,16),(0,0,0),2400,10,(1,.93,.84))
    area('Outdoor_Fill',(10,-8,10),(0,0,1),1500,10,(.87,.94,1))
    area('Outdoor_Rim',(5,9,15),(0,0,1),1700,9,(1,.94,.87))
    d=bpy.data.lights.new('Soft_Sun','SUN');d.energy=1.0;d.angle=math.radians(18);d.color=(1,.96,.88)
    sun=bpy.data.objects.new('Soft_Sun',d);studio.objects.link(sun);sun.rotation_euler=(Vector((0,0,0))-Vector((-8,-10,15))).to_track_quat('-Z','Y').to_euler()
    world=bpy.data.worlds.new('Garden_World');world.node_tree.nodes['Background'].inputs['Color'].default_value=(.78,.82,.88,1);world.node_tree.nodes['Background'].inputs['Strength'].default_value=.3;scene.world=world
    scene.render.engine='BLENDER_EEVEE';scene.render.resolution_x=1920;scene.render.resolution_y=1080;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='8';scene.render.film_transparent=True
    scene.view_settings.view_transform='AgX';scene.view_settings.exposure=.65
    if hasattr(scene.eevee,'taa_render_samples'):scene.eevee.taa_render_samples=64
    for name,px,py,z in [('Rabbit_Feet',1072.8,817.2,.43),('Carrot_Plant',1073,817,.46),('Basket_Landing',1494,834,0)]:
        o=bpy.data.objects.new(name,None);helpers.objects.link(o);o.location=ground_point(camera,px,py,z);o.empty_display_type='PLAIN_AXES';o.empty_display_size=.25
    scene['task']='Task 2E-1 / asset-only';scene['seed']=21
    scene['reference']='Motion Garden Concept Board.png (user-supplied reference) and existing Blender Rabbit; simplified for HUD-safe composition'
    scene['layer_names']=json.dumps(LAYERS)
    scene['carrot_origin']='Grip at leaf/root junction, local (0,0,0); +Z leaves, -Z taproot; front -Y'
    output=root/'assets/blender/scenes/carrot_pull_scene.blend';output.parent.mkdir(parents=True,exist_ok=True)
    bpy.context.view_layer.update()
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(output),check_existing=False)
    manifest={'schemaVersion':1,'task':'2E-1','blenderVersion':bpy.app.version_string,'camera':{'type':data.type,'lensMm':data.lens,'sensorWidthMm':data.sensor_width,'location':list(camera.location),'rotationEulerRadians':list(camera.rotation_euler),'target':[0,1,2.5],'downwardPitchDegrees':math.degrees(math.atan2(13.5,41))},'render':{'engine':scene.render.engine,'viewTransform':'AgX','exposure':.65,'size':list(SIZE),'transparentFilm':True},'collections':{k:{'objectCount':len(v.objects),'objects':[o.name for o in v.objects]} for k,v in cols.items()},'anchors':{o.name:{'world':list(o.location),'canvasPixels':[world_to_camera_view(scene,camera,o.location).x*1920,(1-world_to_camera_view(scene,camera,o.location).y)*1080]} for o in helpers.objects},'lighting':[{'name':o.name,'type':o.data.type,'energy':o.data.energy,'color':list(o.data.color),'location':list(o.location),'size':getattr(o.data,'size',None),'angle':getattr(o.data,'angle',None)} for o in studio.objects if o.type=='LIGHT']}
    report=root/'qa/carrot_pull/scene_manifest.json';report.parent.mkdir(parents=True,exist_ok=True);report.write_text(json.dumps(manifest,indent=2)+'\n')
    print('CARROT_SCENE_BUILT',len(bpy.data.objects),'objects',output,flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,default=ROOT)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    build(args.root.resolve())
