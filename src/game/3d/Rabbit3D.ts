import { RABBIT_3D_CONFIG } from './rabbit3dConfig';
import { Box3, Group, Mesh, Texture, Vector3, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RabbitRigController } from './RabbitRigController';

export function disposeModel(root: Object3D) {
  const geometries = new Set<unknown>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    if (!geometries.has(object.geometry)) { object.geometry.dispose(); geometries.add(object.geometry); }
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (materials.has(material)) continue;
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
      material.dispose(); materials.add(material);
    }
    if ('skeleton' in object) (object as import('three').SkinnedMesh).skeleton.dispose();
  });
  textures.forEach(texture => texture.dispose());
  root.removeFromParent();
}

export class Rabbit3D {
  readonly rig: RabbitRigController;
  readonly pivot = new Group();
  readonly bounds: Box3;
  readonly pixelsPerUnit: number;

  constructor(readonly model: Object3D) {
    // Fit to evaluated skin vertices so the sole anchor survives proportion changes.
    model.updateWorldMatrix(true, true);
    this.bounds = new Box3().setFromObject(model, true);
    const height = this.bounds.getSize(new Vector3()).y;
    if (!Number.isFinite(height) || height <= 0) throw new Error('Rabbit has invalid bounds');
    this.pixelsPerUnit = RABBIT_3D_CONFIG.visibleHeight / height;
    this.pivot.position.y = -this.bounds.min.y;
    this.pivot.add(model);
    this.rig = new RabbitRigController(model);
  }

  static async load(url: string, signal: AbortSignal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Rabbit GLB HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    const gltf = await new GLTFLoader().parseAsync(bytes, '');
    if (signal.aborted) { disposeModel(gltf.scene); throw new DOMException('Aborted', 'AbortError'); }
    try { return new Rabbit3D(gltf.scene); }
    catch (error) { disposeModel(gltf.scene); throw error; }
  }

  dispose() { this.rig.dispose(); disposeModel(this.model); this.pivot.removeFromParent(); }
}
