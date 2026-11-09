import type { CameraTrackingState, MotionInput, MotionInputStatus, MotionSample } from './MotionInput';
import { PoseCamera, type PoseCameraOptions } from '../vision/PoseCamera';
import { PoseEstimator, type PoseEstimatorOptions } from '../vision/PoseEstimator';
import { PoseClassifier } from '../vision/PoseClassifier';
import { POSE_CONFIG } from '../vision/poseConfig';
import type { PoseFrame, PoseSnapshot } from '../vision/poseTypes';
import type { CalibrationProfile } from '../calibration/calibrationTypes';

export interface CameraDriver {
  start(): Promise<HTMLVideoElement>;
  destroy(): void;
}
export interface EstimatorDriver {
  initialize(): Promise<void>;
  start(video: HTMLVideoElement): Promise<void>;
  pause(): void;
  resume(): void;
  destroy(): void;
}
export interface MediapipeInputOptions {
  onFrame?: (frame: PoseFrame, pose: PoseSnapshot) => void;
  onError?: (error: Error) => void;
  createCamera?: (options: PoseCameraOptions) => CameraDriver;
  createEstimator?: (options: PoseEstimatorOptions) => EstimatorDriver;
  now?: () => number;
}

export class MediapipeMotionInput implements MotionInput {
  private readonly classifier = new PoseClassifier();
  private readonly now: () => number;
  private readonly camera: CameraDriver;
  private readonly estimator: EstimatorDriver;
  private started = false;
  private paused = false;
  private destroyed = false;
  private recovering = true;
  private reliableSince?: number;
  private lastReliableTimestampMs?: number;
  private lastFrame?: { timestampMs: number; poseFps: number; personDetected: boolean };
  private framesReceived = 0;
  private personSeen = false;
  private trackingState: CameraTrackingState = 'CAMERA_INITIALIZING';
  private pendingTrackingState?: CameraTrackingState;
  private trackingStateSince = 0;

  constructor(private readonly options: MediapipeInputOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.camera = (options.createCamera ?? (settings => new PoseCamera(settings)))({
      onEnded: () => this.fail(new Error('鏡頭已中斷，你可以重新開啟鏡頭，或者使用鍵盤操作。')),
    });
    this.estimator = (options.createEstimator ?? (settings => new PoseEstimator(settings)))({
      onFrame: frame => this.acceptFrame(frame),
      onError: error => this.fail(error),
    });
  }

  async start(): Promise<HTMLVideoElement> {
    if (this.destroyed) throw new Error('鏡頭啟動已取消。');
    try {
      const video = await this.camera.start();
      if (this.destroyed) throw new Error('鏡頭啟動已取消。');
      await this.estimator.initialize();
      if (this.destroyed) throw new Error('鏡頭啟動已取消。');
      this.started = true;
      this.trackingState = 'WAITING_FOR_PERSON';
      await this.estimator.start(video);
      if (this.paused) this.estimator.pause();
      return video;
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  sample(): MotionSample {
    const status = this.getStatus();
    if (!status.ready || status.suspended) return { bending: false, standing: false };
    const state = this.classifier.snapshot(this.now()).state;
    return { bending: state === 'BENDING', standing: state === 'STANDING' };
  }

  getStatus(): MotionInputStatus {
    const now = this.now();
    const pose = this.classifier.snapshot(now);
    const trackingLost = pose.state === 'UNKNOWN' || pose.state === 'TRACKING_LOST';
    if (trackingLost) {
      this.recovering = true;
      this.reliableSince = undefined;
      this.lastReliableTimestampMs = undefined;
    } else if (pose.timestampMs !== this.lastReliableTimestampMs) {
      const gap = this.lastReliableTimestampMs === undefined ? Infinity : pose.timestampMs - this.lastReliableTimestampMs;
      if (gap > POSE_CONFIG.maxFrameGapMs) this.reliableSince = pose.timestampMs;
      this.reliableSince ??= pose.timestampMs;
      this.lastReliableTimestampMs = pose.timestampMs;
      this.recovering = pose.timestampMs - this.reliableSince < POSE_CONFIG.debounceMs;
    }
    // Reliable neutral poses can recover continuous tracking without emitting a game action.
    const suspended = !this.started || this.paused || this.destroyed || trackingLost || this.recovering;
    const freshFrame = this.lastFrame !== undefined && now >= this.lastFrame.timestampMs
      && now - this.lastFrame.timestampMs <= POSE_CONFIG.maxDataAgeMs;
    const personDetected = freshFrame && this.lastFrame!.personDetected;
    const desiredTrackingState: CameraTrackingState = !this.started ? 'CAMERA_INITIALIZING'
      : !personDetected ? this.personSeen ? 'TRACKING_LOST' : 'WAITING_FOR_PERSON'
      : trackingLost ? 'TRACKING_UNSTABLE'
      : this.recovering ? 'PERSON_DETECTED' : 'TRACKING_READY';
    this.updateTrackingState(desiredTrackingState, now);
    const message = this.paused ? '休息緊，準備好先再繼續。'
      : !personDetected ? '未偵測到人物，請慢慢行到鏡頭前。'
      : trackingLost ? '正在確認姿勢…請讓鏡頭看見全身。'
      : pose.state === 'STANDING' ? '準備好啦，慢慢屈膝。'
      : pose.state === 'BENDING' ? '見到你啦！慢慢企返起身。'
      : pose.state === 'TRANSITION' ? '見到你啦！企穩少少，準備好先開始。' : '企喺鏡頭前面，等阿兔見到你。';
    return { mode: 'camera', ready: this.started && !this.destroyed, suspended,
      requestPause: false, message,
      cameraStatus: this.destroyed ? 'stopped' : !this.started ? 'initializing' : this.paused ? 'paused' : 'running',
      trackingState: this.trackingState, personDetected,
      poseFps: freshFrame ? this.lastFrame!.poseFps : 0,
      framesReceived: this.framesReceived, lastFrameTimestampMs: this.lastFrame?.timestampMs };
  }

  getPoseSnapshot(): PoseSnapshot { return this.classifier.snapshot(this.now()); }

  setCalibration(profile?: CalibrationProfile): void {
    if (this.destroyed) throw new Error('Camera input has been destroyed.');
    this.classifier.setCalibration(profile);
    this.reset();
  }

  setMotionRange(profile: CalibrationProfile): void {
    if (this.destroyed) throw new Error('Input is destroyed.');
    this.classifier.setMotionRange(profile);
    this.reset();
  }

  getCalibration(): CalibrationProfile | undefined { return this.classifier.getCalibration(); }

  reset() {
    this.classifier.reset();
    this.recovering = true;
    this.reliableSince = undefined;
    this.lastReliableTimestampMs = undefined;
  }

  pause() { this.paused = true; this.estimator.pause(); this.reset(); }
  resume() { if (this.destroyed) return; this.paused = false; this.reset(); this.estimator.resume(); }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.started = false;
    try { this.estimator.destroy(); } catch {
      // A failed model shutdown must never keep the camera stream alive.
    }
    this.classifier.setCalibration(undefined);
    this.lastFrame = undefined;
    this.camera.destroy();
  }

  private acceptFrame(frame: PoseFrame) {
    if (this.destroyed || this.paused) return;
    const personDetected = !!frame.landmarks?.length;
    this.lastFrame = { timestampMs: frame.timestampMs, poseFps: frame.poseFps, personDetected };
    this.framesReceived++;
    this.personSeen ||= personDetected;
    const pose = this.classifier.update(frame, this.now());
    this.getStatus();
    this.options.onFrame?.(frame, pose);
  }

  private updateTrackingState(next: CameraTrackingState, now: number): void {
    if (next === this.trackingState) {
      this.pendingTrackingState = undefined;
      return;
    }
    if (next !== this.pendingTrackingState) {
      this.pendingTrackingState = next;
      this.trackingStateSince = now;
    }
    if (now - this.trackingStateSince >= POSE_CONFIG.debounceMs) {
      this.trackingState = next;
      this.pendingTrackingState = undefined;
    }
  }

  private fail(error: Error) {
    if (this.destroyed) return;
    this.destroy();
    this.options.onError?.(error);
  }
}
