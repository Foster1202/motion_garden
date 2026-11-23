import type { BerryMotionSample } from './LegExtensionDetector';
import { validateMotionRange } from '../settings/motionRange';
import type { CalibrationProfile } from '../calibration/calibrationTypes';
import type { ArmReachPose, HumanPose } from './HumanPoseExtractor';
import { MOCAP_CONFIG as CONFIG } from './mocapConfig';
import { neutralRabbitPose, type RabbitPose } from './RabbitPose';

export interface MotionReference {
  centerX: number;
  bodyScale: number;
  torsoScale?: number;
  torsoLean: number;
  torsoForward: number;
  headYaw: number;
  headPitch: number;
  leftArmElevation: number;
  rightArmElevation: number;
  leftElbowBend: number;
  rightElbowBend: number;
  leftArmProjectedElevation?: number;
  rightArmProjectedElevation?: number;
  timestampMs: number;
}
export interface ReferenceCondition {
  name: string;
  value: number | undefined;
  limit: number;
  pass: boolean;
}
export interface MotionReferenceSnapshot {
  referenceReady: boolean;
  referenceProgress: number;
  message: string;
  requiresReset: boolean;
  rejectionReason?: string;
  conditions: readonly ReferenceCondition[];
  acceptedSamples: number;
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value);
const armKeys = ['leftArmElevation', 'rightArmElevation', 'leftElbowBend', 'rightElbowBend'] as const;
const shoulderKeys = ['leftArmElevation', 'rightArmElevation'] as const;
const depthKeys = ['torsoForward', 'headYaw', 'headPitch'] as const;
const projectedKeys = {
  leftArmElevation: 'leftArmProjectedElevation', rightArmElevation: 'rightArmProjectedElevation',
  leftElbowBend: 'leftElbowProjectedBend', rightElbowBend: 'rightElbowProjectedBend',
} as const;
const referenceAngle = (human: HumanPose, key: typeof armKeys[number]) => human[projectedKeys[key]] ?? human[key];
function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values.sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export class MotionRetargeter {
  private readonly armElevationLimit: number;

  constructor(private readonly maximumArmPlane = 90, private readonly gardenMovement = false,
    private readonly shoulderOnly = false, maximumArmElevation = CONFIG.limits.arm.max,
    private readonly allowMissingArms = false) {
    this.armElevationLimit = shoulderOnly && Number.isFinite(maximumArmElevation)
      ? clamp(maximumArmElevation, 0, CONFIG.limits.arm.max) : CONFIG.limits.arm.max;
  }

  retargetArmReach(human: ArmReachPose, reference: Pick<ArmReachPose, 'centerX' | 'shoulderWidth' | 'torsoLean'>) {
    const armLimit = Math.min(this.armElevationLimit, 90);
    const pose: RabbitPose = {
      ...neutralRabbitPose(human.timestampMs),
      leftArmElevation: (human.leftRaise ?? 0) * armLimit,
      rightArmElevation: (human.rightRaise ?? 0) * armLimit,
      torsoLean: clamp(human.torsoLean - reference.torsoLean, -CONFIG.limits.torsoLean, CONFIG.limits.torsoLean),
      trackingConfidence: human.trackingConfidence,
    };
    // The preview is mirrored. Anatomical shoulder labels stay unchanged.
    const x = clamp(-(human.centerX - reference.centerX) / (1.25 * reference.shoulderWidth), -1, 1);
    return { pose, x };
  }

  /** Berry motion already uses anatomical sides and normalized, mirrored root translation. */
  retargetLegMotion(sample: BerryMotionSample): BerryMotionSample {
    const finiteLateral = Number.isFinite(sample.lateralOffset);
    const lateralReliable = sample.lateralReliable && finiteLateral
      && Number.isFinite(sample.timestampMs) && sample.timestampMs >= 0;
    if (sample.legTracking) {
      const legTracking = { ...sample.legTracking };
      const amount = (side: 'left' | 'right') => {
        const measured = sample[`${side}LegExtensionAmount`];
        if (!lateralReliable || legTracking[side].mode === 'lost' || !Number.isFinite(measured)) {
          legTracking[side] = { mode: 'lost', reliable: false };
          return 0;
        }
        return clamp(measured, 0, 1);
      };
      const leftLegExtensionAmount = amount('left');
      const rightLegExtensionAmount = amount('right');
      return { ...sample, legTracking, leftLegExtensionAmount, rightLegExtensionAmount, lateralReliable,
        lateralOffset: finiteLateral ? clamp(sample.lateralOffset, -1, 1) : 0,
        reliable: legTracking.left.reliable || legTracking.right.reliable };
    }
    const valid = sample.reliable && lateralReliable
      && [sample.leftLegExtensionAmount, sample.rightLegExtensionAmount].every(Number.isFinite);
    return {
      leftLegExtensionAmount: valid ? clamp(sample.leftLegExtensionAmount, 0, 1) : 0,
      rightLegExtensionAmount: valid ? clamp(sample.rightLegExtensionAmount, 0, 1) : 0,
      lateralOffset: finiteLateral ? clamp(sample.lateralOffset, -1, 1) : 0,
      lateralReliable,
      reliable: valid, timestampMs: sample.timestampMs,
    };
  }

  private captured?: MotionReference;
  private samples: { pose: HumanPose; creditedMs: number }[] = [];
  private previousCandidateAccepted = false;
  private previousCandidateMs?: number;
  private recovery = { acceptedMs: 0, acceptedSamples: 0, previousAccepted: false,
    lastCandidateMs: undefined as number | undefined, lastAcceptedMs: undefined as number | undefined };
  private lastTarget = neutralRabbitPose();
  private profileKey?: string;
  private lastTimestamp?: number;
  private lastReliableArm: Partial<Record<'left' | 'right', number>> = {};
  private status: MotionReferenceSnapshot = this.initialStatus();

  get isReferenceReady(): boolean { return this.status.referenceReady; }
  get requiresReferenceReset(): boolean { return this.status.requiresReset; }
  get reference(): MotionReference | undefined { return this.captured && { ...this.captured }; }
  get snapshot(): MotionReferenceSnapshot { return { ...this.status, conditions: this.status.conditions.map(condition => ({ ...condition })) }; }

  rejectFrame(timestampMs: number, reason: string): void {
    const latest = Math.max(this.lastTimestamp ?? -Infinity, this.previousCandidateMs ?? -Infinity);
    if ((this.captured && !this.status.requiresReset) || !Number.isFinite(timestampMs) || timestampMs < 0 || timestampMs <= latest) return;
    this.lastTimestamp = timestampMs;
    if (this.captured) this.interruptRecovery(timestampMs, reason);
    else this.rejectCandidate(timestampMs, reason, []);
  }

  resetReference(): void {
    this.captured = undefined;
    this.clearSamples();
    this.clearRecovery();
    this.lastTarget = neutralRabbitPose();
    this.lastTimestamp = undefined;
    this.lastReliableArm = {};
    this.status = this.initialStatus();
  }

  update(human: HumanPose, profile: CalibrationProfile): RabbitPose | undefined {
    if (!validateMotionRange(profile)) return undefined;
    const key = JSON.stringify([profile.timestamp, profile.metric, profile.standingAngle, profile.range,
      profile.reliableSide ?? 'both', profile.partial]);
    if (key !== this.profileKey) { this.resetReference(); this.profileKey = key; }
    if (!Number.isFinite(human.timestampMs) || human.timestampMs < 0
      || (this.lastTimestamp !== undefined && human.timestampMs <= this.lastTimestamp)) {
      if (!this.captured) { this.clearSamples(); this.status = { ...this.initialStatus(), rejectionReason: 'invalid-or-non-increasing-timestamp' }; }
      if (this.status.requiresReset) this.clearRecovery();
      return undefined;
    }
    if (!this.valid(human, profile)) {
      if (!this.captured) this.rejectCandidate(human.timestampMs, 'invalid-human-pose', []);
      else if (this.status.requiresReset) {
        this.lastTimestamp = human.timestampMs;
        this.interruptRecovery(human.timestampMs, 'invalid-human-pose');
      }
      return undefined;
    }
    if (this.lastTimestamp !== undefined && human.timestampMs - this.lastTimestamp > CONFIG.reference.maximumSampleGapMs) {
      this.clearSamples();
      this.clearRecovery();
    }
    this.lastTimestamp = human.timestampMs;
    if (!this.captured && !this.capture(human, profile)) return undefined;
    const reference = this.captured!;
    if (!this.gardenMovement) {
      const scaleShift = Math.abs(human.bodyScale / reference.bodyScale - 1);
      const centerShift = Math.abs(human.centerX - reference.centerX) / reference.bodyScale;
      const conditions = [
        { name: 'camera-scale-shift-max', value: scaleShift, limit: CONFIG.reference.resetScaleFraction,
          pass: scaleShift <= CONFIG.reference.resetScaleFraction },
        { name: 'camera-center-shift-max', value: centerShift, limit: CONFIG.reference.resetCenterShoulderWidths,
          pass: centerShift <= CONFIG.reference.resetCenterShoulderWidths },
      ];
      const failed = conditions.find(condition => !condition.pass);
      if (failed) {
        this.clearRecovery();
        const reason = `${failed.name} ${failed.value.toFixed(2)} (limit ${failed.limit.toFixed(2)})`;
        this.status = { ...this.status, requiresReset: true, referenceProgress: 0, acceptedSamples: 0,
          conditions, rejectionReason: reason,
          message: `站位或鏡頭角度已明顯改變，${reason}。回到原來站位會自動回復，也可重設參考姿勢。` };
        return undefined;
      }
      if (this.status.requiresReset && !this.confirmReferenceReturn(human.timestampMs, conditions)) return undefined;
    }
    const target: RabbitPose = {
      ...this.lastTarget,
      // Raw positive lean moves toward mirrored screen left, matching model +Z roll.
      torsoLean: clamp(human.torsoLean - reference.torsoLean, -CONFIG.limits.torsoLean, CONFIG.limits.torsoLean),
      torsoForward: clamp((human.torsoForward ?? reference.torsoForward) - reference.torsoForward,
        -CONFIG.limits.torsoForward, CONFIG.limits.torsoForward),
      headYaw: clamp((human.headYaw ?? reference.headYaw) - reference.headYaw, -CONFIG.limits.headYaw, CONFIG.limits.headYaw),
      headPitch: clamp((human.headPitch ?? reference.headPitch) - reference.headPitch, -CONFIG.limits.headPitch, CONFIG.limits.headPitch),
      bendAmount: human.estimatedBendAmount ?? clamp((profile.standingAngle! - human.activeKneeAngle!) / profile.range!, 0, 1),
      lateralOffset: this.lateral(human.centerX, reference),
      trackingConfidence: clamp(human.trackingConfidence, 0, 1), timestampMs: human.timestampMs,
    };
    for (const side of ['left', 'right'] as const) {
      const elevation = `${side}ArmElevation` as const;
      const elbow = `${side}ElbowBend` as const;
      const plane = `${side}ArmPlane` as const;
      if (this.shoulderOnly) target[elbow] = 0;
      const reliable = human[`${side}ArmConfidence`] >= CONFIG.confidenceThreshold
        && finite(human[elevation]) && (this.shoulderOnly || finite(human[elbow]));
      if (reliable) {
        this.lastReliableArm[side] = human.timestampMs;
        const projected = `${side}ArmProjectedElevation` as const;
        const currentProjected = human[projected];
        const referenceProjected = reference[projected];
        const projectedChange = finite(currentProjected) && currentProjected >= 0 && currentProjected <= 180
          && finite(referenceProjected) && referenceProjected >= 0 && referenceProjected <= 180
          ? currentProjected - referenceProjected : 0;
        const depthChange = human[elevation]! - reference[elevation];
        target[elevation] = clamp(Math.max(depthChange, projectedChange), 0, this.armElevationLimit);
        target[plane] = clamp(human[plane] ?? 0, 0, this.shoulderOnly ? 90 : this.maximumArmPlane);
        target[elbow] = this.shoulderOnly ? 0 : clamp(human[elbow]! - reference[elbow], 0, CONFIG.limits.elbow.max);
      } else if (human.timestampMs - (this.lastReliableArm[side] ?? reference.timestampMs) > CONFIG.temporal.neutralAfterMs) {
        target[elevation] = 0;
        target[plane] = 0;
        target[elbow] = 0;
      }
    }
    this.lastTarget = target;
    return { ...target };
  }

  private valid(human: HumanPose, profile: CalibrationProfile): boolean {
    const activeKneeAngle = human.activeKneeAngle;
    const estimatedBendAmount = human.estimatedBendAmount;
    const usableBend = estimatedBendAmount === undefined
      ? profile.metric !== 'partial' && finite(activeKneeAngle) && activeKneeAngle >= 0 && activeKneeAngle <= 180
      : !!profile.partial && finite(estimatedBendAmount) && estimatedBendAmount >= 0 && estimatedBendAmount <= 1;
    return usableBend && [human.torsoLean, human.centerX, human.bodyScale,
      human.trackingConfidence, human.timestampMs, human.leftArmConfidence, human.rightArmConfidence].every(Number.isFinite)
      && human.timestampMs >= 0 && human.trackingConfidence >= CONFIG.confidenceThreshold && human.trackingConfidence <= 1
      && human.leftArmConfidence >= 0 && human.leftArmConfidence <= 1 && human.rightArmConfidence >= 0 && human.rightArmConfidence <= 1
      && Math.abs(human.torsoLean) < 80
      && human.centerX >= 0 && human.centerX <= 1 && human.bodyScale >= 0.025 && human.bodyScale <= 1
      && (human.torsoScale === undefined || (finite(human.torsoScale) && human.torsoScale >= .02))
      && (this.shoulderOnly ? shoulderKeys : armKeys)
        .every(key => human[key] === undefined || (finite(human[key]) && human[key]! >= 0 && human[key]! <= 180))
      && (['leftArmPlane', 'rightArmPlane'] as const).every(key => {
        const value = human[key];
        return value === undefined || (Number.isFinite(value) && value >= 0
          && value <= (this.maximumArmPlane > 90 ? 180 : 90));
      })
      && depthKeys.every(key => human[key] === undefined || (finite(human[key]) && Math.abs(human[key]!) < 80));
  }

  private clearSamples(): void {
    this.samples = [];
    this.previousCandidateAccepted = false;
    this.previousCandidateMs = undefined;
  }

  private capture(human: HumanPose, profile: CalibrationProfile): boolean {
    const elapsed = this.previousCandidateMs === undefined ? 0 : human.timestampMs - this.previousCandidateMs;
    this.previousCandidateMs = human.timestampMs;
    this.samples = this.samples.filter(sample => human.timestampMs - sample.pose.timestampMs <= CONFIG.reference.captureMs * 3);
    if (this.samples[0]) this.samples[0].creditedMs = 0;
    const standing = human.estimatedBendAmount === undefined
      ? { name: 'standing-knee-min', value: human.activeKneeAngle, limit: profile.standingThreshold!,
        pass: human.activeKneeAngle! >= profile.standingThreshold! }
      : { name: 'standing-bend-estimate-max', value: human.estimatedBendAmount, limit: .2,
        pass: human.estimatedBendAmount <= .2 + 1e-6 };
    const conditions: ReferenceCondition[] = [
      standing,
      { name: 'torso-lean-max', value: Math.abs(human.torsoLean), limit: CONFIG.reference.maximumLeanDegrees,
        pass: Math.abs(human.torsoLean) <= CONFIG.reference.maximumLeanDegrees },
    ];
    for (const side of ['left', 'right'] as const) {
      const confidence = human[`${side}ArmConfidence`];
      if (this.allowMissingArms && confidence < CONFIG.confidenceThreshold) continue;
      const length = human[`${side}ArmProjectedLength`];
      conditions.push({ name: `${side}-arm-confidence-min`, value: confidence, limit: CONFIG.confidenceThreshold,
        pass: confidence >= CONFIG.confidenceThreshold });
      conditions.push({ name: `${side}-projected-upper-length-min`, value: length, limit: CONFIG.reference.minimumProjectedArmLength,
        pass: length === undefined || length >= CONFIG.reference.minimumProjectedArmLength });
    }
    const referenceKeys = (this.shoulderOnly ? shoulderKeys : armKeys).filter(key =>
      !this.allowMissingArms || human[key.startsWith('left') ? 'leftArmConfidence' : 'rightArmConfidence'] >= CONFIG.confidenceThreshold);
    for (const key of referenceKeys) {
      const value = referenceAngle(human, key);
      const limit = key.includes('Elbow') ? CONFIG.reference.relaxedElbowDegrees : CONFIG.reference.relaxedArmDegrees;
      conditions.push({ name: `${projectedKeys[key]}-max`, value, limit, pass: finite(value) && value <= limit });
    }
    const natural = conditions.every(condition => condition.pass);
    if (natural && this.samples.length) {
      const center = median(this.samples.map(sample => sample.pose.centerX));
      const scale = median(this.samples.map(sample => sample.pose.bodyScale));
      const stable = [
        { name: 'center-spread-max', value: Math.abs(human.centerX - center) / scale,
          limit: CONFIG.reference.centerSpreadShoulderWidths },
        { name: 'scale-spread-max', value: Math.abs(human.bodyScale / scale - 1),
          limit: CONFIG.reference.scaleSpreadFraction },
        { name: 'torso-spread-max', value: Math.abs(human.torsoLean - median(this.samples.map(sample => sample.pose.torsoLean))),
          limit: CONFIG.reference.angularSpreadDegrees },
        ...referenceKeys.flatMap(key => {
          const previous = this.samples.map(sample => referenceAngle(sample.pose, key)).filter(finite);
          return previous.length ? [{ name: `${projectedKeys[key]}-spread-max`,
            value: Math.abs(referenceAngle(human, key)! - median(previous)), limit: CONFIG.reference.angularSpreadDegrees }] : [];
        }),
      ];
      conditions.push(...stable.map(condition => ({ ...condition, pass: condition.value <= condition.limit })));
    }
    const failed = conditions.find(condition => !condition.pass);
    if (failed) {
      const reason = `${failed.name} ${failed.value === undefined ? 'missing' : failed.value.toFixed(2)} (limit ${failed.limit.toFixed(2)})`;
      return this.rejectCandidate(human.timestampMs, reason, conditions);
    }
    const creditedMs = this.previousCandidateAccepted ? Math.min(elapsed, CONFIG.reference.maximumSampleGapMs) : 0;
    this.samples.push({ pose: human, creditedMs });
    this.previousCandidateAccepted = true;
    const acceptedMs = this.samples.reduce((sum, sample) => sum + sample.creditedMs, 0);
    const progress = Math.min(1, acceptedMs / CONFIG.reference.captureMs, this.samples.length / CONFIG.reference.minimumSamples);
    this.status = { referenceReady: false, referenceProgress: progress, requiresReset: false,
      acceptedSamples: this.samples.length, conditions,
      message: `正在記錄自然站立參考 ${Math.round(progress * 100)}%，請稍候。` };
    if (progress < 1) return false;
    const optionalValue = (key: keyof HumanPose) => {
      const values = this.samples.map(sample => sample.pose[key]).filter(finite);
      return values.length ? median(values) : undefined;
    };
    const value = (key: keyof HumanPose) => optionalValue(key) ?? 0;
    this.captured = {
      centerX: value('centerX'), bodyScale: value('bodyScale'), torsoScale: optionalValue('torsoScale'),
      torsoLean: value('torsoLean'),
      torsoForward: value('torsoForward'), headYaw: value('headYaw'), headPitch: value('headPitch'),
      leftArmElevation: value('leftArmElevation'), rightArmElevation: value('rightArmElevation'),
      leftElbowBend: this.shoulderOnly ? 0 : value('leftElbowBend'),
      rightElbowBend: this.shoulderOnly ? 0 : value('rightElbowBend'),
      leftArmProjectedElevation: optionalValue('leftArmProjectedElevation'),
      rightArmProjectedElevation: optionalValue('rightArmProjectedElevation'), timestampMs: human.timestampMs,
    };
    const acceptedSamples = this.samples.length;
    this.clearSamples();
    this.status = { referenceReady: true, referenceProgress: 1, requiresReset: false, acceptedSamples, conditions,
      message: '即時動作同步已就緒。' };
    return true;
  }

  private rejectCandidate(timestampMs: number, reason: string, conditions: readonly ReferenceCondition[]): false {
    this.previousCandidateAccepted = false;
    this.previousCandidateMs = timestampMs;
    const last = this.samples.at(-1)?.pose.timestampMs;
    if (last !== undefined && timestampMs - last > CONFIG.reference.maximumSampleGapMs) this.clearSamples();
    const progress = Math.min(1, this.samples.length / CONFIG.reference.minimumSamples,
      this.samples.reduce((sum, sample) => sum + sample.creditedMs, 0) / CONFIG.reference.captureMs);
    this.status = { ...this.initialStatus(), referenceProgress: progress,
      acceptedSamples: this.samples.length, conditions, rejectionReason: reason,
      message: `參考採集 ${Math.round(progress * 100)}% · ${reason}。請重新站穩、雙手放鬆，會自動繼續。` };
    return false;
  }

  private clearRecovery(): void {
    this.recovery = { acceptedMs: 0, acceptedSamples: 0, previousAccepted: false,
      lastCandidateMs: undefined, lastAcceptedMs: undefined };
  }

  private confirmReferenceReturn(timestampMs: number, conditions: readonly ReferenceCondition[]): boolean {
    const elapsed = this.recovery.lastCandidateMs === undefined ? 0 : timestampMs - this.recovery.lastCandidateMs;
    if (this.recovery.previousAccepted) this.recovery.acceptedMs += Math.min(elapsed, CONFIG.reference.maximumSampleGapMs);
    this.recovery.acceptedSamples++;
    this.recovery.previousAccepted = true;
    this.recovery.lastCandidateMs = this.recovery.lastAcceptedMs = timestampMs;
    return this.updateRecoveryStatus(conditions);
  }

  private interruptRecovery(timestampMs: number, reason: string): void {
    if (this.recovery.lastAcceptedMs !== undefined
      && timestampMs - this.recovery.lastAcceptedMs > CONFIG.reference.maximumSampleGapMs) this.clearRecovery();
    this.recovery.previousAccepted = false;
    this.recovery.lastCandidateMs = timestampMs;
    this.updateRecoveryStatus(this.status.conditions, reason);
  }

  private updateRecoveryStatus(conditions: readonly ReferenceCondition[], reason?: string): boolean {
    const progress = Math.min(1, this.recovery.acceptedMs / CONFIG.reference.captureMs,
      this.recovery.acceptedSamples / CONFIG.reference.minimumSamples);
    const complete = progress >= 1 && reason === undefined;
    const rejection = reason ?? `reference-return-confirmation ${this.recovery.acceptedMs}/${CONFIG.reference.captureMs} ms, ${this.recovery.acceptedSamples}/${CONFIG.reference.minimumSamples} frames`;
    this.status = { ...this.status, requiresReset: !complete, referenceProgress: progress,
      acceptedSamples: this.recovery.acceptedSamples, conditions,
      rejectionReason: complete ? undefined : rejection,
      message: complete ? '原有動作參考已回復，繼續即時跟隨。'
        : `原有參考回復確認 ${Math.round(progress * 100)}% · ${rejection}。請保持在原來鏡頭範圍。` };
    return complete;
  }

  private lateral(centerX: number, reference: MotionReference): number {
    const normalized = -(centerX - reference.centerX) / reference.bodyScale;
    const magnitude = Math.max(0, Math.abs(normalized) - CONFIG.lateral.deadzoneShoulderWidths);
    const span = CONFIG.lateral.fullScaleShoulderWidths - CONFIG.lateral.deadzoneShoulderWidths;
    return Math.sign(normalized) * clamp(magnitude / span, 0, 1) * CONFIG.limits.rootOffset;
  }

  private initialStatus(): MotionReferenceSnapshot {
    return { referenceReady: false, referenceProgress: 0, requiresReset: false, conditions: [], acceptedSamples: 0,
      message: '請自然站立、雙手放鬆，以建立動作參考。' };
  }
}
