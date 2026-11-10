import type { RabbitRigController } from './RabbitRigController';

/** Development-only controls survive the manual/mocap ownership switch. */
export class RabbitIKDebug {
  private readonly root = document.createElement('details');
  private readonly metrics = document.createElement('pre');
  private readonly enable = document.createElement('button');
  private readonly disable = document.createElement('button');
  private elapsed = 0;

  constructor(host: HTMLElement, private readonly rig: RabbitRigController) {
    this.root.className = 'rabbit-ik-debug';
    this.root.open = true;
    const summary = document.createElement('summary');
    summary.textContent = 'IK 與腳底接地';
    this.enable.type = this.disable.type = 'button';
    this.enable.textContent = '啟用 IK';
    this.disable.textContent = '停用 IK';
    this.enable.addEventListener('click', () => rig.setIKEnabled(true));
    this.disable.addEventListener('click', () => rig.setIKEnabled(false));
    this.root.append(summary, this.enable, this.disable, this.metrics);
    host.append(this.root);
    this.update(1);
  }

  update(seconds: number): void {
    this.elapsed += seconds;
    if (this.elapsed < .1) return;
    this.elapsed = 0;
    const data = this.rig.ikSnapshot();
    const feet = data.feet;
    const point = (value?: number[]) => value?.map(n => n.toFixed(3)).join(', ') ?? '—';
    this.enable.disabled = data.enabled || !data.available;
    this.disable.disabled = !data.enabled;
    this.metrics.textContent = [
      `IK ${data.enabled ? 'ON' : 'OFF'} · 混合 ${data.weight.toFixed(2)} · ${data.solverTimeMs.toFixed(3)} ms`,
      `左腳目標 ${point(feet?.left.target)}`,
      `右腳目標 ${point(feet?.right.target)}`,
      `Foot contact error ${feet?.maximumContactError.toFixed(6) ?? '—'}`,
      ...Object.entries(data.hands).map(([side, hand]) =>
        `${side} 手 ${point(hand.target)} · residual ${hand.residual.toFixed(4)}`),
      `Constraint clamp ${data.constraintClamped ? 'YES' : 'NO'}`,
    ].join('\n');
  }

  destroy(): void { this.root.remove(); }
}
