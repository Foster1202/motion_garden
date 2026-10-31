import type { CalibrationSnapshot } from './calibrationTypes';

export interface CalibrationPanelActions {
  bend(): void;
  retry(): void;
  restart(): void;
  play(): void;
  keyboard(): void;
}

export class CalibrationPanel {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly message: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly actions: HTMLElement;
  private state = '';
  private bendStarted = false;

  constructor(host: HTMLElement, private readonly callbacks: CalibrationPanelActions) {
    this.root = document.createElement('section');
    this.root.className = 'calibration-panel';
    this.root.setAttribute('aria-labelledby', 'calibration-title');
    this.root.innerHTML = `
      <p class="calibration-label">動作設定</p>
      <h2 id="calibration-title" tabindex="-1">第一步：自然企直</h2>
      <p class="calibration-message" role="status"></p>
      <p class="calibration-framing">頭到腳盡量留喺畫面內。去到舒服嘅位置就得，唔使蹲低。</p>
      <div class="calibration-progress" role="progressbar" aria-label="動作設定進度" aria-valuemin="0" aria-valuemax="100"><div></div></div>
      <div class="calibration-actions"></div>
      <button class="calibration-keyboard" data-calibration-action="keyboard">使用鍵盤測試</button>`;
    this.title = this.root.querySelector('h2')!;
    this.message = this.root.querySelector('.calibration-message')!;
    this.progress = this.root.querySelector('.calibration-progress')!;
    this.fill = this.progress.firstElementChild as HTMLElement;
    this.actions = this.root.querySelector('.calibration-actions')!;
    this.root.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-calibration-action]');
      const action = button?.dataset.calibrationAction as keyof CalibrationPanelActions | undefined;
      if (action && !button?.disabled) this.callbacks[action]?.();
    });
    host.append(this.root);
  }

  render(snapshot: CalibrationSnapshot) {
    const title = snapshot.state === 'COMPLETE' ? '設定完成！'
      : snapshot.state === 'FAILED' ? '我哋再試一次'
      : snapshot.state.startsWith('BEND') ? '第二步：慢慢屈膝' : '第一步：自然企直';
    if (this.title.textContent !== title) this.title.textContent = title;
    if (this.message.textContent !== snapshot.message) this.message.textContent = snapshot.message;
    const progress = Math.max(0, Math.min(1, snapshot.progress));
    this.fill.style.width = `${progress * 100}%`;
    this.progress.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    this.progress.hidden = !snapshot.state.endsWith('SAMPLING');
    if (this.state === snapshot.state && this.bendStarted === snapshot.bendStarted) return;
    this.bendStarted = snapshot.bendStarted;
    this.state = snapshot.state;
    this.root.dataset.calibrationState = snapshot.state;
    if (snapshot.state === 'COMPLETE') {
      this.actions.innerHTML = '<button class="button primary" data-calibration-action="play">開始遊戲</button><button class="button secondary" data-calibration-action="restart">重新設定</button>';
    } else if (snapshot.state === 'BEND_INSTRUCTIONS') {
      this.actions.innerHTML = `${snapshot.bendStarted ? '' : '<button class="button primary" data-calibration-action="bend">準備好，開始第二步</button>'}<button class="button secondary" data-calibration-action="restart">重新設定</button>`;
    } else if (snapshot.state === 'FAILED') {
      this.actions.innerHTML = '<button class="button primary" data-calibration-action="retry">再試一次</button><button class="button secondary" data-calibration-action="restart">重新設定</button>';
    } else {
      this.actions.innerHTML = '<button class="button secondary" data-calibration-action="restart">重新設定</button>';
    }
    if (snapshot.state === 'COMPLETE' || snapshot.state === 'FAILED' || snapshot.state === 'BEND_INSTRUCTIONS') {
      this.title.focus({ preventScroll: true });
    }
  }

  destroy() { this.root.remove(); }
}
