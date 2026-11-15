import type { PoseFrame, PoseSnapshot } from './poseTypes';
import type { CalibrationProfile } from '../calibration/calibrationTypes';
import { PersonOnlyRenderer } from './PersonOnlyRenderer';
import { getGameSettings } from '../settings/gameSettings';

export const DEV_POSE_DEBUG = false;
export const DEV_POSE_PREVIEW = true;

export class PoseDebugOverlay {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly personRenderer: PersonOnlyRenderer;
  private readonly metrics: HTMLElement;
  private readonly debug: boolean;
  private calibration?: CalibrationProfile;
  private readonly settings = getGameSettings();
  private hasFrame = false;

  constructor(host: HTMLElement, video: HTMLVideoElement, options: { debug?: boolean; preview?: boolean } = {}) {
    this.debug = options.debug ?? Boolean(import.meta.env?.DEV && (DEV_POSE_DEBUG || import.meta.env?.VITE_POSE_DEBUG === 'true'));
    this.root = document.createElement('aside');
    this.root.className = 'pose-preview';
    this.root.setAttribute('aria-label', '鏡頭小畫面');
    this.root.innerHTML = '<div class="pose-preview-media"></div><p class="pose-preview-label">鏡頭小畫面 · 本機處理</p><p class="pose-metrics"></p>';
    const media = this.root.querySelector<HTMLElement>('.pose-preview-media')!;
    video.classList.add('pose-video');
    if (video.videoWidth && video.videoHeight) media.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    media.append(video);
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    media.append(this.canvas);
    this.personRenderer = new PersonOnlyRenderer(video, this.canvas);
    this.root.style.setProperty('--pose-preview-aspect', String(this.canvas.width / this.canvas.height));
    this.metrics = this.root.querySelector<HTMLElement>('.pose-metrics')!;
    this.metrics.hidden = !this.debug;
    if (this.settings.backgroundProcessing) {
      this.root.querySelector('.pose-preview-label')!.textContent = this.settings.backgroundMode === 'gray'
        ? '鏡頭小畫面 · 灰色背景 · 本機處理' : '鏡頭小畫面 · 背景模糊 · 本機處理';
    }
    host.append(this.root);
    this.setVisible(options.preview ?? (Boolean(import.meta.env?.DEV) && DEV_POSE_PREVIEW));
  }

  setVisible(visible: boolean) { this.root.hidden = !visible; if (!visible) this.clear(); }

  clear() {
    if (this.hasFrame) this.personRenderer.clear();
    this.hasFrame = false;
    this.metrics.textContent = '';
  }

  setCalibration(profile?: CalibrationProfile) { this.calibration = profile ? { ...profile } : undefined; }

  update(frame: PoseFrame, pose: PoseSnapshot) {
    if (this.root.hidden) return;
    this.personRenderer.render(frame, {
      background: this.settings.backgroundProcessing ? this.settings.backgroundMode : 'none',
      showBodyKeypoints: this.settings.showBodyKeypoints,
      confidenceThreshold: this.settings.confidenceThreshold,
    });
    this.hasFrame = true;
    this.canvas.parentElement!.style.aspectRatio = `${this.canvas.width} / ${this.canvas.height}`;
    this.root.style.setProperty('--pose-preview-aspect', String(this.canvas.width / this.canvas.height));
    if (!this.debug) return;
    const angle = (value: number | undefined) => value === undefined ? '—' : `${value.toFixed(1)}°`;
    this.metrics.textContent = `L ${angle(pose.leftKneeAngle)} · R ${angle(pose.rightKneeAngle)} · ${angle(pose.activeKneeAngle)}\n${pose.state} · 信心 ${(pose.confidence * 100).toFixed(0)}%\n${frame.inferenceMs.toFixed(1)} ms · 平均 ${(frame.averageInferenceMs ?? frame.inferenceMs).toFixed(1)} ms · ${frame.poseFps.toFixed(1)} FPS`;
    const profile = this.calibration;
    if (profile) this.metrics.textContent += `\n基準 ${angle(profile.standingAngle)} / ${angle(profile.bendingAngle)}\n閾值 ${angle(profile.standingThreshold)} / ${angle(profile.bendingThreshold)}\n幅度 ${angle(profile.range)}`;
  }

  destroy() { this.calibration = undefined; this.clear(); this.root.remove(); }
}
