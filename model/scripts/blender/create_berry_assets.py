"""Build and render independent orthographic garden layers."""
import bpy, math, random, json, shutil
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'dist/berry_kick'; OUT.mkdir(parents=True,exist_ok=True)
PUBLIC=ROOT.parent/'public/assets/berry_kick'; PUBLIC.mkdir(parents=True,exist_ok=True)
random.seed(23)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
scene.render.engine='CYCLES'; scene.cycles.samples=24
scene.world.color=(.6,.65,.5)
scene.view_settings.view_transform='Standard'
scene.render.image_settings.file_format='PNG'; scene.render.image_settings.color_mode='RGBA'
scene.render.film_transparent=True
materials={}
def mat(name,color):
 m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True; m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*color,1); m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.85; materials[name]=m; return m
wood=mat('Honey bark',(.43,.23,.095)); leaf=mat('Sage leaves',(.28,.48,.15)); lightleaf=mat('Sunlit leaves',(.49,.64,.22)); grass=mat('Meadow',(.57,.69,.32)); path=mat('Warm sand',(.83,.72,.48)); berry=mat('Ripe red',(.76,.065,.055)); cream=mat('Cream',(.98,.9,.66)); pink=mat('Blush',(.91,.42,.42)); basket=mat('Woven willow',(.64,.38,.16)); sky=mat('Pale sky',(.86,.9,.72))
def ball(name,loc,scale,material):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=12,location=loc); o=bpy.context.object; o.name=name;o.scale=scale; o.data.materials.append(material)
 for p in o.data.polygons:p.use_smooth=True
 return o
def rod(name,a,b,r,material):
 d=Vector(b)-Vector(a); bpy.ops.mesh.primitive_cone_add(vertices=12,radius1=r,radius2=r*.78,depth=d.length,location=(Vector(a)+Vector(b))/2);o=bpy.context.object;o.name=name;o.rotation_euler=d.to_track_quat('Z','Y').to_euler();o.data.materials.append(material);return o
def flower(x,z,y=0):
 rod('Stem',(x,y,z),(x,y,z+.19),.018,leaf)
 for j in range(5):
  t=j*math.tau/5;ball('Petal',(x+.065*math.cos(t),y-.03,z+.21+.065*math.sin(t)),(.065,.035,.065),pink if x%1>.5 else cream)
 ball('Pollen',(x,y-.075,z+.21),(.035,.025,.035),basket)
bpy.ops.object.camera_add(location=(0,-20,4)); cam=bpy.context.object;cam.rotation_euler=(math.pi/2,0,0);cam.data.type='ORTHO';scene.camera=cam
bpy.ops.object.light_add(type='AREA',location=(-4,-7,10));bpy.context.object.data.energy=1100;bpy.context.object.data.shape='DISK';bpy.context.object.data.size=8;bpy.context.object.rotation_euler=(Vector((0,0,2))-bpy.context.object.location).to_track_quat('-Z','Y').to_euler()
base=set(scene.objects)
def render(name,w,h,center,scale):
 scene.render.resolution_x=w;scene.render.resolution_y=h;scene.render.resolution_percentage=100;cam.location=(center[0],-20,center[1]);cam.data.ortho_scale=scale;scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True);shutil.copy2(scene.render.filepath,PUBLIC)
 for o in list(scene.objects):
  if o not in base: bpy.data.objects.remove(o,do_unlink=True)
# Broad flattened meshes create a softly shaded garden backdrop.
ball('Sky',(0,4,4),(13,.3,8),sky)
ball('Distant hill',(-4,2,1),(9,.8,3.5),lightleaf);ball('Distant hill',(6,2,.8),(8,.8,3.1),leaf)
ball('Lawn',(0,0,-1),(15,1.2,4),grass)
ball('Garden path',(0,-1,-1.8),(2.4,.2,4.6),path)
for x in [-7,-6.4,-5.8,5.8,6.4,7]:flower(x,.2,-1.4)
render('berry_background',1600,900,(0,3.4),16)
for side in ['left','right']:
 rod('Visible tree trunk',(0,0,.1),(0,0,3.8),.24,wood)
 for sign in [-1,1]:
  rod('Spreading bough',(0,0,2.5),(sign*1.0,0,3.9),.14,wood)
  rod('Root',(0,0,.25),(sign*.45,0,.05),.1,wood)
 for x,z,s in [(-.9,4,.73),(0,4.5,.9),(.9,4.1,.78),(-.4,3.65,.72),(.55,3.65,.7)]:
  ball('Leaf crown',(x,.08,z),(s,.43,s*.8),leaf if x<0 else lightleaf)
 for i in range(23):
  x=random.uniform(-1.2,1.2);z=random.uniform(3.8,4.65);ball('Leaf tips',(x,-.38,z),(.15,.07,.065),lightleaf)
 # Keep a source scene with the second tree for inspection.
 if side=='right':
  dest=ROOT/'assets/blender/scenes/berry_garden.blend';dest.parent.mkdir(parents=True,exist_ok=True);bpy.ops.wm.save_as_mainfile(filepath=str(dest))
 render('berry_tree_'+side,400,560,(0,2.7),5.6)
ball('Berry',(0,0,0),(.36,.27,.4),berry)
for x in [-.15,0,.15]:ball('Calyx',(x,-.05,.35),(.16,.08,.065),leaf)
ball('Highlight',(-.12,-.255,.13),(.065,.018,.09),cream)
render('berry',128,128,(0,.04),1)
ball('Basket body',(0,0,.4),(1,.32,.55),basket)
for z in [.1,.23,.36,.49,.62,.75]:rod('Woven horizontal',(-.9,-.31,z),(.9,-.31,z),.035,cream)
for x in [-.75,-.5,-.25,0,.25,.5,.75]:rod('Woven vertical',(x,-.34,.08),(x,-.34,.79),.025,wood)
for i in range(24):
 t=i*math.pi/24;u=(i+1)*math.pi/24;rod('Handle',(math.cos(t)*.8,0,.75+math.sin(t)*.65),(math.cos(u)*.8,0,.75+math.sin(u)*.65),.065,basket)
render('berry_basket',400,320,(0,.65),2.5)
for x in [-7.3,-6.7,-5.7,5.9,6.8,7.4]:
 flower(x,-.3,-1);ball('Grass tuft',(x,0,-.25),(.45,.2,.15),leaf)
render('berry_foreground',1600,900,(0,3.4),16)
metadata={'tree':{'width':400,'height':560,'origin':[.5,1],'trunkNormalized':[.455,.45,.09,.52],'fruitAnchors':[[.27,.29],[.43,.18],[.65,.26],[.36,.35],[.61,.37],[.73,.31]],'groundNormalizedY':.982},'source':'Blender Cycles orthographic procedural meshes','seed':23}
(OUT/'manifest.json').write_text(json.dumps(metadata,indent=2));shutil.copy2(OUT/'manifest.json',PUBLIC)
