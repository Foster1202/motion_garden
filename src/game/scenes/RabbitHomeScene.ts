import Phaser from 'phaser';
import { createHomeIntroDemo } from '../home/HomeIntroDemo';
import { HomeJourneyView } from '../home/HomeJourneyView';
import { RabbitHomeInput } from '../home/RabbitHomeInput';
import { HOME_END, HOME_LANTERNS, HOME_STAGES, RabbitHomeRound, type HomeStep } from '../home/RabbitHomeRound';
import { AudioManager } from '../systems/AudioManager';
import { tryVoiceCue } from '../systems/voiceCue';
import { GameIntroLayout } from '../ui/GameIntroLayout';
import { Overlay, homeIcon } from '../ui/Overlay';
import '../home/rabbitHome.css';

type HomePhase = 'intro' | 'camera-starting' | 'camera-ready' | 'playing' | 'paused' | 'restart'
  | 'camera-error' | 'arrival' | 'result';

const CAMERA_TRACKING = { full: '鏡頭追蹤正常', partial: '鏡頭追蹤膝頭', lost: '正在尋找動作' };
const KEYBOARD_HELP = 'Q ／ E 交替踏步　← ／ → 換路';
const ARRIVAL_REVEAL_MS = 2600;

export class RabbitHomeScene extends Phaser.Scene {
  private ui!: Overlay;
  private round!: RabbitHomeRound;
  private source!: RabbitHomeInput;
  private audio!: AudioManager;
  private view!: HomeJourneyView;
  private phase: HomePhase = 'intro';
  private pauseButton!: HTMLButtonElement;
  private journeyProgress!: HTMLProgressElement;
  private trackingBadge!: HTMLElement;
  private stageDots!: HTMLElement[];
  private arrivalAt = 0;
  private lanternAt = -Infinity;
  private lostAt?: number;
  private lostCue = false;
  private standingCue = false;
  private skipDelta = false;
  private dead = false;
  private hudKey = '';

  constructor() { super('RabbitHome'); }

  create() {
    this.dead = this.skipDelta = this.lostCue = this.standingCue = false;
    this.lostAt = undefined;
    this.hudKey = '';
    this.arrivalAt = 0;
    this.lanternAt = -Infinity;
    this.round = new RabbitHomeRound();
    this.ui = new Overlay();
    this.ui.root.classList.add('rabbit-home-ui');
    this.audio = new AudioManager('home');
    this.source = new RabbitHomeInput(() => this.togglePause(), message => this.cameraFailed(message));
    this.view = new HomeJourneyView(this);
    this.renderHud();
    this.drawWorld();
    this.showIntro();
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
  }

  private renderHud() {
    this.ui.render(`
      <header class="rabbit-home-hud">
        <h1>阿兔回家</h1>
        <div class="home-progress">
          <div class="home-progress-label">
            <strong data-home-stage></strong><span><b data-home-distance>0</b> ／ ${HOME_END} 步</span>
          </div>
          <div class="home-progress-track">
            <progress aria-label="回家路程" max="${HOME_END}" value="0"></progress>
            ${HOME_STAGES.slice(1).map(stage => `<i style="--marker:${stage.start / HOME_END * 100}%"></i>`).join('')}
          </div>
          <div class="home-progress-stages" aria-hidden="true">
            ${HOME_STAGES.map(stage => `<span data-home-stage-dot>${stage.name}</span>`).join('')}
          </div>
        </div>
        <div class="rabbit-home-actions">
          <button class="button secondary" data-action="pause">暫停</button>
          <button class="button quiet" data-action="home">主頁</button>
        </div>
      </header>
      <div class="home-lantern-count"><span aria-hidden="true" class="home-lantern-icon"></span>
        <span>燈籠 <b data-home-lanterns>0</b> ／ ${HOME_LANTERNS.length}</span>
      </div>
      <div class="home-instructions">
        <div class="home-footprints" aria-hidden="true">
          <span data-home-foot="left">左</span><span data-home-foot="right">右</span>
        </div>
        <p data-home-hint role="status"></p>
        <p class="home-control-hint" data-home-controls></p>
      </div>
      <small class="person-status home-tracking" data-home-tracking role="status" hidden></small>`);
    this.pauseButton = this.ui.root.querySelector('[data-action="pause"]')!;
    this.journeyProgress = this.ui.root.querySelector('progress')!;
    this.trackingBadge = this.ui.root.querySelector('[data-home-tracking]')!;
    this.stageDots = [...this.ui.root.querySelectorAll<HTMLElement>('[data-home-stage-dot]')];
    this.ui.on('pause', () => this.togglePause());
    this.ui.on('home', () => this.home());
  }

  private showIntro() {
    this.source.pause();
    this.setPhase('intro');
    this.ui.dialog(new GameIntroLayout('home', `
      <h2 id="dialog-title">阿兔回家</h2>
      <p>天就黑喇！跟住螢火蟲，陪阿兔返屋企。</p>
      <ul class="home-how-to">
        <li><strong>原地踏步</strong><span>左右腳輪流輕輕抬起再放低，阿兔就會向前行。</span></li>
        <li><strong>輕輕左右移</strong><span>見到箭嘴就輕輕向嗰邊移，換好路再繼續踏步。</span></li>
      </ul>
      <p class="game-intro-note">大約 2–3 分鐘。唔使向前行，攰就停低休息。</p>
      <p class="game-intro-detail">鍵盤：${KEYBOARD_HELP}</p>
      <div class="game-intro-actions">
        <button class="button primary" data-action="camera">開啟攝像頭</button>
        <button class="button secondary" data-action="keyboard">鍵盤試玩</button>
        <button class="button quiet" data-action="home">返回主頁</button>
      </div>`, createHomeIntroDemo()));
    this.bindHome();
    this.ui.on('camera', () => void this.startCamera());
    this.ui.on('keyboard', () => this.useKeyboard());
    this.ui.focus('camera');
  }

  private async startCamera() {
    const input = this.source;
    this.ui.closeModal();
    this.setPhase('camera-starting');
    this.source.resume();
    tryVoiceCue(this.audio, 'safety');
    const started = await input.startCamera(this.ui.root);
    if (started && !this.dead && input === this.source && this.phase === 'camera-starting') {
      this.setPhase('camera-ready');
    }
  }

  private cameraFailed(message: string) {
    if (this.dead || this.phase === 'result' || this.phase === 'arrival') return;
    this.source.pause();
    this.audio.pause();
    this.setPhase('camera-error');
    this.ui.dialog(`
      <h2 id="dialog-title">鏡頭未能使用</h2>
      <p data-home-camera-error></p>
      <div class="dialog-actions">
        <button class="button primary" data-action="keyboard">使用鍵盤</button>
        <button class="button quiet" data-action="home">返回主頁</button>
      </div>`);
    this.ui.text('[data-home-camera-error]', message);
    this.ui.on('keyboard', () => this.useKeyboard());
    this.bindHome();
    this.ui.focus('keyboard');
  }

  private useKeyboard() {
    this.source.useKeyboard();
    this.resume();
  }

  private setPhase(phase: HomePhase) {
    this.phase = phase;
    this.ui.root.dataset.homePhase = phase;
    this.pauseButton.disabled = phase !== 'playing' && phase !== 'camera-ready';
    this.refreshHud();
  }

  private togglePause() {
    if (this.phase === 'paused') this.resume();
    else if (this.phase === 'restart') this.showPause();
    else if (this.phase === 'playing' || this.phase === 'camera-ready') this.pause(true);
  }

  private pause(explicit = false) {
    this.source.pause();
    this.audio.pause();
    this.lostAt = undefined;
    this.lostCue = false;
    if (explicit) tryVoiceCue(this.audio, 'rest', { allowWhilePaused: true });
    this.showPause();
  }

  private showPause() {
    this.setPhase('paused');
    this.ui.dialog(`
      <h2 id="dialog-title">休息一陣先</h2>
      <p>阿兔喺度等你。準備好就繼續行啦！</p>
      <div class="dialog-actions">
        <button class="button primary" data-action="resume">繼續玩</button>
        ${this.source.mode === 'camera' ? '<button class="button secondary" data-action="keyboard">關閉鏡頭，改用鍵盤</button>' : ''}
        <button class="button secondary" data-action="restart">重新開始</button>
        <button class="button quiet" data-action="home">返回主頁</button>
      </div>`, () => this.resume());
    this.ui.on('resume', () => this.resume());
    this.ui.on('keyboard', () => this.useKeyboard());
    this.ui.on('restart', () => this.confirmRestart());
    this.bindHome();
    this.ui.focus('resume');
  }

  private confirmRestart() {
    this.setPhase('restart');
    this.ui.dialog(`
      <h2 id="dialog-title">由頭再行？</h2>
      <p>重新開始會由森林入口出發。</p>
      <div class="dialog-actions">
        <button class="button secondary" data-action="confirm-restart">重新開始</button>
        <button class="button primary" data-action="cancel-restart">返回暫停</button>
      </div>`, () => this.showPause());
    this.ui.on('confirm-restart', () => this.scene.restart());
    this.ui.on('cancel-restart', () => this.showPause());
    this.ui.focus('cancel-restart');
  }

  private resume() {
    if (this.dead || document.hidden) return;
    this.ui.closeModal();
    this.source.resume();
    this.audio.stopVoice('rest');
    this.audio.resume();
    this.skipDelta = true;
    const waitingForReference = this.source.mode === 'camera' && !this.source.hasCameraReference;
    this.setPhase(waitingForReference ? 'camera-ready' : 'playing');
    this.ui.focus('pause');
  }

  private onBlur = () => {
    if (this.phase === 'playing' || this.phase === 'camera-ready') this.pause();
  };

  private onVisibility = () => {
    if (document.hidden) {
      this.onBlur();
      this.skipDelta = true;
    } else if (this.phase === 'camera-ready' && !document.hasFocus()) {
      this.pause();
    }
  };

  update(_time: number, delta: number) {
    if (this.dead || document.hidden || this.phase === 'paused' || this.phase === 'restart'
      || this.phase === 'camera-error' || this.phase === 'result') return;
    if (this.skipDelta) { this.skipDelta = false; return; }
    this.round.advanceTime(Math.min(delta, 100));

    if (this.phase === 'playing' || this.phase === 'camera-ready') {
      const sample = this.source.update();
      if (this.phase === 'camera-ready' && this.source.cameraReadyForSteps) {
        this.audio.stopVoice('calibrationStanding');
        this.setPhase('playing');
      }
      if (this.phase === 'playing') {
        if (sample.lane !== null) this.round.selectLane(sample.lane);
        for (const { foot, timeMs } of sample.steps) {
          const step = this.round.takeStep(foot, timeMs);
          if (step) this.onStep(step);
        }
      }
      this.refreshHud();
      this.updateTrackingVoice();
    }

    this.drawWorld();
    if (this.phase === 'arrival' && this.round.timeMs - this.arrivalAt >= ARRIVAL_REVEAL_MS) this.showResult();
  }

  private onStep(step: HomeStep) {
    if (step.lantern) this.lanternAt = this.round.timeMs;
    if (step.arrived) {
      this.arrivalAt = this.round.timeMs;
      this.source.destroy();
      this.audio.stopAll();
      this.audio.playSfx('complete');
      this.setPhase('arrival');
    } else {
      this.audio.playSfx(step.lantern || step.crossing || step.newStage ? 'success' : 'grab');
    }
  }

  private drawWorld() {
    const { distance, lane, lastFoot, lanterns, timeMs, sinceStepMs, arrived, blocked } = this.round;
    this.view.update({
      distance, steps: distance, lane, lastFoot, lanterns, timeMs, arrived, blocked,
      gate: this.round.nextGate, moving: sinceStepMs < 600,
    });
  }

  private refreshHud() {
    const { distance, lanterns, stageIndex, lane, lastFoot, sinceStepMs, blocked } = this.round;
    const lit = this.round.timeMs - this.lanternAt < 1400;
    const foot = sinceStepMs < 410 ? lastFoot ?? '' : '';
    const mode = this.source.mode === 'camera' ? this.source.trackingMode : 'keyboard';
    const hint = this.hint();
    const key = [this.phase, distance, lane, blocked, lit, foot, mode, hint].join('|');
    if (key === this.hudKey) return;
    this.hudKey = key;
    const root = this.ui.root;
    root.dataset.homeLane = String(lane);
    root.dataset.homeBlocked = String(blocked);
    root.dataset.homeFoot = foot;
    root.dataset.homeLit = String(lit);
    if (this.journeyProgress.value !== distance) this.journeyProgress.value = distance;
    this.ui.text('[data-home-distance]', String(distance));
    this.ui.text('[data-home-stage]', HOME_STAGES[stageIndex].name);
    this.ui.text('[data-home-lanterns]', String(lanterns));
    this.stageDots.forEach((dot, index) => { dot.toggleAttribute('data-current', index === stageIndex); });
    this.ui.text('[data-home-hint]', hint);
    const activeInput = this.phase === 'playing' || this.phase === 'camera-ready';
    this.ui.text('[data-home-controls]', activeInput ? this.controlHint() : '');
    this.trackingBadge.hidden = !activeInput && this.phase !== 'camera-starting';
    this.trackingBadge.dataset.trackingMode = mode;
    this.ui.text('[data-home-tracking]', this.phase === 'camera-starting' ? '正在開啟鏡頭'
      : mode === 'keyboard' ? '鍵盤模式' : CAMERA_TRACKING[mode]);
  }

  private controlHint() {
    if (this.source.mode === 'keyboard') return KEYBOARD_HELP;
    const gate = this.round.nextGate;
    if (gate && gate.at - this.round.distance <= 8 && gate.lane !== this.round.lane) {
      return '移完企返中間，就可以再換路';
    }
    return '輪流抬腳，再輕輕放低';
  }

  private hint() {
    if (this.phase === 'arrival' || this.phase === 'result') return '好叻！阿兔返到屋企啦！';
    if (this.phase === 'camera-starting') return '正在開啟鏡頭…';
    if (this.phase === 'camera-ready') return '面向鏡頭企定，畀鏡頭睇到肩膊、腰同膝頭。';
    if (this.source.mode === 'camera') {
      if (this.source.trackingMode === 'lost') return '阿兔等緊你。畀鏡頭睇到肩膊、腰同膝頭，再繼續。';
      if (!this.source.cameraReadyForSteps) return '雙腳放返落地，企定一陣再踏步。';
    }
    const gate = this.round.nextGate;
    if (gate && gate.at - this.round.distance <= 8) {
      if (gate.lane === this.round.lane) return '對喇！繼續踏步過橋。';
      return gate.lane < 0 ? '← 輕輕向左，去木橋嗰邊' : '輕輕向右，去木橋嗰邊 →';
    }
    if (this.round.timeMs - this.lanternAt < 1400) return '叮！點亮咗一盞燈籠！';
    if (this.round.distance >= 103) return '好叻！就快到屋企啦';
    if (this.round.stageIndex > 0) return '繼續向前，原地踏步';
    return '原地踏步，跟住螢火蟲';
  }

  private updateTrackingVoice() {
    if (this.source.mode !== 'camera' || this.phase === 'arrival') return;
    if (this.phase === 'camera-ready') {
      if (!this.standingCue) this.standingCue = tryVoiceCue(this.audio, 'calibrationStanding');
      return;
    }
    if (this.source.trackingMode !== 'lost') {
      if (this.lostAt !== undefined) this.audio.stopVoice('trackingLost');
      this.lostAt = undefined;
      this.lostCue = false;
      return;
    }
    this.lostAt ??= this.round.timeMs;
    if (!this.lostCue && this.round.timeMs - this.lostAt >= 1500) {
      this.lostCue = tryVoiceCue(this.audio, 'trackingLost', { cooldownMs: 15000 });
    }
  }

  private showResult() {
    this.setPhase('result');
    tryVoiceCue(this.audio, 'complete');
    this.ui.dialog(`
      <div class="dialog-symbol harvest">${homeIcon}</div>
      <h2 id="dialog-title">返到屋企啦！</h2>
      <p>多謝你陪阿兔行過森林。屋企暖笠笠！</p>
      <div class="home-result-stats">
        <div><strong data-home-result-steps>${this.round.distance}</strong><span>踏步次數</span></div>
        <div><strong data-home-result-lanterns>${this.round.lanterns}</strong><span>點亮燈籠</span></div>
      </div>
      <div class="dialog-actions">
        <button class="button primary" data-action="restart">再玩一次</button>
        <button class="button quiet" data-action="home">返回主頁</button>
      </div>`);
    this.ui.root.querySelector('dialog')?.classList.add('home-result-dialog');
    this.ui.on('restart', () => this.scene.restart());
    this.bindHome();
    this.ui.focus('restart');
  }

  private bindHome() { this.ui.on('home', () => this.home()); }
  private home() { this.scene.start('Menu'); }

  private cleanup() {
    this.dead = true;
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.source.destroy();
    this.view.destroy();
    this.audio.destroy();
    this.ui.destroy();
    const root = this.ui.root;
    root.classList.remove('rabbit-home-ui');
    for (const key of Object.keys(root.dataset)) {
      if (key.startsWith('home')) delete root.dataset[key];
    }
  }
}
