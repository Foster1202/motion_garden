import { TRACKING_MODE_LABEL } from '../vision/trackingMode';
import Phaser from 'phaser';
import { AppleHarvestInput, type AppleHarvestSample } from '../apple/AppleHarvestInput';
import { AppleHarvestRound, type AppleHarvestEvent } from '../apple/AppleHarvestRound';
import { AppleOrchardView } from '../apple/AppleOrchardView';
import { APPLE_CONFIG } from '../apple/appleConfig';
import { getGameSettings } from '../settings/gameSettings';
import { AudioManager } from '../systems/AudioManager';
import { tryVoiceCue } from '../systems/voiceCue';
import { Overlay, appleIcon } from '../ui/Overlay';
import { GameIntroLayout } from '../ui/GameIntroLayout';
import '../apple/appleHarvest.css';

type ScenePhase = 'loading' | 'intro' | 'camera-starting' | 'camera-ready' | 'playing' | 'paused'
  | 'camera-error' | 'art-error' | 'result';

const DIRECTION = { left: '← 左', right: '右 →' } as const;
const KEYBOARD_CONTROLS = 'A / D 或 ← / → 移動 · 按住 Q / E 抬手，放開落手';
const PICKED_HINT = '成功摘到蘋果！返去籃子啦！';

const COUNTDOWN_FRAMES = [
  { transform: 'translateX(-50%) scale(.45) rotate(-9deg)', opacity: 0, offset: 0 },
  { transform: 'translateX(-50%) scale(1.15) rotate(4deg)', opacity: 1, offset: .18 },
  { transform: 'translateX(-50%) scale(.96)', opacity: 1, offset: .32 },
  { transform: 'translateX(-50%) scale(1)', opacity: 1, offset: .5 },
  { transform: 'translate(-50%, -12px) scale(1.04)', opacity: 0, offset: 1 },
];
const SCORE_FRAMES = [
  { transform: 'translate(-50%, 15px) scale(.7)', opacity: 0, offset: 0 },
  { transform: 'translate(-50%, 0) scale(1.1)', opacity: 1, offset: .2 },
  { transform: 'translate(-50%, -16px) scale(1)', opacity: 1, offset: .7 },
  { transform: 'translate(-50%, -42px) scale(1)', opacity: 0, offset: 1 },
];

interface ClockEffect {
  element: HTMLElement;
  animation: Animation;
  time: number;
  duration: number;
}

export class AppleHarvestScene extends Phaser.Scene {
  private ui!: Overlay;
  private round!: AppleHarvestRound;
  private source!: AppleHarvestInput;
  private audio!: AudioManager;
  private view!: AppleOrchardView;
  private phase: ScenePhase = 'loading';
  private clockStarted = false;
  private skipDelta = false;
  private dead = false;
  private playerX = 0;
  private countdown: number | null = null;
  private wrongUntil = 0;
  private trackingLostAt?: number;
  private readyCue = false;
  private safetyCue = false;
  private trackingCue = false;
  private targetBadge!: HTMLElement;
  private trackingBadge!: HTMLElement;
  private effectsHost!: HTMLElement;
  private pauseButton!: HTMLButtonElement;
  private readonly effects = new Set<ClockEffect>();

  constructor() { super('AppleHarvest'); }

  create() {
    this.phase = 'loading';
    this.clockStarted = this.skipDelta = this.dead = false;
    this.playerX = this.wrongUntil = 0;
    this.countdown = null;
    this.trackingLostAt = undefined;
    this.readyCue = this.safetyCue = this.trackingCue = false;
    this.round = new AppleHarvestRound(getGameSettings().appleDurationSeconds);
    this.ui = new Overlay();
    this.ui.root.classList.add('apple-harvest-ui');
    this.audio = new AudioManager('apple');
    this.source = new AppleHarvestInput(() => this.togglePause(), message => this.cameraFailed(message));
    this.view = new AppleOrchardView(this, () => this.artFailed());
    this.renderHud();
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
    void this.prepareOrchard(this.view);
  }

  private async prepareOrchard(view: AppleOrchardView) {
    try {
      const loaded = await view.load();
      if (this.dead || this.view !== view || this.phase !== 'loading') return;
      if (!loaded) { this.artFailed(); return; }
      this.setPhase('intro');
      this.ui.dialog(new GameIntroLayout('apple', `
        <h2 id="dialog-title">同阿兔摘蘋果</h2>
        <ol class="apple-how-to">
          <li>跟住箭嘴，移去發光嘅蘋果樹。</li>
          <li>抬起一隻手至接近肩膊，再放低，摘一個蘋果。</li>
          <li>返去中間籃子，再抬手同放低，蘋果入籃就加一分。</li>
        </ol>
        <p class="game-intro-note">${this.round.durationMs / 1000} 秒挑戰 · 舒服咁郁動，隨時可以休息。</p>
        <div class="game-intro-actions">
          <button class="button primary" data-action="camera">開啟攝像頭</button>
          <button class="button secondary" data-action="keyboard">鍵盤試玩</button>
          <button class="button quiet" data-action="home">返回主頁</button>
        </div>`));
      this.ui.root.querySelector('dialog')?.classList.add('apple-dialog');
      this.ui.on('camera', () => void this.startCamera());
      this.ui.on('keyboard', () => this.useKeyboard());
      this.ui.on('home', () => { this.ui.closeModal(); this.home(); });
      this.ui.focus('camera');
    } catch {
      if (!this.dead && this.view === view) this.artFailed();
    }
  }

  private renderHud() {
    this.ui.render(`
      <header class="apple-hud">
        <h1>摘蘋果</h1>
        <div class="apple-hud-controls">
          <div class="apple-timer" data-apple-timer><span>剩餘時間</span><strong data-apple-time role="timer">${this.formatTime()}</strong></div>
          <div class="apple-score" aria-live="polite">${appleIcon}<span>收集 <b data-apple-score>0</b> 個</span></div>
          <button class="button secondary" data-action="pause" disabled>暫停</button>
          <button class="button quiet" data-action="home">主頁</button>
        </div>
      </header>
      <div class="apple-target" data-apple-target aria-live="polite" hidden>
        <span data-apple-target-title></span><strong data-apple-target-label></strong>
      </div>
      <div class="berry-effects" data-apple-effects aria-hidden="true"></div>
      <p class="apple-hint" data-apple-hint role="status">正在準備蘋果園同 3D 阿兔…</p>
      <footer class="apple-footer" data-apple-controls hidden></footer>
      <small class="person-status apple-tracking-status" data-apple-tracking hidden></small>`);
    this.targetBadge = this.ui.root.querySelector('[data-apple-target]')!;
    this.trackingBadge = this.ui.root.querySelector('[data-apple-tracking]')!;
    this.effectsHost = this.ui.root.querySelector('[data-apple-effects]')!;
    this.pauseButton = this.ui.root.querySelector('[data-action="pause"]')!;
    this.ui.on('pause', () => this.togglePause());
    this.ui.on('home', () => this.home());
  }

  private setPhase(phase: ScenePhase) {
    this.phase = phase;
    this.refreshTrackingStatus();
    this.pauseButton.disabled = phase !== 'playing' && phase !== 'camera-ready';
  }

  private async startCamera() {
    const source = this.source;
    this.ui.closeModal();
    this.setPhase('camera-starting');
    this.ui.text('[data-apple-hint]', '正在開啟鏡頭…');
    if (await source.startCamera(this.ui.root) && !this.dead && source === this.source && this.phase === 'camera-starting') {
      this.setPhase('camera-ready');
      this.showControls('體感操作 · 左右小步移動 · 抬手，再放低');
      this.ui.text('[data-apple-hint]', '放鬆雙手，畀鏡頭睇到肩膊、腰部同至少一隻手腕。');
      this.skipDelta = true;
    }
  }

  private useKeyboard() {
    this.ui.closeModal();
    this.source.useKeyboard();
    this.showControls(KEYBOARD_CONTROLS);
    this.clockStarted = true;
    this.resume();
    this.refreshHud();
  }

  private showControls(text: string) {
    const footer = this.ui.root.querySelector<HTMLElement>('[data-apple-controls]')!;
    footer.textContent = text;
    footer.hidden = false;
  }

  private cameraFailed(message: string) {
    if (this.dead || this.phase === 'result' || this.phase === 'art-error') return;
    this.freeze();
    this.setPhase('camera-error');
    this.ui.dialog(`
      <h2 id="dialog-title">鏡頭未能使用</h2><p data-apple-camera-error></p>
      <div class="dialog-actions">
        <button class="button primary" data-action="keyboard">使用鍵盤</button>
        <button class="button quiet" data-action="home">返回主頁</button>
      </div>`);
    this.ui.text('[data-apple-camera-error]', message);
    this.ui.on('keyboard', () => this.useKeyboard());
    this.ui.on('home', () => this.home());
  }

  private artFailed() {
    if (this.dead || this.phase === 'art-error' || this.phase === 'result') return;
    this.setPhase('art-error');
    this.audio.stopAll();
    this.source.destroy();
    this.view.destroy();
    this.clearEffects();
    this.targetBadge.hidden = true;
    this.ui.dialog(`<h2 id="dialog-title">蘋果園未能載入</h2>
      <p>未能顯示 3D 場景。請返回主頁再試。</p>
      <div class="dialog-actions"><button class="button primary" data-action="home">返回主頁</button></div>`);
    this.ui.on('home', () => this.home());
  }

  private togglePause() {
    if (this.phase === 'paused') { this.resume(); return; }
    if (this.phase === 'playing' || this.phase === 'camera-ready') this.pause(true);
  }

  private freeze() {
    this.round.paused = true;
    this.source.pause();
    this.audio.pause();
    this.trackingLostAt = undefined;
    this.trackingCue = false;
  }

  private pause(explicit = false) {
    this.freeze();
    this.setPhase('paused');
    if (explicit) tryVoiceCue(this.audio, 'rest', { allowWhilePaused: true });
    this.ui.dialog(`
      <h2 id="dialog-title">休息一陣先</h2><p>準備好再繼續，計時會由呢度開始。</p>
      <div class="dialog-actions">
        <button class="button primary" data-action="resume">繼續玩</button>
        ${this.source.mode === 'camera' ? '<button class="button secondary" data-action="keyboard">關閉鏡頭，改用鍵盤</button>' : ''}
        <button class="button secondary" data-action="restart">重新開始</button>
        <button class="button quiet" data-action="home">返回主頁</button>
      </div>`, () => this.resume());
    this.ui.on('resume', () => this.resume());
    this.ui.on('keyboard', () => this.useKeyboard());
    this.bindExitActions();
  }

  private resume() {
    if (this.dead || document.hidden) return;
    this.ui.closeModal();
    this.round.paused = false;
    this.source.resume();
    this.audio.stopVoice('rest');
    this.audio.resume();
    this.skipDelta = true;
    this.setPhase(this.clockStarted ? 'playing' : 'camera-ready');
  }

  private onBlur = () => {
    if (this.phase === 'playing' || this.phase === 'camera-ready') this.pause();
  };
  private onVisibility = () => { if (document.hidden) this.onBlur(); };

  update(_time: number, delta: number) {
    if (this.phase === 'intro' && !this.safetyCue) this.safetyCue = tryVoiceCue(this.audio, 'safety');
    if (this.phase !== 'playing' && this.phase !== 'camera-ready') return;
    if (document.hidden) { this.pause(); return; }
    if (this.skipDelta) { this.skipDelta = false; return; }
    const deltaMs = delta * this.time.timeScale;
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;

    const sample = this.source.update(Math.min(deltaMs, 100));
    this.refreshTrackingStatus();
    this.playerX = sample.x;
    if (!this.clockStarted) {
      if (!sample.lateralReliable || !this.source.hasCameraReference) {
        if (!this.readyCue) this.readyCue = tryVoiceCue(this.audio, 'calibrationStanding');
        return;
      }
      this.clockStarted = true;
      this.setPhase('playing');
    }

    const before = this.round.elapsedMs;
    const event = this.round.update(deltaMs, sample);
    if (this.round.complete && !event) {
      this.ui.text('[data-apple-time]', this.formatTime());
      this.finish();
      return;
    }
    const frame = { x: sample.x, target: this.round.carrying ? 'basket' as const : this.round.target, pose: sample.pose };
    this.view.update((this.round.elapsedMs - before) / 1000, frame);
    if (event) this.handleEvent(event);
    this.refreshHud(sample);
    if (this.round.complete) { this.finish(); return; }
    this.updateTrackingVoice(sample);
    this.updateEffects();
    this.showCountdown();
  }

  private handleEvent(event: AppleHarvestEvent) {
    switch (event.kind) {
      case 'picked':
        this.view.pick(event.tree, event.hand);
        this.wrongUntil = 0;
        this.audio.playSfx('grab');
        break;
      case 'wrong-tree':
        this.wrongUntil = this.round.elapsedMs + 1500;
        tryVoiceCue(this.audio, 'retry', { cooldownMs: 8000 });
        break;
      case 'depositing':
        this.view.deposit();
        break;
      case 'deposited':
        this.audio.playSfx('success');
        this.addEffect('berry-score-popup apple-score-popup', '🍎 +1', 1000, this.round.elapsedMs, SCORE_FRAMES);
        break;
    }
  }

  private refreshHud(sample?: AppleHarvestSample) {
    const basket = !!this.round.carrying;
    this.targetBadge.hidden = false;
    this.targetBadge.dataset.goal = basket ? 'basket' : this.round.target;
    this.ui.text('[data-apple-target-title]', basket ? '放入' : '目標樹');
    this.ui.text('[data-apple-target-label]', basket ? '籃子' : DIRECTION[this.round.target]);
    this.ui.text('[data-apple-score]', String(this.round.score));
    this.ui.text('[data-apple-time]', this.formatTime());
    this.ui.root.querySelector('[data-apple-timer]')?.setAttribute('data-urgent', String(this.round.remainingMs <= 10000));
    this.ui.text('[data-apple-hint]', this.hint(sample));
  }

  private hint(sample?: AppleHarvestSample) {
    if (this.round.depositing) return '蘋果就快落入籃子！';
    if (sample && !sample.lateralReliable) return '請畀鏡頭睇清楚肩膊同腰部。';
    if (sample && sample.left === null && sample.right === null) return '請畀鏡頭睇到至少一隻手腕。';
    if (this.round.elapsedMs < this.wrongUntil) return '請去指定嘅蘋果樹！';
    if (this.round.state === 'DEPOSITING') return '放低隻手，將蘋果放入籃子。';
    if (this.round.state === 'PICKING') return '放低隻手，完成採摘。';
    if (this.round.carrying) return Math.abs(this.playerX - APPLE_CONFIG.zones.basket.center) <= APPLE_CONFIG.zones.basket.radius
      ? '到籃子啦！抬起一隻手，再放低。' : PICKED_HINT;
    return '行到發光嘅樹旁，抬起一隻手，再放低。';
  }

  private refreshTrackingStatus() {
    const badge = this.trackingBadge;
    badge.hidden = this.source.mode !== 'camera' || (this.phase !== 'playing' && this.phase !== 'camera-ready');
    if (badge.hidden) return;
    const mode = this.source.trackingMode;
    if (badge.dataset.trackingMode === mode) return;
    badge.dataset.trackingMode = mode;
    badge.textContent = TRACKING_MODE_LABEL[mode];
  }

  private updateTrackingVoice(sample: AppleHarvestSample) {
    if (this.source.mode !== 'camera') return;
    if (sample.lateralReliable) {
      if (this.trackingLostAt !== undefined) this.audio.stopVoice('trackingLost');
      this.trackingLostAt = undefined;
      this.trackingCue = false;
      return;
    }
    this.trackingLostAt ??= this.round.elapsedMs;
    if (!this.trackingCue && this.round.elapsedMs - this.trackingLostAt >= 1500) {
      this.trackingCue = tryVoiceCue(this.audio, 'trackingLost', { cooldownMs: 15000 });
    }
  }

  private formatTime() {
    const seconds = Math.ceil(this.round.remainingMs / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  private showCountdown() {
    const seconds = Math.ceil(this.round.remainingMs / 1000);
    if (seconds > 10 || seconds === this.countdown) return;
    this.countdown = seconds;
    const element = this.addEffect('berry-countdown-digit', String(seconds), 1100,
      this.round.durationMs - seconds * 1000, COUNTDOWN_FRAMES);
    element.dataset.appleCountdown = String(seconds);
  }

  private addEffect(className: string, label: string, duration: number, time: number, keyframes: Keyframe[]) {
    const element = document.createElement('span');
    element.className = className;
    element.textContent = label;
    this.effectsHost.append(element);
    const frames = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? [{ transform: 'translateX(-50%)', opacity: 1 }] : keyframes;
    const animation = element.animate(frames, { duration, fill: 'both', easing: 'ease-out' });
    animation.pause();
    animation.currentTime = this.round.elapsedMs - time;
    this.effects.add({ element, animation, time, duration });
    return element;
  }

  private updateEffects() {
    for (const effect of this.effects) {
      const elapsed = this.round.elapsedMs - effect.time;
      if (elapsed < effect.duration) effect.animation.currentTime = elapsed;
      else { effect.animation.cancel(); effect.element.remove(); this.effects.delete(effect); }
    }
  }

  private clearEffects() {
    for (const { animation, element } of this.effects) { animation.cancel(); element.remove(); }
    this.effects.clear();
    this.countdown = null;
  }

  private finish() {
    this.setPhase('result');
    this.source.destroy();
    this.view.finish();
    this.clearEffects();
    this.audio.stopAll();
    this.audio.playSfx('complete');
    this.audio.playVoice('complete');
    this.targetBadge.hidden = true;
    this.ui.text('[data-apple-hint]', '挑戰完成！');
    this.ui.dialog(`
      <div class="berry-result-art apple-result-art">${appleIcon}</div>
      <h2 id="dialog-title">挑戰完成！</h2>
      <div class="berry-result-total"><span>本局收集蘋果</span><strong data-apple-result-score>${this.round.score}</strong><span>個</span></div>
      <p class="berry-result-duration">挑戰時間 <b data-apple-result-duration>${this.round.durationMs / 1000} 秒</b></p>
      <div class="dialog-actions">
        <button class="button primary" data-action="restart">再玩一次</button>
        <button class="button quiet" data-action="home">返回主頁</button>
      </div>`);
    this.ui.root.querySelector('dialog')?.classList.add('berry-results');
    this.bindExitActions();
  }

  private bindExitActions() {
    this.ui.on('restart', () => this.scene.restart());
    this.ui.on('home', () => this.home());
  }

  private home() { this.scene.start('Menu'); }

  private cleanup() {
    this.dead = true;
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.source.destroy();
    this.view.destroy();
    this.clearEffects();
    this.audio.destroy();
    this.ui.root.classList.remove('apple-harvest-ui');
    this.ui.destroy();
  }

  snapshot() {
    return {
      ...this.round.snapshot(),
      phase: this.phase,
      active: this.phase === 'playing',
      ready: this.phase !== 'loading' && this.phase !== 'art-error',
      paused: this.round.paused,
      countdown: this.countdown,
      mode: this.source.mode,
      playerX: this.playerX,
      input: this.source.trackingSnapshot(),
      view: this.view.snapshot(),
      audio: this.audio.snapshot(),
    };
  }
}
