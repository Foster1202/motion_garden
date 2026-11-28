import { clearPosePerformance, recordPosePerformance } from '../performance/performanceMetrics';
import { getGameSettings, type GameSettings } from '../settings/gameSettings';
import { PersonOnlyRenderer } from '../vision/PersonOnlyRenderer';
import { PoseCamera } from '../vision/PoseCamera';
import { PoseEstimator } from '../vision/PoseEstimator';
import type { PoseFrame } from '../vision/poseTypes';
import type { TrackingMode } from '../vision/trackingMode';
import { HOME_MAXIMUM_FRAME_GAP_MS, HomeStepDetector } from './HomeStepDetector';
import type { HomeFoot, HomeLane } from './RabbitHomeRound';

interface TimedStep {
  foot: HomeFoot;
  timeMs: number;
}

export interface RabbitHomeSample {
  steps: TimedStep[];
  lane: HomeLane | null;
}

export class RabbitHomeInput {
  mode: 'keyboard' | 'camera' = 'keyboard';
  private detector = new HomeStepDetector();
  private camera?: PoseCamera;
  private estimator?: PoseEstimator;
  private preview?: PersonOnlyRenderer;
  private estimatorReady = false;
  private phase: TrackingMode = 'lost';
  private stanceReady = false;
  private generation = 0;
  private paused = false;
  private destroyed = false;
  private lastFrame?: number;
  private lane: HomeLane = 0;
  private pendingLane: HomeLane | null = null;
  private steps: TimedStep[] = [];

  constructor(private readonly onPause: () => void, private readonly onError: (message: string) => void) {
    window.addEventListener('keydown', this.onKey);
  }

  get hasCameraReference() { return this.detector.hasReference; }
  get trackingMode(): TrackingMode { return this.phase; }
  get cameraReadyForSteps() { return this.stanceReady; }

  async startCamera(host: HTMLElement): Promise<boolean> {
    if (this.destroyed) return false;
    const generation = ++this.generation;
    this.releaseCamera();
    this.mode = 'camera';
    const settings = getGameSettings();
    const current = () => generation === this.generation && !this.destroyed;
    const fail = (message: string) => {
      if (!current()) return;
      ++this.generation;
      this.releaseCamera();
      this.onError(message);
    };
    const low = settings.lowPerformanceMode;
    const camera = new PoseCamera({ lowPerformanceMode: low,
      onEnded: () => fail('相機已中斷，可以重試或者改用鍵盤。'),
    });
    this.camera = camera;
    try {
      const video = await camera.start();
      if (!current()) return false;
      video.className = 'home-camera-source';
      video.setAttribute('aria-hidden', 'true');
      const canvas = document.createElement('canvas');
      canvas.className = 'home-camera';
      canvas.setAttribute('aria-hidden', 'true');
      this.preview = new PersonOnlyRenderer(video, canvas, { nativeVideo: low });
      host.append(video, canvas);
      const estimator = new PoseEstimator({
        maxFps: low ? 10 : undefined,
        outputSegmentationMasks: !low && settings.backgroundProcessing,
        onFrame: frame => { if (current() && !this.paused) this.onFrame(frame, settings); },
        onError: error => fail(error.message),
      });
      this.estimator = estimator;
      await estimator.start(video);
      if (!current()) return false;
      this.estimatorReady = true;
      if (this.paused) estimator.pause();
      return true;
    } catch (error) {
      fail(error instanceof Error ? error.message : '未能開啟相機，可以重試或者改用鍵盤。');
      return false;
    }
  }

  useKeyboard(): void {
    if (this.destroyed) return;
    ++this.generation;
    this.releaseCamera();
    this.mode = 'keyboard';
  }

  update(): RabbitHomeSample {
    if (this.mode === 'camera' && this.lastFrame !== undefined
      && performance.now() - this.lastFrame >= HOME_MAXIMUM_FRAME_GAP_MS) this.clearTracking();
    const sample = { steps: this.steps, lane: this.pendingLane };
    if (this.pendingLane !== null) this.lane = this.pendingLane;
    this.clearPending();
    return sample;
  }

  pause(): void {
    this.paused = true;
    if (this.estimatorReady) this.estimator?.pause();
    this.clearTracking();
  }

  resume(): void {
    this.paused = false;
    if (this.estimatorReady) this.estimator?.resume();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    ++this.generation;
    this.releaseCamera();
    window.removeEventListener('keydown', this.onKey);
  }

  private readonly onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      this.onPause();
      return;
    }
    if (this.paused || this.mode !== 'keyboard'
      || (event.target instanceof HTMLElement && event.target.closest('input, select, textarea, [contenteditable]'))) return;
    switch (event.code) {
      case 'KeyQ': this.steps.push({ foot: 'left', timeMs: event.timeStamp }); break;
      case 'KeyE': this.steps.push({ foot: 'right', timeMs: event.timeStamp }); break;
      case 'ArrowLeft': this.move(-1); break;
      case 'ArrowRight': this.move(1); break;
      default: return;
    }
    event.preventDefault();
  };

  private move(direction: -1 | 1): void {
    const next = (this.pendingLane ?? this.lane) + direction;
    if (next < -1 || next > 1) return;
    this.pendingLane = next as HomeLane;
  }

  private onFrame(frame: PoseFrame, settings: GameSettings): void {
    const age = performance.now() - frame.timestampMs;
    if (!Number.isFinite(age) || age < 0 || age >= HOME_MAXIMUM_FRAME_GAP_MS) {
      this.clearTracking();
      return;
    }
    this.lastFrame = frame.timestampMs;
    recordPosePerformance(this, frame);
    this.preview?.render(frame, {
      background: settings.lowPerformanceMode || !settings.backgroundProcessing ? 'none' : settings.backgroundMode,
      showBodyKeypoints: settings.showBodyKeypoints,
      confidenceThreshold: settings.confidenceThreshold,
    });
    const sample = this.detector.update(frame, settings.confidenceThreshold);
    this.phase = sample.trackingMode;
    this.stanceReady = sample.ready;
    if (!sample.ready) {
      this.clearPending();
      return;
    }
    if (sample.step) this.steps.push({ foot: sample.step, timeMs: frame.timestampMs });
    if (sample.shift) this.move(sample.shift);
  }

  private clearPending(): void {
    this.steps = [];
    this.pendingLane = null;
  }

  private clearTracking(): void {
    this.lastFrame = undefined;
    this.phase = 'lost';
    this.stanceReady = false;
    this.detector.interrupt();
    this.clearPending();
    this.preview?.clear();
    clearPosePerformance(this);
  }

  private releaseCamera(): void {
    this.clearTracking();
    this.detector = new HomeStepDetector();
    this.estimator?.destroy();
    this.estimator = undefined;
    this.estimatorReady = false;
    this.preview?.canvas.remove();
    this.preview = undefined;
    this.camera?.destroy();
    this.camera = undefined;
  }
}
