import { Bone, Object3D } from 'three';
import type { RabbitBoneName } from '../rabbit3dConfig';

/** Transform-only working hierarchy; no meshes, GPU resources or second render loop. */
export class RabbitPoseBuffer {
  readonly model: Object3D;
  readonly bones = new Map<RabbitBoneName, Bone>();

  constructor(source: Object3D, sourceBones: ReadonlyMap<RabbitBoneName, Bone>) {
    const names = new Map([...sourceBones].map(([name, bone]) => [bone, name]));
    const copy = (original: Object3D): Object3D => {
      const target = original instanceof Bone ? new Bone() : new Object3D();
      target.position.copy(original.position);
      target.quaternion.copy(original.quaternion);
      target.scale.copy(original.scale);
      const name = names.get(original as Bone);
      if (name) this.bones.set(name, target as Bone);
      for (const child of original.children) target.add(copy(child));
      return target;
    };
    this.model = copy(source);
    this.model.matrixAutoUpdate = false;
    this.prepare(source);
  }

  prepare(source: Object3D): void {
    source.updateWorldMatrix(true, false);
    this.model.matrix.copy(source.matrixWorld);
  }

  dispose(): void { this.model.clear(); this.bones.clear(); }
}
