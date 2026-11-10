import { MathUtils, Vector3 } from 'three';

const finiteVector = (value: Vector3) => Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);

export interface TwoBoneIKResult {
  readonly joint: Vector3;
  readonly end: Vector3;
  residual: number;
  bendRadians: number;
  clamped: boolean;
  valid: boolean;
}

/** Analytic position solver. The pole is a direction in the same space as the endpoints. */
export class TwoBoneIK {
  private readonly direction = new Vector3();
  private readonly pole = new Vector3();
  private readonly fallback = new Vector3();
  readonly result: TwoBoneIKResult = {
    joint: new Vector3(), end: new Vector3(), residual: 0, bendRadians: 0, clamped: false, valid: true,
  };

  solve(start: Vector3, target: Vector3, poleDirection: Vector3, upperLength: number,
    lowerLength: number, maximumBendRadians = Math.PI): TwoBoneIKResult {
    const result = this.result;
    if (!finiteVector(start) || !finiteVector(target) || !finiteVector(poleDirection)
      || !Number.isFinite(upperLength) || !Number.isFinite(lowerLength)
      || upperLength <= 1e-8 || lowerLength <= 1e-8 || !Number.isFinite(upperLength ** 2 + lowerLength ** 2)
      || !Number.isFinite(maximumBendRadians)) {
      result.joint.set(0, 0, 0); result.end.set(0, 0, 0);
      result.residual = 0; result.bendRadians = 0; result.clamped = true; result.valid = false;
      return result;
    }
    const maximumBend = MathUtils.clamp(maximumBendRadians, 0, Math.PI);
    const minimumReach = Math.max(1e-8, Math.sqrt(Math.max(0,
      upperLength ** 2 + lowerLength ** 2 + 2 * upperLength * lowerLength * Math.cos(maximumBend))));
    const maximumReach = upperLength + lowerLength;
    this.direction.subVectors(target, start);
    const requestedReach = Math.hypot(this.direction.x, this.direction.y, this.direction.z);
    if (requestedReach > 1e-8) this.direction.multiplyScalar(1 / requestedReach);
    else this.direction.set(0, -1, 0);
    const reach = MathUtils.clamp(requestedReach, minimumReach, maximumReach);
    this.pole.copy(poleDirection).addScaledVector(this.direction, -poleDirection.dot(this.direction));
    if (this.pole.lengthSq() < 1e-12) {
      this.fallback.set(Math.abs(this.direction.x) < .8 ? 1 : 0, Math.abs(this.direction.x) < .8 ? 0 : 1, 0);
      this.pole.copy(this.fallback).addScaledVector(this.direction, -this.fallback.dot(this.direction));
    }
    this.pole.normalize();
    const along = (reach ** 2 + upperLength ** 2 - lowerLength ** 2) / (2 * reach);
    const height = Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2));
    result.end.copy(start).addScaledVector(this.direction, reach);
    result.joint.copy(start).addScaledVector(this.direction, along).addScaledVector(this.pole, height);
    result.bendRadians = Math.acos(MathUtils.clamp((reach ** 2 - upperLength ** 2 - lowerLength ** 2)
      / (2 * upperLength * lowerLength), -1, 1));
    result.residual = Math.abs(requestedReach - reach);
    result.clamped = result.residual > 1e-8;
    result.valid = true;
    return result;
  }
}
