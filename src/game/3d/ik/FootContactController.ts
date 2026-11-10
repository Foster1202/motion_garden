import { MathUtils, Quaternion, Vector3 } from 'three';

export type IKSide = 'L' | 'R';

/** Persistent model-space sole contacts. Targets are absolute, never accumulated frame deltas. */
export class FootContactController {
  private readonly anchors: Record<IKSide, Vector3>;
  private readonly targets: Record<IKSide, Vector3>;
  private readonly offsets: Record<IKSide, Vector3>;

  constructor(ankles: Record<IKSide, Vector3>, soleHeights: Record<IKSide, number>) {
    this.offsets = { L: new Vector3(0, soleHeights.L - ankles.L.y, 0),
      R: new Vector3(0, soleHeights.R - ankles.R.y, 0) };
    this.anchors = { L: ankles.L.clone().add(this.offsets.L), R: ankles.R.clone().add(this.offsets.R) };
    this.targets = { L: this.anchors.L.clone(), R: this.anchors.R.clone() };
  }

  getTarget(side: IKSide, output: Vector3): Vector3 { return output.copy(this.targets[side]); }
  getAnchor(side: IKSide, output: Vector3): Vector3 { return output.copy(this.anchors[side]); }
  getAnkleTarget(side: IKSide, output: Vector3): Vector3 {
    return output.copy(this.targets[side]).sub(this.offsets[side]);
  }
  contactPosition(side: IKSide, ankle: Vector3, output: Vector3, rotationDelta?: Quaternion): Vector3 {
    const x = ankle.x, y = ankle.y, z = ankle.z;
    output.copy(this.offsets[side]);
    if (rotationDelta) output.applyQuaternion(rotationDelta);
    output.x += x; output.y += y; output.z += z;
    return output;
  }

  /** Independent targets permit small stance adjustments while keeping the rest ground plane. */
  setTarget(side: IKSide, target: Vector3): boolean {
    if (![target.x, target.y, target.z].every(Number.isFinite)) return false;
    const anchor = this.anchors[side];
    this.targets[side].set(MathUtils.clamp(target.x, anchor.x - .06, anchor.x + .06), anchor.y,
      MathUtils.clamp(target.z, anchor.z - .06, anchor.z + .06));
    return true;
  }

  reset(): void {
    this.targets.L.copy(this.anchors.L); this.targets.R.copy(this.anchors.R);
  }
}
