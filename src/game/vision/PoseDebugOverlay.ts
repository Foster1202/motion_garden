import type { PoseFrame, PoseSnapshot } from './poseTypes';
import { copyCalibrationProfile, type CalibrationProfile } from '../calibration/calibrationTypes';
import { TRACKING_MODE_LABEL } from './trackingMode';
import { PersonOnlyRenderer } from './PersonOnlyRenderer';
import { getGameSettings } from '../settings/gameSettings';

export const DEV_POSE_DEBUG = false;

export class PoseDebugOverlay {
  readonly root: HTMLElement;
  private readonly media: HTMLElement;
  private readonly personRenderer: PersonOnlyRenderer;
  private readonly metrics: HTMLElement;
  private readonly debug: boolean;
  private calibration?: CalibrationProfile;
  private readonly settings = getGameSettings();
  private readonly processBackground = !this.settings.lowPerformanceMode && this.settings.backgroundProcessing;
  private hasFrame = false;

  constructor(host: HTMLElement, private readonly video: HTMLVideoElement,
    options: { debug?: boolean; preview?: boolean; paused?: boolean } = {}) {
    this.debug = options.debug ?? Boolean(import.meta.env?.DEV && (DEV_POSE_DEBUG || import.meta.env?.VITE_POSE_DEBUG === 'true'));
    this.root = document.createElement('aside');
    this.root.className = 'pose-preview';
    this.root.setAttribute('aria-label', '鏡頭小畫面');
    this.root.innerHTML = '<div class="pose-preview-media"></div><p class="pose-preview-label">鏡頭小畫面 · 本機處理</p><p class="pose-metrics"></p>';
    this.media = this.root.querySelector<HTMLElement>('.pose-preview-media')!;
    video.classList.add('pose-video');
    video.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    this.media.append(video, canvas);
    this.personRenderer = new PersonOnlyRenderer(video, canvas, { nativeVideo: !this.processBackground, paused: options.paused });
    video.addEventListener('resize', this.syncAspect);
    this.syncAspect();
    this.metrics = this.root.querySelector<HTMLElement>('.pose-metrics')!;
    this.metrics.hidden = !this.debug;
    if (this.processBackground) {
      this.root.querySelector('.pose-preview-label')!.textContent = this.settings.backgroundMode === 'gray'
        ? '鏡頭小畫面 · 灰色背景 · 本機處理' : '鏡頭小畫面 · 背景模糊 · 本機處理';
    }
    host.append(this.root);
    this.setVisible(options.preview ?? true);
  }

  setVisible(visible: boolean) { this.root.hidden = !visible; if (!visible) this.clear(); }

  setPaused(paused: boolean) {
    this.personRenderer.setPaused(paused);
    if (paused) this.clear();
  }

  clear() {
    if (this.hasFrame) this.personRenderer.clear();
    this.hasFrame = false;
    this.metrics.textContent = '';
  }

  setCalibration(profile?: CalibrationProfile) { this.calibration = profile ? copyCalibrationProfile(profile) : undefined; }

  update(frame: PoseFrame, pose: PoseSnapshot) {
    if (this.root.hidden) return;
    this.personRenderer.render(frame, {
      background: this.processBackground ? this.settings.backgroundMode : 'none',
      showBodyKeypoints: this.settings.showBodyKeypoints,
      confidenceThreshold: this.settings.confidenceThreshold,
    });
    this.hasFrame = true;
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

  private readonly syncAspect = () => {
    const { videoWidth: width, videoHeight: height } = this.video;
    if (!width || !height) return;
    this.media.style.aspectRatio = `${width} / ${height}`;
    this.root.style.setProperty('--pose-preview-aspect', String(width / height));
  };

  destroy() {
    this.video.removeEventListener('resize', this.syncAspect);
    this.calibration = undefined;
    this.clear();
    this.root.remove();
  }
}
