import Phaser from 'phaser';
import { Overlay } from '../ui/Overlay';
import { Rabbit3D } from '../3d/Rabbit3D';
import { Rabbit } from '../art/Rabbit';
import { BERRY_ASSETS, BERRY_CONFIG as C, berryFile, berryKey, type FootPoint, type BerrySide } from '../berry/berryConfig';
import { BerryKickRound } from '../berry/BerryKickRound';
import { BerryKickInput } from '../berry/BerryKickInput';
import { BerryRabbitView } from '../berry/BerryRabbitView';
import { TreeTrunk } from '../berry/TreeTrunk';

export class BerryKickScene extends Phaser.Scene {
  private ui!: Overlay;
  private inputSource!: BerryKickInput;
  private view?: BerryRabbitView;
  private round!: BerryKickRound;
  private trees!: Record<BerrySide, TreeTrunk>;
  private debug!: Phaser.GameObjects.Graphics;
  private shadow!: Phaser.GameObjects.Ellipse;
  private request?: AbortController;
  private active = false;
  private paused = false;
  private dead = false;
  private failed = false;
  private completeShown = false;
  private finishElapsed = 0;
  private feedbackUntil = 0;
  private playClock = 0;
  private feet?: Record<BerrySide, FootPoint>;
  private debugEnabled = false;
  constructor() { super('BerryKick'); }
  preload() {
    for (const name of BERRY_ASSETS) if (!this.textures.exists(berryKey(name)))
      this.load.image(berryKey(name), `${import.meta.env.BASE_URL}assets/berry_kick/${berryFile(name)}`);
  }
  create() {
    this.dead = this.active = this.paused = this.failed = this.completeShown = false;
    this.finishElapsed = this.feedbackUntil = this.playClock = 0;
    this.add.image(0, 0, berryKey('background')).setOrigin(0).setDisplaySize(1600, 900);
    this.trees = { left: new TreeTrunk(this, 'left'), right: new TreeTrunk(this, 'right') };
    this.round = new BerryKickRound({ left: this.trees.left.zone, right: this.trees.right.zone });
    this.shadow = this.add.ellipse(800, 731, 124, 20, 0x53623b, .12).setDepth(4);
    this.add.image(800, 780, berryKey('basket')).setDisplaySize(180, 144).setDepth(9);
    this.add.image(0, 0, berryKey('foreground')).setOrigin(0).setDisplaySize(1600, 900).setDepth(10);
    this.debug = this.add.graphics().setDepth(20);
    this.debugEnabled = new URLSearchParams(location.search).has('berryDebug');
    this.ui = new Overlay(); this.renderHud();
    this.inputSource = new BerryKickInput(() => this.togglePause(), message => {
      this.pause(); this.ui.closeModal(); this.ui.dialog(`<h2 id="dialog-title">相機暫停咗</h2><p>${message}</p>
        <button class="button primary" data-action="keyboard">使用鍵盤</button><button class="button quiet" data-action="home">返回主頁</button>`);
      this.ui.on('keyboard', () => { this.inputSource.useKeyboard(); this.active = true; this.resume(); }); this.ui.on('home', () => this.home());
    });
    window.addEventListener('blur', this.onBlur); document.addEventListener('visibilitychange', this.onVisibility);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.ui.text('[data-berry-hint]', '正在準備花園同 3D 阿兔…');
    this.request = new AbortController();
    void this.loadRabbit(this.request.signal);
  }
  private async loadRabbit(signal: AbortSignal) {
    try {
      const rabbit = await Rabbit3D.load(`${import.meta.env.BASE_URL}assets/rabbit3d/rabbit_realtime.glb`, signal);
      if (this.dead) { rabbit.dispose(); return; }
      try { this.view = new BerryRabbitView(this, rabbit, () => this.modelFailure()); }
      catch (error) { rabbit.dispose(); throw error; }
      this.ui.dialog(`<h2 id="dialog-title">準備好啦！</h2><p>我哋一齊收集莓果！小幅、慢慢伸腳就得。<br>可以喺旁邊放穩固椅子作支撐，唔使踢任何真實物件。</p>
        <button class="button primary" data-action="camera">開啟攝像頭</button>
        <button class="button secondary" data-action="keyboard">鍵盤試玩</button>
        <button class="button quiet" data-action="home">返回主頁</button>`);
      this.ui.on('keyboard', () => { this.inputSource.useKeyboard(); this.begin(); });
      this.ui.on('camera', () => { this.begin(); void this.inputSource.startCamera(this.ui.root); });
      this.ui.on('home', () => this.home());
    } catch { if (!this.dead) this.modelFailure(); }
  }
  private modelFailure() {
    if (this.failed || this.dead) return; this.failed = true; this.active = false; this.tweens.pauseAll();
    this.inputSource?.destroy(); this.view?.destroy(); this.view = undefined;
    new Rabbit(this, 800, 730, .85);
    this.ui.closeModal(); this.ui.dialog(`<h2 id="dialog-title">3D 阿兔未能載入</h2>
      <p>而家只顯示靜態替代角色，伸腿互動同計分已停用。請返回主頁再試。</p>
      <button class="button primary" data-action="home">返回主頁</button>`);
    this.ui.on('home', () => this.home());
  }
  private begin() { this.ui.closeModal(); this.active = true; this.paused = false; this.ui.text('[data-berry-hint]', '準備好啦！我哋一齊收集莓果！'); }
  private renderHud() {
    this.ui.render(`<header class="berry-hud"><div class="berry-title"><span class="berry-eyebrow">動態花園</span><h1>莓果大豐收</h1></div>
      <div class="berry-score" aria-live="polite"><img src="${import.meta.env.BASE_URL}assets/berry_kick/berry.png" alt="">收集 <b data-berry-score>0</b> / 6</div>
      <button class="button secondary" data-action="pause">暫停</button><button class="button quiet" data-action="home">主頁</button></header>
      <div class="berry-progress left" data-berry-left>左邊 0 / 3</div><div class="berry-progress right" data-berry-right>右邊 0 / 3</div>
      <p class="berry-hint" data-berry-hint role="status"></p>
      <footer class="berry-footer"><span data-berry-controls>A / D 左右移動 · Q / E 伸腳 · 放開收腳 · Esc 暫停</span><small>舒服地小幅伸腳，隨時可以休息</small></footer>`);
    this.ui.on('pause', () => this.togglePause()); this.ui.on('home', () => this.home());
  }
  private onBlur = () => { if (this.active && !this.paused && !this.round.complete) this.pause(); };
  private onVisibility = () => { if (document.hidden) this.onBlur(); };
  private togglePause() { if (!this.active || this.failed || this.completeShown) return; if (this.paused) this.resume(); else this.pause(); }
  private pause() {
    if (this.paused || !this.active) return;
    this.paused = this.round.paused = true; this.inputSource.pause(); this.tweens.pauseAll();
    this.ui.dialog(`<h2 id="dialog-title">休息一陣先</h2><p>準備好先再慢慢嚟。</p>
      <button class="button primary" data-action="resume">繼續玩</button><button class="button secondary" data-action="restart">重新開始</button>
      <button class="button quiet" data-action="home">返回主頁</button>`, () => this.resume());
    this.ui.on('resume', () => this.resume()); this.ui.on('restart', () => this.scene.restart()); this.ui.on('home', () => this.home());
  }
  private resume() { this.ui.closeModal(); this.paused = this.round.paused = false; this.inputSource.resume(); this.tweens.resumeAll(); }
  private home() { this.scene.start('Menu'); }
  update(_time: number, delta: number) {
    if (!this.active || this.paused || !this.view || this.failed) return;
    const dt = Math.min(delta / 1000, .1); this.playClock += dt * 1000;
    const sample = this.inputSource.update(dt);
    this.feet = this.view.update(dt, sample.lateralOffset, sample.reliable ? sample.leftLegExtensionAmount : 0,
      sample.reliable ? sample.rightLegExtensionAmount : 0);
    this.shadow.x = this.view.rootX;
    const hit = this.round.update(dt * 1000, { left: sample.leftLegExtensionAmount, right: sample.rightLegExtensionAmount,
      feet: this.feet, reliable: sample.reliable, rootX: this.view.rootX });
    if (hit) { this.trees[hit].harvest(); this.feedbackUntil = this.playClock + 1400; }
    this.ui.text('[data-berry-score]', String(this.round.score));
    for (const side of ['left', 'right'] as const) this.ui.text(`[data-berry-${side}]`, `${side === 'left' ? '左' : '右'}邊 ${this.round.counts[side]} / ${C.targetPerSide}`);
    const side = this.round.counts.left < C.targetPerSide ? '左' : '右';
    this.ui.text('[data-berry-controls]', this.inputSource.mode === 'camera' ? '攝像頭體感 · 左右小幅移動，再輕輕伸腳' : 'A / D 左右移動 · Q / E 伸腳 · 放開收腳 · Esc 暫停');
    this.ui.text('[data-berry-hint]', !sample.reliable ? '我睇唔清楚你，企返鏡頭中間少少。'
      : this.playClock < this.feedbackUntil ? '好叻呀！莓果跌落嚟喇！'
        : `慢慢移向${side}邊，伸出${side}腳輕輕掂下樹幹。`);
    this.drawDebug();
    if (this.round.complete && !this.completeShown) {
      this.finishElapsed += dt;
      if (this.finishElapsed > 1.5) {
        this.completeShown = true; this.inputSource.pause();
        this.ui.dialog(`<h2 id="dialog-title">大豐收！</h2><p>成功收集 6 次莓果！</p>
          <button class="button primary" data-action="restart">再玩一次</button><button class="button quiet" data-action="home">返回主頁</button>`);
        this.ui.on('restart', () => this.scene.restart()); this.ui.on('home', () => this.home());
      }
    }
  }
  private drawDebug() {
    this.debug.clear(); if (!this.debugEnabled || !this.feet) return;
    for (const side of ['left', 'right'] as const) {
      const zone = this.trees[side].zone; const foot = this.feet[side];
      this.debug.lineStyle(3, side === 'left' ? 0x0077ff : 0xee00aa).strokeRect(zone.x, zone.y, zone.width, zone.height);
      this.debug.fillStyle(side === 'left' ? 0x0077ff : 0xee00aa).fillCircle(foot.x, foot.y, 7);
    }
  }
  snapshot() { return { ...this.round.snapshot(), active: this.active, failed: this.failed, completeShown: this.completeShown,
    renderMode: this.view ? '3d' : 'fallback', feet: this.feet, zones: this.round.zones, rootX: this.view?.rootX,
    fps: this.view?.fps ?? 0, mode: this.inputSource.mode, maxTravel: this.view?.maxTravel }; }
  private cleanup() {
    this.dead = true; this.request?.abort(); this.request = undefined; this.inputSource.destroy(); this.view?.destroy(); this.view = undefined;
    this.tweens.killAll(); this.ui.destroy(); window.removeEventListener('blur', this.onBlur); document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
