import { HumanPoseExtractor } from '../mocap/HumanPoseExtractor';
import { MotionRetargeter } from '../mocap/MotionRetargeter';
import { LEG_EXTENSION_CONFIG, type BerryMotionSample } from '../mocap/LegExtensionDetector';
import { PoseCamera } from '../vision/PoseCamera';
import { PoseEstimator } from '../vision/PoseEstimator';
import { PersonOnlyRenderer } from '../vision/PersonOnlyRenderer';
import { getGameSettings } from '../settings/gameSettings';
import { clearPosePerformance, recordPosePerformance } from '../performance/performanceMetrics';
import type { TrackingMode } from '../vision/trackingMode';
const neutral = (): BerryMotionSample => ({ leftLegExtensionAmount: 0, rightLegExtensionAmount: 0,
  lateralOffset: 0, lateralReliable: false, reliable: false, timestampMs: 0 });
export class BerryKickInput {
  mode: 'keyboard' | 'camera' = 'keyboard';
  private keys = new Set<string>();
  private sample = neutral();
  private extractor = new HumanPoseExtractor();
  private retargeter = new MotionRetargeter();
  private camera?: PoseCamera;
  private estimator?: PoseEstimator;
  private preview?: PersonOnlyRenderer;
  private previewCanvas?: HTMLCanvasElement;
  private generation = 0;
  private paused = false;
  private destroyed = false;
  private lastFrame?: number;
  private stale = true;
  private poseFps = 0;
  constructor(private readonly onPause: () => void, private readonly onError: (message: string) => void) {
    window.addEventListener('keydown', this.down); window.addEventListener('keyup', this.up);
  }
  private down = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLElement && /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) {
      if (event.code !== 'Escape') return;
    }
    if (['KeyA', 'KeyD', 'KeyQ', 'KeyE', 'Escape'].includes(event.code)) event.preventDefault();
    if (event.code === 'Escape' && !event.repeat) this.onPause();
    else this.keys.add(event.code);
  };
  private up = (event: KeyboardEvent) => { this.keys.delete(event.code); };
  async startCamera(host: HTMLElement) {
    const generation = ++this.generation;
    this.releaseCamera(); this.mode = 'camera'; this.sample = neutral(); this.extractor.resetLegMotion();
    const settings = getGameSettings();
    const fail = (message: string) => {
      if (generation !== this.generation || this.destroyed) return;
      ++this.generation;
      this.releaseCamera();
      this.sample = neutral();
      this.onError(message);
    };
    const { lowPerformanceMode } = settings;
    const outputSegmentationMasks = !lowPerformanceMode && settings.backgroundProcessing;
    const camera = new PoseCamera({ lowPerformanceMode, onEnded: () => fail('相機已中斷，請重新開啟或使用鍵盤。') });
    this.camera = camera;
    const estimator = new PoseEstimator({ maxFps: lowPerformanceMode ? 10 : undefined, outputSegmentationMasks, onPreviewFrame: frame => {
      if (generation !== this.generation || this.paused || this.destroyed) return;
      this.preview?.renderPreview(frame, {
        background: outputSegmentationMasks ? settings.backgroundMode : 'none',
        showBodyKeypoints: settings.showBodyKeypoints, confidenceThreshold: settings.confidenceThreshold,
      });
    }, onFrame: frame => {
      if (generation !== this.generation || this.paused || this.destroyed) return;
      const age = performance.now() - frame.timestampMs;
      if (!Number.isFinite(age) || age < 0 || age >= LEG_EXTENSION_CONFIG.maximumGapMs
        || (this.lastFrame !== undefined && frame.timestampMs <= this.lastFrame)) {
        this.invalidateCameraSample();
        return;
      }
      this.lastFrame = frame.timestampMs;
      this.stale = false;
      this.poseFps = frame.poseFps;
      recordPosePerformance(this, frame);
      this.sample = this.retargeter.retargetLegMotion(this.extractor.extractLegMotion(frame));
    }, onError: error => fail(error.message) });
    this.estimator = estimator;
    try {
      const video = await camera.start();
      if (generation !== this.generation || this.destroyed) return;
      video.className = 'berry-camera-source';
      video.setAttribute('aria-hidden', 'true');
      const canvas = document.createElement('canvas');
      canvas.className = 'berry-camera';
      canvas.setAttribute('aria-hidden', 'true');
      host.append(video, canvas);
      this.previewCanvas = canvas;
      this.preview = new PersonOnlyRenderer(video, canvas, { nativeVideo: !outputSegmentationMasks, paused: this.paused });
      await estimator.initialize();
      if (generation !== this.generation || this.destroyed) return;
      await estimator.start(video);
      if (this.paused) estimator.pause();
    } catch (error) {
      if (generation !== this.generation || this.destroyed) return;
      fail(error instanceof Error ? error.message : '相機未能啟動。');
    }
  }
  useKeyboard() { ++this.generation; this.releaseCamera(); this.mode = 'keyboard'; this.keys.clear(); this.sample = neutral(); }
  update(dt: number): BerryMotionSample {
    if (this.paused) return { ...this.sample, lateralReliable: false, reliable: false };
    if (this.mode === 'camera') {
      const age = this.frameAgeMs;
      if (!this.stale && (age === null || age >= LEG_EXTENSION_CONFIG.maximumGapMs)) this.invalidateCameraSample();
      return { ...this.sample };
    }
    const approach = (value: number, target: number) => value + (target - value) * (1 - Math.exp(-10 * dt));
    this.sample = { leftLegExtensionAmount: approach(this.sample.leftLegExtensionAmount, this.keys.has('KeyQ') ? 1 : 0),
      rightLegExtensionAmount: approach(this.sample.rightLegExtensionAmount, this.keys.has('KeyE') ? 1 : 0),
      lateralOffset: Math.max(-1, Math.min(1, this.sample.lateralOffset +
        ((this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0)) * dt * .8)),
      lateralReliable: true, reliable: true, timestampMs: performance.now() };
    return { ...this.sample };
  }
  private get frameAgeMs(): number | null {
    return this.lastFrame === undefined ? null : performance.now() - this.lastFrame;
  }
  get hasCameraReference() { return this.extractor.hasLegMotionReference; }
  get trackingMode(): TrackingMode {
    if (this.paused || this.stale || !this.sample.lateralReliable) return 'lost';
    const legs = this.sample.legTracking;
    return legs?.left.mode === 'full' && legs.right.mode === 'full' ? 'full' : 'partial';
  }
  trackingSnapshot() {
    return {
      ...this.extractor.legMotionSnapshot(),
      mode: this.trackingMode,
      status: this.paused ? 'paused' : this.stale ? 'waiting-for-frames'
        : this.sample.lateralReliable ? 'tracking' : 'waiting-for-pose',
      reliable: !this.paused && !this.stale && this.sample.lateralReliable,
      kickReliable: !this.paused && !this.stale && this.sample.reliable,
      lateralOffset: this.sample.lateralOffset, frameAgeMs: this.frameAgeMs,
      poseFps: this.paused || this.stale ? 0 : this.poseFps,
    };
  }
  private invalidateCameraSample() {
    this.stale = true;
    this.sample = this.extractor.suspendLegMotion('stale');
  }
  pause() {
    this.paused = true; this.keys.clear(); this.estimator?.pause(); this.preview?.setPaused(true);
    clearPosePerformance(this);
    if (this.mode === 'camera') {
      this.stale = true;
      this.sample = this.extractor.suspendLegMotion('paused');
    }
  }
  resume() {
    this.paused = false;
    this.sample = { ...this.sample, leftLegExtensionAmount: 0, rightLegExtensionAmount: 0,
      lateralReliable: false, reliable: false };
    this.preview?.setPaused(false); this.estimator?.resume();
  }
  private releaseCamera() {
    this.lastFrame = undefined; this.stale = true; this.poseFps = 0;
    clearPosePerformance(this);
    this.estimator?.destroy(); this.estimator = undefined; this.preview?.clear(); this.preview = undefined;
    this.previewCanvas?.remove(); this.previewCanvas = undefined; this.camera?.destroy(); this.camera = undefined;
  }
  destroy() { if (this.destroyed) return; this.destroyed = true; ++this.generation; this.releaseCamera();
    this.keys.clear(); window.removeEventListener('keydown', this.down); window.removeEventListener('keyup', this.up); }
}
