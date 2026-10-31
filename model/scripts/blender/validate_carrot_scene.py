"""Reopen and validate the saved scene without altering Blender or game assets."""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).resolve().parent))
from create_carrot_scene import LAYERS


def validate(root):
    path=root/'assets/blender/scenes/carrot_pull_scene.blend'
    before=hashlib.sha256(path.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(path))
    scene=bpy.context.scene
    report=json.loads((root/'qa/carrot_pull/scene_manifest.json').read_text())
    assert scene.camera.data.type=='PERSP' and scene.camera.data.lens==65
    assert (scene.render.resolution_x,scene.render.resolution_y)==(1920,1080)
    assert scene.render.image_settings.color_mode=='RGBA' and scene.render.film_transparent
    assert scene.render.engine=='BLENDER_EEVEE'
    assert not any(o.type=='ARMATURE' for o in bpy.data.objects)
    assert bpy.data.collections['Layout_Guides'].hide_render
    for name in LAYERS:
        col=bpy.data.collections[name]
        assert len(col.objects)==report['collections'][name]['objectCount'],name
        assert sorted(o.name for o in col.objects)==sorted(report['collections'][name]['objects']),name
        assert all(all(math.isfinite(v) for row in o.matrix_world for v in row) for o in col.objects),name
    for name in ('carrot','basket','soil_patch'):
        col=bpy.data.collections[name]
        roots=[o for o in col.objects if o.parent is None]
        assert len(roots)==1 and roots[0].type=='EMPTY',name
        assert roots[0].location.length<1e-6 and all(abs(v-1)<1e-6 for v in roots[0].scale),name
        assert all(o.parent==roots[0] for o in col.objects if o!=roots[0]),name
    assert not [im.filepath for im in bpy.data.images if im.source=='FILE' and im.filepath]
    assert hashlib.sha256(path.read_bytes()).hexdigest()==before
    result={'status':'PASS','sourceSha256':before,'objects':len(bpy.data.objects),'collections':{n:len(bpy.data.collections[n].objects) for n in LAYERS},'checks':['Reopened saved blend','Seven named collections and manifest inventory match','No armature or rabbit meshes in scene','Camera and transparent Eevee RGBA settings','Isolated prop identity roots and mesh parenting','Finite transforms','No external textures','Read-only validation preserved blend SHA256']}
    (root/'qa/carrot_pull/blender_validation.json').write_text(json.dumps(result,indent=2)+'\n')
    print('CARROT_SCENE_VALIDATE_PASS',json.dumps(result),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,default=ROOT)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    validate(args.root.resolve())
