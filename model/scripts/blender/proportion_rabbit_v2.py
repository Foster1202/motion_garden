"""Derive an articulated cartoon rabbit from the immutable original rig."""
import hashlib
import json
import math
from pathlib import Path
import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'assets/blender/rabbit/rabbit_rigged.blend'
OUTPUT = ROOT / 'assets/blender/rabbit/rabbit_realtime_v2.blend'
ARM = 1.38
LEG = 1.45
HEAD = .93
LIFT = .38 * (LEG - 1)

def smooth(low, high, value):
    t = max(0., min(1., (value-low)/(high-low)))
    return t*t*(3-2*t)

def torso(p):
    return Vector((p.x, p.y, .57+LIFT+(p.z-.57)*1.12))

def head(p):
    return torso(Vector((0,0,1.48))) + (p-Vector((0,0,1.48)))*HEAD

def arm(p, sign):
    shoulder = Vector((sign*.515,-.005,1.37))
    return torso(shoulder)+(p-shoulder)*ARM

def leg(p):
    return Vector((p.x,p.y,.13+(p.z-.13)*LEG))

def build():
    original_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    rig=bpy.data.objects['Rabbit_Rig']
    for obj in bpy.data.objects:
        obj.animation_data_clear()
    for pose in rig.pose.bones:
        pose.matrix_basis=Matrix.Identity(4)
    bpy.context.view_layer.update()
    collection=bpy.data.collections['Rabbit_Character']
    worlds={o.name:o.matrix_world.copy() for o in collection.all_objects}
    originals={b.name:(b.head_local.copy(),b.tail_local.copy(),b.length) for b in rig.data.bones}
    # Bake each rigid part's affine transform in world space after editing the rig.
    target_worlds={}
    for obj in collection.all_objects:
        if obj.type not in {'MESH','CURVE'} or obj.name.startswith(('Rabbit_Arm_','Rabbit_Leg_')):
            continue
        if obj.name=='Rabbit_Body':
            transform=Matrix.Translation((0,0,.57+LIFT)) @ Matrix.Diagonal((.96,.96,1.12,1)) @ Matrix.Translation((0,0,-.57))
        elif obj.name=='Rabbit_Tail':
            transform=Matrix.Translation((0,0,LIFT))
        else:
            transform=Matrix.Translation(torso(Vector((0,0,1.48)))) @ Matrix.Diagonal((HEAD,HEAD,HEAD,1)) @ Matrix.Translation((0,0,-1.48))
        target_worlds[obj.name]=transform@worlds[obj.name]
    bpy.context.view_layer.objects.active=rig
    bpy.ops.object.mode_set(mode='EDIT')
    for b in rig.data.edit_bones:
        old_head,old_tail,_=originals[b.name]
        if b.name=='root': continue
        if b.name in {'head','ear.L','ear.R'}: fn=head
        elif b.name.startswith(('upper_arm','forearm','hand')):
            sign=1 if b.name.endswith('.L') else -1
            fn=lambda p,s=sign:arm(p,s)
        elif b.name.startswith(('thigh','shin')): fn=leg
        elif b.name.startswith('foot'): fn=lambda p:p.copy()
        else: fn=torso
        b.head,b.tail=fn(old_head),fn(old_tail)
        if b.name.startswith('thigh'):
            b.parent=rig.data.edit_bones['root']
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.update()
    # Parents must be assigned before their descendants to avoid a second transform.
    def depth(o):
        return 1+depth(o.parent) if o.parent else 0
    for obj in sorted(collection.all_objects,key=depth):
        if obj.name in target_worlds:
            obj.matrix_world=target_worlds[obj.name]
            bpy.context.view_layer.update()
    body = bpy.data.objects['Rabbit_Body']
    body_world = body.matrix_world.copy()
    body_inverse = body_world.inverted()
    for vertex in body.data.vertices:
        point = body_world @ vertex.co
        taper = 1 - smooth(.40, 1.12, point.z)
        point.z += .17 * taper
        point.x *= 1 - .12 * taper
        point.y = .025 + (point.y - .025) * (1 - .08 * taper)
        vertex.co = body_inverse @ point
    for suffix,sign in [('L',1),('R',-1)]:
        obj=bpy.data.objects['Rabbit_Arm_'+suffix]
        world=worlds[obj.name]
        obj.matrix_world=world
        inverse=world.inverted()
        shoulder=Vector((sign*.515,-.005,1.37))
        axis=(Vector((sign*.77,-.012,.77))-shoulder).normalized()
        for v in obj.data.vertices:
            p=world@v.co
            delta=p-shoulder
            longitudinal=axis*delta.dot(axis)
            p=torso(shoulder)+longitudinal*ARM+(delta-longitudinal)*.82
            v.co=inverse@p
        # Weight transitions follow the new elbow and wrist while retaining topology.
        obj.vertex_groups.clear()
        groups=[obj.vertex_groups.new(name=n+'.'+suffix) for n in ['upper_arm','forearm','hand']]
        for v in obj.data.vertices:
            p=world@v.co
            old_z=1.37+(p.z-torso(shoulder).z)/ARM
            upper=smooth(.98,1.25,old_z)
            hand_weight=1-smooth(.77,.97,old_z)
            for g,w in zip(groups,(upper,max(0,1-upper-hand_weight),hand_weight)):
                if w:g.add([v.index],w,'REPLACE')
        obj=bpy.data.objects['Rabbit_Leg_'+suffix]
        # One continuous ring surface creates a soft thigh, knee, shin and paw.
        rings=[(.008,-.060,.045,.065),(.035,-.055,.150,.210),(.085,-.050,.176,.233),
               (.130,-.040,.172,.225),(.190,-.015,.143,.165),(.270,-.035,.115,.120),
               (.355,-.060,.119,.116),(.4055,-.070,.128,.120),(.470,-.045,.142,.137),
               (.560,-.010,.158,.153),(.650,.000,.151,.147),(.720,.000,.100,.100),(.750,.000,.025,.025)]
        vertices=[]
        count=28
        for z,y,rx,ry in rings:
            for i in range(count):
                angle=math.tau*i/count
                vertices.append((sign*.265+rx*math.cos(angle),y+ry*math.sin(angle),z))
        faces=[]
        for row in range(len(rings)-1):
            for i in range(count):
                a=row*count+i;b=row*count+(i+1)%count
                faces.append((a,b,b+count,a+count))
        faces.extend([tuple(reversed(range(count))),tuple((len(rings)-1)*count+i for i in range(count))])
        material=obj.data.materials[0]
        mesh=bpy.data.meshes.new(obj.name+'_ArticulatedV2')
        mesh.from_pydata(vertices,[],faces);mesh.update()
        obj.data=mesh;obj.matrix_world=Matrix.Identity(4)
        mesh.materials.append(material)
        for poly in mesh.polygons:poly.use_smooth=True
        obj.vertex_groups.clear()
        groups=[obj.vertex_groups.new(name=n+'.'+suffix) for n in ['thigh','shin','foot']]
        for v in mesh.vertices:
            thigh=smooth(.345,.465,v.co.z)
            foot=1-smooth(.15,.25,v.co.z)
            for g,w in zip(groups,(thigh,max(0,1-thigh-foot),foot)):
                if w:g.add([v.index],w,'REPLACE')
    bpy.context.view_layer.update()
    for pose in rig.pose.bones:pose.bone['originalBoneName']=pose.name
    metrics={'version':'rabbit-realtime-v2','arm_chain_scale':ARM,'arm_radial_scale':.82,'leg_chain_scale':LEG,
             'torso_bone_scale':1.12,'lower_belly_lift':.17,'lower_pelvis_taper':.12,'head_face_ear_scale':HEAD,'original_source_sha256':original_hash,
             'bone_lengths':{b.name:{'old':originals[b.name][2],'new':b.length,'ratio':b.length/originals[b.name][2]} for b in rig.data.bones}}
    rig['proportion_version']='v2';rig['proportion_metrics']=json.dumps(metrics)
    bpy.context.scene['asset_version']='Realtime anthropomorphic v2'
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT))
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==original_hash
    path=ROOT/'dist/rabbit3d/rabbit_v2_proportions.json';path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(metrics,indent=2)+'\n')
    print('RABBIT_V2',json.dumps(metrics))

if __name__=='__main__':build()
