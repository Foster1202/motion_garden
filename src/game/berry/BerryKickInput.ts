import { HumanPoseExtractor } from '../mocap/HumanPoseExtractor';
import { MotionRetargeter } from '../mocap/MotionRetargeter';
import type { BerryMotionSample } from '../mocap/LegExtensionDetector';
import { PoseCamera } from '../vision/PoseCamera';
import { PoseEstimator } from '../vision/PoseEstimator';
const neutral = (): BerryMotionSample => ({ leftLegExtensionAmount: 0, rightLegExtensionAmount: 0,
  lateralOffset: 0, reliable: false, timestampMs: 0 });
export class BerryKickInput {
  mode: 'keyboard' | 'camera' = 'keyboard';
  private keys = new Set<string>();
  private sample = neutral();
  private extractor = new HumanPoseExtractor();
  private retargeter = new MotionRetargeter();
  private camera?: PoseCamera;
  private estimator?: PoseEstimator;
  private generation = 0;
  private paused = false;
  private destroyed = false;
  private lastFrame = -Infinity;
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
    const camera = new PoseCamera({ onEnded: () => { this.sample = neutral(); this.onError('相機已中斷，請重新開啟或使用鍵盤。'); } });
    this.camera = camera;
    const estimator = new PoseEstimator({ onFrame: frame => {
      if (generation !== this.generation || this.paused || this.destroyed) return;
      this.sample = this.retargeter.retargetLegMotion(this.extractor.extractLegMotion(frame));
      this.lastFrame = performance.now();
    }, onError: error => { this.sample = neutral(); this.onError(error.message); } });
    this.estimator = estimator;
    try {
      const video = await camera.start();
      if (generation !== this.generation || this.destroyed) return;
      video.className = 'berry-camera'; host.append(video);
      await estimator.initialize();
      if (generation !== this.generation || this.destroyed) return;
      await estimator.start(video);
      if (this.paused) estimator.pause();
    } catch (error) {
      if (generation !== this.generation || this.destroyed) return;
      this.releaseCamera(); this.onError(error instanceof Error ? error.message : '相機未能啟動。');
    }
  }
  useKeyboard() { ++this.generation; this.releaseCamera(); this.mode = 'keyboard'; this.keys.clear(); this.sample = neutral(); }
  update(dt: number): BerryMotionSample {
    if (this.paused) return { ...this.sample, reliable: false };
    if (this.mode === 'camera') return { ...this.sample, reliable: this.sample.reliable && performance.now() - this.lastFrame < 300 };
    const approach = (value: number, target: number) => value + (target - value) * (1 - Math.exp(-10 * dt));
    this.sample = { leftLegExtensionAmount: approach(this.sample.leftLegExtensionAmount, this.keys.has('KeyQ') ? 1 : 0),
      rightLegExtensionAmount: approach(this.sample.rightLegExtensionAmount, this.keys.has('KeyE') ? 1 : 0),
      lateralOffset: Math.max(-1, Math.min(1, this.sample.lateralOffset +
        ((this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0)) * dt * .8)),
      reliable: true, timestampMs: performance.now() };
    return { ...this.sample };
  }
  pause() { this.paused = true; this.keys.clear(); this.estimator?.pause(); }
  resume() { this.paused = false; this.sample = { ...this.sample, leftLegExtensionAmount: 0, rightLegExtensionAmount: 0, reliable: false };
    this.lastFrame = -Infinity; this.estimator?.resume(); }
  private releaseCamera() { this.estimator?.destroy(); this.estimator = undefined; this.camera?.destroy(); this.camera = undefined; }
  destroy() { if (this.destroyed) return; this.destroyed = true; ++this.generation; this.releaseCamera();
    this.keys.clear(); window.removeEventListener('keydown', this.down); window.removeEventListener('keyup', this.up); }
}
