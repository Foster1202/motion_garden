import Phaser from 'phaser';
import { GAME_SETTINGS_CHANGED_EVENT, getGameSettings } from '../settings/gameSettings';
import { POSE_CONFIG } from '../vision/poseConfig';
import { readPerformanceWindow, setPerformanceMonitoring } from './performanceMetrics';

export class PerformancePanel {
  private readonly element = document.createElement('aside');
  private enabled = false;
  private mode = '';
  private windowStarted?: number;
  private renderedFrames = 0;

  constructor(private readonly game: Phaser.Game, host: HTMLElement) {
    this.element.className = 'performance-panel';
    this.element.setAttribute('aria-label', '效能數據');
    this.element.hidden = true;
    host.append(this.element);
    window.addEventListener(GAME_SETTINGS_CHANGED_EVENT, this.syncSettings);
    document.addEventListener('visibilitychange', this.resetWindow);
    this.game.events.once(Phaser.Core.Events.DESTROY, this.destroy);
    this.syncSettings();
  }

  private readonly syncSettings = () => {
    const { lowPerformanceMode, showPerformanceMetrics } = getGameSettings();
    this.mode = lowPerformanceMode ? '低效能' : '標準';
    if (this.enabled === showPerformanceMetrics) return;
    this.enabled = showPerformanceMetrics;
    this.element.hidden = !this.enabled;
    this.resetWindow();
    if (this.enabled) this.game.events.on(Phaser.Core.Events.POST_RENDER, this.render);
    else this.game.events.off(Phaser.Core.Events.POST_RENDER, this.render);
  };

  private readonly resetWindow = () => {
    this.windowStarted = undefined;
    this.renderedFrames = 0;
    setPerformanceMonitoring(this.enabled && !document.hidden);
    this.element.textContent = this.enabled ? `${this.mode}模式 · 正在量度…` : '';
  };

  private readonly render = () => {
    if (document.hidden) return;
    const now = performance.now();
    if (this.windowStarted === undefined) {
      this.windowStarted = now;
      readPerformanceWindow();
      return;
    }
    this.renderedFrames++;
    const elapsed = now - this.windowStarted;
    if (elapsed < 1000) return;
    const { pose, threeFrames } = readPerformanceWindow();
    const fps = (frames: number) => (frames * 1000 / elapsed).toFixed(1);
    const freshPose = pose && now - pose.timestampMs <= POSE_CONFIG.maxDataAgeMs ? pose : undefined;
    const inference = freshPose
      ? `${freshPose.inferenceMs.toFixed(1)} ms · 平均 ${(freshPose.averageInferenceMs ?? freshPose.inferenceMs).toFixed(1)} ms`
      : '—';
    const camera = pose?.imageWidth && pose.imageHeight ? `${pose.imageWidth}×${pose.imageHeight}` : '—';
    const text = [
      `${this.mode}模式 · 相機 ${camera}`,
      `推論 ${inference}`,
      `Pose ${freshPose?.poseFps ? freshPose.poseFps.toFixed(1) : '—'} FPS`,
      `Phaser ${fps(this.renderedFrames)} FPS · 3D ${threeFrames ? fps(threeFrames) : '—'} FPS`,
    ].join('\n');
    if (this.element.textContent !== text) this.element.textContent = text;
    this.windowStarted = now;
    this.renderedFrames = 0;
  };

  private readonly destroy = () => {
    window.removeEventListener(GAME_SETTINGS_CHANGED_EVENT, this.syncSettings);
    document.removeEventListener('visibilitychange', this.resetWindow);
    this.game.events.off(Phaser.Core.Events.POST_RENDER, this.render);
    setPerformanceMonitoring(false);
    this.element.remove();
  };
}
