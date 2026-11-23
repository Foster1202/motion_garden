import type { PoseFrame, PoseSnapshot } from './poseTypes';
import { copyCalibrationProfile, type CalibrationProfile } from '../calibration/calibrationTypes';
import { TRACKING_MODE_LABEL } from './trackingMode';
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
    this.personRenderer = new PersonOnlyRenderer(video, this.canvas, { nativeVideo: this.settings.lowPerformanceMode });
    this.root.style.setProperty('--pose-preview-aspect', String(this.canvas.width / this.canvas.height));
    this.metrics = this.root.querySelector<HTMLElement>('.pose-metrics')!;
    this.metrics.hidden = !this.debug;
    if (!this.settings.lowPerformanceMode && this.settings.backgroundProcessing) {
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

  setCalibration(profile?: CalibrationProfile) { this.calibration = profile ? copyCalibrationProfile(profile) : undefined; }

  update(frame: PoseFrame, pose: PoseSnapshot) {
    if (this.root.hidden) return;
    this.personRenderer.render(frame, {
      background: this.settings.lowPerformanceMode || !this.settings.backgroundProcessing ? 'none' : this.settings.backgroundMode,
      showBodyKeypoints: this.settings.showBodyKeypoints,
      confidenceThreshold: this.settings.confidenceThreshold,
    });
    this.hasFrame = true;
    this.canvas.parentElement!.style.aspectRatio = `${this.canvas.width} / ${this.canvas.height}`;
    this.root.style.setProperty('--pose-preview-aspect', String(this.canvas.width / this.canvas.height));
    if (!this.debug) return;
    const number = (value: number | undefined) => value === undefined ? '—' : value.toFixed(3);
    const angle = (value: number | undefined) => value === undefined ? '—' : `${value.toFixed(1)}°`;
    const mode = TRACKING_MODE_LABEL[pose.trackingMode ?? 'lost'];
    const measurement = pose.trackingMode === 'partial'
      ? `屈膝特徵 ${number(pose.partialBendSignal)} · 推算幅度 ${number(pose.estimatedBendAmount)}`
      : `L ${angle(pose.leftKneeAngle)} · R ${angle(pose.rightKneeAngle)} · ${angle(pose.activeKneeAngle)}`;
    const rows = [measurement, `${mode} · ${pose.state} · 信心 ${(pose.confidence * 100).toFixed(0)}%`,
      `${frame.inferenceMs.toFixed(1)} ms · 平均 ${(frame.averageInferenceMs ?? frame.inferenceMs).toFixed(1)} ms · ${frame.poseFps.toFixed(1)} FPS`];
    if (pose.reason) rows.push(pose.reason);
    const profile = this.calibration;
    if (profile && profile.metric !== 'partial') rows.push(
      `膝角基準 ${angle(profile.standingAngle)} / ${angle(profile.bendingAngle)}`,
      `膝角閾值 ${angle(profile.standingThreshold)} / ${angle(profile.bendingThreshold)}`);
    if (profile?.partial) rows.push(
      `特徵基準 ${number(profile.partial.standing)} / ${number(profile.partial.bending)}`,
      `特徵閾值 ${number(profile.partial.standingThreshold)} / ${number(profile.partial.bendingThreshold)}`);
    this.metrics.textContent = rows.join('\n');
  }

  destroy() { this.calibration = undefined; this.clear(); this.root.remove(); }
}
