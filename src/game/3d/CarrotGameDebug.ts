export const DEV_CARROT_GAME_DEBUG = import.meta.env.DEV &&
  new URLSearchParams(location.search).get('carrotGameDebug') === '1';
export const DEV_CARROT_GAME_SIM = import.meta.env.DEV &&
  new URLSearchParams(location.search).get('carrotGameSim') === '1';

export class CarrotGameDebug {
  private readonly root = document.createElement('details');
  private readonly metrics = document.createElement('pre');
  private elapsed = 0;

  constructor(host: HTMLElement, private readonly snapshot: () => unknown) {
    this.root.className = 'carrot-game-debug';
    this.root.open = true;
    const summary = document.createElement('summary');
    summary.textContent = '拔蘿蔔即時遊戲數據';
    this.root.append(summary, this.metrics);
    host.append(this.root);
  }

  update(seconds: number) {
    this.elapsed += seconds;
    if (this.elapsed < .15) return;
    this.elapsed = 0;
    this.metrics.textContent = JSON.stringify(this.snapshot(), (_key, value) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10000) / 10000 : value, 2);
  }

  destroy() { this.root.remove(); }
}
