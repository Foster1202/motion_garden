import type { MotionInput, MotionInputStatus, MotionSample } from './MotionInput';
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
  private lossSince?: number;

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
      this.lossSince = this.now();
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
    const pose = this.classifier.snapshot(this.now());
    const trackingLost = pose.state === 'UNKNOWN' || pose.state === 'TRACKING_LOST';
    if (trackingLost) {
      this.lossSince ??= this.now();
      this.recovering = true;
    }
    if (!trackingLost) this.lossSince = undefined;
    const confirmed = pose.state === 'BENDING' || pose.state === 'STANDING';
    if (confirmed) { this.recovering = false; this.lossSince = undefined; }
    // Reacquisition must finish debounce before the interrupted game hold can resume.
    const suspended = !this.started || this.paused || this.destroyed || trackingLost || this.recovering;
    const lossMs = this.lossSince === undefined ? 0 : this.now() - this.lossSince;
    const message = this.paused ? '休息緊，準備好先再繼續。'
      : trackingLost && lossMs >= POSE_CONFIG.lossGraceMs ? '我睇唔清楚你，企返鏡頭中間少少。'
      : pose.state === 'STANDING' ? '準備好啦，慢慢屈膝。'
      : pose.state === 'BENDING' ? '見到你啦！慢慢企返起身。'
      : pose.state === 'TRANSITION' ? '見到你啦！企穩少少，準備好先開始。' : '企喺鏡頭前面，等阿兔見到你。';
    return { mode: 'camera', ready: this.started && !this.destroyed, suspended,
      requestPause: this.started && !this.paused && lossMs >= POSE_CONFIG.autoRestMs, message };
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
    this.lossSince = this.started && !this.paused ? this.now() : undefined;
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
    this.lossSince = undefined;
    this.camera.destroy();
  }

  private acceptFrame(frame: PoseFrame) {
    if (this.destroyed || this.paused) return;
    const pose = this.classifier.update(frame, this.now());
    this.getStatus();
    this.options.onFrame?.(frame, pose);
  }

  private fail(error: Error) {
    if (this.destroyed) return;
    this.destroy();
    this.options.onError?.(error);
  }
}
