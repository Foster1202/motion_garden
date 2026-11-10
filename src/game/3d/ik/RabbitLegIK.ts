import { Bone, MathUtils, Mesh, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { rabbitRigProfile, type RabbitBoneName } from '../rabbit3dConfig';
import { FootContactController, type IKSide } from './FootContactController';
import { TwoBoneIK } from './TwoBoneIK';

export interface RabbitLegContactSnapshot {
  target: number[];
  position: number[];
  contact: number[];
  error: number;
  kneeDegrees: number;
  clamped: boolean;
}
export interface RabbitLegIKSnapshot {
  left: RabbitLegContactSnapshot;
  right: RabbitLegContactSnapshot;
  rootClamped: boolean;
  maximumContactError: number;
}
interface LegRest {
  hip: Vector3; ankle: Vector3; upperDirection: Vector3; lowerDirection: Vector3;
  upperLength: number; lowerLength: number;
  upperOrientation: Quaternion; lowerOrientation: Quaternion; footOrientation: Quaternion;
  upperLocal: Quaternion; lowerLocal: Quaternion; footLocal: Quaternion;
}
const sides: readonly IKSide[] = ['L', 'R'];
const vector = () => new Vector3();

/** Solves a pose shadow after interpolation; only the caller commits the final rendered bones. */
export class RabbitLegIK {
  readonly contacts: FootContactController;
  private readonly rest: Record<IKSide, LegRest>;
  private readonly rootRest: Vector3;
  private readonly maximumKneeBend: number;
  private readonly analytic = new TwoBoneIK();
  private readonly point = vector();
  private readonly rootPoint = vector();
  private readonly displacement = vector();
  private readonly ankleTarget = vector();
  private readonly hip = vector();
  private readonly upperDirection = vector();
  private readonly lowerDirection = vector();
  private readonly pole = new Vector3(0, 0, 1);
  private readonly bendAxis = new Vector3(1, 0, 0);
  private readonly modelRotation = new Quaternion();
  private readonly parentRotation = new Quaternion();
  private readonly upperDelta = new Quaternion();
  private readonly lowerDelta = new Quaternion();
  private readonly desired = new Quaternion();
  private readonly current = new Quaternion();
  private readonly diagnostics: RabbitLegIKSnapshot = {
    left: { target: [0, 0, 0], position: [0, 0, 0], contact: [0, 0, 0], error: 0, kneeDegrees: 0, clamped: false },
    right: { target: [0, 0, 0], position: [0, 0, 0], contact: [0, 0, 0], error: 0, kneeDegrees: 0, clamped: false },
    rootClamped: false, maximumContactError: 0,
  };

  constructor(model: Object3D, bones: ReadonlyMap<RabbitBoneName, Bone>) {
    model.updateWorldMatrix(true, true);
    this.maximumKneeBend = MathUtils.degToRad(rabbitRigProfile(model).limits.knee * 2);
    const point = (name: RabbitBoneName) => model.worldToLocal(bones.get(name)!.getWorldPosition(vector()));
    const modelInverse = model.getWorldQuaternion(new Quaternion()).invert();
    const orientation = (name: RabbitBoneName) => modelInverse.clone().multiply(bones.get(name)!.getWorldQuaternion(new Quaternion())).normalize();
    const capture = (side: IKSide): LegRest => {
      const hip = point(`thigh.${side}`); const knee = point(`shin.${side}`); const ankle = point(`foot.${side}`);
      const upper = knee.clone().sub(hip); const lower = ankle.clone().sub(knee);
      return { hip, ankle, upperLength: upper.length(), lowerLength: lower.length(),
        upperDirection: upper.normalize(), lowerDirection: lower.normalize(),
        upperOrientation: orientation(`thigh.${side}`), lowerOrientation: orientation(`shin.${side}`),
        footOrientation: orientation(`foot.${side}`), upperLocal: bones.get(`thigh.${side}`)!.quaternion.clone(),
        lowerLocal: bones.get(`shin.${side}`)!.quaternion.clone(), footLocal: bones.get(`foot.${side}`)!.quaternion.clone() };
    };
    this.rest = { L: capture('L'), R: capture('R') };
    this.rootRest = point('root');
    const heights = { L: Infinity, R: Infinity };
    model.traverse(object => {
      if (!(object instanceof Mesh) || !object.name.startsWith('Rabbit_Leg_')) return;
      if (object instanceof SkinnedMesh) object.skeleton.update();
      const side = object.name.endsWith('L') ? 'L' : 'R';
      for (let index = 0; index < object.geometry.getAttribute('position').count; index++) {
        object.getVertexPosition(index, this.point).applyMatrix4(object.matrixWorld);
        model.worldToLocal(this.point); heights[side] = Math.min(heights[side], this.point.y);
      }
    });
    for (const side of sides) if (!Number.isFinite(heights[side])) heights[side] = this.rest[side].ankle.y;
    this.contacts = new FootContactController({ L: this.rest.L.ankle, R: this.rest.R.ankle }, heights);
  }

  solve(model: Object3D, bones: ReadonlyMap<RabbitBoneName, Bone>): RabbitLegIKSnapshot {
    model.updateWorldMatrix(true, true);
    const root = bones.get('root')!;
    model.worldToLocal(root.getWorldPosition(this.rootPoint));
    this.displacement.subVectors(this.rootPoint, this.rootRest);
    // Remove the FK fore/aft knee compensation; contact IK supplies the new support geometry.
    let kneeCompensationZ = 0;
    for (const side of sides) {
      const rest = this.rest[side];
      this.current.copy(bones.get(`shin.${side}`)!.quaternion).normalize();
      this.desired.copy(rest.lowerLocal).normalize();
      const angle = this.current.angleTo(this.desired) * .5;
      this.point.copy(rest.upperDirection).multiplyScalar(rest.upperLength).applyAxisAngle(this.bendAxis, -angle);
      this.ankleTarget.copy(rest.lowerDirection).multiplyScalar(rest.lowerLength).applyAxisAngle(this.bendAxis, angle);
      kneeCompensationZ -= (this.point.z - rest.upperDirection.z * rest.upperLength
        + this.ankleTarget.z - rest.lowerDirection.z * rest.lowerLength) * .5;
    }
    this.displacement.z -= kneeCompensationZ;
    const originalX = this.displacement.x, originalY = this.displacement.y, originalZ = this.displacement.z;
    this.displacement.x = MathUtils.clamp(this.displacement.x, -.12, .12);
    this.displacement.z = MathUtils.clamp(this.displacement.z, -.08, .08);
    let minimumY = -Infinity, maximumY = Infinity;
    for (const side of sides) {
      const rest = this.rest[side]; this.contacts.getAnkleTarget(side, this.ankleTarget);
      const dx = rest.hip.x + this.displacement.x - this.ankleTarget.x;
      const dz = rest.hip.z + this.displacement.z - this.ankleTarget.z;
      const horizontalSq = dx * dx + dz * dz;
      const maximumReach = rest.upperLength + rest.lowerLength;
      const minimumReachSq = rest.upperLength ** 2 + rest.lowerLength ** 2
        + 2 * rest.upperLength * rest.lowerLength * Math.cos(this.maximumKneeBend);
      minimumY = Math.max(minimumY, this.ankleTarget.y + Math.sqrt(Math.max(0, minimumReachSq - horizontalSq)) - rest.hip.y);
      maximumY = Math.min(maximumY, this.ankleTarget.y + Math.sqrt(Math.max(0, maximumReach ** 2 - horizontalSq)) - rest.hip.y);
    }
    this.displacement.y = MathUtils.clamp(this.displacement.y, minimumY, maximumY);
    this.diagnostics.rootClamped = Math.abs(originalX - this.displacement.x) > 1e-7
      || Math.abs(originalY - this.displacement.y) > 1e-7 || Math.abs(originalZ - this.displacement.z) > 1e-7;
    this.rootPoint.copy(this.rootRest).add(this.displacement);
    model.localToWorld(this.rootPoint);
    root.position.copy(root.parent ? root.parent.worldToLocal(this.rootPoint) : this.rootPoint);
    model.updateWorldMatrix(true, true);
    model.getWorldQuaternion(this.modelRotation);
    for (const side of sides) {
      const rest = this.rest[side]; const thigh = bones.get(`thigh.${side}`)!;
      const shin = bones.get(`shin.${side}`)!; const foot = bones.get(`foot.${side}`)!;
      model.worldToLocal(thigh.getWorldPosition(this.hip));
      this.contacts.getAnkleTarget(side, this.ankleTarget);
      const atRest = this.hip.distanceToSquared(rest.hip) < 1e-14 && this.ankleTarget.distanceToSquared(rest.ankle) < 1e-14;
      const result = this.analytic.solve(this.hip, this.ankleTarget, this.pole,
        rest.upperLength, rest.lowerLength, this.maximumKneeBend);
      if (atRest) {
        thigh.quaternion.copy(rest.upperLocal); shin.quaternion.copy(rest.lowerLocal); foot.quaternion.copy(rest.footLocal);
      } else {
        this.upperDirection.subVectors(result.joint, this.hip).normalize();
        this.lowerDirection.subVectors(result.end, result.joint).normalize();
        this.upperDelta.setFromUnitVectors(rest.upperDirection, this.upperDirection);
        this.desired.copy(this.upperDelta).multiply(rest.upperOrientation);
        this.applyModelOrientation(thigh, this.desired);
        this.point.copy(rest.lowerDirection).applyQuaternion(this.upperDelta);
        this.lowerDelta.setFromUnitVectors(this.point, this.lowerDirection);
        this.desired.copy(this.lowerDelta).multiply(this.upperDelta).multiply(rest.lowerOrientation);
        this.applyModelOrientation(shin, this.desired);
        this.applyModelOrientation(foot, rest.footOrientation);
      }
      model.updateWorldMatrix(true, true);
      model.worldToLocal(foot.getWorldPosition(this.point));
      const diagnostic = side === 'L' ? this.diagnostics.left : this.diagnostics.right;
      diagnostic.kneeDegrees = atRest ? 0 : MathUtils.radToDeg(result.bendRadians);
      diagnostic.clamped = result.clamped;
    }
    return this.measure(model, bones);
  }

  measure(model: Object3D, bones: ReadonlyMap<RabbitBoneName, Bone>): RabbitLegIKSnapshot {
    model.updateWorldMatrix(true, true);
    model.getWorldQuaternion(this.modelRotation).invert();
    for (const side of sides) {
      const foot = bones.get(`foot.${side}`)!;
      model.worldToLocal(foot.getWorldPosition(this.point));
      this.current.copy(this.modelRotation).multiply(foot.getWorldQuaternion(this.parentRotation));
      this.desired.copy(this.rest[side].footOrientation).invert();
      this.current.multiply(this.desired).normalize();
      const diagnostic = side === 'L' ? this.diagnostics.left : this.diagnostics.right;
      this.point.toArray(diagnostic.position);
      this.contacts.contactPosition(side, this.point, this.point, this.current).toArray(diagnostic.contact);
      this.current.copy(bones.get(`shin.${side}`)!.quaternion).normalize();
      this.desired.copy(this.rest[side].lowerLocal).normalize();
      diagnostic.kneeDegrees = MathUtils.radToDeg(this.current.angleTo(this.desired));
      this.contacts.getTarget(side, this.ankleTarget).toArray(diagnostic.target);
      diagnostic.error = this.point.distanceTo(this.ankleTarget);
    }
    this.diagnostics.maximumContactError = Math.max(this.diagnostics.left.error, this.diagnostics.right.error);
    return this.diagnostics;
  }

  reset(): void { this.contacts.reset(); }

  private applyModelOrientation(bone: Bone, orientation: Quaternion): void {
    if (bone.parent) bone.parent.getWorldQuaternion(this.parentRotation);
    else this.parentRotation.identity();
    this.parentRotation.invert();
    this.current.copy(this.modelRotation).multiply(orientation);
    bone.quaternion.copy(this.parentRotation).multiply(this.current).normalize();
    bone.updateWorldMatrix(false, true);
  }
}
