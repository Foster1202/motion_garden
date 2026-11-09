import type { MocapController } from './MocapController';
import type { MotionInputStatus } from '../input/MotionInput';

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
    this.root.innerHTML = '<summary>即時動作同步 · 開發數據</summary><p>開啟鏡頭並完成動作設定後，請自然站穩、雙臂放鬆，阿兔會自動跟隨。</p><p>阿兔的解剖左臂在畫面右側；鏡頭小畫面採鏡像顯示。</p>';
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

  update(snapshot: Snapshot, threeFps: number, input?: MotionInputStatus) {
    const now = performance.now();
    if (now - this.lastRender < 150) return;
    this.lastRender = now;
    this.toggle.textContent = snapshot.enabled ? '改用手動骨骼測試' : '恢復自動體感同步';
    this.status.textContent = `${snapshot.paused ? '已暫停' : STATES[snapshot.trackingState] ?? snapshot.trackingState} · ${snapshot.message}`;
    const fmt = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
    const pose = snapshot.smoothed;
    const camera = { initializing: '準備中', running: '運作中', paused: '已暫停', stopped: '已停止' };
    const reference = snapshot.referenceReady ? '已建立' : `等待自然站立 ${Math.round(snapshot.referenceProgress * 100)}%`;
    this.metrics.textContent = `鏡頭 ${input?.cameraStatus ? camera[input.cameraStatus] : '未開啟'} · 人物 ${input?.personDetected ? '已偵測' : '未偵測'}\n動作設定 ${input?.calibrationState ?? 'IDLE'} · ${input?.calibrationReady ? '已完成' : '等待完成'}\n動作參考 ${reference}\n同步控制器 ${snapshot.controllerStatus}\n控制來源 ${snapshot.enabled ? '體感同步' : '手動滑桿'}\nMediaPipe ${fmt(input?.poseFps ?? snapshot.mediaPipeFps)} FPS · Three.js ${fmt(threeFps)} FPS\n影像推理幀 ${input?.framesReceived ?? 0} · 同步收到 ${snapshot.framesReceived}\n人體姿勢 ${snapshot.humanPosesExtracted} · 有效映射 ${snapshot.mappedPoses}\n左臂目標 ${fmt(snapshot.mapped?.leftArmElevation)}° · 實際 ${fmt(snapshot.boneDeltasDegrees['upper_arm.L'])}°\n右臂目標 ${fmt(snapshot.mapped?.rightArmElevation)}° · 實際 ${fmt(snapshot.boneDeltasDegrees['upper_arm.R'])}°\n前抬方向 左 ${fmt(pose.leftArmPlane)}° / 右 ${fmt(pose.rightArmPlane)}°\n軀幹側傾 ${fmt(pose.torsoLean)}° · 前傾 ${fmt(pose.torsoForward)}°\n屈膝幅度 ${fmt(pose.bendAmount)} · 平移 ${fmt(pose.lateralOffset)}\n拒絕幀 ${snapshot.rejectedFrames} · 原因 ${snapshot.lastRejection ?? '無'}\n\n限速後姿態\n${JSON.stringify(pose, null, 1)}\n實際骨骼相對自然站姿角度\n${JSON.stringify(snapshot.boneDeltasDegrees, null, 1)}`;
  }

  destroy() { this.root.remove(); }
}
