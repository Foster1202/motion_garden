import type { RabbitRigController } from './RabbitRigController';
import { RABBIT_INWARD_ARM_MAX_PLANE } from './rabbit3dConfig';

export const DEV_RABBIT_3D_DEBUG = import.meta.env.DEV &&
  (import.meta.env.VITE_DEV_RABBIT_3D_DEBUG === 'true' || new URLSearchParams(location.search).get('rabbit3dDebug') === '1');

export class Rabbit3DDebug {
  readonly root = document.createElement('details');
  private readonly status: HTMLElement;
  constructor(host: HTMLElement, rig: RabbitRigController) {
    this.root.className = 'rabbit-3d-debug';
    this.root.open = true;
    this.root.innerHTML = `<summary>骨骼測試 · ${rig.version.toUpperCase()}</summary><p>控制來源 · 手動滑桿。完成鏡頭動作設定後會自動交由體感控制。</p>`;
    const slider = (name: string, bone: string, min: number, max: number, step: number, apply: (value: number) => void) => {
      const label = document.createElement('label');
      label.innerHTML = `<span>${name} <output>0</output></span><small>${bone}</small>`;
      const input = document.createElement('input');
      input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = '0';
      input.setAttribute('aria-label', name);
      input.addEventListener('input', () => { label.querySelector('output')!.value = input.value; apply(Number(input.value)); });
      label.append(input); this.root.append(label);
    };
    const limits = rig.limits;
    for (const [side, label] of [['L', '左'], ['R', '右']] as const) {
      const apply = () => rig.setArmRotation(side,
        Number(this.root.querySelector<HTMLInputElement>(`[aria-label="${label}臂"]`)!.value),
        Number(this.root.querySelector<HTMLInputElement>(`[aria-label="${label}手肘"]`)!.value),
        Number(this.root.querySelector<HTMLInputElement>(`[aria-label="${label}臂前抬方向"]`)!.value));
      slider(`${label}臂`, `upper_arm.${side}`, 0, limits.arm.max, 1, apply);
      slider(`${label}手肘`, `forearm.${side}`, 0, limits.forearm.max, 1, apply);
      slider(`${label}臂前抬方向`, rig.armInwardEnabled ? '0° 側抬 / 90° 前抬 / 145° 內收' : '0° 側抬 / 90° 前抬',
        0, rig.armInwardEnabled ? RABBIT_INWARD_ARM_MAX_PLANE : 90, 1, apply);
    }
    slider('身體側傾', 'body', -limits.bodySide, limits.bodySide, 1, value => rig.setBodyLean(value, Number(this.root.querySelector<HTMLInputElement>('[aria-label="身體前後傾"]')!.value)));
    slider('身體前後傾', 'body', -limits.bodyForward, limits.bodyForward, 1, value => rig.setBodyLean(Number(this.root.querySelector<HTMLInputElement>('[aria-label="身體側傾"]')!.value), value));
    slider('頭部轉向', 'head + ears + face', -limits.headYaw, limits.headYaw, 1, value => rig.setHeadRotation(value));
    slider('淺屈膝', 'thigh / shin / foot · FK 近似', 0, 1, .01, value => rig.setKneeBend(value));
    slider('左右平移', 'root · model units', -.45, .45, .01, value => rig.setRootOffset(value, Number(this.root.querySelector<HTMLInputElement>('[aria-label="輕微高度"]')!.value), 0));
    slider('輕微高度', 'root · model units', 0, .04, .005, value => rig.setRootOffset(Number(this.root.querySelector<HTMLInputElement>('[aria-label="左右平移"]')!.value), value, 0));
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = '恢復自然站立';
    reset.addEventListener('click', () => {
      rig.resetPose();
      this.root.querySelectorAll('input').forEach(input => { input.value = '0'; });
      this.root.querySelectorAll('output').forEach(output => { output.value = '0'; });
    });
    this.root.append(reset);
    this.status = document.createElement('p'); this.status.className = 'rabbit-3d-status'; this.root.append(this.status);
    host.append(this.root);
  }
  update(fps: number) { this.status.textContent = `GLB 已載入 · ${fps.toFixed(1)} FPS`; }
  destroy() { this.root.remove(); }
}
