import { getGameSettings } from '../settings/gameSettings';
import { MathUtils, type Quaternion } from 'three';
import type { RabbitRigController } from '../3d/RabbitRigController';
import type { CalibrationProfile } from '../calibration/calibrationTypes';
import { validateMotionRange } from '../settings/motionRange';
import type { PoseFrame, PoseSnapshot } from '../vision/poseTypes';
import { HumanPoseExtractor, type HumanPose } from './HumanPoseExtractor';
import { MotionRetargeter, type MotionReference, type MotionReferenceSnapshot } from './MotionRetargeter';
import { MotionSmoother } from './MotionSmoother';
import { MOCAP_CONFIG } from './mocapConfig';
import { neutralRabbitPose, type RabbitPose } from './RabbitPose';
import { RABBIT_INWARD_ARM_MAX_PLANE } from '../3d/rabbit3dConfig';

type MocapRig = Pick<RabbitRigController, 'setArmRotation' | 'setBodyLean' | 'setKneeBend' | 'setRootOffset'>
  & Partial<Pick<RabbitRigController, 'bones' | 'setHeadRotation' | 'applyPose' | 'version' | 'armControl' | 'limits'>>;
export type MocapTrackingState = 'disabled' | 'waiting' | 'acquiring-reference' | 'tracking' | 'holding'
  | 'returning-neutral' | 'reference-required' | 'disposed';

export interface MocapSnapshot {
  mirrored: boolean;
  enabled: boolean;
  paused: boolean;
  trackingState: MocapTrackingState;
  raw?: HumanPose;
  mapped?: RabbitPose;
  smoothed: RabbitPose;
  referenceReady: boolean;
  reference?: MotionReference;
  referenceProgress: number;
  message: string;
  mediaPipeFps: number;
  inferenceMs: number;
  averageInferenceMs: number;
  threeFps: number;
  rejectedFrames: number;
  lastRejection?: string;
  boneDeltasDegrees: Record<string, number>;
  controllerStatus: 'DISABLED' | 'WAITING' | 'ACTIVE' | 'PAUSED' | 'DISPOSED';
  framesReceived: number;
  humanPosesExtracted: number;
  mappedPoses: number;
  ignoredFrames: number;
  lastFrameAgeMs?: number;
  lastHumanPoseAgeMs?: number;
  lastMappedChangeAgeMs?: number;
  lastBoneChangeAgeMs?: number;
  extractionRejection?: string;
  referenceRejectionReason?: string;
  referenceConditions: MotionReferenceSnapshot['conditions'];
  referenceAcceptedSamples: number;
  updateCount: number;
  poseWrites: number;
  mappedPoseChanges: number;
  bonePoseChanges: number;
  boneQuaternions: Record<string, number[]>;
  bonePositions: Record<string, number[]>;
  rootOffsetApplied?: number;
  renderedFrames: number;
  lastRenderAgeMs?: number;
  diagnosticStage: string;
}

/** Consumes shared inference results and advances only on the existing scene clock. */
export class MocapController {
  private readonly extractor: HumanPoseExtractor;
  private readonly retargeter: MotionRetargeter;
  private readonly smoother: MotionSmoother;
  private readonly shoulderOnly: boolean;
  private readonly maximumArmElevation: number;
  private readonly initialBoneRotations = new Map<string, Quaternion>();
  private initialRootX?: number;
  private enabled = false;
  private paused = false;
  private disposed = false;
  private raw?: HumanPose;
  private movementStanding = false;
  private mapped?: RabbitPose;
  private lastTimestamp?: number;
  private lastReliableTimestamp?: number;
  private reliable = false;
  private trackingState: MocapTrackingState = 'disabled';
  private message = '即時動作同步已停止。';
  private mediaPipeFps = 0;
  private inferenceMs = 0;
  private averageInferenceMs = 0;
  private threeFps = 0;
  private rejectedFrames = 0;
  private lastRejection?: string;
  private framesReceived = 0;
  private humanPosesExtracted = 0;
  private mappedPoses = 0;
  private ignoredFrames = 0;
  private lastReceivedTimestamp?: number;
  private extractionRejection?: string;
  private updateCount = 0;
  private poseWrites = 0;
  private mappedPoseChanges = 0;
  private bonePoseChanges = 0;
  private renderedFrames = 0;
  private lastRenderedTimestamp?: number;
  private previousMapped = neutralRabbitPose();
  private lastMappedChangeTimestamp?: number;
  private lastBoneChangeTimestamp?: number;
  private pendingBoneChangeSince?: number;
  private readonly previousBoneState = new Map<string, number[]>();

  constructor(private readonly rig: MocapRig, private readonly now = () => performance.now(), allowInwardArms = false,
    private readonly gardenMovement = false) {
    this.shoulderOnly = rig.armControl === 'shoulder';
    const armMaximum = rig.limits?.arm.max;
    this.maximumArmElevation = armMaximum !== undefined && Number.isFinite(armMaximum)
      ? MathUtils.clamp(armMaximum, 0, MOCAP_CONFIG.limits.arm.max) : MOCAP_CONFIG.limits.arm.max;
    const inward = allowInwardArms && rig.version === 'v3' && !this.shoulderOnly;
    const maximumPlane = inward ? RABBIT_INWARD_ARM_MAX_PLANE : 90;
    this.extractor = new HumanPoseExtractor(inward, this.shoulderOnly);
    this.retargeter = new MotionRetargeter(maximumPlane, gardenMovement, this.shoulderOnly, this.maximumArmElevation);
    this.smoother = new MotionSmoother(rig.version === 'v3', maximumPlane);
    this.initialRootX = rig.bones?.get('root')?.position.x;
    for (const [name, bone] of rig.bones ?? []) {
      this.initialBoneRotations.set(name, bone.quaternion.clone().normalize());
      this.previousBoneState.set(name, [...bone.quaternion.toArray(), ...bone.position.toArray()]);
    }
  }

  get statusMessage() { return this.message; }
  get pose(): RabbitPose { return this.smoother.pose; }
  get movementFrame() {
    return this.gameplayReady && this.raw
      ? { pose: this.raw, reference: this.retargeter.reference, standing: this.movementStanding } : undefined;
  }
  get gameplayReady(): boolean {
    const timestamp = this.raw?.timestampMs;
    const nowMs = this.now();
    return this.enabled && !this.paused && !this.disposed && this.retargeter.isReferenceReady
      && !this.retargeter.requiresReferenceReset && !!this.mapped && !this.lastRejection
      && timestamp !== undefined && nowMs >= timestamp && nowMs - timestamp <= MOCAP_CONFIG.temporal.maxDataAgeMs;
  }

  enable(): void {
    if (this.disposed || this.enabled) return;
    this.enabled = true;
    this.paused = false;
    this.smoother.reset();
    this.resetReference();
  }

  /** Releases bone ownership synchronously; the scene restores its selected source. */
  stop(): void {
    this.enabled = false;
    this.paused = false;
    this.reliable = false;
    this.trackingState = this.disposed ? 'disposed' : 'disabled';
    this.message = '即時動作同步已停止。';
  }

  pause(): void {
    if (!this.enabled || this.disposed) return;
    this.paused = true;
    this.reliable = false;
    this.trackingState = 'holding';
    this.message = '休息緊，準備好先再繼續。';
  }

  resume(): void {
    if (!this.enabled || this.disposed || !this.paused) return;
    this.paused = false;
    this.raw = undefined;
    this.mapped = undefined;
    this.lastTimestamp = undefined;
    this.lastReliableTimestamp = undefined;
    this.reliable = false;
    this.trackingState = 'waiting';
    this.message = '等待鏡頭重新識別姿勢。';
  }

  resetReference(): void {
    if (this.disposed) return;
    this.retargeter.resetReference();
    this.raw = undefined;
    this.mapped = undefined;
    this.lastTimestamp = undefined;
    this.lastReliableTimestamp = undefined;
    this.reliable = false;
    this.trackingState = this.enabled ? 'waiting' : 'disabled';
    this.message = '請自然站立，等候穩定參考姿勢。';
    this.lastRejection = undefined;
    this.extractionRejection = undefined;
    this.previousMapped = neutralRabbitPose();
    this.pendingBoneChangeSince = undefined;
  }

  acceptFrame(frame: PoseFrame, pose: PoseSnapshot, profile: CalibrationProfile | undefined): void {
    if (this.disposed) return;
    this.framesReceived++;
    this.lastReceivedTimestamp = frame.timestampMs;
    this.inferenceMs = Number.isFinite(frame.inferenceMs) ? Math.max(0, frame.inferenceMs) : 0;
    this.averageInferenceMs = Number.isFinite(frame.averageInferenceMs) ? Math.max(0, frame.averageInferenceMs!) : this.inferenceMs;
    if (!this.enabled || this.paused) {
      this.ignoredFrames++;
      this.lastRejection = this.paused ? 'mocap-paused' : 'mocap-disabled';
      return;
    }
    this.extractionRejection = undefined;
    this.mediaPipeFps = Number.isFinite(frame.poseFps) ? Math.max(0, frame.poseFps) : 0;
    const nowMs = this.now();
    const freshIncreasing = Number.isFinite(nowMs) && Number.isFinite(frame.timestampMs) && frame.timestampMs >= 0
      && frame.timestampMs <= nowMs && nowMs - frame.timestampMs <= MOCAP_CONFIG.temporal.maxDataAgeMs
      && (this.lastTimestamp === undefined || frame.timestampMs > this.lastTimestamp);
    const canInterruptReference = freshIncreasing && !!profile && validateMotionRange(profile);
    const fail = (reason: string) => {
      this.reliable = false;
      this.rejectedFrames++;
      this.lastRejection = reason;
      if (canInterruptReference) this.retargeter.rejectFrame(frame.timestampMs, this.extractionRejection ?? reason);
    };
    if (!profile || !validateMotionRange(profile)) { fail('invalid-calibration'); return; }
    if (!Number.isFinite(nowMs) || !Number.isFinite(frame.timestampMs)
      || frame.timestampMs > nowMs || nowMs - frame.timestampMs > MOCAP_CONFIG.temporal.maxDataAgeMs) {
      fail('stale-or-future-frame'); return;
    }
    if (this.lastTimestamp !== undefined && frame.timestampMs <= this.lastTimestamp) {
      fail('non-increasing-timestamp'); return;
    }
    this.lastTimestamp = frame.timestampMs;
    if (pose.timestampMs !== frame.timestampMs) { fail('mismatched-pose'); return; }
    const human = this.extractor.extract(frame, pose, profile);
    this.extractionRejection = this.extractor.lastRejection;
    if (!human) { fail('unreliable-pose'); return; }
    this.humanPosesExtracted++;
    const recent = this.raw && this.lastReliableTimestamp !== undefined
      && frame.timestampMs - this.lastReliableTimestamp < MOCAP_CONFIG.temporal.neutralAfterMs;
    if (recent && Math.abs(human.centerX - this.raw!.centerX) > MOCAP_CONFIG.temporal.maxLandmarkJump) {
      fail('position-jump'); return;
    }
    if (recent) {
      const seconds = (frame.timestampMs - this.lastReliableTimestamp!) / 1000;
      const maximumArmChange = Math.max(35, 540 * seconds);
      const keys = this.shoulderOnly ? ['leftArmElevation', 'rightArmElevation'] as const
        : ['leftArmElevation', 'rightArmElevation', 'leftElbowBend', 'rightElbowBend'] as const;
      for (const key of keys) {
        if (human[key] !== undefined && this.raw![key] !== undefined
          && Math.abs(human[key]! - this.raw![key]!) > maximumArmChange) {
          fail('angle-jump'); return;
        }
      }
    }
    this.raw = human;
    this.movementStanding = human.activeKneeAngle >= profile.standingThreshold;
    const anatomical = this.retargeter.update(human, profile);
    let mapped = anatomical;
    if (anatomical && this.gardenMovement) {
      mapped = { ...anatomical, lateralOffset: 0 };
      if (!this.shoulderOnly) Object.assign(mapped, {
        leftArmElevation: anatomical.rightArmElevation, rightArmElevation: anatomical.leftArmElevation,
        leftElbowBend: anatomical.rightElbowBend, rightElbowBend: anatomical.leftElbowBend,
        leftArmPlane: anatomical.rightArmPlane, rightArmPlane: anatomical.leftArmPlane,
      });
    }
    const reference = this.retargeter.snapshot;
    if (!mapped && reference.referenceReady && !reference.requiresReset) {
      fail('invalid-retargeted-pose');
      return;
    }
    this.lastReliableTimestamp = frame.timestampMs;
    this.reliable = true;
    this.lastRejection = mapped ? undefined : reference.rejectionReason;
    this.mapped = mapped;
    if (mapped) {
      this.mappedPoses++;
      const changed = (Object.keys(mapped) as (keyof RabbitPose)[]).some(key => key !== 'timestampMs'
        && key !== 'trackingConfidence' && Math.abs(mapped[key] - this.previousMapped[key]) > 1e-5);
      if (changed) {
        this.mappedPoseChanges++;
        this.lastMappedChangeTimestamp = frame.timestampMs;
        this.pendingBoneChangeSince ??= frame.timestampMs;
      }
      this.previousMapped = { ...mapped };
    } else this.message = reference.message;
  }

  update(deltaSeconds: number, nowMs = this.now(), applyPose = true): void {
    if (!this.enabled || this.paused || this.disposed || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0
      || !Number.isFinite(nowMs)) return;
    this.updateCount++;
    const elapsed = this.lastReliableTimestamp === undefined ? Infinity : Math.max(0, nowMs - this.lastReliableTimestamp);
    const reference = this.retargeter.snapshot;
    let target = this.mapped ?? neutralRabbitPose(nowMs);
    if (reference.requiresReset) {
      this.trackingState = 'reference-required';
      this.message = reference.message;
      target = neutralRabbitPose(nowMs);
    } else if (elapsed >= MOCAP_CONFIG.temporal.neutralAfterMs) {
      this.trackingState = this.lastReliableTimestamp === undefined ? 'waiting' : 'returning-neutral';
      this.message = this.lastReliableTimestamp === undefined ? '請站喺鏡頭前，讓阿兔睇到你。' : '暫時睇唔清楚你，阿兔慢慢回復站姿。';
      target = neutralRabbitPose(nowMs);
    } else if (!this.reliable || elapsed > MOCAP_CONFIG.temporal.maxDataAgeMs) {
      this.trackingState = 'holding';
      this.message = '暫時睇唔清楚你，先保持姿勢。';
      target = this.smoother.pose;
    } else if (!reference.referenceReady) {
      this.trackingState = 'acquiring-reference';
      this.message = reference.message;
    } else {
      this.trackingState = 'tracking';
      this.message = '即時動作同步中，按照自己舒適幅度活動。';
    }
    if (!applyPose) return;
    // Cap only the render step so resume cannot consume a long pause in one jump.
    const step = Math.min(deltaSeconds, MOCAP_CONFIG.temporal.maxStepSeconds);
    const gain = this.trackingState === 'holding' ? 1 : getGameSettings().mocapGain;
    target = { ...target };
    for (const key of ['leftArmElevation', 'rightArmElevation', 'leftElbowBend', 'rightElbowBend',
      'torsoLean', 'torsoForward', 'headYaw', 'headPitch', 'bendAmount', 'lateralOffset'] as const) target[key] *= gain;
    if (this.shoulderOnly) {
      target.leftArmElevation = MathUtils.clamp(target.leftArmElevation, 0, this.maximumArmElevation);
      target.rightArmElevation = MathUtils.clamp(target.rightArmElevation, 0, this.maximumArmElevation);
    }
    const smoothed = this.smoother.update(target, step);
    if (this.rig.applyPose) this.rig.applyPose(smoothed);
    else {
      this.rig.setArmRotation('left', smoothed.leftArmElevation, smoothed.leftElbowBend, smoothed.leftArmPlane);
      this.rig.setArmRotation('right', smoothed.rightArmElevation, smoothed.rightElbowBend, smoothed.rightArmPlane);
      this.rig.setBodyLean(smoothed.torsoLean, smoothed.torsoForward);
      this.rig.setHeadRotation?.(smoothed.headYaw, smoothed.headPitch, -0.4 * smoothed.torsoLean);
      this.rig.setKneeBend(smoothed.bendAmount);
      this.rig.setRootOffset(smoothed.lateralOffset, 0, 0);
    }
    this.poseWrites++;
    this.threeFps = deltaSeconds < 1 ? 1 / deltaSeconds : 0;
  }

  recordRenderedFrame(): void {
    if (this.disposed) return;
    this.renderedFrames++;
    this.lastRenderedTimestamp = this.now();
  }

  snapshot(): MocapSnapshot {
    const reference = this.retargeter.snapshot;
    const boneDeltasDegrees: Record<string, number> = {};
    const boneQuaternions: Record<string, number[]> = {};
    const bonePositions: Record<string, number[]> = {};
    let bonesChanged = false;
    for (const [name, bone] of this.rig.bones ?? []) {
      const initial = this.initialBoneRotations.get(name);
      if (initial) boneDeltasDegrees[name] = MathUtils.radToDeg(initial.angleTo(bone.quaternion.clone().normalize()));
      boneQuaternions[name] = bone.quaternion.toArray();
      bonePositions[name] = bone.position.toArray();
      const values = [...boneQuaternions[name], ...bonePositions[name]];
      const previous = this.previousBoneState.get(name);
      if (previous && values.some((value, index) => Math.abs(value - previous[index]) > 1e-7)) bonesChanged = true;
      this.previousBoneState.set(name, values);
    }
    const nowMs = this.now();
    if (bonesChanged) {
      this.bonePoseChanges++;
      this.lastBoneChangeTimestamp = nowMs;
      this.pendingBoneChangeSince = undefined;
    }
    const lastFrameAgeMs = this.lastReceivedTimestamp === undefined ? undefined : nowMs - this.lastReceivedTimestamp;
    const lastRenderAgeMs = this.lastRenderedTimestamp === undefined ? undefined : Math.max(0, nowMs - this.lastRenderedTimestamp);
    let diagnosticStage = 'render-submitted';
    if (this.framesReceived === 0 || lastFrameAgeMs === undefined || lastFrameAgeMs < 0 || lastFrameAgeMs > MOCAP_CONFIG.temporal.maxDataAgeMs) {
      diagnosticStage = 'A-no-fresh-frames';
    } else if (!this.enabled || this.paused) {
      diagnosticStage = 'controller-inactive';
    } else if (this.extractionRejection) {
      diagnosticStage = 'B-human-pose-rejected';
    } else if (!reference.referenceReady || reference.requiresReset) {
      diagnosticStage = 'C-reference-pending';
    } else if (this.mappedPoseChanges === 0) {
      diagnosticStage = 'D-reference-ready-awaiting-motion';
    } else if (this.bonePoseChanges === 0 || (this.pendingBoneChangeSince !== undefined
      && nowMs - this.pendingBoneChangeSince > MOCAP_CONFIG.temporal.maxDataAgeMs)) {
      diagnosticStage = 'E-target-changed-awaiting-bones';
    } else if (lastRenderAgeMs === undefined || lastRenderAgeMs > MOCAP_CONFIG.temporal.maxDataAgeMs) {
      diagnosticStage = 'F-bones-changed-awaiting-render';
    }
    return {
      mirrored: this.gardenMovement && !this.shoulderOnly,
      enabled: this.enabled, paused: this.paused, trackingState: this.trackingState,
      raw: this.raw ? { ...this.raw } : undefined, mapped: this.mapped ? { ...this.mapped } : undefined,
      smoothed: this.smoother.pose, referenceReady: reference.referenceReady, reference: this.retargeter.reference,
      referenceProgress: reference.referenceProgress, message: this.message,
      mediaPipeFps: this.mediaPipeFps, inferenceMs: this.inferenceMs, averageInferenceMs: this.averageInferenceMs, threeFps: this.threeFps, rejectedFrames: this.rejectedFrames,
      lastRejection: this.lastRejection, boneDeltasDegrees,
      controllerStatus: this.disposed ? 'DISPOSED' : this.paused ? 'PAUSED' : !this.enabled ? 'DISABLED'
        : this.trackingState === 'tracking' ? 'ACTIVE' : 'WAITING',
      framesReceived: this.framesReceived, humanPosesExtracted: this.humanPosesExtracted, mappedPoses: this.mappedPoses,
      ignoredFrames: this.ignoredFrames, lastFrameAgeMs,
      lastHumanPoseAgeMs: this.raw ? Math.max(0, nowMs - this.raw.timestampMs) : undefined,
      lastMappedChangeAgeMs: this.lastMappedChangeTimestamp === undefined ? undefined : Math.max(0, nowMs - this.lastMappedChangeTimestamp),
      lastBoneChangeAgeMs: this.lastBoneChangeTimestamp === undefined ? undefined : Math.max(0, nowMs - this.lastBoneChangeTimestamp),
      extractionRejection: this.extractionRejection,
      referenceRejectionReason: reference.rejectionReason, referenceConditions: reference.conditions.map(condition => ({ ...condition })),
      referenceAcceptedSamples: reference.acceptedSamples, updateCount: this.updateCount, poseWrites: this.poseWrites,
      mappedPoseChanges: this.mappedPoseChanges, bonePoseChanges: this.bonePoseChanges,
      boneQuaternions, bonePositions,
      rootOffsetApplied: this.initialRootX === undefined || !bonePositions.root ? undefined : bonePositions.root[0] - this.initialRootX,
      renderedFrames: this.renderedFrames, lastRenderAgeMs, diagnosticStage,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.trackingState = 'disposed';
    this.retargeter.resetReference();
    this.raw = undefined;
    this.mapped = undefined;
    this.initialBoneRotations.clear();
    this.previousBoneState.clear();
  }
}
