import { getGameSettings } from '../settings/gameSettings';
import { MathUtils, type Quaternion } from 'three';
import type { RabbitRigController } from '../3d/RabbitRigController';
import type { CalibrationProfile } from '../calibration/calibrationTypes';
import { validateMotionRange } from '../settings/motionRange';
import type { PoseFrame, PoseSnapshot } from '../vision/poseTypes';
import { HumanPoseExtractor, type HumanPose } from './HumanPoseExtractor';
import { MotionRetargeter } from './MotionRetargeter';
import { MotionSmoother } from './MotionSmoother';
import { MOCAP_CONFIG } from './mocapConfig';
import { neutralRabbitPose, type RabbitPose } from './RabbitPose';

type MocapRig = Pick<RabbitRigController, 'setArmRotation' | 'setBodyLean' | 'setKneeBend' | 'setRootOffset'>
  & Partial<Pick<RabbitRigController, 'bones' | 'setHeadRotation' | 'applyPose' | 'version'>>;
export type MocapTrackingState = 'disabled' | 'waiting' | 'acquiring-reference' | 'tracking' | 'holding'
  | 'returning-neutral' | 'reference-required' | 'disposed';

export interface MocapSnapshot {
  enabled: boolean;
  paused: boolean;
  trackingState: MocapTrackingState;
  raw?: HumanPose;
  mapped?: RabbitPose;
  smoothed: RabbitPose;
  referenceReady: boolean;
  referenceProgress: number;
  message: string;
  mediaPipeFps: number;
  threeFps: number;
  rejectedFrames: number;
  lastRejection?: string;
  boneDeltasDegrees: Record<string, number>;
  controllerStatus: 'DISABLED' | 'WAITING' | 'ACTIVE' | 'PAUSED' | 'DISPOSED';
  framesReceived: number;
  humanPosesExtracted: number;
  mappedPoses: number;
}

/** Consumes shared inference results and advances only on the existing scene clock. */
export class MocapController {
  private readonly extractor = new HumanPoseExtractor();
  private readonly retargeter = new MotionRetargeter();
  private readonly smoother: MotionSmoother;
  private readonly initialBoneRotations = new Map<string, Quaternion>();
  private enabled = false;
  private paused = false;
  private disposed = false;
  private raw?: HumanPose;
  private mapped?: RabbitPose;
  private lastTimestamp?: number;
  private lastReliableTimestamp?: number;
  private reliable = false;
  private trackingState: MocapTrackingState = 'disabled';
  private message = '即時動作同步已停止。';
  private mediaPipeFps = 0;
  private threeFps = 0;
  private rejectedFrames = 0;
  private lastRejection?: string;
  private framesReceived = 0;
  private humanPosesExtracted = 0;
  private mappedPoses = 0;

  constructor(private readonly rig: MocapRig, private readonly now = () => performance.now()) {
    this.smoother = new MotionSmoother(rig.version === 'v3');
    for (const [name, bone] of rig.bones ?? []) this.initialBoneRotations.set(name, bone.quaternion.clone().normalize());
  }

  get statusMessage() { return this.message; }

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
  }

  acceptFrame(frame: PoseFrame, pose: PoseSnapshot, profile: CalibrationProfile | undefined): void {
    if (!this.enabled || this.paused || this.disposed) return;
    this.framesReceived++;
    this.mediaPipeFps = Number.isFinite(frame.poseFps) ? Math.max(0, frame.poseFps) : 0;
    const nowMs = this.now();
    const fail = (reason: string) => {
      this.reliable = false;
      this.rejectedFrames++;
      this.lastRejection = reason;
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
      for (const key of ['leftArmElevation', 'rightArmElevation', 'leftElbowBend', 'rightElbowBend'] as const) {
        if (human[key] !== undefined && this.raw![key] !== undefined
          && Math.abs(human[key]! - this.raw![key]!) > maximumArmChange) {
          fail('angle-jump'); return;
        }
      }
    }
    this.raw = human;
    const mapped = this.retargeter.update(human, profile);
    const reference = this.retargeter.snapshot;
    if (!mapped && reference.referenceReady && !reference.requiresReset) {
      fail('invalid-retargeted-pose');
      return;
    }
    this.lastReliableTimestamp = frame.timestampMs;
    this.reliable = true;
    this.lastRejection = undefined;
    this.mapped = mapped;
    if (this.mapped) this.mappedPoses++;
  }

  update(deltaSeconds: number, nowMs = this.now()): void {
    if (!this.enabled || this.paused || this.disposed || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0
      || !Number.isFinite(nowMs)) return;
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
    // Cap only the render step so resume cannot consume a long pause in one jump.
    const step = Math.min(deltaSeconds, MOCAP_CONFIG.temporal.maxStepSeconds);
    const gain = this.trackingState === 'holding' ? 1 : getGameSettings().mocapGain;
    target = { ...target };
    for (const key of ['leftArmElevation', 'rightArmElevation', 'leftElbowBend', 'rightElbowBend',
      'torsoLean', 'torsoForward', 'headYaw', 'headPitch', 'bendAmount', 'lateralOffset'] as const) target[key] *= gain;
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
    this.threeFps = deltaSeconds < 1 ? 1 / deltaSeconds : 0;
  }

  snapshot(): MocapSnapshot {
    const reference = this.retargeter.snapshot;
    const boneDeltasDegrees: Record<string, number> = {};
    for (const [name, bone] of this.rig.bones ?? []) {
      const initial = this.initialBoneRotations.get(name);
      if (initial) boneDeltasDegrees[name] = MathUtils.radToDeg(initial.angleTo(bone.quaternion.clone().normalize()));
    }
    return {
      enabled: this.enabled, paused: this.paused, trackingState: this.trackingState,
      raw: this.raw ? { ...this.raw } : undefined, mapped: this.mapped ? { ...this.mapped } : undefined,
      smoothed: this.smoother.pose, referenceReady: reference.referenceReady,
      referenceProgress: reference.referenceProgress, message: this.message,
      mediaPipeFps: this.mediaPipeFps, threeFps: this.threeFps, rejectedFrames: this.rejectedFrames,
      lastRejection: this.lastRejection, boneDeltasDegrees,
      controllerStatus: this.disposed ? 'DISPOSED' : this.paused ? 'PAUSED' : !this.enabled ? 'DISABLED'
        : this.trackingState === 'tracking' ? 'ACTIVE' : 'WAITING',
      framesReceived: this.framesReceived, humanPosesExtracted: this.humanPosesExtracted, mappedPoses: this.mappedPoses,
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
  }
}
