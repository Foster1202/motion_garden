import { BERRY_CONFIG } from '../berry/berryConfig';
import { calculateAngle, landmarkConfidence } from '../vision/poseMath';
import type { PoseFrame } from '../vision/poseTypes';
import type { TrackingMode } from '../vision/trackingMode';

type Side = 'left' | 'right';
type Sides<T> = Record<Side, T>;
type LegTracking = { mode: TrackingMode; reliable: boolean };

export interface BerryMotionSample {
  leftLegExtensionAmount: number;
  rightLegExtensionAmount: number;
  lateralOffset: number;
  lateralReliable: boolean;
  reliable: boolean;
  legTracking?: Sides<LegTracking>;
  timestampMs: number;
}

export const LEG_EXTENSION_CONFIG = {
  confidence: 0.55,
  referenceMs: 400,
  referenceFrames: 5,
  maximumGapMs: 300,
  recoveryFrames: 3,
  deadzoneLegLengths: 0.07,
  fullStandingOffset: 0.12,
  fullExtensionLegLengths: 0.28,
  maximumLeanDegrees: 25,
  lateralFullScaleLegLengths: 0.45,
  smoothingMs: 70,
  thighStartDegrees: 7,
  thighRetractDegrees: 4,
  thighFullDegrees: 15,
  thighStartOffset: .10,
  thighRetractOffset: .065,
  thighFullOffset: .24,
  thighStartHorizontal: .08,
  thighRetractHorizontal: .055,
  thighFullHorizontal: .21,
  thighHoldMs: 80,
  thighRetractMs: 100,
  partialLateralScale: 1.8,
} as const;

const C = LEG_EXTENSION_CONFIG;
const fullExtensionSpan = C.fullExtensionLegLengths - C.deadzoneLegLengths;
const qualifyingFullOffset = C.deadzoneLegLengths + BERRY_CONFIG.extensionThreshold * fullExtensionSpan;
const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const median = (values: number[]) => {
  const sorted = values.sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2;
};
const torsoIds = [11, 12, 23, 24];
const sides = ['left', 'right'] as const;
const perSide = <T>(measure: (side: Side) => T): Sides<T> => ({ left: measure('left'), right: measure('right') });
const opposite = (side: Side): Side => side === 'left' ? 'right' : 'left';

interface PoseGeometry { center: number; scale: number | null; direction: number }
interface Reference { center: number; scale: number; direction: number; aspect: number }
interface ThighPose { angle: number; offset: number; horizontal: number }
interface StandingFrame extends Reference { timestamp: number; thighs: Sides<ThighPose | undefined> }
interface KickMotion { mode: 'full' | 'partial'; amount: number; extended: boolean; retracted: boolean }
interface KickControl {
  mode: TrackingMode;
  ready: boolean;
  active: boolean;
  evidence?: 'extended' | 'retracted';
  since: number;
}
type ResetReason = 'camera-start' | 'manual';
type InterruptReason = 'stale' | 'paused' | 'invalid-timestamp' | 'torso-confidence' | 'torso-geometry' | 'direction-change' | 'lateral-jump' | 'standing-reference';

const idle = (timestampMs: number, lateralOffset = 0): BerryMotionSample => ({
  leftLegExtensionAmount: 0, rightLegExtensionAmount: 0, lateralOffset,
  lateralReliable: false, reliable: false,
  legTracking: perSide(() => ({ mode: 'lost', reliable: false })), timestampMs,
});

/** Keeps the standing origin for the camera session and measures kicks from the current leg geometry. */
export class LegExtensionDetector {
  private lastTimestamp?: number;
  private reference?: Reference;
  private current?: PoseGeometry;
  private candidates: StandingFrame[] = [];
  private thighReference = perSide<ThighPose | undefined>(() => undefined);
  private thighCandidates = perSide<{ pose: ThighPose; timestamp: number }[]>(() => []);
  private kick = perSide<KickControl>(() => ({ mode: 'lost', active: false, ready: false, since: 0 }));
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
    this.thighReference = perSide(() => undefined);
    this.current = undefined;
    this.lastCenter = undefined;
    this.resetReason = reason;
    this.interrupt('stale');
    this.rejection = undefined;
  }

  interrupt(reason: InterruptReason, timestamp = this.filtered.timestampMs): BerryMotionSample {
    this.candidates = [];
    this.thighCandidates = perSide(() => []);
    this.kick = perSide(() => ({ mode: 'lost', active: false, ready: false, since: timestamp }));
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
      legTracking: this.filtered.legTracking,
      legAmounts: { left: this.filtered.leftLegExtensionAmount, right: this.filtered.rightLegExtensionAmount },
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
    if (torsoHeight <= 0 || direction === 0 || Math.sign(shoulderWidth) !== direction
      || Math.abs(hipWidth) < torsoHeight * .15 || Math.abs(shoulderWidth) < torsoHeight * .2 || lean > 40) {
      return this.interrupt('torso-geometry', timestamp);
    }
    if (this.reference && direction !== this.reference.direction) return this.interrupt('direction-change', timestamp);

    const visiblePoint = (id: number) => landmarkConfidence(points[id]) >= C.confidence ? point(id) : undefined;
    const hips = { left: lh, right: rh };
    const knees = { left: visiblePoint(25), right: visiblePoint(26) };
    const ankles = { left: visiblePoint(27), right: visiblePoint(28) };
    const torsoLength = Math.hypot(torsoHeight, torsoShift);
    const thighs = perSide(side => measureThigh(hips[side], knees[side], torsoShift, torsoHeight,
      torsoLength, side === 'left' ? direction : -direction));
    const full = knees.left && knees.right && ankles.left && ankles.right
      ? measureLegs(lh, rh, knees.left, knees.right, ankles.left, ankles.right, direction, lean, hipWidth, shoulderWidth)
      : undefined;
    const kickStance = lean <= C.maximumLeanDegrees && Math.abs(lh.y - rh.y) / torsoLength <= .27;
    // The torso-only scale sets lateral travel sensitivity; it does not locate an ankle.
    const partialScale = torsoLength * C.partialLateralScale;
    this.current = { center, scale: full?.scale ?? partialScale, direction };
    const single = perSide(side => measureSingleLeg(hips[side], knees[side], ankles[side],
      side === 'left' ? direction : -direction, lean, hipWidth, shoulderWidth));
    const natural = perSide(side => {
      const thigh = thighs[side];
      return kickStance && thigh && isNaturalThigh(thigh)
        && (!ankles[side] || single[side]?.standing) ? thigh : undefined;
    });

    const acquiring = !this.reference;
    if (acquiring) {
      const hasStandingPose = full ? full.standing
        : sides.some(side => natural[side]) && sides.every(side => !knees[side] || !!natural[side]);
      if (!hasStandingPose) return this.interrupt('standing-reference', timestamp);
      this.acquireReference({ center, scale: full?.scale ?? partialScale, aspect, direction, timestamp, thighs: natural }, gap);
    }

    const reference = this.reference;
    if (!reference) {
      this.rejection = 'standing-reference';
      return idle(timestamp);
    }
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
    const motion = perSide(side => {
      this.acquireThighReference(side, natural[side], timestamp, gap);
      if (full) return full.valid ? fullMotion(side === 'left' ? full.leftOut : full.rightOut) : undefined;
      if (ankles[side]) {
        const leg = single[side];
        return kickStance && leg?.valid ? fullMotion(leg.outward) : undefined;
      }
      const thigh = thighs[side];
      const baseline = this.thighReference[side];
      const support = thighs[opposite(side)];
      const supportBaseline = this.thighReference[opposite(side)];
      const supportAngle = support ? support.angle - (supportBaseline?.angle ?? 0) : 0;
      const supportOffset = support ? support.offset - (supportBaseline?.offset ?? 0) : 0;
      if (!kickStance || !thigh || !baseline || thigh.angle < baseline.angle - 18
        || thigh.offset < baseline.offset - .24) return undefined;
      const estimate = partialMotion(thigh, baseline);
      if (!estimate.retracted && (Math.abs(supportAngle) > 13 || Math.abs(supportOffset) > .22)) return undefined;
      return estimate;
    });
    this.rejection = sides.some(side => motion[side]) ? undefined : 'leg-confidence-or-geometry';

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
    const left = this.updateKick('left', motion.left, this.filtered.leftLegExtensionAmount, alpha, timestamp, gap, acquiring);
    const right = this.updateKick('right', motion.right, this.filtered.rightLegExtensionAmount, alpha, timestamp, gap, acquiring);
    this.filtered = {
      leftLegExtensionAmount: left.amount,
      rightLegExtensionAmount: right.amount,
      lateralOffset: this.filtered.lateralOffset + (target - this.filtered.lateralOffset) * alpha,
      lateralReliable: true,
      reliable: left.tracking.reliable || right.tracking.reliable,
      legTracking: { left: left.tracking, right: right.tracking },
      timestampMs: timestamp,
    };
    return { ...this.filtered };
  }

  private updateKick(side: Side, motion: KickMotion | undefined, previous: number,
    alpha: number, timestamp: number, gap: number, acquiring: boolean): { amount: number; tracking: LegTracking } {
    const state = this.kick[side];
    const mode = motion?.mode ?? 'lost';
    if (state.mode !== mode) {
      state.mode = mode;
      state.ready = acquiring && !!motion?.retracted;
      state.active = previous > .15 && !!motion?.extended;
      state.evidence = undefined;
    }
    if (!motion) return { amount: 0, tracking: { mode, reliable: false } };

    const evidence = motion.retracted ? 'retracted' : motion.extended ? 'extended' : undefined;
    if (state.evidence !== evidence || gap > 150) {
      state.evidence = evidence;
      state.since = timestamp;
    }
    if (evidence === 'retracted' && timestamp - state.since >= C.thighRetractMs) {
      state.ready = true;
      state.active = false;
    }
    if (evidence === 'extended' && timestamp - state.since >= C.thighHoldMs) state.active = true;
    const target = motion.mode === 'full' ? motion.amount : state.active ? Math.max(.18, motion.amount) : 0;
    const amount = previous + (target - previous) * alpha;
    return { amount, tracking: { mode, reliable: state.ready } };
  }

  private acquireThighReference(side: Side, pose: ThighPose | undefined, timestamp: number, gap: number) {
    if (this.thighReference[side]) return;
    if (!pose) { this.thighCandidates[side] = []; return; }
    let samples = this.thighCandidates[side];
    if (gap > 150 || samples.some(sample => Math.abs(sample.pose.angle - pose.angle) > 5
      || Math.abs(sample.pose.offset - pose.offset) > .07 || Math.abs(sample.pose.horizontal - pose.horizontal) > .07)) samples = this.thighCandidates[side] = [];
    samples.push({ pose, timestamp });
    if (samples.length < C.referenceFrames || timestamp - samples[0].timestamp < C.referenceMs) return;
    this.thighReference[side] = medianThigh(samples.map(sample => sample.pose));
    this.thighCandidates[side] = [];
  }

  private acquireReference(candidate: StandingFrame, gap: number): void {
    const { center, scale, aspect, direction, timestamp } = candidate;
    const stable = gap <= 150 && this.candidates.every(sample => sample.direction === direction && sample.aspect === aspect
      && Math.abs(center - sample.center) < .08 * sample.scale / aspect
      && Math.abs(scale / sample.scale - 1) < .12);
    if (!stable) this.candidates = [];
    this.candidates.push(candidate);
    if (this.candidates.length >= C.referenceFrames && timestamp - this.candidates[0].timestamp >= C.referenceMs) {
      this.reference = { center: median(this.candidates.map(sample => sample.center)),
        scale: median(this.candidates.map(sample => sample.scale)), direction, aspect };
      for (const side of sides) {
        const samples = this.candidates.map(sample => sample.thighs[side]);
        if (samples.every(pose => pose !== undefined)) this.thighReference[side] = medianThigh(samples);
      }
      this.candidates = [];
    }
  }
}

type Point = { x: number; y: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const degrees = (radians: number) => radians * 180 / Math.PI;
const medianThigh = (poses: ThighPose[]) => ({ angle: median(poses.map(pose => pose.angle)),
  offset: median(poses.map(pose => pose.offset)), horizontal: median(poses.map(pose => pose.horizontal)) });

function measureThigh(hip: Point, knee: Point | undefined, torsoX: number, torsoY: number,
  torsoLength: number, direction: number): ThighPose | undefined {
  if (!knee) return undefined;
  const x = knee.x - hip.x, y = knee.y - hip.y;
  const length = Math.hypot(x, y) / torsoLength;
  const down = (x * torsoX + y * torsoY) / (torsoLength * torsoLength);
  const offset = direction * (x * torsoY - y * torsoX) / (torsoLength * torsoLength);
  if (length < .4 || length > 1.65 || down < .6 * length) return undefined;
  return { angle: degrees(Math.atan2(offset, down)), offset, horizontal: direction * x / torsoLength };
}

function isNaturalThigh(thigh: ThighPose) {
  return Math.abs(thigh.angle) <= 12 && Math.abs(thigh.offset) <= .19;
}

function fullMotion(outward: number): KickMotion {
  const { extensionThreshold } = BERRY_CONFIG;
  // A stance accepted for the reference must also be able to rearm the kick.
  const amount = outward >= qualifyingFullOffset ? clamp((outward - C.deadzoneLegLengths) / fullExtensionSpan)
    : extensionThreshold * clamp((outward - C.fullStandingOffset) / (qualifyingFullOffset - C.fullStandingOffset));
  return { mode: 'full', amount, extended: outward >= qualifyingFullOffset, retracted: outward <= C.fullStandingOffset };
}

function partialMotion(thigh: ThighPose, reference: ThighPose): KickMotion {
  const angle = thigh.angle - reference.angle;
  const offset = thigh.offset - reference.offset;
  const horizontal = thigh.horizontal - reference.horizontal;
  // Torso tilt alone can rotate a still thigh into apparent abduction.
  const amount = Math.min(clamp((angle - C.thighRetractDegrees) / (C.thighFullDegrees - C.thighRetractDegrees)),
    clamp((offset - C.thighRetractOffset) / (C.thighFullOffset - C.thighRetractOffset)),
    clamp((horizontal - C.thighRetractHorizontal) / (C.thighFullHorizontal - C.thighRetractHorizontal)));
  return { mode: 'partial', amount,
    extended: angle >= C.thighStartDegrees && offset >= C.thighStartOffset && horizontal >= C.thighStartHorizontal,
    retracted: angle <= C.thighRetractDegrees && offset <= C.thighRetractOffset && horizontal <= C.thighRetractHorizontal };
}

function measureSingleLeg(hip: Point, knee: Point | undefined, ankle: Point | undefined,
  direction: number, lean: number, hipWidth: number, shoulderWidth: number) {
  if (!knee || !ankle) return undefined;
  const scale = distance(hip, knee) + distance(knee, ankle);
  const outward = direction * (ankle.x - hip.x) / scale;
  const kneeOut = direction * (knee.x - hip.x) / scale;
  const valid = scale >= .06 && Math.abs(hipWidth) / scale >= .08 && Math.abs(shoulderWidth) / scale >= .12
    && lean <= C.maximumLeanDegrees && (ankle.y - hip.y) / scale >= .55 && outward >= -.15
    && (outward <= .12 || (kneeOut >= -.05 && kneeOut <= outward + .12));
  const standing = valid && Math.abs(outward) <= C.fullStandingOffset && (calculateAngle(hip, knee, ankle) ?? 0) >= 155;
  return { outward, valid, standing };
}

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
    && Math.min(leftOut, rightOut) < qualifyingFullOffset
    && (leftOut <= .12 || (leftKneeOut >= -.05 && leftKneeOut <= leftOut + .12))
    && (rightOut <= .12 || (rightKneeOut >= -.05 && rightKneeOut <= rightOut + .12));
  const standing = valid && Math.max(Math.abs(leftOut), Math.abs(rightOut)) <= C.fullStandingOffset
    && (calculateAngle(lh, lk, la) ?? 0) >= 155 && (calculateAngle(rh, rk, ra) ?? 0) >= 155;
  return { scale, leftOut, rightOut, valid, standing };
}
