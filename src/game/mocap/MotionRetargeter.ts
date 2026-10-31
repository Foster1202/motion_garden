import type { BerryMotionSample } from './LegExtensionDetector';
import { validateMotionRange } from '../settings/motionRange';
import type { CalibrationProfile } from '../calibration/calibrationTypes';
import type { HumanPose } from './HumanPoseExtractor';
import { MOCAP_CONFIG as CONFIG } from './mocapConfig';
import { neutralRabbitPose, type RabbitPose } from './RabbitPose';

export interface MotionReference {
  centerX: number;
  bodyScale: number;
  torsoLean: number;
  leftArmElevation: number;
  rightArmElevation: number;
  leftElbowBend: number;
  rightElbowBend: number;
  timestampMs: number;
}
export interface MotionReferenceSnapshot {
  referenceReady: boolean;
  referenceProgress: number;
  message: string;
  requiresReset: boolean;
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value);
const armKeys = ['leftArmElevation', 'rightArmElevation', 'leftElbowBend', 'rightElbowBend'] as const;

export class MotionRetargeter {
  /** Berry motion already uses anatomical sides and normalized, mirrored root translation. */
  retargetLegMotion(sample: BerryMotionSample): BerryMotionSample {
    const valid = sample.reliable && [sample.leftLegExtensionAmount, sample.rightLegExtensionAmount,
      sample.lateralOffset, sample.timestampMs].every(Number.isFinite) && sample.timestampMs >= 0;
    return {
      leftLegExtensionAmount: valid ? clamp(sample.leftLegExtensionAmount, 0, 1) : 0,
      rightLegExtensionAmount: valid ? clamp(sample.rightLegExtensionAmount, 0, 1) : 0,
      lateralOffset: valid ? clamp(sample.lateralOffset, -1, 1) : 0,
      reliable: valid, timestampMs: sample.timestampMs,
    };
  }

  private captured?: MotionReference;
  private samples: HumanPose[] = [];
  private lastTarget = neutralRabbitPose();
  private profileKey?: string;
  private lastTimestamp?: number;
  private lastReliableArm: Partial<Record<'left' | 'right', number>> = {};
  private status: MotionReferenceSnapshot = this.initialStatus();

  get reference(): MotionReference | undefined { return this.captured && { ...this.captured }; }
  get snapshot(): MotionReferenceSnapshot { return { ...this.status }; }

  resetReference(): void {
    this.captured = undefined;
    this.samples = [];
    this.lastTarget = neutralRabbitPose();
    this.lastTimestamp = undefined;
    this.lastReliableArm = {};
    this.status = this.initialStatus();
  }

  update(human: HumanPose, profile: CalibrationProfile): RabbitPose | undefined {
    if (!validateMotionRange(profile)) return undefined;
    const key = JSON.stringify([profile.timestamp, profile.standingAngle, profile.range, profile.reliableSide ?? 'both']);
    if (key !== this.profileKey) { this.resetReference(); this.profileKey = key; }
    if (!this.valid(human) || (this.lastTimestamp !== undefined && human.timestampMs <= this.lastTimestamp)) {
      if (!this.captured) { this.samples = []; this.status = this.initialStatus(); }
      return undefined;
    }
    if (this.lastTimestamp !== undefined && human.timestampMs - this.lastTimestamp > CONFIG.reference.maximumSampleGapMs) {
      this.samples = [];
    }
    this.lastTimestamp = human.timestampMs;
    if (this.status.requiresReset) return undefined;
    if (!this.captured && !this.capture(human, profile)) return undefined;
    const reference = this.captured!;
    const scaleShift = Math.abs(human.bodyScale / reference.bodyScale - 1);
    const centerShift = Math.abs(human.centerX - reference.centerX) / reference.bodyScale;
    if (scaleShift > CONFIG.reference.resetScaleFraction || centerShift > CONFIG.reference.resetCenterShoulderWidths) {
      this.status = { ...this.status, requiresReset: true,
        message: '站位或鏡頭角度已明顯改變，請自然站立並重設參考姿勢。' };
      return undefined;
    }
    const target: RabbitPose = {
      ...this.lastTarget,
      // Raw positive lean moves toward mirrored screen left, matching model +Z roll.
      torsoLean: clamp(human.torsoLean - reference.torsoLean, -CONFIG.limits.torsoLean, CONFIG.limits.torsoLean),
      bendAmount: clamp((profile.standingAngle - human.activeKneeAngle) / profile.range, 0, 1),
      lateralOffset: this.lateral(human.centerX, reference),
      trackingConfidence: clamp(human.trackingConfidence, 0, 1), timestampMs: human.timestampMs,
    };
    for (const side of ['left', 'right'] as const) {
      const elevation = `${side}ArmElevation` as const;
      const elbow = `${side}ElbowBend` as const;
      const reliable = human[`${side}ArmConfidence`] >= CONFIG.confidenceThreshold
        && finite(human[elevation]) && finite(human[elbow]);
      if (reliable) {
        this.lastReliableArm[side] = human.timestampMs;
        target[elevation] = clamp(human[elevation]! - reference[elevation], 0, CONFIG.limits.arm.max);
        target[elbow] = clamp(human[elbow]! - reference[elbow], 0, CONFIG.limits.elbow.max);
      } else if (human.timestampMs - (this.lastReliableArm[side] ?? reference.timestampMs) > CONFIG.temporal.neutralAfterMs) {
        target[elevation] = 0;
        target[elbow] = 0;
      }
    }
    this.lastTarget = target;
    return { ...target };
  }

  private valid(human: HumanPose): boolean {
    return [human.torsoLean, human.activeKneeAngle, human.centerX, human.bodyScale,
      human.trackingConfidence, human.timestampMs, human.leftArmConfidence, human.rightArmConfidence].every(Number.isFinite)
      && human.timestampMs >= 0 && human.trackingConfidence >= CONFIG.confidenceThreshold && human.trackingConfidence <= 1
      && human.leftArmConfidence >= 0 && human.leftArmConfidence <= 1 && human.rightArmConfidence >= 0 && human.rightArmConfidence <= 1
      && human.activeKneeAngle >= 0 && human.activeKneeAngle <= 180 && Math.abs(human.torsoLean) < 80
      && human.centerX >= 0 && human.centerX <= 1 && human.bodyScale >= 0.025 && human.bodyScale <= 1
      && armKeys.every(key => human[key] === undefined || (finite(human[key]) && human[key]! >= 0 && human[key]! <= 180));
  }

  private capture(human: HumanPose, profile: CalibrationProfile): boolean {
    const natural = human.activeKneeAngle >= profile.standingThreshold
      && Math.abs(human.torsoLean) <= CONFIG.reference.maximumLeanDegrees
      && human.leftArmConfidence >= CONFIG.confidenceThreshold && human.rightArmConfidence >= CONFIG.confidenceThreshold
      && armKeys.every(key => finite(human[key]) && human[key]! <= (key.includes('Elbow')
        ? CONFIG.reference.relaxedElbowDegrees : CONFIG.reference.relaxedArmDegrees));
    if (!natural) {
      this.samples = [];
      this.status = { ...this.initialStatus(), message: '請自然站立、雙手放鬆，等待參考姿勢穩定。' };
      return false;
    }
    const first = this.samples[0];
    const stable = !first || (Math.abs(human.centerX - first.centerX) / first.bodyScale <= CONFIG.reference.centerSpreadShoulderWidths
      && Math.abs(human.bodyScale / first.bodyScale - 1) <= CONFIG.reference.scaleSpreadFraction
      && Math.abs(human.torsoLean - first.torsoLean) <= CONFIG.reference.angularSpreadDegrees
      && armKeys.every(key => Math.abs(human[key]! - first[key]!) <= CONFIG.reference.angularSpreadDegrees));
    if (!stable) this.samples = [];
    this.samples.push(human);
    const progress = clamp((human.timestampMs - this.samples[0].timestampMs) / CONFIG.reference.captureMs, 0, 1);
    this.status = { referenceReady: false, referenceProgress: progress, requiresReset: false,
      message: '正在記錄自然站立參考，請稍候。' };
    if (progress < 1) return false;
    const mean = (key: keyof HumanPose) => this.samples.reduce((sum, sample) => sum + (sample[key] as number), 0) / this.samples.length;
    this.captured = {
      centerX: mean('centerX'), bodyScale: mean('bodyScale'), torsoLean: mean('torsoLean'),
      leftArmElevation: mean('leftArmElevation'), rightArmElevation: mean('rightArmElevation'),
      leftElbowBend: mean('leftElbowBend'), rightElbowBend: mean('rightElbowBend'), timestampMs: human.timestampMs,
    };
    this.samples = [];
    this.status = { referenceReady: true, referenceProgress: 1, requiresReset: false, message: '即時動作同步已就緒。' };
    return true;
  }

  private lateral(centerX: number, reference: MotionReference): number {
    const normalized = -(centerX - reference.centerX) / reference.bodyScale;
    const magnitude = Math.max(0, Math.abs(normalized) - CONFIG.lateral.deadzoneShoulderWidths);
    const span = CONFIG.lateral.fullScaleShoulderWidths - CONFIG.lateral.deadzoneShoulderWidths;
    return Math.sign(normalized) * clamp(magnitude / span, 0, 1) * CONFIG.limits.rootOffset;
  }

  private initialStatus(): MotionReferenceSnapshot {
    return { referenceReady: false, referenceProgress: 0, requiresReset: false,
      message: '請自然站立、雙手放鬆，以建立動作參考。' };
  }
}
