"""Reproducible layered, softly lit storybook orchard environment."""
import bpy, math, random, shutil
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'dist/berry_kick'; PUBLIC=ROOT.parent/'public/assets/berry_kick'
OUT.mkdir(parents=True,exist_ok=True); PUBLIC.mkdir(parents=True,exist_ok=True)
random.seed(64)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=48
scene.cycles.use_denoising=True; scene.render.image_settings.file_format='PNG'; scene.render.image_settings.color_mode='RGBA'
scene.render.film_transparent=True; scene.view_settings.view_transform='Standard'
scene.world.use_nodes=True; scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.84,.9,1,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.7

def mat(name,c):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True
 c=tuple(v**2.2 for v in c)
 bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*c,1);bs.inputs['Roughness'].default_value=.78
 return m
M={k:mat(k,v) for k,v in {'sky':(.99,.95,.85),'cloud':(1,.96,.84),'far':(.51,.72,.67),'farLight':(.67,.81,.71),'hill':(.5,.7,.4),'hillLight':(.65,.77,.43),'lawn':(.62,.74,.35),'lawnLight':(.72,.8,.46),'grass':(.32,.55,.22),'leaf':(.24,.46,.19),'leafLight':(.48,.65,.28),'cream':(.99,.92,.7),'white':(.99,.97,.86),'blush':(.94,.54,.48),'pink':(.88,.38,.39),'gold':(.93,.64,.22),'sand':(.86,.76,.53),'sandLight':(.95,.86,.64),'wood':(.57,.34,.15),'willow':(.72,.47,.22),'rim':(.87,.63,.32),'stone':(.68,.73,.55)}.items()}
# Gentle material texture avoids a uniform plastic surface.
for key in ['lawn','lawnLight','sandLight','hill','hillLight']:
 m=M[key];nt=m.node_tree;bs=nt.nodes.get('Principled BSDF');base=tuple(bs.inputs['Base Color'].default_value)
 noise=nt.nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=65 if key=='sandLight' else 28;noise.inputs['Detail'].default_value=2
 ramp=nt.nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].position=.15;ramp.color_ramp.elements[1].position=.85
 ramp.color_ramp.elements[0].color=tuple(v*.88 for v in base[:3])+(1,);ramp.color_ramp.elements[1].color=tuple(min(1,v*1.07) for v in base[:3])+(1,)
 nt.links.new(noise.outputs['Fac'],ramp.inputs[0]);nt.links.new(ramp.outputs[0],bs.inputs['Base Color'])
 bump=nt.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.14;bump.inputs['Distance'].default_value=.013;nt.links.new(noise.outputs['Fac'],bump.inputs['Height']);nt.links.new(bump.outputs[0],bs.inputs['Normal'])
# The sky is luminous, while foreground geometry receives the soft key light.
nt=M['sky'].node_tree;output=nt.nodes.get('Material Output');em=nt.nodes.new('ShaderNodeEmission');em.inputs[0].default_value=(.99**2.2,.95**2.2,.85**2.2,1);em.inputs[1].default_value=1;nt.links.new(em.outputs[0],output.inputs['Surface'])
collections={} 
for name in ['Background','Foreground','Basket']:
 c=bpy.data.collections.new(name);scene.collection.children.link(c);collections[name]=c
active='Background'
def own(o,material):
 for c in list(o.users_collection):c.objects.unlink(o)
 collections[active].objects.link(o);o.data.materials.append(material);return o
def ball(name,p,s,m):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=16,location=p);o=bpy.context.object;o.name=name;o.scale=s;own(o,m)
 for f in o.data.polygons:f.use_smooth=True
 return o
def curve(name,pts,r,m,cyclic=False):
 cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=20;cu.bevel_depth=r;cu.bevel_resolution=4
 sp=cu.splines.new('BEZIER');sp.bezier_points.add(len(pts)-1)
 for b,p in zip(sp.bezier_points,pts):b.co=p;b.handle_left_type='AUTO';b.handle_right_type='AUTO'
 sp.use_cyclic_u=cyclic;o=bpy.data.objects.new(name,cu);own(o,m);return o
def shape(name,pts,depth,m):
 cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='2D';cu.resolution_u=24;cu.fill_mode='BOTH'
 sp=cu.splines.new('BEZIER');sp.bezier_points.add(len(pts)-1)
 for b,(x,z) in zip(sp.bezier_points,pts):b.co=(x,z,0);b.handle_left_type='AUTO';b.handle_right_type='AUTO'
 sp.use_cyclic_u=True;o=bpy.data.objects.new(name,cu);o.rotation_euler=(math.pi/2,0,0);o.location.y=depth;o.visible_shadow=False;own(o,m);return o
def pix(x,y,d=0):return ((x-800)/100,d,(900-y)/100)
def grass(x,y,size=1,depth=-1):
 for dx,h in [(-.12,.25),(0,.34),(.13,.22)]:
  p=pix(x,y,depth);curve('Curved grass blade',[p,(p[0]+dx*.3*size,depth,p[2]+h*.6*size),(p[0]+dx*size,depth+.01,p[2]+h*size)],.013*size,M['grass'])
def flower(x,y,s=1,depth=-1,color='white'):
 p=pix(x,y,depth);h=.32*s
 curve('Flower stem',[p,(p[0]+.025,depth,p[2]+h*.55),(p[0],depth,p[2]+h)],.012*s,M['leaf'])
 leaf=ball('Botanical leaf',(p[0]+.07*s,depth,p[2]+h*.4),(.105*s,.022*s,.038*s),M['leafLight']);leaf.rotation_euler.y=-.45
 for i in range(7):
  a=i*math.tau/7;pet=ball('Rounded petal',(p[0]+.065*s*math.cos(a),depth-.025,p[2]+h+.065*s*math.sin(a)),(.064*s,.028*s,.038*s),M[color]);pet.rotation_euler.y=-a
 ball('Golden flower heart',(p[0],depth-.06,p[2]+h),(.04*s,.022*s,.04*s),M['gold'])
bpy.ops.object.camera_add(location=(0,-20,4.5));cam=bpy.context.object;cam.rotation_euler=(math.pi/2,0,0);cam.data.type='ORTHO';cam.data.ortho_scale=16;scene.camera=cam
bpy.ops.object.light_add(type='AREA',location=(-4,-7,11));light=bpy.context.object;light.data.energy=850;light.data.size=10;light.rotation_euler=(Vector((0,0,3))-light.location).to_track_quat('-Z','Y').to_euler()
# Layered organic silhouettes keep the playing area airy.
shape('Warm sky',[(-9,-1),(9,-1),(9,10),(-9,10)],5,M['sky'])
for x,y,s in [(270,205,1),(1240,235,.85),(760,170,.65)]:
 for dx,dz,ss in [(-.52,0,.55),(0,.15,.72),(.62,0,.6)]:ball('Soft cloud',pix(x+dx*80,y-dz*80,4),(.72*s*ss,.06,.25*s*ss),M['cloud'])
shape('Distant blue orchard hills',[(-9,2.8),(-8,5.1),(-5,5.65),(-1.5,4.75),(2,5.4),(6,5.8),(9,4.5),(9,-1),(-9,-1)],3.5,M['farLight'])
shape('Distant shaded hill',[(-9,2),(-9,4.3),(-5.5,4.9),(-1,3.9),(4.2,4.8),(9,4.4),(9,-1)],3.2,M['far'])
shape('Rolling orchard meadow',[(-9,-1),(-9,3.9),(-5,4.2),(-1,3.8),(4,4.1),(9,3.6),(9,-1)],2.8,M['hill'])
shape('Sunny middle hillside',[(-9,-1),(-9,3.1),(-5,3.7),(0,3.3),(5,3.65),(9,3.2),(9,-1)],2.5,M['hillLight'])
shape('Fresh open meadow',[(-9,-2),(-9,2.5),(-4,3),(0,2.9),(5,3),(9,2.4),(9,-2)],1.8,M['lawn'])
# A tapering garden path curves away behind the central clearing.
path_left, path_right = [], []
for i in range(41):
 t=i/40; z=1.8+2.45*t; center=.8+.65*t+.38*math.sin(t*math.tau); width=.68*(1-t)**1.8+.008
 path_left.append((center-width,z));path_right.append((center+width,z))
shape('Winding sandy garden path',path_left+path_right[::-1],1.5,M['sandLight'])
# Small atmospheric orchard silhouettes establish scale beyond the fence.
for i in range(22):
 x=-8.4+i*.8+random.uniform(-.15,.15);z=3.75+.16*math.sin(x*.6);h=random.uniform(.25,.44)
 curve('Distant orchard trunk',[(x,2.65,z-.4),(x,2.65,z+.04)],.018,M['far'])
 for dx,dz,scale in [(-.15,0,.8),(.12,.04,.9),(0,.17,.8)]:
  o=ball('Distant orchard foliage',(x+dx,2.6,z+dz),(h*scale,.08,h*.8*scale),M['hill' if i%3 else 'farLight']);o.visible_shadow=False
# Small distant fence posts make the depth legible.
for x in range(-8,9):
 z=3.2+.08*math.cos(x*.6)
 curve('Orchard fence post',[(x,2,z-.35),(x,2,z+.25)],.035,M['rim'])
for h in [-.08,.13]:
 for span in [range(-9,2),range(2,10)]:curve('Curving fence rail',[(x,2.04,3.2+.08*math.cos(x*.6)+h) for x in span],.026,M['rim'])
# Low clipped hedging below the fence, never in front of the feet.
for i in range(45):
 x=-8.5+i*.39;z=2.9+.06*math.sin(x)
 if .75<x<1.7:continue
 ball('Soft low hedge',(x,1.9,z),(.29,.12,.18+random.random()*.09),M['hill' if i%3 else 'hillLight'])
shape('Soft grassy clearing edge',[(-6.1,1.4),(-5.7,2.1),(-3.5,2.45),(-.7,2.5),(2.2,2.4),(4.9,2.2),(6.1,1.65),(5.5,1),(3.2,.8),(.3,.66),(-2.5,.8),(-5,1)],.6,M['lawnLight'])
shape('Natural warm sandy clearing',[(-5.8,1.45),(-5.4,2.04),(-3.4,2.33),(-.7,2.39),(2.15,2.29),(4.7,2.08),(5.8,1.65),(5.25,1.13),(3.15,.91),(.3,.78),(-2.4,.91),(-4.8,1.12)],.4,M['sandLight'])
# Fine path pebbles and discreet meadow blossoms.
for i in range(75):
 x=random.uniform(25,1575);y=random.uniform(610,835)
 if 260<x<1340 and 650<y<800:continue
 if i%3==0:flower(x,y,random.uniform(.4,.8),-.1,'white' if i%2 else 'blush')
 else:grass(x,y,random.uniform(.45,.8),-.15)
for i in range(24):
 a=i*math.tau/24;x=800+555*math.cos(a);y=724+80*math.sin(a)
 if i%3==0:ball('Clearing edge pebble',pix(x,y,-.15),(.055,.025,.025),M['stone'])
active='Foreground'
for sign in [-1,1]:
 for i in range(36):
  x=800+sign*random.uniform(600,820);y=random.uniform(748,848)
  grass(x,y,random.uniform(.8,1.5),-1)
  if i%2==0:flower(x,y,random.uniform(.85,1.4),-1.2,'white' if i%3 else 'blush')
 for x,y,s in [(90,824,.65),(210,832,.4),(36,790,.4)]:
  xx=x if sign==-1 else 1600-x
  ball('Mossy rounded garden stone',pix(xx,y,-.8),(s,.12,s*.32),M['stone'])
  for j in range(5):ball('Clover cushion',pix(xx+random.uniform(-35,35),y+random.uniform(-9,9),-1),(.11,.025,.055),M['leafLight'])
active='Basket'
# Actual elliptical wicker strands, alternating over and under upright ribs.
for row in range(18):
 z=.13+row*.026;radius=.67+.25*(row/17)
 pts=[]
 for j in range(96):
  a=j*math.tau/96;r=radius+.009*math.cos(a*24+row*math.pi)
  pts.append((r*math.cos(a),r*.46*math.sin(a),z))
 curve('Woven willow horizontal',pts,.017,M['willow' if row%3 else 'rim'],True)
for i in range(48):
 a=i*math.tau/48;pts=[]
 for j in range(18):
  r=.67+.25*j/17+.012*math.cos(j*math.pi+i*math.pi)
  pts.append((r*math.cos(a),r*.46*math.sin(a),.13+j*.026))
 curve('Woven willow upright',pts,.013,M['rim'])
ball('Basket inner shadow',(0,0,.145),(.66,.3,.025),M['wood'])
for phase in [0,math.pi]:
 pts=[]
 for j in range(240):
  a=j*math.tau/240;r=.925+.019*math.cos(a*30+phase)
  pts.append((r*math.cos(a),r*.46*math.sin(a),.60+.019*math.sin(a*30+phase)))
 curve('Braided willow rim',pts,.026,M['rim'],True)
for dx in [-.024,.024]:
 curve('Arched wicker handle',[(.86*math.cos(a)+dx,.05,.58+.72*math.sin(a)) for a in [i*math.pi/30 for i in range(31)]],.032,M['rim'])
# The open weave remains visible without an opaque front ornament.

def render(group,name,w,h):
 for key,col in collections.items():col.hide_render=key!=group
 scene.render.resolution_x=w;scene.render.resolution_y=h;scene.render.resolution_percentage=100
 scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True);shutil.copy2(scene.render.filepath,PUBLIC)
render('Background','berry_background',1600,900)
render('Foreground','berry_foreground',1600,900)
cam.location=(0,-10,4.5);cam.rotation_euler=(Vector((0,0,.65))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=2.6
render('Basket','berry_basket',800,640)
cam.location=(0,-20,4.5);cam.rotation_euler=(math.pi/2,0,0);cam.data.ortho_scale=16
for key,col in collections.items():col.hide_render=key!='Background';col.hide_viewport=key!='Background'
scene.render.resolution_x=1600;scene.render.resolution_y=900
source=ROOT/'assets/blender/scenes/berry_environment_v2.blend';bpy.ops.wm.save_as_mainfile(filepath=str(source))
