import { HumanPoseExtractor, type ArmReachPose } from '../mocap/HumanPoseExtractor';
import { MotionRetargeter } from '../mocap/MotionRetargeter';
import { neutralRabbitPose, type RabbitPose } from '../mocap/RabbitPose';
import { getGameSettings, type GameSettings } from '../settings/gameSettings';
import { clearPosePerformance, recordPosePerformance } from '../performance/performanceMetrics';
import { PersonOnlyRenderer } from '../vision/PersonOnlyRenderer';
import { PoseCamera } from '../vision/PoseCamera';
import { PoseEstimator } from '../vision/PoseEstimator';
import type { PoseFrame } from '../vision/poseTypes';
import type { TrackingMode } from '../vision/trackingMode';
import type { AppleHarvestRoundInput } from './AppleHarvestRound';
import { APPLE_CONFIG as C } from './appleConfig';

export interface AppleHarvestSample extends AppleHarvestRoundInput {
  pose: RabbitPose;
}

type Reference = Pick<ArmReachPose, 'centerX' | 'shoulderWidth' | 'torsoLean' | 'orientation'>;
type TrackingStatus = 'waiting-for-frames' | 'waiting-for-pose' | 'acquiring-reference' | 'recovering' | 'tracking';
const MOVEMENT_KEYS = ['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE'];
const REFERENCE_MS = 420;
const RECOVERY_FRAMES = 3;
const clampTravel = (x: number) => Math.max(-C.maxTravel, Math.min(C.maxTravel, x));
const unavailable = (x = 0): AppleHarvestSample => ({ x, lateralReliable: false,
  left: null, right: null, pose: neutralRabbitPose() });

export class AppleHarvestInput {
  mode: 'keyboard' | 'camera' = 'keyboard';
  private readonly keys = new Set<string>();
  private readonly extractor = new HumanPoseExtractor();
  private readonly retargeter = new MotionRetargeter();
  private camera?: PoseCamera;
  private estimator?: PoseEstimator;
  private preview?: PersonOnlyRenderer;
  private reference?: Reference;
  private candidates: ArmReachPose[] = [];
  private recoveryFrames = 0;
  private previousCenter?: number;
  private lastFrame?: number;
  private generation = 0;
  private paused = false;
  private destroyed = false;
  private poseFps = 0;
  private x = 0;
  private status: TrackingStatus = 'waiting-for-frames';
  private sample = unavailable();

  constructor(private readonly onPause: () => void, private readonly onError: (message: string) => void) {
    window.addEventListener('keydown', this.down);
    window.addEventListener('keyup', this.up);
  }

  async startCamera(host: HTMLElement): Promise<boolean> {
    if (this.destroyed) return false;
    const generation = ++this.generation;
    this.releaseCamera();
    this.mode = 'camera';
    this.keys.clear();
    const settings = getGameSettings();
    const isCurrent = () => !this.destroyed && generation === this.generation;
    const fail = (message: string) => {
      if (!isCurrent()) return;
      ++this.generation;
      this.releaseCamera();
      this.onError(message);
    };
    const { lowPerformanceMode } = settings;
    const outputSegmentationMasks = !lowPerformanceMode && settings.backgroundProcessing;
    const camera = new PoseCamera({ lowPerformanceMode, onEnded: () => fail('相機已中斷，請重新開啟或改用鍵盤。') });
    this.camera = camera;
    try {
      const video = await camera.start();
      if (!isCurrent()) return false;
      video.className = 'apple-camera-source';
      video.setAttribute('aria-hidden', 'true');
      const canvas = document.createElement('canvas');
      canvas.className = 'apple-camera';
      canvas.setAttribute('aria-hidden', 'true');
      this.preview = new PersonOnlyRenderer(video, canvas, { nativeVideo: !outputSegmentationMasks, paused: this.paused });
      host.append(video, canvas);
      const estimator = new PoseEstimator({
        maxFps: lowPerformanceMode ? 10 : undefined,
        outputSegmentationMasks,
        onFrame: frame => { if (isCurrent() && !this.paused) this.onFrame(frame, settings); },
        onError: error => fail(error.message),
      });
      this.estimator = estimator;
      await estimator.start(video);
      if (!isCurrent()) return false;
      if (this.paused) estimator.pause();
      return true;
    } catch (error) {
      fail(error instanceof Error ? error.message : '未能啟動相機，請重試或改用鍵盤。');
      return false;
    }
  }

  useKeyboard(): void {
    if (this.destroyed) return;
    ++this.generation;
    this.releaseCamera();
    this.mode = 'keyboard';
    this.keys.clear();
  }

  update(deltaMs: number): AppleHarvestSample {
    if (this.paused || this.destroyed) return unavailable(this.x);
    const dt = Number.isFinite(deltaMs) ? Math.max(0, Math.min(deltaMs, 100)) : 0;
    if (this.mode === 'camera') {
      const age = this.frameAgeMs;
      if (this.status !== 'waiting-for-frames' && (age === null || age >= C.maximumFrameGapMs)) {
        this.interrupt('waiting-for-frames');
        this.preview?.clear();
      }
      if (this.sample.lateralReliable) {
        const difference = this.sample.x - this.x;
        this.x = Math.abs(difference) < .001 ? this.sample.x : this.x + difference * (1 - Math.exp(-dt / 75));
      }
      return { ...this.sample, x: this.x };
    }

    const movement = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight'))
      - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    this.x = clampTravel(this.x + movement * dt * C.keyboardSpeedPerMs);
    const left = Number(this.keys.has('KeyQ'));
    const right = Number(this.keys.has('KeyE'));
    return { x: this.x, left, right, lateralReliable: true, pose: {
      ...neutralRabbitPose(performance.now()), leftArmElevation: left * 90, rightArmElevation: right * 90,
      trackingConfidence: 1,
    } };
  }

  get hasCameraReference() { return this.reference !== undefined; }

  get trackingMode(): TrackingMode {
    if (this.mode !== 'camera' || this.paused || this.destroyed || !this.sample.lateralReliable) return 'lost';
    const wrists = Number(this.sample.left !== null) + Number(this.sample.right !== null);
    return wrists === 2 ? 'full' : wrists === 1 ? 'partial' : 'lost';
  }

  trackingSnapshot() {
    const enabled = !this.paused && !this.destroyed;
    return {
      mode: this.mode, status: this.destroyed ? 'closed' : this.paused ? 'paused' : this.mode === 'keyboard' ? 'keyboard' : this.status,
      trackingMode: this.trackingMode,
      hasReference: this.hasCameraReference,
      reliable: enabled && (this.mode === 'keyboard' || this.sample.lateralReliable),
      leftReliable: enabled && (this.mode === 'keyboard' || this.sample.left !== null),
      rightReliable: enabled && (this.mode === 'keyboard' || this.sample.right !== null),
      x: this.x, targetX: this.sample.x, frameAgeMs: this.frameAgeMs,
      poseFps: !enabled || this.status === 'waiting-for-frames' ? 0 : this.poseFps,
    };
  }

  pause(): void {
    this.paused = true;
    this.keys.clear();
    this.estimator?.pause();
    this.preview?.setPaused(true);
    clearPosePerformance(this);
    this.interrupt('waiting-for-frames');
  }

  resume(): void {
    this.paused = false;
    this.preview?.setPaused(false);
    this.estimator?.resume();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    ++this.generation;
    this.releaseCamera();
    this.keys.clear();
    window.removeEventListener('keydown', this.down);
    window.removeEventListener('keyup', this.up);
  }

  private readonly down = (event: KeyboardEvent) => {
    if (event.repeat || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      this.onPause();
      return;
    }
    if (this.paused || this.mode !== 'keyboard' || !MOVEMENT_KEYS.includes(event.code)
      || (event.target instanceof HTMLElement && event.target.matches('input, select, textarea, [contenteditable="true"]'))) return;
    event.preventDefault();
    this.keys.add(event.code);
  };

  private readonly up = (event: KeyboardEvent) => { this.keys.delete(event.code); };

  private get frameAgeMs(): number | null {
    return this.lastFrame === undefined ? null : performance.now() - this.lastFrame;
  }

  private onFrame(frame: PoseFrame, settings: GameSettings): void {
    const timestamp = frame.timestampMs;
    const gap = this.lastFrame === undefined ? 0 : timestamp - this.lastFrame;
    const age = performance.now() - timestamp;
    if (!Number.isFinite(age) || age < 0 || age >= C.maximumFrameGapMs || (this.lastFrame !== undefined && gap <= 0)) {
      this.interrupt('waiting-for-frames');
      this.preview?.clear();
      return;
    }
    if (gap >= C.maximumFrameGapMs) this.interrupt('recovering');
    this.lastFrame = timestamp;
    this.poseFps = frame.poseFps;
    recordPosePerformance(this, frame);
    this.preview?.render(frame, {
      background: settings.lowPerformanceMode || !settings.backgroundProcessing ? 'none' : settings.backgroundMode,
      showBodyKeypoints: settings.showBodyKeypoints, confidenceThreshold: settings.confidenceThreshold,
    });

    const human = this.extractor.extractArmReach(frame, Math.max(.55, settings.confidenceThreshold));
    if (!human || (this.reference && human.orientation !== this.reference.orientation)) {
      this.interrupt('waiting-for-pose');
      return;
    }
    if (!this.reference) {
      this.status = 'acquiring-reference';
      this.captureReference(human);
      if (!this.reference) return;
      this.recoveryFrames = RECOVERY_FRAMES;
    }

    const jump = this.previousCenter !== undefined
      && Math.abs(human.centerX - this.previousCenter) > this.reference.shoulderWidth * .55;
    if (jump) this.interrupt('recovering');
    this.previousCenter = human.centerX;
    this.recoveryFrames = Math.min(RECOVERY_FRAMES, this.recoveryFrames + 1);
    if (this.recoveryFrames < RECOVERY_FRAMES) {
      this.status = 'recovering';
      return;
    }
    const { x, pose } = this.retargeter.retargetArmReach(human, this.reference);
    this.sample = { x: clampTravel(x), pose, lateralReliable: true, left: human.leftRaise,
      right: human.rightRaise, timestampMs: timestamp };
    this.status = 'tracking';
  }

  private captureReference(human: ArmReachPose): void {
    const { leftRaise, rightRaise } = human;
    if ((leftRaise === null && rightRaise === null)
      || (leftRaise !== null && leftRaise > C.lowerThreshold) || (rightRaise !== null && rightRaise > C.lowerThreshold)) {
      this.candidates = [];
      return;
    }
    const continuousWrist = (leftRaise !== null && this.candidates.every(candidate => candidate.leftRaise !== null))
      || (rightRaise !== null && this.candidates.every(candidate => candidate.rightRaise !== null));
    const stable = continuousWrist && this.candidates.every(candidate => candidate.orientation === human.orientation
      && Math.abs(human.centerX - candidate.centerX) <= candidate.shoulderWidth * .22
      && Math.abs(human.shoulderWidth / candidate.shoulderWidth - 1) <= .20
      && Math.abs(human.torsoHeight / candidate.torsoHeight - 1) <= .20);
    if (!stable) this.candidates = [];
    this.candidates.push(human);
    if (this.candidates.length < 5 || human.timestampMs - this.candidates[0].timestampMs < REFERENCE_MS) return;
    const mean = (key: 'centerX' | 'shoulderWidth' | 'torsoLean') =>
      this.candidates.reduce((sum, candidate) => sum + candidate[key], 0) / this.candidates.length;
    this.reference = { centerX: mean('centerX'), shoulderWidth: mean('shoulderWidth'),
      torsoLean: mean('torsoLean'), orientation: human.orientation };
    this.candidates = [];
  }

  private interrupt(status: TrackingStatus): void {
    this.status = status;
    this.candidates = [];
    this.previousCenter = undefined;
    this.recoveryFrames = 0;
    this.sample = unavailable(this.x);
  }

  private releaseCamera(): void {
    this.estimator?.destroy();
    this.estimator = undefined;
    clearPosePerformance(this);
    this.preview?.clear();
    this.preview?.canvas.remove();
    this.preview = undefined;
    this.camera?.destroy();
    this.camera = undefined;
    this.reference = undefined;
    this.lastFrame = undefined;
    this.poseFps = 0;
    this.interrupt('waiting-for-frames');
  }
}
