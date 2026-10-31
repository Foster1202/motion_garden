"""Render individually addressable RGBA environment layers from the saved scene."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).resolve().parent))
sys.path.insert(0,str(ROOT/'scripts'))
from create_carrot_scene import LAYERS
from rabbit_pipeline import normalize_png_metadata


def render(root, selected, draft=False):
    source=root/'assets/blender/scenes/carrot_pull_scene.blend'
    source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene=bpy.context.scene
    camera=scene.camera
    original_matrix=camera.matrix_world.copy()
    original_lights={o.name:(o.location.copy(),o.data.energy) for o in bpy.data.objects if o.type=='LIGHT'}
    out=root/'assets/rendered/carrot_pull';out.mkdir(parents=True,exist_ok=True)
    manifest_path=out/'carrot_scene_assets.json'
    manifest=json.loads(manifest_path.read_text()) if manifest_path.exists() else {'schemaVersion':1,'canvas':[1920,1080],'layers':{}}
    manifest.update(sourceSha256=source_hash,alphaMode='straight',colorSpace='sRGB',sourceCamera='Camera_Scene_65mm',layerOrder=['background_far','background_mid','platform','soil_patch','rabbit (external)','carrot','basket','foreground'])
    desc={'background_far':'Authored pale sky, soft clouds, distant rounded mountains and hills; sky covers canvas.', 'background_mid':'Rounded meadow, trees, low wooden fence, stepping path, left carrot bed and sparse flowers.', 'platform':'Thick rounded wooden platform, fitted planks and subtle geometric grain.', 'foreground':'Sparse corner flowers and grass; transparent central play area.', 'soil_patch':'Rounded soil mound with dark central depression and soft clumps.', 'carrot':'Complete carrot with orange taproot and green leaves; pivot at grip.', 'basket':'Open woven wooden basket, rounded rim and arched handle.'}
    for layer in (LAYERS if selected=='all' else [selected]):
        for name in LAYERS:bpy.data.collections[name].hide_render=(name!=layer)
        camera.matrix_world=original_matrix.copy()
        for name,(pos,power) in original_lights.items():
            ob=bpy.data.objects[name];ob.location=pos.copy();ob.data.energy=power
        size=512 if layer in ('carrot','basket','soil_patch') else None
        scene.render.resolution_x=size or 1920;scene.render.resolution_y=size or 1080
        scene.render.resolution_percentage=100
        if hasattr(scene.eevee,'taa_render_samples'):scene.eevee.taa_render_samples=16 if draft else 64
        bpy.context.view_layer.update()
        record={'file':layer+'.png','size':[scene.render.resolution_x,scene.render.resolution_y],'placement':{'x':0,'y':0},'displayScale':1,'contents':desc[layer]}
        if size:
            graph=bpy.context.evaluated_depsgraph_get()
            points=[]
            for ob in bpy.data.collections[layer].objects:
                if ob.type=='MESH':
                    e=ob.evaluated_get(graph);points.extend(e.matrix_world@Vector(p) for p in e.bound_box)
            q=camera.rotation_euler.to_quaternion();inv=q.inverted()
            local=[inv@p for p in points]
            lo=Vector(tuple(min(p[a] for p in local) for a in range(3)));hi=Vector(tuple(max(p[a] for p in local) for a in range(3)))
            center=q@((lo+hi)*.5)
            distance=max(hi.x-lo.x,hi.y-lo.y)*camera.data.lens/camera.data.sensor_width/.76+(hi.z-lo.z)*.5
            camera.location=center+q@Vector((0,0,distance))
            # Keep the same soft light directions at the smaller product scale.
            for name,(pos,power) in original_lights.items():
                ob=bpy.data.objects[name]
                if ob.data.type=='AREA':ob.location=pos*.35;ob.data.energy=power*.1225;ob.data.size=3.5
            bpy.context.view_layer.update()
            origin=world_to_camera_view(scene,camera,Vector((0,0,0)))
            pivot={'x':origin.x*512,'y':(1-origin.y)*512}
            record.update(pivotPixels=pivot,origin={'x':pivot['x']/512,'y':pivot['y']/512},cameraLocation=list(camera.location),cameraRotationEulerRadians=list(camera.rotation_euler),lensMm=camera.data.lens,originWorld=[0,0,0])
            # These are recommended composition placements, not runtime changes.
            scale={'carrot':.44,'soil_patch':.40,'basket':.60}[layer]
            target={'carrot':(1073,827),'soil_patch':(1073,833),'basket':(1494,858)}[layer]
            record['displayScale']=scale
            record['placement']={'x':target[0]-pivot['x']*scale,'y':target[1]-pivot['y']*scale}
            record['anchorCanvasPixels']={'x':target[0],'y':target[1]}
            if layer=='carrot':record['pivotDefinition']='Local origin (0,0,0) at leaf/root junction; grip anchor. +Z leaves, -Z taproot, front -Y. Use pivotPixels / 512 as Phaser origin.'
        scene.render.filepath=str(out/(layer+'.png'))
        bpy.ops.render.render(write_still=True)
        normalize_png_metadata(out/(layer+'.png'))
        record['sha256']=hashlib.sha256((out/(layer+'.png')).read_bytes()).hexdigest()
        record['quality']='draft' if draft else 'final'
        manifest['layers'][layer]=record
        manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
        print('CARROT_LAYER_RENDERED',layer,record['size'],flush=True)
    if hashlib.sha256(source.read_bytes()).hexdigest()!=source_hash:raise RuntimeError('Source blend changed during render')
    print('CARROT_SCENE_RENDER_COMPLETE',selected,flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,default=ROOT);parser.add_argument('--layer',choices=['all',*LAYERS],default='all');parser.add_argument('--draft',action='store_true')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    render(args.root.resolve(),args.layer,args.draft)
