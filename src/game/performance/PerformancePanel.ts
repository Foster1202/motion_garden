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
    delete this.element.dataset.poseBackend;
    delete this.element.dataset.videoFps;
    this.element.textContent = this.enabled ? `${this.mode}模式 · 正在量度…` : '';
  };

  private readonly render = () => {
    if (document.hidden) return;
    const now = performance.now();
    if (this.windowStarted === undefined) {
      this.windowStarted = now;
      readPerformanceWindow(1000);
      return;
    }
    this.renderedFrames++;
    const elapsed = now - this.windowStarted;
    if (elapsed < 1000) return;
    const { pose, ai, camera, thread, threeFrames } = readPerformanceWindow(elapsed);
    const fps = (frames: number) => (frames * 1000 / elapsed).toFixed(1);
    const metric = (value: number | undefined) => value === undefined ? '—' : value.toFixed(1);
    const freshPose = pose && now - pose.timestampMs <= POSE_CONFIG.maxDataAgeMs ? pose : undefined;
    const latest = ai?.inferenceMs ?? freshPose?.inferenceMs;
    const resolution = camera?.width && camera.height ? `${camera.width}×${camera.height}` : '—';
    if (ai) this.element.dataset.poseBackend = ai.backend;
    else delete this.element.dataset.poseBackend;
    if (camera?.presentedFps !== undefined) this.element.dataset.videoFps = camera.presentedFps.toFixed(1);
    else delete this.element.dataset.videoFps;
    const text = [
      `${this.mode}模式 · 相機 ${resolution} · 協商 ${metric(camera?.trackFps)} FPS`,
      `Video ${metric(camera?.presentedFps)} FPS · 解碼 P95 ${metric(camera?.decodeP95Ms)} ms`,
      `推論 ${metric(latest)} ms · P95 ${metric(ai?.p95Ms)} ms`,
      `Pose ${metric(freshPose?.poseFps || undefined)} FPS · AI ${metric(ai?.completedFps)} FPS`
        + (ai ? ` · ${ai.backend === 'worker' ? 'Worker' : '主線程'}${ai.fallbackReason ? ` (${ai.fallbackReason})` : ''}` : ''),
      `Phaser ${fps(this.renderedFrames)} FPS · 3D ${threeFrames ? fps(threeFrames) : '—'} FPS`,
      `長任務 ${thread?.longTasks ?? '—'} · RAF 停頓 ${thread?.rafStalls ?? '—'} · 最長 ${metric(thread?.maxRafGapMs)} ms`,
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
