import type { MocapController } from './MocapController';

export const DEV_MOCAP_DEBUG = Boolean(import.meta.env.DEV &&
  (import.meta.env.VITE_DEV_MOCAP_DEBUG === 'true' || new URLSearchParams(location.search).get('mocapDebug') === '1'));

type Snapshot = ReturnType<MocapController['snapshot']>;
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
    this.root.innerHTML = '<summary>Task 4B · 即時動作同步</summary><p>開啟鏡頭即可開始；自然站穩、雙臂放鬆，模型會自動建立短暫動作參考。</p><p>阿兔的解剖左臂在畫面右側；鏡頭小畫面採鏡像顯示。</p>';
    this.toggle.type = 'button'; this.toggle.dataset.mocapAction = 'toggle';
    this.toggle.textContent = '啟用即時動作同步';
    this.toggle.addEventListener('click', onToggle);
    const reset = document.createElement('button'); reset.type = 'button';
    reset.dataset.mocapAction = 'reference'; reset.textContent = '重設參考姿勢';
    reset.addEventListener('click', onReference);
    this.status.setAttribute('role', 'status');
    this.metrics.setAttribute('aria-label', '動作同步數據');
    this.root.append(this.toggle, reset, this.status, this.metrics); host.append(this.root);
  }

  update(snapshot: Snapshot, threeFps: number) {
    const now = performance.now();
    if (now - this.lastRender < 150) return;
    this.lastRender = now;
    this.toggle.textContent = snapshot.enabled ? '停止動作同步' : '啟用即時動作同步';
    this.status.textContent = `${snapshot.paused ? '已暫停' : STATES[snapshot.trackingState] ?? snapshot.trackingState} · ${snapshot.message}`;
    const fmt = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
    const pose = snapshot.smoothed;
    this.metrics.textContent = `MediaPipe ${fmt(snapshot.mediaPipeFps)} FPS · Three ${fmt(threeFps)} FPS\n參考 ${Math.round(snapshot.referenceProgress * 100)}% · 信心 ${fmt(pose.trackingConfidence)}\n左臂 ${fmt(pose.leftArmElevation)}° · 右臂 ${fmt(pose.rightArmElevation)}°\n側傾 ${fmt(pose.torsoLean)}° · 屈膝 ${fmt(pose.bendAmount)}\n平移 ${fmt(pose.lateralOffset)} · 拒絕幀 ${snapshot.rejectedFrames}\n\n原始 HumanPose\n${JSON.stringify(snapshot.raw ?? null, null, 1)}\n目標 RabbitPose\n${JSON.stringify(snapshot.mapped ?? null, null, 1)}\n限速 RabbitPose\n${JSON.stringify(pose, null, 1)}\n實際骨骼相對 Rest 角度\n${JSON.stringify(snapshot.boneDeltasDegrees, null, 1)}`;
  }

  destroy() { this.root.remove(); }
}
