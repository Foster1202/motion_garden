import type { Group } from 'three';

export interface WorldMotionSample {
  centerX: number;
  bodyScale: number;
  torsoScale?: number;
  depthReliable?: boolean;
}

/** Moves the character's garden transform while keeping bone-space IK unchanged. */
export class RabbitWorldMotion {
  private readonly restPosition;
  private readonly restScale;
  private currentX = 0;
  private currentZ = 0;
  private targetX = 0;
  private targetZ = 0;
  private locked = false;
  private reliable = false;
  private depthReliable = false;
  private rejectionReason?: string;

  constructor(private readonly pivot: Group) {
    this.restPosition = pivot.position.clone();
    this.restScale = pivot.scale.clone();
  }

  update(deltaSeconds: number, sample?: WorldMotionSample, reference?: WorldMotionSample, movable = true): void {
    this.locked = !movable;
    this.reliable = false;
    this.depthReliable = false;
    this.rejectionReason = 'missing-motion-frame';
    if (this.locked) {
      this.targetX = this.currentX;
      this.targetZ = this.currentZ;
      this.rejectionReason = 'world-motion-locked';
      return;
    }
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    if (sample && reference) this.acceptSample(sample, reference);
    const step = Math.min(deltaSeconds, .05);
    const xDistance = this.targetX - this.currentX;
    const zDistance = this.targetZ - this.currentZ;
    this.currentX += Math.sign(xDistance) * Math.min(Math.abs(xDistance), 3 * step);
    this.currentZ += Math.sign(zDistance) * Math.min(Math.abs(zDistance), 2 * step);
    const scaleFactor = 1 + this.currentZ * .1;
    // Rabbit3D's floor pivot offsets the model's minimum Y; preserve that sole anchor when scaling.
    this.pivot.position.set(this.restPosition.x + this.currentX,
      this.restPosition.y * scaleFactor - this.currentZ * .4, this.restPosition.z + this.currentZ);
    this.pivot.scale.copy(this.restScale).multiplyScalar(scaleFactor);
  }

  reset(): void {
    this.currentX = this.currentZ = this.targetX = this.targetZ = 0;
    this.locked = this.reliable = false;
    this.depthReliable = false;
    this.rejectionReason = undefined;
    this.pivot.position.copy(this.restPosition);
    this.pivot.scale.copy(this.restScale);
  }

  snapshot() {
    return {
      offset: { x: this.currentX, y: -this.currentZ * .4, z: this.currentZ },
      target: { x: this.targetX, z: this.targetZ },
      normalizedLateral: this.targetX / 2.5,
      normalizedDepth: this.targetZ / 2,
      groundY: -this.currentZ * .4,
      scaleFactor: 1 + this.currentZ * .1,
      position: this.pivot.position.toArray(),
      scale: this.pivot.scale.toArray(),
      locked: this.locked, reliable: this.reliable,
      depthReliable: this.depthReliable, rejectionReason: this.rejectionReason,
    };
  }

  private acceptSample(sample: WorldMotionSample, reference: WorldMotionSample): void {
    const scales = [sample.bodyScale, reference.bodyScale];
    const optionalScales = [sample.torsoScale, reference.torsoScale];
    if (![sample.centerX, reference.centerX, ...scales].every(Number.isFinite)
      || scales.some(value => value < .025)
      || optionalScales.some(value => value !== undefined && (!Number.isFinite(value) || value < .02))) {
      this.rejectionReason = 'invalid-motion-dimensions';
      return;
    }
    const useTorso = sample.torsoScale !== undefined && reference.torsoScale !== undefined;
    const currentScale = useTorso ? sample.torsoScale! : sample.bodyScale;
    const referenceScale = useTorso ? reference.torsoScale! : reference.bodyScale;
    const ratio = currentScale / referenceScale;
    if (sample.depthReliable !== false && (ratio < .4 || ratio > 2.5)) {
      this.rejectionReason = 'depth-scale-ratio-out-of-range';
      return;
    }
    const lateral = -(sample.centerX - reference.centerX) / reference.bodyScale;
    this.targetX = normalize(lateral, .06, 1.1) * 2.5;
    this.reliable = true;
    if (sample.depthReliable === false) {
      this.rejectionReason = 'non-standing-depth';
      return;
    }
    const scaleDisagreement = Math.abs(ratio - sample.bodyScale / reference.bodyScale);
    if (useTorso && scaleDisagreement > .18) {
      this.rejectionReason = `depth-scale-disagreement ${scaleDisagreement.toFixed(3)} > 0.18`;
      return;
    }
    const depth = 1 - referenceScale / currentScale;
    this.targetZ = normalize(depth, .05, .35) * 2;
    this.depthReliable = true;
    this.rejectionReason = undefined;
  }
}

function normalize(value: number, deadzone: number, fullScale: number): number {
  return Math.sign(value) * Math.min(1, Math.max(0, Math.abs(value) - deadzone) / (fullScale - deadzone));
}
