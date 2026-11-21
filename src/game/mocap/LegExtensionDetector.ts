import { calculateAngle, landmarkConfidence } from '../vision/poseMath';
import type { PoseFrame } from '../vision/poseTypes';

export interface BerryMotionSample {
  leftLegExtensionAmount: number;
  rightLegExtensionAmount: number;
  lateralOffset: number;
  lateralReliable: boolean;
  reliable: boolean;
  timestampMs: number;
}

export const LEG_EXTENSION_CONFIG = {
  confidence: 0.55,
  referenceMs: 400,
  referenceFrames: 5,
  maximumGapMs: 300,
  recoveryFrames: 3,
  deadzoneLegLengths: 0.07,
  fullExtensionLegLengths: 0.28,
  maximumSupportOffset: 0.17,
  maximumLeanDegrees: 25,
  lateralFullScaleLegLengths: 0.45,
  smoothingMs: 70,
} as const;

const C = LEG_EXTENSION_CONFIG;
const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const median = (values: number[]) => {
  const sorted = values.sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2;
};
const torsoIds = [11, 12, 23, 24];
const legIds = [25, 26, 27, 28];

interface PoseGeometry { center: number; scale: number | null; direction: number }
interface Reference { center: number; scale: number; direction: number; aspect: number }
type ResetReason = 'camera-start' | 'manual';
type InterruptReason = 'stale' | 'paused' | 'invalid-timestamp' | 'torso-confidence' | 'torso-geometry' | 'direction-change' | 'lateral-jump' | 'standing-reference';

const idle = (timestampMs: number, lateralOffset = 0): BerryMotionSample => ({
  leftLegExtensionAmount: 0, rightLegExtensionAmount: 0, lateralOffset,
  lateralReliable: false, reliable: false, timestampMs,
});

/** Keeps the standing origin for the camera session and measures kicks from the current leg geometry. */
export class LegExtensionDetector {
  private lastTimestamp?: number;
  private reference?: Reference;
  private current?: PoseGeometry;
  private candidates: { center: number; scale: number; aspect: number; direction: number; timestamp: number }[] = [];
  private lastCenter?: number;
  private recentCenters: number[] = [];
  private recoveryCenter?: number;
  private recoveryFrames = 0;
  private resetReason: ResetReason = 'camera-start';
  private rejection?: InterruptReason | 'leg-confidence-or-geometry';
  private filtered = idle(0);

  reset(reason: ResetReason = 'manual'): void {
    this.lastTimestamp = undefined;
    this.reference = undefined;
    this.current = undefined;
    this.lastCenter = undefined;
    this.resetReason = reason;
    this.interrupt('stale');
    this.rejection = undefined;
  }

  interrupt(reason: InterruptReason, timestamp = this.filtered.timestampMs): BerryMotionSample {
    this.candidates = [];
    this.recentCenters = [];
    this.recoveryCenter = undefined;
    this.recoveryFrames = 0;
    this.rejection = reason;
    this.filtered = idle(timestamp, this.reference ? this.filtered.lateralOffset : 0);
    return { ...this.filtered };
  }

  get hasReference() { return this.reference !== undefined; }

  snapshot() {
    const referenceState = !this.reference ? 'acquiring' : this.filtered.lateralReliable ? 'tracking'
      : this.recoveryFrames ? 'recovering' : 'lost';
    return {
      referenceState, reference: this.reference ? { ...this.reference } : null,
      current: this.current ? { ...this.current } : null,
      referenceFrames: this.candidates.length, recoveryFrames: this.recoveryFrames,
      resetReason: this.resetReason, rejection: this.rejection ?? null,
    };
  }

  update(frame: PoseFrame): BerryMotionSample {
    const timestamp = frame.timestampMs;
    if (!Number.isFinite(timestamp) || timestamp < 0
      || (this.lastTimestamp !== undefined && timestamp <= this.lastTimestamp)) return this.interrupt('invalid-timestamp');
    const gap = this.lastTimestamp === undefined ? 33 : timestamp - this.lastTimestamp;
    const dt = Math.min(gap, 70);
    this.lastTimestamp = timestamp;
    if (gap >= C.maximumGapMs) this.interrupt('stale');

    const points = frame.landmarks;
    const aspect = (frame.imageWidth ?? 1) / (frame.imageHeight ?? 1);
    this.current = undefined;
    if (!points || !Number.isFinite(aspect) || aspect <= 0
      || (frame.imageWidth ?? 1) <= 0 || (frame.imageHeight ?? 1) <= 0
      || torsoIds.some(id => landmarkConfidence(points[id]) < C.confidence)) {
      return this.interrupt('torso-confidence', timestamp);
    }
    const point = (id: number) => ({ x: (points[id].x - .5) * aspect, y: points[id].y });
    const ls = point(11), rs = point(12), lh = point(23), rh = point(24);
    const center = (points[23].x + points[24].x) / 2;
    const torsoHeight = (lh.y + rh.y - ls.y - rs.y) / 2;
    const hipWidth = lh.x - rh.x;
    const shoulderWidth = ls.x - rs.x;
    const direction = Math.sign(hipWidth);
    const torsoShift = (lh.x + rh.x - ls.x - rs.x) / 2;
    const lean = Math.abs(Math.atan2(torsoShift, torsoHeight) * 180 / Math.PI);
    const legs = legIds.every(id => landmarkConfidence(points[id]) >= C.confidence)
      ? measureLegs(lh, rh, point(25), point(26), point(27), point(28), direction, lean, hipWidth, shoulderWidth) : undefined;
    this.current = { center, scale: legs?.scale ?? null, direction };
    if (torsoHeight <= 0 || direction === 0 || Math.sign(shoulderWidth) !== direction
      || Math.abs(hipWidth) < torsoHeight * .15 || Math.abs(shoulderWidth) < torsoHeight * .2 || lean > 40) {
      return this.interrupt('torso-geometry', timestamp);
    }
    if (this.reference && direction !== this.reference.direction) return this.interrupt('direction-change', timestamp);

    if (!this.reference) {
      if (!legs?.standing) return this.interrupt('standing-reference', timestamp);
      this.acquireReference({ center, scale: legs.scale, aspect, direction, timestamp }, gap);
      if (!this.reference) {
        this.rejection = 'standing-reference';
        return idle(timestamp);
      }
    }

    const reference = this.reference;
    const imageLegLength = reference.scale / reference.aspect;
    const jump = .24 * imageLegLength;
    if (this.filtered.lateralReliable && this.lastCenter !== undefined && Math.abs(center - this.lastCenter) > jump) {
      this.interrupt('lateral-jump', timestamp);
    }
    if (this.lastCenter !== undefined && !this.filtered.lateralReliable) {
      this.recoveryFrames = this.recoveryCenter !== undefined && Math.abs(center - this.recoveryCenter) <= jump
        ? this.recoveryFrames + 1 : 1;
      this.recoveryCenter = center;
      if (this.recoveryFrames < C.recoveryFrames) {
        this.filtered.timestampMs = timestamp;
        return { ...this.filtered };
      }
    }
    this.recoveryCenter = undefined;
    this.recoveryFrames = 0;
    this.lastCenter = center;
    this.rejection = legs?.valid ? undefined : 'leg-confidence-or-geometry';

    // Seed the window on acquisition or recovery, then reject isolated center spikes.
    if (!this.recentCenters.length) this.recentCenters = [center, center, center];
    this.recentCenters.shift();
    this.recentCenters.push(center);
    const filteredCenter = median([...this.recentCenters]);
    const lateral = -reference.direction * (filteredCenter - reference.center) / imageLegLength;
    const deadzone = .015;
    const target = clamp(Math.sign(lateral) * Math.max(0, Math.abs(lateral) - deadzone)
      / (C.lateralFullScaleLegLengths - deadzone), -1, 1);
    const alpha = 1 - Math.exp(-dt / C.smoothingMs);
    const kickAlpha = this.filtered.reliable ? alpha : 1;
    const approach = (value: number, outward: number) => {
      const amount = clamp((outward - C.deadzoneLegLengths) / (C.fullExtensionLegLengths - C.deadzoneLegLengths));
      return value + (amount - value) * kickAlpha;
    };
    this.filtered = {
      leftLegExtensionAmount: legs?.valid ? approach(this.filtered.leftLegExtensionAmount, legs.leftOut) : 0,
      rightLegExtensionAmount: legs?.valid ? approach(this.filtered.rightLegExtensionAmount, legs.rightOut) : 0,
      lateralOffset: this.filtered.lateralOffset + (target - this.filtered.lateralOffset) * alpha,
      lateralReliable: true,
      reliable: legs?.valid ?? false,
      timestampMs: timestamp,
    };
    return { ...this.filtered };
  }

  private acquireReference(candidate: Reference & { timestamp: number }, gap: number): void {
    const { center, scale, aspect, direction, timestamp } = candidate;
    const stable = gap <= 150 && this.candidates.every(sample => sample.direction === direction && sample.aspect === aspect
      && Math.abs(center - sample.center) < .08 * sample.scale / aspect
      && Math.abs(scale / sample.scale - 1) < .12);
    if (!stable) this.candidates = [];
    this.candidates.push(candidate);
    if (this.candidates.length >= C.referenceFrames && timestamp - this.candidates[0].timestamp >= C.referenceMs) {
      this.reference = { center: median(this.candidates.map(sample => sample.center)),
        scale: median(this.candidates.map(sample => sample.scale)), direction, aspect };
      this.candidates = [];
    }
  }
}

type Point = { x: number; y: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function measureLegs(lh: Point, rh: Point, lk: Point, rk: Point, la: Point, ra: Point,
  direction: number, lean: number, hipWidth: number, shoulderWidth: number) {
  const leftLength = distance(lh, lk) + distance(lk, la);
  const rightLength = distance(rh, rk) + distance(rk, ra);
  const scale = (leftLength + rightLength) / 2;
  const leftOut = direction * (la.x - lh.x) / scale;
  const rightOut = -direction * (ra.x - rh.x) / scale;
  const leftKneeOut = direction * (lk.x - lh.x) / scale;
  const rightKneeOut = -direction * (rk.x - rh.x) / scale;

  // The kick gate keeps the original support-leg checks independent of lateral tracking.
  const valid = scale >= .06 && Math.abs(hipWidth) / scale >= .08 && Math.abs(shoulderWidth) / scale >= .12
    && lean <= C.maximumLeanDegrees && Math.abs(lh.y - rh.y) / scale <= .15
    && Math.abs(la.y - ra.y) / scale <= .28 && Math.min(la.y - lh.y, ra.y - rh.y) / scale >= .55
    && Math.min(leftLength, rightLength) / Math.max(leftLength, rightLength) >= .65
    && leftOut >= -.15 && rightOut >= -.15
    && (leftOut <= C.maximumSupportOffset || rightOut <= C.maximumSupportOffset)
    && (leftOut <= .12 || (leftKneeOut >= -.05 && leftKneeOut <= leftOut + .12))
    && (rightOut <= .12 || (rightKneeOut >= -.05 && rightKneeOut <= rightOut + .12));
  const standing = valid && Math.max(Math.abs(leftOut), Math.abs(rightOut)) <= .12
    && (calculateAngle(lh, lk, la) ?? 0) >= 155 && (calculateAngle(rh, rk, ra) ?? 0) >= 155;
  return { scale, leftOut, rightOut, valid, standing };
}
