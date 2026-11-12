import { Box3, Quaternion, SkinnedMesh, Vector3 } from 'three';
import type { Rabbit3D } from '../Rabbit3D';

export interface HandGripSample {
  leftGripPosition: Vector3;
  rightGripPosition: Vector3;
  gripMidpoint: Vector3;
  leftQuaternion: Quaternion;
  rightQuaternion: Quaternion;
  span: number;
  scale: number;
  valid: boolean;
  reliable: boolean;
}

/** Palm offsets are measured once and remain owned by this tracker. */
export class RabbitHandTracker {
  readonly HandGripOffset: { L: Vector3; R: Vector3 };
  readonly palmRadius: number;
  readonly measurementSource: string;
  private disposed = false;

  constructor(private readonly rabbit: Pick<Rabbit3D, 'model' | 'rig'>) {
    rabbit.model.updateWorldMatrix(true, true);
    const offsets = { L: new Vector3(), R: new Vector3() };
    const radii: number[] = [];
    let measured = 0;
    for (const side of ['L', 'R'] as const) {
      const bone = rabbit.rig.bones.get(`hand.${side}`);
      const forearm = rabbit.rig.bones.get(`forearm.${side}`);
      if (!bone || !forearm) throw new Error(`Rabbit is missing hand chain ${side}`);
      const bounds = new Box3();
      rabbit.model.traverse(object => {
        if (!(object instanceof SkinnedMesh)) return;
        const boneIndex = object.skeleton.bones.indexOf(bone);
        if (boneIndex < 0) return;
        const weights = object.geometry.getAttribute('skinWeight');
        const indices = object.geometry.getAttribute('skinIndex');
        if (!weights || !indices) return;
        object.skeleton.update();
        for (let index = 0; index < weights.count; index++) {
          let weight = 0;
          for (let component = 0; component < 4; component++) {
            if (indices.getComponent(index, component) === boneIndex) weight += weights.getComponent(index, component);
          }
          if (weight < .5) continue;
          const point = object.getVertexPosition(index, new Vector3()).applyMatrix4(object.matrixWorld);
          bounds.expandByPoint(rabbit.model.worldToLocal(point));
        }
      });
      if (bounds.isEmpty()) {
        const hand = rabbit.model.worldToLocal(bone.getWorldPosition(new Vector3()));
        const elbow = rabbit.model.worldToLocal(forearm.getWorldPosition(new Vector3()));
        radii.push(hand.distanceTo(elbow) * .35);
        continue;
      }
      const size = bounds.getSize(new Vector3());
      const point = bounds.getCenter(new Vector3());
      point.x = side === 'L' ? bounds.min.x + size.x * .15 : bounds.max.x - size.x * .15;
      point.z = bounds.max.z - size.z * .25;
      offsets[side].copy(bone.worldToLocal(rabbit.model.localToWorld(point)));
      radii.push(size.length() / 2);
      measured++;
    }
    this.HandGripOffset = offsets;
    this.palmRadius = Math.max(...radii);
    if (!Number.isFinite(this.palmRadius) || this.palmRadius <= 0) throw new Error('Rabbit has invalid palm dimensions');
    this.measurementSource = measured === 2 ? 'hand-weighted skin bounds' : 'forearm-length fallback';
  }

  /** Call only after RabbitRigController.update has committed its final IK pose. */
  sample(reliable = true): HandGripSample {
    const { model, rig } = this.rabbit;
    model.updateWorldMatrix(true, true);
    const left = rig.bones.get('hand.L')!;
    const right = rig.bones.get('hand.R')!;
    const leftGripPosition = left.localToWorld(this.HandGripOffset.L.clone());
    const rightGripPosition = right.localToWorld(this.HandGripOffset.R.clone());
    const leftQuaternion = left.getWorldQuaternion(new Quaternion());
    const rightQuaternion = right.getWorldQuaternion(new Quaternion());
    const gripMidpoint = leftGripPosition.clone().add(rightGripPosition).multiplyScalar(.5);
    const worldScale = model.getWorldScale(new Vector3());
    const scale = Math.min(Math.abs(worldScale.x), Math.abs(worldScale.y), Math.abs(worldScale.z));
    const span = leftGripPosition.distanceTo(rightGripPosition);
    const valid = !this.disposed && [...leftGripPosition.toArray(), ...rightGripPosition.toArray(),
      ...leftQuaternion.toArray(), ...rightQuaternion.toArray(), scale, span].every(Number.isFinite) && scale > 1e-8;
    return { leftGripPosition, rightGripPosition, gripMidpoint, leftQuaternion, rightQuaternion, span, scale, valid, reliable: valid && reliable };
  }

  dispose(): void { this.disposed = true; }
}
