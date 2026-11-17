import type { MocapController } from './MocapController';
import type { MotionInputStatus } from '../input/MotionInput';

export const DEV_MOCAP_DEBUG = Boolean(import.meta.env.DEV &&
  (import.meta.env.VITE_DEV_MOCAP_DEBUG === 'true' || new URLSearchParams(location.search).get('mocapDebug') === '1'));

type Snapshot = ReturnType<MocapController['snapshot']>;
export interface MocapPipelineDiagnostics {
  generation?: number;
  gameplayReady?: boolean;
  visualReady?: boolean;
  gameWasReady?: boolean;
  renderMode?: string;
  purpose?: string;
  imageVisible?: boolean;
  textureExists?: boolean;
  rootClamped?: boolean;
  worldMovement?: unknown;
  worldBonePositions?: Record<string, number[]>;
}

const STAGES: Record<string, string> = {
  'A-no-fresh-frames': 'A · 等待新影像幀，檢查鏡頭和傳遞路徑',
  'controller-inactive': '控制器已停用或暫停',
  'B-human-pose-rejected': 'B · HumanPose 提取失敗，查看拒絕原因',
  'C-reference-pending': 'C · 參考姿勢尚未建立，查看採集條件',
  'D-reference-ready-awaiting-motion': 'D · 參考已建立，等待可見動作令映射目標改變',
  'E-target-changed-awaiting-bones': 'E · 目標已改變，等待實際骨骼響應，檢查寫入及限制',
  'F-bones-changed-awaiting-render': 'F · 骨骼已改變，等待 Three 渲染與 Phaser 紋理更新',
  'F-bones-changed-render-hidden': 'F · 骨骼已改變，Phaser 圖像隱藏或紋理不存在',
  'render-submitted': '骨骼與渲染提交已有更新，請對照畫面驗證可見效果',
};
const STATES: Record<string, string> = {
  disabled: '已停止', waiting: '等待鏡頭', 'acquiring-reference': '採集自然站立參考',
  tracking: '即時跟隨', holding: '暫時看不清，保持姿勢', 'returning-neutral': '緩慢回復中立',
  'reference-required': '請重設參考姿勢', disposed: '已釋放',
};

export class MocapDebug {
  readonly root = document.createElement('details');
  private readonly toggle = document.createElement('button');
  private readonly status = document.createElement('p');
  private readonly metrics = document.createElement('pre');
  private lastRender = -Infinity;

  constructor(host: HTMLElement, onToggle: () => void, onReference: () => void) {
    this.root.className = 'mocap-debug'; this.root.open = true;
    this.root.innerHTML = '<summary>即時動作同步 · 開發數據</summary><p>開啟鏡頭並完成動作設定後，請自然站穩、雙臂放鬆，阿兔會自動跟隨。</p>';
    this.toggle.type = 'button'; this.toggle.dataset.mocapAction = 'toggle';
    this.toggle.textContent = '切換控制來源';
    this.toggle.addEventListener('click', onToggle);
    const reset = document.createElement('button'); reset.type = 'button';
    reset.dataset.mocapAction = 'reference'; reset.textContent = '重設參考姿勢';
    reset.addEventListener('click', onReference);
    this.status.setAttribute('role', 'status');
    this.metrics.setAttribute('aria-label', '動作同步數據');
    this.root.append(this.toggle, reset, this.status, this.metrics); host.append(this.root);
  }

  update(snapshot: Snapshot, threeFps: number, input?: MotionInputStatus, pipeline: MocapPipelineDiagnostics = {}) {
    const now = performance.now();
    if (now - this.lastRender < 150) return;
    this.lastRender = now;
    this.toggle.hidden = pipeline.purpose === 'game';
    this.toggle.textContent = snapshot.enabled ? '改用手動骨骼測試' : '恢復自動體感同步';
    this.status.textContent = `${snapshot.paused ? '已暫停' : STATES[snapshot.trackingState] ?? snapshot.trackingState} · ${snapshot.message}`;
    const fmt = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
    const conditions = snapshot.referenceConditions.map(condition =>
      `${condition.pass ? 'PASS' : 'WAIT'} ${condition.name} ${fmt(condition.value)} / ${fmt(condition.limit)}`).join('\n');
    const raw = snapshot.raw;
    const stage = snapshot.bonePoseChanges > 0 && (pipeline.imageVisible === false || pipeline.textureExists === false)
      ? 'F-bones-changed-render-hidden' : snapshot.diagnosticStage;
    const lines = [
      `Person Detected ${Boolean(input?.personDetected)}`,
      `Calibration Complete ${Boolean(input?.calibrationReady)} · ${input?.calibrationState ?? 'IDLE'}`,
      `Camera Ready ${Boolean(input?.ready && input.cameraStatus === 'running')} · ${input?.cameraStatus ?? '未開啟'}`,
      `Mocap Enabled ${snapshot.enabled} · ${snapshot.controllerStatus}`,
      `Mirrored arms ${snapshot.mirrored}`,
      `Reference Ready ${snapshot.referenceReady}`,
      `Reference arms 3D ${fmt(snapshot.reference?.leftArmElevation)} / ${fmt(snapshot.reference?.rightArmElevation)}° · 2D ${fmt(snapshot.reference?.leftArmProjectedElevation)} / ${fmt(snapshot.reference?.rightArmProjectedElevation)}°`,
      `Reference Progress ${Math.round(snapshot.referenceProgress * 100)}% · samples ${snapshot.referenceAcceptedSamples}`,
      `Reference Rejection Reason ${snapshot.referenceRejectionReason ?? '無'}`,
      conditions,
      `Frames Received ${snapshot.framesReceived} · camera ${input?.framesReceived ?? 0} · ignored ${snapshot.ignoredFrames}`,
      `Human Poses Extracted ${snapshot.humanPosesExtracted}`,
      `Mapped Poses ${snapshot.mappedPoses} · target changes ${snapshot.mappedPoseChanges}`,
      `Mocap Tracking State ${snapshot.trackingState}`,
      `Pipeline ${STAGES[stage] ?? stage}`,
      `Last Frame Age ${fmt(snapshot.lastFrameAgeMs)} ms · last valid HumanPose ${fmt(snapshot.lastHumanPoseAgeMs)} ms`,
      `Last Rejection ${snapshot.lastRejection ?? '無'} · extraction ${snapshot.extractionRejection ?? '無'}`,
      `Raw Left/Right Arm Angle 3D ${fmt(raw?.leftArmElevation)} / ${fmt(raw?.rightArmElevation)}°`,
      `Raw Left/Right Arm Angle 2D ${fmt(raw?.leftArmProjectedElevation)} / ${fmt(raw?.rightArmProjectedElevation)}°`,
      `Raw Elbow 3D ${fmt(raw?.leftElbowBend)} / ${fmt(raw?.rightElbowBend)}°`,
      `Raw Elbow 2D ${fmt(raw?.leftElbowProjectedBend)} / ${fmt(raw?.rightElbowProjectedBend)}°`,
      `Raw Torso Lean ${fmt(raw?.torsoLean)}° · forward ${fmt(raw?.torsoForward)}°`,
      `Raw Knee Angle ${fmt(raw?.activeKneeAngle)}°`,
      `Root X target ${fmt(snapshot.mapped?.lateralOffset)} / applied ${fmt(snapshot.rootOffsetApplied)} model units · IK constrained ${pipeline.rootClamped ?? '—'}`,
      `Garden world movement ${JSON.stringify(pipeline.worldMovement) ?? '—'}`,
      `Update ticks ${snapshot.updateCount} · pose writes ${snapshot.poseWrites} · bone changes ${snapshot.bonePoseChanges}`,
      `Mapped change age ${fmt(snapshot.lastMappedChangeAgeMs)} ms · bone change age ${fmt(snapshot.lastBoneChangeAgeMs)} ms`,
      `Rendered frames ${snapshot.renderedFrames} · render age ${fmt(snapshot.lastRenderAgeMs)} ms`,
      `Phaser image visible ${pipeline.imageVisible ?? '—'} · texture exists ${pipeline.textureExists ?? '—'}`,
      `MediaPipe ${fmt(input?.poseFps ?? snapshot.mediaPipeFps)} FPS · Three ${fmt(threeFps)} FPS`,
      `Controller generation ${pipeline.generation ?? '—'} · ${pipeline.renderMode ?? '—'} / ${pipeline.purpose ?? '—'}`,
      `Inference ${fmt(snapshot.inferenceMs)} ms · average ${fmt(snapshot.averageInferenceMs)} ms`,
      `Game frame held ${pipeline.purpose === 'game' && Boolean(pipeline.gameWasReady && !pipeline.visualReady)}`,
      `gameplayReady ${pipeline.gameplayReady ?? '—'} · gameWasReady ${pipeline.gameWasReady ?? '—'}`,
      '', 'RabbitPose Targets', JSON.stringify(snapshot.mapped, null, 1) ?? '—',
      '', 'Slew-limited pose', JSON.stringify(snapshot.smoothed, null, 1),
      '', 'Final Bone Rotation (local quaternion)', JSON.stringify(snapshot.boneQuaternions, null, 1),
      '', 'Final Bone Position (local)', JSON.stringify(snapshot.bonePositions, null, 1),
      '', 'Final Bone Position (garden world)', JSON.stringify(pipeline.worldBonePositions, null, 1) ?? '—',
      '', 'Final Bone Delta Degrees', JSON.stringify(snapshot.boneDeltasDegrees, null, 1),
    ];
    this.metrics.textContent = lines.join('\n');
  }

  destroy() { this.root.remove(); }
}
