import { landmarkConfidence } from '../vision/poseMath';
import type { PoseFrame } from '../vision/poseTypes';

export interface BerryMotionSample {
  leftLegExtensionAmount: number;
  rightLegExtensionAmount: number;
  lateralOffset: number;
  reliable: boolean;
  timestampMs: number;
}

export const LEG_EXTENSION_CONFIG = {
  confidence: 0.55,
  referenceFrames: 3,
  maximumGapMs: 500,
  deadzoneLegLengths: 0.07,
  fullExtensionLegLengths: 0.28,
  maximumSupportOffset: 0.17,
  maximumLeanDegrees: 25,
  lateralFullScaleLegLengths: 0.45,
  smoothingMs: 70,
} as const;

const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const neutral = (timestampMs: number): BerryMotionSample => ({
  leftLegExtensionAmount: 0, rightLegExtensionAmount: 0, lateralOffset: 0,
  reliable: false, timestampMs,
});

/** Ephemeral, body-relative geometry; never requests or persists a personal pose. */
export class LegExtensionDetector {
  private lastTimestamp?: number;
  private lastReliableTimestamp?: number;
  private reference?: { center: number; scale: number; direction: number };
  private centers: number[] = [];
  private scales: number[] = [];
  private filtered = neutral(0);

  reset(): void {
    this.lastTimestamp = undefined;
    this.lastReliableTimestamp = undefined;
    this.reference = undefined;
    this.centers = [];
    this.scales = [];
    this.filtered = neutral(0);
  }

  update(frame: PoseFrame): BerryMotionSample {
    const timestamp = frame.timestampMs;
    if (!Number.isFinite(timestamp) || timestamp < 0
      || (this.lastTimestamp !== undefined && timestamp <= this.lastTimestamp)) return neutral(timestamp);
    if (this.lastTimestamp !== undefined && timestamp - this.lastTimestamp > LEG_EXTENSION_CONFIG.maximumGapMs) this.reset();
    const dt = this.lastTimestamp === undefined ? 33 : timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;
    const fail = () => {
      this.centers = [];
      this.scales = [];
      this.filtered = neutral(timestamp);
      if (this.lastReliableTimestamp !== undefined
        && timestamp - this.lastReliableTimestamp > LEG_EXTENSION_CONFIG.maximumGapMs) this.reference = undefined;
      return neutral(timestamp);
    };
    const points = frame.landmarks;
    const width = frame.imageWidth ?? 1;
    const height = frame.imageHeight ?? 1;
    const ids = [11, 12, 23, 24, 25, 26, 27, 28];
    if (!points || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
      || ids.some(id => landmarkConfidence(points[id]) < LEG_EXTENSION_CONFIG.confidence)) return fail();
    const p = (id: number) => ({ x: points[id].x * width / height, y: points[id].y });
    const ls = p(11), rs = p(12), lh = p(23), rh = p(24);
    const lk = p(25), rk = p(26), la = p(27), ra = p(28);
    const distance = (a: typeof lh, b: typeof lh) => Math.hypot(a.x - b.x, a.y - b.y);
    const leftLength = distance(lh, lk) + distance(lk, la);
    const rightLength = distance(rh, rk) + distance(rk, ra);
    const scale = (leftLength + rightLength) / 2;
    const center = (lh.x + rh.x) / 2;
    const shoulderCenter = (ls.x + rs.x) / 2;
    const torsoHeight = (lh.y + rh.y - ls.y - rs.y) / 2;
    const direction = Math.sign(lh.x - rh.x);
    if (scale < 0.06 || torsoHeight <= 0 || direction === 0
      || Math.sign(ls.x - rs.x) !== direction
      || Math.abs(lh.x - rh.x) / scale < 0.08
      || Math.abs(ls.x - rs.x) / scale < 0.12
      || Math.abs(Math.atan2(center - shoulderCenter, torsoHeight) * 180 / Math.PI) > LEG_EXTENSION_CONFIG.maximumLeanDegrees
      || Math.abs(lh.y - rh.y) / scale > 0.15
      || Math.abs(la.y - ra.y) / scale > 0.28
      || Math.min(la.y - lh.y, ra.y - rh.y) / scale < 0.55
      || Math.min(leftLength, rightLength) / Math.max(leftLength, rightLength) < 0.65) return fail();

    // Own-hip subtraction cancels whole-body translation. Opposite-leg support rejects wide unstable poses.
    const leftOut = direction * (la.x - lh.x) / scale;
    const rightOut = -direction * (ra.x - rh.x) / scale;
    const leftKneeOut = direction * (lk.x - lh.x) / scale;
    const rightKneeOut = -direction * (rk.x - rh.x) / scale;
    if (leftOut < -0.15 || rightOut < -0.15
      || (leftOut > LEG_EXTENSION_CONFIG.maximumSupportOffset && rightOut > LEG_EXTENSION_CONFIG.maximumSupportOffset)
      || (leftOut > 0.12 && (leftKneeOut < -0.05 || leftKneeOut > leftOut + 0.12))
      || (rightOut > 0.12 && (rightKneeOut < -0.05 || rightKneeOut > rightOut + 0.12))) return fail();
    if (this.reference && (this.reference.direction !== direction
      || Math.abs(scale / this.reference.scale - 1) > 0.35)) {
      this.reference = undefined;
      return fail();
    }
    this.lastReliableTimestamp = timestamp;
    if (!this.reference) {
      if (this.centers.length && (Math.abs(center - this.centers[0]) / scale > 0.12
        || Math.abs(scale / this.scales[0] - 1) > 0.15)) {
        this.centers = [];
        this.scales = [];
      }
      this.centers.push(center);
      this.scales.push(scale);
      if (this.centers.length < LEG_EXTENSION_CONFIG.referenceFrames) return neutral(timestamp);
      this.reference = {
        center: this.centers.reduce((sum, value) => sum + value, 0) / this.centers.length,
        scale: this.scales.reduce((sum, value) => sum + value, 0) / this.scales.length,
        direction,
      };
      this.centers = [];
      this.scales = [];
    }
    const amount = (outward: number) => clamp((outward - LEG_EXTENSION_CONFIG.deadzoneLegLengths)
      / (LEG_EXTENSION_CONFIG.fullExtensionLegLengths - LEG_EXTENSION_CONFIG.deadzoneLegLengths));
    const target = {
      leftLegExtensionAmount: amount(leftOut), rightLegExtensionAmount: amount(rightOut),
      lateralOffset: clamp(-direction * (center - this.reference.center)
        / (this.reference.scale * LEG_EXTENSION_CONFIG.lateralFullScaleLegLengths), -1, 1),
    };
    const alpha = 1 - Math.exp(-dt / LEG_EXTENSION_CONFIG.smoothingMs);
    for (const key of ['leftLegExtensionAmount', 'rightLegExtensionAmount', 'lateralOffset'] as const) {
      this.filtered[key] += (target[key] - this.filtered[key]) * alpha;
    }
    this.filtered.reliable = true;
    this.filtered.timestampMs = timestamp;
    return { ...this.filtered };
  }
}
