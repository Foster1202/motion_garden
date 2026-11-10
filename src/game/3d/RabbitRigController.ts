import { Bone, MathUtils, Object3D, Quaternion, Vector3 } from 'three';
import type { RabbitPose } from '../mocap/RabbitPose';
import { RabbitPoseBuffer } from './ik/RabbitPoseBuffer';
import { RabbitLegIK } from './ik/RabbitLegIK';
import { RabbitArmIK } from './ik/RabbitArmIK';
import {
  RABBIT_3D_CONFIG, RABBIT_REQUIRED_BONES,
  rabbitRigProfile, rabbitRaiseLimit, type RabbitBoneName, type RabbitRaiseLimitCurve,
  type RabbitRigLimits, type RabbitRigVersion, type RabbitSide,
} from './rabbit3dConfig';

interface RestBone {
  name: RabbitBoneName;
  bone: Bone;
  quaternion: Quaternion;
  position: Vector3;
  scale: Vector3;
  targetQuaternion: Quaternion;
  targetPosition: Vector3;
  blendedQuaternion: Quaternion;
  blendedPosition: Vector3;
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
  readonly version: RabbitRigVersion;
  readonly limits: RabbitRigLimits;
  readonly elbowLimitsByRaise: RabbitRaiseLimitCurve;
  readonly headLimitsByRaise: RabbitRaiseLimitCurve;
  private readonly rest = new Map<RabbitBoneName, RestBone>();
  private readonly rootOffset = new Vector3();
  private readonly kneeCompensation = new Vector3();
  private readonly legSegments: { upper: Vector3; lower: Vector3 }[] = [];
  private readonly lowerArmDirections = new Map<'L' | 'R', Vector3>();
  private readonly armElevations = { L: 0, R: 0 };
  private readonly headRotation = { yaw: 0, pitch: 0, roll: 0 };
  private kneeAngle = 0;
  private readonly legExtensions = { L: 0, R: 0 };
  private disposed = false;
  private ikEnabled = false;
  private ikWeight = 0;
  private solverTimeMs = 0;
  private readonly poseBuffer: RabbitPoseBuffer;
  private readonly legIK: RabbitLegIK;
  private readonly armIK = new Map<'L' | 'R', RabbitArmIK>();
  private readonly armRequests = { L: { raise: 0, elbow: 0, plane: 0 }, R: { raise: 0, elbow: 0, plane: 0 } };
  private readonly handTargets = new Map<'L' | 'R', Vector3>();
  private readonly targetScratch = new Vector3();
  private readonly bodyRestOrientation = new Quaternion();
  private readonly armResults = new Map<'L' | 'R', ReturnType<RabbitArmIK['solve']>>();

  constructor(private readonly model: Object3D) {
    const profile = rabbitRigProfile(model);
    this.version = profile.version;
    this.limits = profile.limits;
    this.elbowLimitsByRaise = profile.elbowLimitsByRaise;
    this.headLimitsByRaise = profile.headLimitsByRaise;
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
        name, bone, quaternion: bone.quaternion.clone(), position: bone.position.clone(), scale: bone.scale.clone(),
        targetQuaternion: bone.quaternion.clone(), targetPosition: bone.position.clone(),
        blendedQuaternion: bone.quaternion.clone(), blendedPosition: bone.position.clone(),
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
      const upperArm = point(`forearm.${side}`).sub(point(`upper_arm.${side}`));
      const lowerArm = point(`hand.${side}`).sub(point(`forearm.${side}`));
      this.lowerArmDirections.set(side, lowerArm.clone().normalize());
      this.armIK.set(side, new RabbitArmIK(upperArm, lowerArm, side === 'L' ? 1 : -1,
        this.elbowLimitsByRaise, this.limits));
      this.legSegments.push({ upper: knee.clone().sub(hip), lower: ankle.sub(knee) });
    }
    this.bodyRestOrientation.copy(model.getWorldQuaternion(new Quaternion()).invert())
      .multiply(this.bones.get('body')!.getWorldQuaternion(new Quaternion()));
    this.poseBuffer = new RabbitPoseBuffer(model, this.bones);
    this.legIK = new RabbitLegIK(model, this.bones);
  }

  /** A single staged target transaction; update() owns the final bone commit. */
  applyPose(pose: RabbitPose): void {
    this.setArmRotation('left', pose.leftArmElevation, pose.leftElbowBend, pose.leftArmPlane);
    this.setArmRotation('right', pose.rightArmElevation, pose.rightElbowBend, pose.rightArmPlane);
    this.setBodyLean(pose.torsoLean, pose.torsoForward);
    this.setHeadRotation(pose.headYaw, pose.headPitch, -.4 * pose.torsoLean);
    this.setKneeBend(pose.bendAmount);
    this.setRootOffset(pose.lateralOffset);
  }

  setIKEnabled(enabled: boolean): void {
    if (this.disposed) return;
    this.ikEnabled = enabled && this.version === 'v3';
  }

  /** Shoulder-relative model axes; depth is a stylized target, not reconstructed human XYZ. */
  setHandTarget(side: RabbitSide, x: number, y: number, z: number): boolean {
    if (this.disposed || ![x, y, z].every(Number.isFinite) || Math.hypot(x, y, z) > 1e4) return false;
    this.handTargets.set(suffix(side), new Vector3(x, y, z));
    return true;
  }

  clearHandTarget(side: RabbitSide): void { this.handTargets.delete(suffix(side)); }

  ikSnapshot() {
    const copyFoot = (foot: NonNullable<typeof this.legSnapshot>['left']) => ({ ...foot,
      target: [...foot.target], position: [...foot.position], contact: [...foot.contact] });
    const feet = this.legSnapshot && { ...this.legSnapshot,
      left: copyFoot(this.legSnapshot.left), right: copyFoot(this.legSnapshot.right) };
    if (feet && this.ikWeight === 0) {
      feet.rootClamped = feet.left.clamped = feet.right.clamped = false;
    }
    const body = this.model.getWorldQuaternion(new Quaternion()).invert()
      .multiply(this.bones.get('body')!.getWorldQuaternion(new Quaternion())).invert();
    const undoBody = this.bodyRestOrientation.clone().multiply(body);
    const hands = Object.fromEntries([...this.armResults].filter(() => this.ikWeight > 0).map(([side, result]) => {
      const request = this.armRequests[side];
      const target = this.handTargets.get(side) ?? this.armIK.get(side)!.forward(request.raise, request.elbow, request.plane, new Vector3());
      const shoulder = this.model.worldToLocal(this.bones.get(`upper_arm.${side}`)!.getWorldPosition(new Vector3()));
      const position = this.model.worldToLocal(this.bones.get(`hand.${side}`)!.getWorldPosition(new Vector3()))
        .sub(shoulder).applyQuaternion(undoBody);
      return [side, { ...result, solverResidual: result.residual, residual: position.distanceTo(target),
        target: target.toArray(), position: position.toArray() }];
    }));
    return { enabled: this.ikEnabled, available: this.version === 'v3', weight: this.ikWeight,
      solverTimeMs: this.solverTimeMs, feet, hands,
      constraintClamped: this.ikWeight > 0 && (!!feet?.rootClamped || [...this.armResults.values()].some(value => value.clamped)),
    };
  }

  private legSnapshot?: ReturnType<RabbitLegIK['solve']>;

  /** Plane 0 raises sideways, plane 90 raises forward, around the unchanged shoulder pivot. */
  setArmRotation(side: RabbitSide, upperDegrees: number, forearmDegrees = 0, planeDegrees = 0): void {
    if (this.disposed) return;
    const part = suffix(side);
    Object.assign(this.armRequests[part], { raise: clamp(upperDegrees, this.limits.arm.min, this.limits.arm.max),
      elbow: clamp(forearmDegrees, 0, this.limits.forearm.max), plane: clamp(planeDegrees, 0, 90) });
    this.handTargets.delete(part);
    this.targetArmRotation(side, upperDegrees, forearmDegrees, planeDegrees);
  }

  private targetArmRotation(side: RabbitSide, upperDegrees: number, forearmDegrees: number, planeDegrees: number): void {
    const part = suffix(side);
    const sign = part === 'L' ? 1 : -1;
    const limits = this.limits;
    const plane = radians(clamp(planeDegrees, 0, 90));
    const upper = this.rest.get(`upper_arm.${part}`)!;
    const axis = upper.axes.z.clone().multiplyScalar(sign * Math.cos(plane))
      .addScaledVector(upper.axes.x, -Math.sin(plane)).normalize();
    this.armElevations[part] = clamp(upperDegrees, limits.arm.min, limits.arm.max);
    const elevation = radians(this.armElevations[part]);
    upper.targetQuaternion.copy(upper.quaternion).multiply(new Quaternion().setFromAxisAngle(axis, elevation)).normalize();
    if (this.version === 'v3') {
      // The V3 mesh supports a fixed anatomical hinge carried by its upper arm.
      this.setRotation(`forearm.${part}`, -clamp(forearmDegrees, limits.forearm.min,
        this.maximumElbowBend(this.armElevations[part])), 0, 0);
    } else {
      const shoulderDelta = new Quaternion().setFromAxisAngle(
        new Vector3(-Math.sin(plane), 0, sign * Math.cos(plane)), elevation);
      const direction = this.lowerArmDirections.get(part)!.clone().applyQuaternion(shoulderDelta);
      // Retain the V2 outward clearance workaround for the preserved legacy asset.
      const outward = new Vector3(sign, 0.4, 1).normalize();
      const elbowLimit = Math.min(limits.forearm.max, MathUtils.radToDeg(direction.angleTo(outward)));
      const hinge = direction.cross(outward).normalize().applyQuaternion(shoulderDelta.invert());
      const forearm = this.rest.get(`forearm.${part}`)!;
      const localHinge = forearm.axes.x.clone().multiplyScalar(hinge.x)
        .addScaledVector(forearm.axes.y, hinge.y).addScaledVector(forearm.axes.z, hinge.z).normalize();
      forearm.targetQuaternion.copy(forearm.quaternion).multiply(new Quaternion().setFromAxisAngle(localHinge,
        radians(clamp(forearmDegrees, limits.forearm.min, elbowLimit)))).normalize();
    }
    this.updateHeadRotation();
  }

  maximumElbowBend(upperDegrees: number): number {
    return rabbitRaiseLimit(this.elbowLimitsByRaise, clamp(upperDegrees, 0, this.limits.arm.max));
  }

  maximumHeadEnvelope(upperDegrees: number): number {
    return rabbitRaiseLimit(this.headLimitsByRaise, clamp(upperDegrees, 0, this.limits.arm.max));
  }

  /** Positive side lean moves the head toward screen left; forward lean bows. */
  setBodyLean(sideDegrees: number, forwardDegrees = 0): void {
    const limits = this.limits;
    this.setRotation('body', clamp(forwardDegrees, -limits.bodyForward, limits.bodyForward), 0,
      clamp(sideDegrees, -limits.bodySide, limits.bodySide));
  }

  setHeadRotation(yawDegrees: number, pitchDegrees = 0, rollDegrees = 0): void {
    const limits = this.limits;
    this.headRotation.yaw = clamp(yawDegrees, -limits.headYaw, limits.headYaw);
    this.headRotation.pitch = clamp(pitchDegrees, -limits.headPitch, limits.headPitch);
    this.headRotation.roll = clamp(rollDegrees, -limits.headRoll, limits.headRoll);
    this.updateHeadRotation();
  }

  private updateHeadRotation(): void {
    const requested = Math.hypot(this.headRotation.pitch, this.headRotation.yaw, this.headRotation.roll);
    const elevation = Math.max(this.armElevations.L, this.armElevations.R);
    const clearance = requested === 0 ? 0 : this.version === 'v3'
      ? Math.min(1, this.maximumHeadEnvelope(elevation) / requested)
      : (1 - clamp((elevation - 60) / 30, 0, 1)) * Math.min(1, this.limits.headMotionEnvelope / requested);
    this.setRotation('head', this.headRotation.pitch * clearance, this.headRotation.yaw * clearance,
      this.headRotation.roll * clearance);
  }

  /** Shallow symmetric FK with rest-geometry support compensation; this is not IK. */
  setKneeBend(amount: number): void {
    const angle = clamp(amount, 0, 1) * this.limits.knee;
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
      const outward = (side === 'L' ? 1 : -1) * this.legExtensions[side] * this.limits.legExtension;
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
    const limits = this.limits.root;
    this.rootOffset.set(clamp(x, -limits.x, limits.x), clamp(y, -limits.y, limits.y), clamp(z, -limits.z, limits.z));
    this.updateRootTarget();
  }

  /** Rest-relative model-space control for future grip attachment, independent of arm targets. */
  setCarrotSocketOffset(x: number, y = 0, z = 0): void {
    if (this.disposed) return;
    const state = this.rest.get('carrot_socket')!;
    const limit = RABBIT_3D_CONFIG.socketOffset;
    const delta = new Vector3(clamp(x, -limit, limit), clamp(y, -limit, limit), clamp(z, -limit, limit));
    const modelWorld = this.model.getWorldQuaternion(new Quaternion());
    const parentWorld = state.bone.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
    delta.applyQuaternion(modelWorld).applyQuaternion(parentWorld.invert());
    state.targetPosition.copy(state.position).add(delta);
  }

  resetPose(immediate = false): void {
    this.rootOffset.set(0, 0, 0);
    this.kneeCompensation.set(0, 0, 0);
    this.kneeAngle = 0;
    this.armElevations.L = this.armElevations.R = 0;
    this.headRotation.yaw = this.headRotation.pitch = this.headRotation.roll = 0;
    this.legExtensions.L = this.legExtensions.R = 0;
    this.handTargets.clear();
    this.armResults.clear();
    this.armRequests.L.raise = this.armRequests.L.elbow = this.armRequests.L.plane = 0;
    this.armRequests.R.raise = this.armRequests.R.elbow = this.armRequests.R.plane = 0;
    this.armIK.forEach(solver => solver.reset());
    this.legIK?.reset();
    for (const state of this.rest.values()) {
      state.targetQuaternion.copy(state.quaternion);
      state.targetPosition.copy(state.position);
      if (immediate) {
        state.bone.quaternion.copy(state.quaternion);
        state.bone.position.copy(state.position);
        state.bone.scale.copy(state.scale);
        state.blendedPosition.copy(state.position);
        state.blendedQuaternion.copy(state.quaternion);
      }
    }
    if (immediate) this.model.updateWorldMatrix(true, true);
  }

  update(deltaSeconds: number): void {
    if (this.disposed || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    const started = performance.now();
    const previousWeight = this.ikWeight;
    const step = Math.min(deltaSeconds, .05);
    this.ikWeight = MathUtils.clamp(this.ikWeight + (this.ikEnabled ? 1 : -1) * step / .2, 0, 1);
    if (this.ikWeight > 0) {
      for (const side of ['L', 'R'] as const) {
        const solver = this.armIK.get(side)!;
        const request = this.armRequests[side];
        const target = this.handTargets.get(side) ?? solver.forward(request.raise, request.elbow, request.plane, this.targetScratch);
        const solution = solver.solve(target, request);
        this.armResults.set(side, solution);
        this.targetArmRotation(side, MathUtils.lerp(request.raise, solution.raise, this.ikWeight),
          MathUtils.lerp(request.elbow, solution.elbow, this.ikWeight), MathUtils.lerp(request.plane, solution.plane, this.ikWeight));
      }
    } else if (previousWeight > 0) {
      for (const side of ['L', 'R'] as const) {
        const request = this.armRequests[side];
        this.targetArmRotation(side, request.raise, request.elbow, request.plane);
      }
    }
    const blend = 1 - Math.exp(-RABBIT_3D_CONFIG.smoothingRate * deltaSeconds);
    this.poseBuffer.prepare(this.model);
    for (const [name, state] of this.rest) {
      state.blendedQuaternion.slerp(state.targetQuaternion, blend);
      state.blendedPosition.lerp(state.targetPosition, blend);
      const normalization = Math.sqrt(state.blendedQuaternion.lengthSq() * state.targetQuaternion.lengthSq());
      if (1 - Math.abs(state.blendedQuaternion.dot(state.targetQuaternion)) / normalization < 1e-12) {
        state.blendedQuaternion.copy(state.targetQuaternion);
      }
      if (state.blendedPosition.distanceToSquared(state.targetPosition) < 1e-16) state.blendedPosition.copy(state.targetPosition);
      const work = this.poseBuffer.bones.get(name)!;
      work.quaternion.copy(state.blendedQuaternion);
      work.position.copy(state.blendedPosition);
    }
    if (this.version === 'v3') this.constrainInterpolatedPose();
    this.poseBuffer.model.updateWorldMatrix(true, true);
    if (this.ikWeight > 0) {
      this.legSnapshot = this.legIK.solve(this.poseBuffer.model, this.poseBuffer.bones);
      // Blend only the mode transition; steady IK has no extra temporal filter.
      if (this.ikWeight < 1) for (const [name, state] of this.rest) {
        if (!/^(root|thigh\.|shin\.|foot\.)/.test(name)) continue;
        const work = this.poseBuffer.bones.get(name)!;
        work.quaternion.slerpQuaternions(state.blendedQuaternion, work.quaternion, this.ikWeight);
        work.position.lerpVectors(state.blendedPosition, work.position, this.ikWeight);
      }
    }
    for (const [name, state] of this.rest) {
      const work = this.poseBuffer.bones.get(name)!;
      state.bone.quaternion.copy(work.quaternion);
      state.bone.position.copy(work.position);
    }
    this.model.updateWorldMatrix(true, true);
    this.legSnapshot = this.legIK.measure(this.model, this.bones);
    this.solverTimeMs = performance.now() - started;
  }

  private constrainInterpolatedPose(): void {
    // Safe target joints can interpolate beyond a coupled limit between curve points.
    const angle = (state: RestBone) => MathUtils.radToDeg(state.quaternion.clone().normalize()
      .angleTo(this.poseBuffer.bones.get(state.name)!.quaternion.clone().normalize()));
    const constrain = (state: RestBone, maximum: number) => {
      const current = angle(state);
      if (current > maximum && current > 1e-8) {
        const rotation = this.poseBuffer.bones.get(state.name)!.quaternion.clone().normalize();
        this.poseBuffer.bones.get(state.name)!.quaternion.copy(state.quaternion).normalize().slerp(rotation, maximum / current);
      }
    };
    let maximumRaise = 0;
    for (const side of ['L', 'R'] as const) {
      const elevation = angle(this.rest.get(`upper_arm.${side}`)!);
      maximumRaise = Math.max(maximumRaise, elevation);
      constrain(this.rest.get(`forearm.${side}`)!, this.maximumElbowBend(elevation));
    }
    constrain(this.rest.get('head')!, this.maximumHeadEnvelope(maximumRaise));
  }

  dispose(): void {
    this.resetPose(true);
    this.disposed = true;
    this.poseBuffer.dispose();
    this.ikEnabled = false;
    this.ikWeight = 0;
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
