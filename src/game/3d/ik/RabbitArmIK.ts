import { MathUtils, Vector3 } from 'three';
import { rabbitRaiseLimit, type RabbitRaiseLimitCurve, type RabbitRigLimits } from '../rabbit3dConfig';

export interface RabbitArmAngles { raise: number; elbow: number; plane: number }
export interface RabbitArmIKResult extends RabbitArmAngles {
  residual: number;
  clamped: boolean;
  valid: boolean;
  iterations: number;
}

const radians = MathUtils.degToRad;
const finite = (value: number) => Number.isFinite(value) ? value : 0;
const bounded = (value: number, minimum: number, maximum: number) => MathUtils.clamp(finite(value), minimum, maximum);
const finitePoint = (value: Vector3) => Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);

/** Hand-position IK restricted to V3's tested shoulder/hinge manifold. */
export class RabbitArmIK {
  private readonly upper: Vector3;
  private readonly lower: Vector3;
  private readonly point = new Vector3();
  private readonly target = new Vector3();
  private readonly prior = { raise: 0, elbow: 0, plane: 0 };
  private readonly result: RabbitArmIKResult = {
    raise: 0, elbow: 0, plane: 0, residual: 0, clamped: false, valid: true, iterations: 0,
  };
  private readonly maximumReach: number;
  private bestCost = Infinity;
  private bestRaise = 0;
  private bestElbow = 0;
  private bestPlane = 0;
  private evaluations = 0;
  private solved = false;

  constructor(upperRest: Vector3, lowerRest: Vector3, private readonly sideSign: number,
    private readonly elbowCurve: RabbitRaiseLimitCurve, private readonly limits: RabbitRigLimits) {
    if (!finitePoint(upperRest) || !finitePoint(lowerRest) || upperRest.length() < 1e-6
      || lowerRest.length() < 1e-6 || ![1, -1].includes(sideSign)) throw new Error('Invalid Rabbit arm rest chain');
    this.upper = upperRest.clone();
    this.lower = lowerRest.clone();
    this.maximumReach = this.upper.length() + this.lower.length();
  }

  /** Relative shoulder-to-hand target; coupling is intentionally applied by solve(). */
  forward(raise: number, elbow: number, plane: number, out: Vector3): Vector3 {
    const elevation = radians(bounded(raise, this.limits.arm.min, this.limits.arm.max));
    const flexion = radians(bounded(elbow, this.limits.forearm.min, this.limits.forearm.max));
    const azimuth = radians(bounded(plane, 0, 90));
    const flexCos = Math.cos(flexion), flexSin = Math.sin(flexion);
    const x = this.upper.x + this.lower.x;
    const y = this.upper.y + this.lower.y * flexCos + this.lower.z * flexSin;
    const z = this.upper.z - this.lower.y * flexSin + this.lower.z * flexCos;
    const ax = -Math.sin(azimuth), az = this.sideSign * Math.cos(azimuth);
    const cos = Math.cos(elevation), sin = Math.sin(elevation), dot = ax * x + az * z;
    return out.set(x * cos - az * y * sin + ax * dot * (1 - cos),
      y * cos + (az * x - ax * z) * sin,
      z * cos + ax * y * sin + az * dot * (1 - cos));
  }

  /** Reuses its result object; callers retaining a snapshot should copy it. */
  solve(target: Vector3, seed?: RabbitArmAngles): RabbitArmIKResult {
    if (!finitePoint(target) || target.length() > this.maximumReach * 1e6) {
      this.result.valid = false;
      this.result.clamped = true;
      this.result.iterations = 0;
      return this.result;
    }
    this.target.copy(target);
    this.evaluations = 0;
    this.bestCost = Infinity;
    this.prior.raise = this.result.raise;
    this.prior.elbow = this.result.elbow;
    this.prior.plane = this.result.plane;
    const requestedRaise = bounded(seed?.raise ?? this.result.raise, this.limits.arm.min, this.limits.arm.max);
    const requestedElbow = bounded(seed?.elbow ?? this.result.elbow, this.limits.forearm.min, this.limits.forearm.max);
    const requestedPlane = bounded(seed?.plane ?? this.result.plane, 0, 90);
    this.consider(requestedRaise, requestedElbow, requestedPlane);
    // Exact feasible human-derived targets need no iterative work.
    if (this.point.distanceToSquared(this.target) > 1e-16) {
      const radialElbow = this.analyticSeed();
      if (this.point.distanceToSquared(this.target) > 1e-16) {
        this.refine();
        if (this.solved) {
          this.consider(this.prior.raise, this.prior.elbow, this.prior.plane);
          this.refine();
        }
        for (let raise = this.limits.arm.min; raise < this.limits.arm.max; raise += 30) {
          for (let plane = 0; plane <= 90; plane += 30) {
            this.consider(raise, radialElbow, plane);
            this.consider(raise, 0, plane);
            this.consider(raise, this.elbowLimit(raise), plane);
          }
        }
        for (const [raise] of this.elbowCurve) {
          for (let plane = 0; plane <= 90; plane += 30) this.consider(raise, radialElbow, plane);
        }
        this.refine();
      }
    }
    this.forward(this.bestRaise, this.bestElbow, this.bestPlane, this.point);
    this.result.raise = this.bestRaise;
    this.result.elbow = this.bestElbow;
    this.result.plane = this.bestPlane;
    this.result.residual = this.point.distanceTo(this.target);
    this.result.clamped = this.result.residual > 1e-4 || (seed !== undefined
      && (Math.abs(requestedRaise - finite(seed.raise)) > 1e-8
        || Math.abs(requestedElbow - finite(seed.elbow)) > 1e-8
        || Math.abs(requestedPlane - finite(seed.plane)) > 1e-8
        || requestedElbow > this.elbowLimit(requestedRaise) + 1e-8));
    this.result.valid = true;
    this.result.iterations = this.evaluations;
    this.solved = true;
    return this.result;
  }

  reset(): void {
    this.result.raise = this.result.elbow = this.result.plane = this.result.residual = 0;
    this.result.clamped = false;
    this.result.valid = true;
    this.result.iterations = 0;
    this.solved = false;
  }

  private elbowLimit(raise: number): number {
    return Math.min(this.limits.forearm.max, rabbitRaiseLimit(this.elbowCurve, Math.max(0, raise)));
  }

  private analyticSeed(): number {
    // The fixed X hinge preserves the X components of the measured rest segments.
    const a = this.upper.y * this.lower.y + this.upper.z * this.lower.z;
    const b = this.upper.y * this.lower.z - this.upper.z * this.lower.y;
    const c = (this.target.lengthSq() - this.upper.lengthSq() - this.lower.lengthSq()) * .5
      - this.upper.x * this.lower.x;
    const radius = Math.hypot(a, b);
    const flexion = radius > 1e-12
      ? Math.acos(MathUtils.clamp(c / radius, -1, 1)) + Math.atan2(b, a) : 0;
    const elbow = bounded(MathUtils.radToDeg(flexion), this.limits.forearm.min, this.limits.forearm.max);
    const cos = Math.cos(radians(elbow)), sin = Math.sin(radians(elbow));
    const x = this.upper.x + this.lower.x;
    const y = this.upper.y + this.lower.y * cos + this.lower.z * sin;
    const z = this.upper.z - this.lower.y * sin + this.lower.z * cos;
    let plane = MathUtils.radToDeg(Math.atan2(this.target.z - z, this.sideSign * (this.target.x - x)));
    if (plane < 0) plane += 180;
    plane = bounded(plane, 0, 90);
    const ax = -Math.sin(radians(plane)), az = this.sideSign * Math.cos(radians(plane));
    const fromAxis = ax * x + az * z;
    const toAxis = ax * this.target.x + az * this.target.z;
    const cross = ax * (y * this.target.z - z * this.target.y)
      + az * (x * this.target.y - y * this.target.x);
    const dot = x * this.target.x + y * this.target.y + z * this.target.z - fromAxis * toAxis;
    const raise = MathUtils.radToDeg(Math.atan2(cross, dot));
    this.consider(raise, elbow, plane);
    return elbow;
  }

  private consider(raise: number, elbow: number, plane: number): void {
    raise = bounded(raise, this.limits.arm.min, this.limits.arm.max);
    elbow = bounded(elbow, this.limits.forearm.min, this.elbowLimit(raise));
    plane = bounded(plane, 0, 90);
    this.forward(raise, elbow, plane, this.point);
    this.evaluations++;
    const priorDistance = ((raise - this.prior.raise) ** 2 + (elbow - this.prior.elbow) ** 2
      + (plane - this.prior.plane) ** 2) / (180 * 180);
    const cost = this.point.distanceToSquared(this.target) + priorDistance * 1e-10;
    if (cost < this.bestCost - 1e-15) {
      this.bestCost = cost;
      this.bestRaise = raise;
      this.bestElbow = elbow;
      this.bestPlane = plane;
    }
  }

  private refine(): void {
    for (let step = 15; step >= .058; step *= .5) {
      for (let sweep = 0; sweep < 4; sweep++) {
        const raise = this.bestRaise, elbow = this.bestElbow, plane = this.bestPlane;
        this.consider(raise - step, elbow, plane);
        this.consider(raise + step, elbow, plane);
        this.consider(this.bestRaise, this.bestElbow - step, this.bestPlane);
        this.consider(this.bestRaise, this.bestElbow + step, this.bestPlane);
        this.consider(this.bestRaise, this.bestElbow, this.bestPlane - step);
        this.consider(this.bestRaise, this.bestElbow, this.bestPlane + step);
        if (raise === this.bestRaise && elbow === this.bestElbow && plane === this.bestPlane) break;
      }
    }
  }
}
