import { MathUtils, Vector3 } from 'three';
import type { RabbitArmIKResult } from './RabbitArmIK';

/** Projects a requested wrist point onto the fixed-length shoulder sweep. */
export class RabbitShoulderArm {
  private readonly axis = new Vector3();
  private readonly point = new Vector3();

  constructor(private readonly restOffset: Vector3, private readonly sign: number,
    private readonly maximumRaise: number) {}

  forward(raise: number, plane: number, out: Vector3): Vector3 {
    const angle = MathUtils.degToRad(plane);
    this.axis.set(-Math.sin(angle), 0, this.sign * Math.cos(angle));
    return out.copy(this.restOffset).applyAxisAngle(this.axis, MathUtils.degToRad(raise));
  }

  solve(target: Vector3, requestedRaise: number, requestedPlane: number): RabbitArmIKResult {
    let raise = requestedRaise;
    let plane = requestedPlane;
    let distance = this.forward(raise, plane, this.point).distanceToSquared(target);
    let iterations = 1;
    const test = (candidateRaise: number, candidatePlane: number) => {
      candidateRaise = MathUtils.clamp(candidateRaise, 0, this.maximumRaise);
      candidatePlane = MathUtils.clamp(candidatePlane, 0, 90);
      const residual = this.forward(candidateRaise, candidatePlane, this.point).distanceToSquared(target);
      iterations++;
      if (residual < distance) {
        raise = candidateRaise;
        plane = candidatePlane;
        distance = residual;
      }
    };
    // The assisted contact normally starts near its sampled planting pose.
    // A coarse sweep and local refinement also handle off-sphere requests.
    if (distance > 1e-12) {
      for (let r = 0; r <= 6; r++) {
        for (let p = 0; p <= 6; p++) test(r * this.maximumRaise / 6, p * 15);
      }
      for (let step = 8; step >= .0625; step /= 2) {
        const r = raise, p = plane;
        for (const dr of [-step, 0, step]) {
          for (const dp of [-step, 0, step]) if (dr !== 0 || dp !== 0) test(r + dr, p + dp);
        }
      }
    }
    return { raise, plane, elbow: 0, residual: Math.sqrt(distance), clamped: distance > 1e-8, valid: true, iterations };
  }
}
