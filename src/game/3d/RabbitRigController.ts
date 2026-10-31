import { Bone, MathUtils, Object3D, Quaternion, Vector3 } from 'three';
import {
  RABBIT_3D_CONFIG, RABBIT_REQUIRED_BONES,
  type RabbitBoneName, type RabbitSide,
} from './rabbit3dConfig';

interface RestBone {
  bone: Bone;
  quaternion: Quaternion;
  position: Vector3;
  scale: Vector3;
  targetQuaternion: Quaternion;
  targetPosition: Vector3;
  axes: { x: Vector3; y: Vector3; z: Vector3 };
}

const finite = (value: number) => Number.isFinite(value) ? value : 0;
const clamp = (value: number, min: number, max: number) => MathUtils.clamp(finite(value), min, max);
const radians = MathUtils.degToRad;
const suffix = (side: RabbitSide): 'L' | 'R' => side === 'L' || side === 'left' ? 'L' : 'R';
const sanitizedName = (name: string) => name.replace(/[.\[\]:/]/g, '');

/** Rest-relative FK controls in glTF model coordinates: +Y up, +Z front. */
export class RabbitRigController {
  readonly bones = new Map<RabbitBoneName, Bone>();
  private readonly rest = new Map<RabbitBoneName, RestBone>();
  private readonly rootOffset = new Vector3();
  private readonly kneeCompensation = new Vector3();
  private readonly legSegments: { upper: Vector3; lower: Vector3 }[] = [];
  private kneeAngle = 0;
  private readonly legExtensions = { L: 0, R: 0 };
  private disposed = false;

  constructor(private readonly model: Object3D) {
    model.updateWorldMatrix(true, true);
    const found: Bone[] = [];
    model.traverse(object => { if (object instanceof Bone) found.push(object); });
    const modelWorld = model.getWorldQuaternion(new Quaternion());
    for (const name of RABBIT_REQUIRED_BONES) {
      const bone = found.find(candidate => candidate.userData.originalBoneName === name)
        ?? found.find(candidate => candidate.name === name)
        ?? found.find(candidate => candidate.name === sanitizedName(name));
      if (!bone) continue;
      this.bones.set(name, bone);
      const worldToLocal = bone.getWorldQuaternion(new Quaternion()).invert();
      const axis = (value: Vector3) => value.applyQuaternion(modelWorld).applyQuaternion(worldToLocal).normalize();
      this.rest.set(name, {
        bone, quaternion: bone.quaternion.clone(), position: bone.position.clone(), scale: bone.scale.clone(),
        targetQuaternion: bone.quaternion.clone(), targetPosition: bone.position.clone(),
        axes: { x: axis(new Vector3(1, 0, 0)), y: axis(new Vector3(0, 1, 0)), z: axis(new Vector3(0, 0, 1)) },
      });
    }
    const missing = RABBIT_REQUIRED_BONES.filter(name => !this.bones.has(name));
    if (missing.length) throw new Error(`Rabbit GLB is missing bones: ${missing.join(', ')}`);
    for (const side of ['L', 'R'] as const) {
      const point = (name: RabbitBoneName) => model.worldToLocal(this.bones.get(name)!.getWorldPosition(new Vector3()));
      const hip = point(`thigh.${side}`);
      const knee = point(`shin.${side}`);
      const ankle = point(`foot.${side}`);
      this.legSegments.push({ upper: knee.clone().sub(hip), lower: ankle.sub(knee) });
    }
  }

  /** Positive angles raise either arm outward; forearm angles bend inward. */
  setArmRotation(side: RabbitSide, upperDegrees: number, forearmDegrees = 0): void {
    const part = suffix(side);
    const sign = part === 'L' ? 1 : -1;
    const limits = RABBIT_3D_CONFIG.limits;
    this.setRotation(`upper_arm.${part}`, 0, 0, sign * clamp(upperDegrees, limits.arm.min, limits.arm.max));
    this.setRotation(`forearm.${part}`, 0, 0, -sign * clamp(forearmDegrees, limits.forearm.min, limits.forearm.max));
  }

  /** Positive side lean moves the head toward screen left; forward lean bows. */
  setBodyLean(sideDegrees: number, forwardDegrees = 0): void {
    const limits = RABBIT_3D_CONFIG.limits;
    this.setRotation('body', clamp(forwardDegrees, -limits.bodyForward, limits.bodyForward), 0,
      clamp(sideDegrees, -limits.bodySide, limits.bodySide));
  }

  setHeadRotation(yawDegrees: number, pitchDegrees = 0, rollDegrees = 0): void {
    const limits = RABBIT_3D_CONFIG.limits;
    this.setRotation('head', clamp(pitchDegrees, -limits.headPitch, limits.headPitch),
      clamp(yawDegrees, -limits.headYaw, limits.headYaw), clamp(rollDegrees, -limits.headRoll, limits.headRoll));
  }

  /** Shallow symmetric FK with rest-geometry support compensation; this is not IK. */
  setKneeBend(amount: number): void {
    const angle = clamp(amount, 0, 1) * RABBIT_3D_CONFIG.limits.knee;
    this.kneeAngle = angle;
    this.updateLegRotations();
    const axis = new Vector3(1, 0, 0);
    this.kneeCompensation.set(0, 0, 0);
    for (const { upper, lower } of this.legSegments) {
      const displacement = upper.clone().applyAxisAngle(axis, -radians(angle)).sub(upper)
        .add(lower.clone().applyAxisAngle(axis, radians(angle)).sub(lower));
      this.kneeCompensation.addScaledVector(displacement, -1 / this.legSegments.length);
    }
    this.updateRootTarget();
  }

  /** Bounded continuous hip abduction, composed with the existing shallow knee bend. */
  setLegExtension(side: RabbitSide, amount: number): void {
    this.legExtensions[suffix(side)] = clamp(amount, 0, 1);
    this.updateLegRotations();
  }

  private updateLegRotations(): void {
    if (this.disposed) return;
    for (const side of ['L', 'R'] as const) {
      const outward = (side === 'L' ? 1 : -1) * this.legExtensions[side] * RABBIT_3D_CONFIG.limits.legExtension;
      this.setRotation(`thigh.${side}`, -this.kneeAngle, 0, outward);
      this.setRotation(`shin.${side}`, 2 * this.kneeAngle, 0, 0);
      // Cancel the composed hip/knee rotation, including simultaneous abduction.
      const thigh = this.rest.get(`thigh.${side}`)!;
      const shin = this.rest.get(`shin.${side}`)!;
      const foot = this.rest.get(`foot.${side}`)!;
      const restChain = thigh.quaternion.clone().multiply(shin.quaternion).multiply(foot.quaternion);
      foot.targetQuaternion.copy(thigh.targetQuaternion).multiply(shin.targetQuaternion)
        .invert().multiply(restChain).normalize();
    }
  }

  /** Offsets use natural glTF model units, before the display's uniform scale. */
  setRootOffset(x: number, y = 0, z = 0): void {
    const limits = RABBIT_3D_CONFIG.limits.root;
    this.rootOffset.set(clamp(x, -limits.x, limits.x), clamp(y, -limits.y, limits.y), clamp(z, -limits.z, limits.z));
    this.updateRootTarget();
  }

  resetPose(immediate = false): void {
    this.rootOffset.set(0, 0, 0);
    this.kneeCompensation.set(0, 0, 0);
    this.kneeAngle = 0;
    this.legExtensions.L = this.legExtensions.R = 0;
    for (const state of this.rest.values()) {
      state.targetQuaternion.copy(state.quaternion);
      state.targetPosition.copy(state.position);
      if (immediate) {
        state.bone.quaternion.copy(state.quaternion);
        state.bone.position.copy(state.position);
        state.bone.scale.copy(state.scale);
      }
    }
    if (immediate) this.model.updateWorldMatrix(true, true);
  }

  update(deltaSeconds: number): void {
    if (this.disposed || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    const blend = 1 - Math.exp(-RABBIT_3D_CONFIG.smoothingRate * deltaSeconds);
    for (const state of this.rest.values()) {
      state.bone.quaternion.slerp(state.targetQuaternion, blend);
      state.bone.position.lerp(state.targetPosition, blend);
      const normalization = Math.sqrt(state.bone.quaternion.lengthSq() * state.targetQuaternion.lengthSq());
      if (1 - Math.abs(state.bone.quaternion.dot(state.targetQuaternion)) / normalization < 1e-12) {
        state.bone.quaternion.copy(state.targetQuaternion);
      }
      if (state.bone.position.distanceToSquared(state.targetPosition) < 1e-16) {
        state.bone.position.copy(state.targetPosition);
      }
    }
    this.model.updateWorldMatrix(true, true);
  }

  dispose(): void {
    this.resetPose(true);
    this.disposed = true;
  }

  private setRotation(name: RabbitBoneName, xDegrees: number, yDegrees: number, zDegrees: number): void {
    if (this.disposed) return;
    const state = this.rest.get(name)!;
    state.targetQuaternion.copy(state.quaternion);
    const rotation = new Quaternion();
    for (const [axis, angle] of [[state.axes.x, xDegrees], [state.axes.y, yDegrees], [state.axes.z, zDegrees]] as const) {
      rotation.setFromAxisAngle(axis, radians(angle));
      state.targetQuaternion.multiply(rotation);
    }
    state.targetQuaternion.normalize();
  }

  private updateRootTarget(): void {
    if (this.disposed) return;
    const state = this.rest.get('root')!;
    // Root position belongs to its parent frame, which need not match model axes.
    const delta = this.rootOffset.clone().add(this.kneeCompensation);
    const modelWorld = this.model.getWorldQuaternion(new Quaternion());
    const parentWorld = state.bone.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
    delta.applyQuaternion(modelWorld).applyQuaternion(parentWorld.invert());
    state.targetPosition.copy(state.position).add(delta);
  }
}
