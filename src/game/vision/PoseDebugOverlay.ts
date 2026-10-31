import type { PoseFrame, PoseSnapshot } from './poseTypes';
import type { CalibrationProfile } from '../calibration/calibrationTypes';

export const DEV_POSE_DEBUG = false;
export const DEV_POSE_PREVIEW = true;
const LINKS = [[11,12],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]] as const;

export class PoseDebugOverlay {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly metrics: HTMLElement;
  private readonly debug: boolean;
  private calibration?: CalibrationProfile;

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
    this.canvas.width = 320;
    this.canvas.height = 180;
    this.canvas.hidden = !this.debug;
    this.canvas.setAttribute('aria-hidden', 'true');
    media.append(this.canvas);
    this.metrics = this.root.querySelector<HTMLElement>('.pose-metrics')!;
    this.metrics.hidden = !this.debug;
    host.append(this.root);
    this.setVisible(options.preview ?? (Boolean(import.meta.env?.DEV) && DEV_POSE_PREVIEW));
  }

  setVisible(visible: boolean) { this.root.hidden = !visible; }

  setCalibration(profile?: CalibrationProfile) { this.calibration = profile ? { ...profile } : undefined; }

  update(frame: PoseFrame, pose: PoseSnapshot) {
    if (!this.debug) return;
    const angle = (value: number | undefined) => value === undefined ? '—' : `${value.toFixed(1)}°`;
    this.metrics.textContent = `L ${angle(pose.leftKneeAngle)} · R ${angle(pose.rightKneeAngle)} · ${angle(pose.activeKneeAngle)}\n${pose.state} · 信心 ${(pose.confidence * 100).toFixed(0)}%\n${frame.inferenceMs.toFixed(1)} ms · 平均 ${(frame.averageInferenceMs ?? frame.inferenceMs).toFixed(1)} ms · ${frame.poseFps.toFixed(1)} FPS`;
    const profile = this.calibration;
    if (profile) this.metrics.textContent += `\n基準 ${angle(profile.standingAngle)} / ${angle(profile.bendingAngle)}\n閾值 ${angle(profile.standingThreshold)} / ${angle(profile.bendingThreshold)}\n幅度 ${angle(profile.range)}`;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 320, 180);
    const landmarks = frame.landmarks;
    if (!landmarks) return;
    ctx.strokeStyle = '#e9ff64';
    ctx.fillStyle = '#e9ff64';
    ctx.lineWidth = 2;
    for (const [a,b] of LINKS) {
      const first = landmarks[a], second = landmarks[b];
      if (!first || !second || (first.visibility ?? 0) < .5 || (second.visibility ?? 0) < .5) continue;
      ctx.beginPath();
      ctx.moveTo(first.x * 320, first.y * 180);
      ctx.lineTo(second.x * 320, second.y * 180);
      ctx.stroke();
    }
    for (const index of [11,12,23,24,25,26,27,28]) {
      const point = landmarks[index];
      if (!point || (point.visibility ?? 0) < .5) continue;
      ctx.beginPath();ctx.arc(point.x * 320, point.y * 180, 3, 0, Math.PI * 2);ctx.fill();
    }
  }

  destroy() { this.calibration = undefined; this.root.remove(); }
}
