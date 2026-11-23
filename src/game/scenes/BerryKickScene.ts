import { TRACKING_MODE_LABEL } from '../vision/trackingMode';
import Phaser from 'phaser';
import { Overlay } from '../ui/Overlay';
import { GameIntroLayout } from '../ui/GameIntroLayout';
import { Rabbit3D } from '../3d/Rabbit3D';
import { Rabbit } from '../art/Rabbit';
import { BERRY_ASSETS, BERRY_CONFIG as C, berryFile, berryKey, type FootPoint, type BerrySide } from '../berry/berryConfig';
import { BerryKickRound } from '../berry/BerryKickRound';
import { BerryKickInput } from '../berry/BerryKickInput';
import { BerryRabbitView } from '../berry/BerryRabbitView';
import { TreeTrunk } from '../berry/TreeTrunk';
import { getGameSettings } from '../settings/gameSettings';
import { AudioManager } from '../systems/AudioManager';
import { tryVoiceCue } from '../systems/voiceCue';

interface BerryEffect {
  element?: HTMLElement;
  animation: Animation;
  startedAt: number;
  duration: number;
}

const TARGET_LABEL = { left: '左', right: '右' } as const;

export class BerryKickScene extends Phaser.Scene {
  private ui!: Overlay;
  private audio!: AudioManager;
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
  private safetyVoicePending = true;
  private restVoiceRequest = 0;
  private trackingLostAt?: number;
  private trackingVoiceIssued = false;
  private voiceTrackingReliable = false;
  private skipNextDelta = true;
  private feedback?: { kind: 'harvest' | 'wrong-tree'; until: number };
  private targetBadge!: HTMLElement;
  private lastCountdown = 11;
  private popupIndex = 0;
  private readonly effects = new Set<BerryEffect>();
  private feet?: Record<BerrySide, FootPoint>;
  private debugEnabled = false;
  private trackingHud?: HTMLPreElement;
  private trackingStatus?: HTMLElement;
  private trackingLog = false;
  private nextTrackingLogAt = 0;
  constructor() { super('BerryKick'); }
  preload() {
    for (const name of BERRY_ASSETS) if (!this.textures.exists(berryKey(name)))
      this.load.image(berryKey(name), `${import.meta.env.BASE_URL}assets/berry_kick/${berryFile(name)}`);
  }
  create() {
    this.audio = new AudioManager('berry');
    this.dead = this.active = this.paused = this.failed = this.completeShown = false;
    this.safetyVoicePending = true;
    this.restVoiceRequest = 0;
    this.trackingLostAt = undefined;
    this.trackingVoiceIssued = false;
    this.voiceTrackingReliable = false;
    this.skipNextDelta = true;
    this.feedback = undefined;
    this.popupIndex = 0;
    this.lastCountdown = 11;
    this.feet = undefined;
    this.effects.clear();
    this.add.image(0, 0, berryKey('background')).setOrigin(0).setDisplaySize(1600, 900);
    this.trees = { left: new TreeTrunk(this, 'left'), right: new TreeTrunk(this, 'right') };
    this.round = new BerryKickRound({ left: this.trees.left.zone, right: this.trees.right.zone }, getGameSettings().berryDurationSeconds);
    // Berry tweens are advanced explicitly with the same game delta as the round.
    this.tweens.pauseAll();
    this.shadow = this.add.ellipse(800, 731, 124, 20, 0x53623b, .12).setDepth(4);
    this.add.image(800, 780, berryKey('basket')).setDisplaySize(180, 144).setDepth(9);
    this.add.image(0, 0, berryKey('foreground')).setOrigin(0).setDisplaySize(1600, 900).setDepth(10);
    this.debug = this.add.graphics().setDepth(20);
    this.debugEnabled = new URLSearchParams(location.search).has('berryDebug');
    this.ui = new Overlay(); this.renderHud();
    const query = new URLSearchParams(location.search);
    this.trackingHud = undefined;
    this.trackingLog = import.meta.env.DEV && query.get('berryTrackingLog') === '1';
    this.nextTrackingLogAt = 0;
    if (import.meta.env.DEV && query.get('berryTrackingDebug') === '1') {
      this.trackingHud = document.createElement('pre');
      this.trackingHud.className = 'berry-tracking-debug';
      this.trackingHud.hidden = true;
      this.ui.root.append(this.trackingHud);
    }
    this.inputSource = new BerryKickInput(() => this.togglePause(), message => {
      if (this.dead || this.failed || this.completeShown) return;
      this.pause(); this.ui.closeModal(); this.ui.dialog(`<h2 id="dialog-title">相機暫停咗</h2><p>${message}</p>
        <button class="button primary" data-action="keyboard">使用鍵盤</button><button class="button quiet" data-action="camera-home">返回主頁</button>`);
      this.ui.on('keyboard', () => { this.inputSource.useKeyboard(); this.active = true; this.resume(); }); this.ui.on('camera-home', () => this.home());
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
      if (this.dead || signal.aborted) { rabbit.dispose(); return; }
      try { this.view = new BerryRabbitView(this, rabbit, () => this.modelFailure()); }
      catch (error) { rabbit.dispose(); throw error; }
      this.ui.dialog(new GameIntroLayout('berry', `
        <h2 id="dialog-title">準備好啦！</h2>
        <p>${this.round.durationMs / 1000} 秒內，跟住箭嘴去發光嘅目標樹旁，伸腳掂中樹幹就有 3 顆莓果。得分後先收返隻腳，再跟下一個目標。</p>
        <p class="game-intro-note">舒服地慢慢伸腳，可在旁邊放穩固椅子作支撐，唔使踢任何真實物件。用鏡頭時，畀鏡頭睇到肩膊、腰同膝頭。</p>
        <div class="game-intro-actions">
          <button class="button primary" data-action="camera">開啟攝像頭</button>
          <button class="button secondary" data-action="keyboard">鍵盤試玩</button>
          <button class="button quiet" data-action="home">返回主頁</button>
        </div>`));
      this.ui.on('keyboard', () => { this.inputSource.useKeyboard(); this.begin(); });
      this.ui.on('camera', () => { this.begin(); void this.inputSource.startCamera(this.ui.root); });
      this.ui.on('home', () => { this.ui.closeModal(); this.home(); });
    } catch { if (!this.dead && !signal.aborted) this.modelFailure(); }
  }
  private modelFailure() {
    if (this.failed || this.dead || this.completeShown) return;
    this.failed = true; this.active = false;
    this.audio.stopAll();
    this.clearAnimations();
    this.inputSource?.destroy(); this.view?.destroy(); this.view = undefined;
    new Rabbit(this, 800, 730, .85);
    this.ui.closeModal(); this.ui.dialog(`<h2 id="dialog-title">3D 阿兔未能載入</h2>
      <p>而家只顯示靜態替代角色，伸腿互動同計分已停用。請返回主頁再試。</p>
      <button class="button primary" data-action="home">返回主頁</button>`);
    this.ui.on('home', () => this.home());
  }
  private begin() {
    this.safetyVoicePending = false;
    this.ui.closeModal(); this.active = true; this.paused = false; this.skipNextDelta = true;
    this.updateTarget();
    this.ui.text('[data-berry-hint]', this.targetHint());
  }
  private renderHud() {
    this.ui.render(`<header class="berry-hud"><div class="berry-title"><span class="berry-eyebrow">動態花園</span><h1>莓果大豐收</h1></div>
      <div class="berry-target" data-berry-target hidden><span>目標樹</span><strong class="berry-target-direction"><span class="berry-target-arrow" aria-hidden="true">➜</span><span data-berry-target-label></span></strong></div>
      <div class="berry-hud-controls"><div class="berry-timer" data-berry-timer><span>剩餘時間</span><strong data-berry-time role="timer">${this.formatTime(this.round.remainingMs)}</strong></div>
      <div class="berry-score" aria-live="polite"><img src="${import.meta.env.BASE_URL}assets/berry_kick/berry.png" alt="">收集 <b data-berry-score>0</b></div>
      <button class="button secondary" data-action="pause">暫停</button><button class="button quiet" data-action="home">主頁</button></div></header>
      <div class="berry-effects" data-berry-effects aria-hidden="true"></div>
      <p class="berry-hint" data-berry-hint role="status"></p>
      <footer class="berry-footer"><span data-berry-controls>A / D 左右移動 · Q / E 伸腳 · 放開收腳 · Esc 暫停</span><small>舒服地小幅伸腳，隨時可以休息</small></footer>
      <small class="person-status berry-tracking-status" data-berry-tracking hidden></small>`);
    this.targetBadge = this.ui.root.querySelector<HTMLElement>('[data-berry-target]')!;
    this.trackingStatus = this.ui.root.querySelector<HTMLElement>('[data-berry-tracking]') ?? undefined;
    this.ui.on('pause', () => this.togglePause()); this.ui.on('home', () => this.home());
  }
  private updateTarget(transitionMs = 0) {
    const target = this.round.target;
    if (this.targetBadge.dataset.side !== target) {
      this.targetBadge.dataset.side = target;
      this.ui.text('[data-berry-target-label]', TARGET_LABEL[target]);
      this.trees.left.setTarget(target === 'left', transitionMs);
      this.trees.right.setTarget(target === 'right', transitionMs);
    }
    this.targetBadge.hidden = false;
  }
  private targetHint() {
    return `慢慢移去${TARGET_LABEL[this.round.target]}邊嘅發光樹，伸腳掂下樹幹，再收返隻腳。`;
  }
  private pulseTarget(wrongTree: boolean) {
    this.addEffect(this.targetBadge, 320, this.round.elapsedMs, [
      { transform: 'scale(1)' },
      { transform: `scale(${wrongTree ? 1.13 : 1.08})`, offset: .38 },
      { transform: 'scale(1)' },
    ], false);
  }
  private formatTime(milliseconds: number) {
    const seconds = Math.ceil(milliseconds / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  private onBlur = () => { if (this.active && !this.paused && !this.round.complete) this.pause(); };
  private onVisibility = () => { if (document.hidden) this.onBlur(); };
  private togglePause() { if (!this.active || this.failed || this.completeShown) return; if (this.paused) this.resume(); else this.pause(true); }
  private pause(explicit = false) {
    if (this.paused || !this.active || this.round.complete) return;
    this.paused = this.round.paused = true; this.inputSource.pause();
    this.updateTrackingDiagnostics(true);
    this.trackingLostAt = undefined;
    this.trackingVoiceIssued = false;
    this.voiceTrackingReliable = false;
    this.audio.pause();
    const audio = this.audio;
    const restRequest = ++this.restVoiceRequest;
    if (explicit && !tryVoiceCue(audio, 'rest', { allowWhilePaused: true })) {
      void audio.unlock().then(() => {
        if (this.audio === audio && restRequest === this.restVoiceRequest && this.paused && !this.dead && !document.hidden)
          tryVoiceCue(audio, 'rest', { allowWhilePaused: true });
      });
    }
    this.ui.dialog(`<h2 id="dialog-title">休息一陣先</h2><p>準備好先再慢慢嚟。</p>
      <button class="button primary" data-action="resume">繼續玩</button><button class="button secondary" data-action="restart">重新開始</button>
      <button class="button quiet" data-action="home">返回主頁</button>`, () => this.resume());
    this.ui.on('resume', () => this.resume()); this.ui.on('restart', () => this.scene.restart()); this.ui.on('home', () => this.home());
  }
  private resume() {
    if (this.dead || this.failed || this.completeShown || document.hidden) return;
    ++this.restVoiceRequest;
    this.audio.stopVoice('rest');
    this.ui.closeModal(); this.paused = this.round.paused = false; this.skipNextDelta = true; this.inputSource.resume();
    this.audio.resume();
  }
  private home() { this.scene.start('Menu'); }
  update(_time: number, delta: number) {
    if (!this.active && this.view && !this.paused && !this.dead && !this.failed && !this.completeShown && this.safetyVoicePending) {
      this.safetyVoicePending = !tryVoiceCue(this.audio, 'safety');
    }
    if (!this.active || this.paused || !this.view || this.failed || this.completeShown) return;
    if (document.hidden) { this.pause(); return; }
    if (this.skipNextDelta) { this.skipNextDelta = false; return; }
    const deltaMs = delta * this.time.timeScale;
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    const dt = Math.min(deltaMs, 100) / 1000;
    const sample = this.inputSource.update(dt);
    const legs = sample.legTracking;
    const legReliable = legs && { left: legs.left.reliable, right: legs.right.reliable };
    this.feet = this.view.update(dt, sample.lateralReliable ? sample.lateralOffset : undefined,
      legs || sample.reliable ? sample.leftLegExtensionAmount : 0, legs || sample.reliable ? sample.rightLegExtensionAmount : 0);
    this.shadow.x = this.view.rootX;
    const hit = this.round.update(deltaMs, { left: sample.leftLegExtensionAmount, right: sample.rightLegExtensionAmount,
      feet: this.feet, reliable: sample.reliable, legReliable, rootX: this.view.rootX });
    this.ui.text('[data-berry-score]', String(this.round.score));
    this.ui.text('[data-berry-time]', this.formatTime(this.round.remainingMs));
    this.ui.root.querySelector('[data-berry-timer]')?.setAttribute('data-urgent', String(this.round.remainingMs <= 10000));
    if (this.round.complete) { this.finish(); return; }
    this.updateTrackingVoice(sample.lateralReliable);
    for (const tween of this.tweens.getTweens()) {
      if (tween.update(deltaMs)) { this.tweens.remove(tween); tween.destroy(); }
    }
    this.updateEffects();
    if (hit?.kind === 'harvest') {
      this.audio.playSfx('berry');
      this.audio.playVoice('success', { interrupt: false, cooldownMs: 8000 });
      this.trees[hit.side].harvest();
      this.feedback = { kind: hit.kind, until: this.round.elapsedMs + 1400 };
      this.showScorePopup();
      this.updateTarget(220);
      this.pulseTarget(false);
    } else if (hit?.kind === 'wrong-tree') {
      this.feedback = { kind: hit.kind, until: this.round.elapsedMs + 1100 };
      this.pulseTarget(true);
    }
    const seconds = Math.ceil(this.round.remainingMs / 1000);
    if (seconds <= 10 && seconds < this.lastCountdown) {
      this.lastCountdown = seconds;
      this.showCountdown(seconds);
    }
    this.ui.text('[data-berry-controls]', this.inputSource.mode === 'camera' ? '攝像頭體感 · 左右小幅移動，再輕輕伸腳' : 'A / D 左右移動 · Q / E 伸腳 · 放開收腳 · Esc 暫停');
    const feedback = this.feedback && this.round.elapsedMs < this.feedback.until ? this.feedback.kind : undefined;
    this.ui.text('[data-berry-hint]', !sample.lateralReliable ? this.cameraTrackingHint()
      : legs?.[this.round.target].mode === 'lost' ? `請畀鏡頭睇清楚${TARGET_LABEL[this.round.target]}邊膝頭。`
        : !sample.reliable || (legs && !legs[this.round.target].reliable) ? '慢慢收返隻腳，等阿兔準備好。'
        : feedback === 'wrong-tree' ? `請去${TARGET_LABEL[this.round.target]}邊嘅樹！`
          : feedback === 'harvest' ? `好叻呀！下一個目標係${TARGET_LABEL[this.round.target]}邊。`
            : this.targetHint());
    this.drawDebug();
    this.updateTrackingDiagnostics();
  }
  private cameraTrackingHint() {
    return this.inputSource.hasCameraReference
      ? '我睇唔清楚你嘅肩膊同腰，對準鏡頭就可以繼續。'
      : '畀鏡頭睇到肩膊、腰同膝頭，企穩一陣。';
  }

  private trackingSnapshot() {
    const tracking = this.inputSource.trackingSnapshot();
    return {
      ...tracking,
      rootX: this.view?.rootX ?? null,
      targetRootX: tracking.reliable ? this.view?.targetRootX ?? null : null,
      fps: this.view?.fps ?? 0,
    };
  }

  private updateTrackingDiagnostics(force = false) {
    const camera = this.inputSource.mode === 'camera';
    if (this.trackingStatus) {
      this.trackingStatus.hidden = !camera;
      if (camera) this.ui.text('[data-berry-tracking]', TRACKING_MODE_LABEL[this.inputSource.trackingMode]);
    }
    if (!this.trackingHud && !this.trackingLog) return;
    if (this.trackingHud) this.trackingHud.hidden = !camera;
    const now = performance.now();
    if (!camera || (!force && now < this.nextTrackingLogAt)) return;
    this.nextTrackingLogAt = now + 200;
    const tracking = this.trackingSnapshot();
    if (this.trackingLog) console.debug('[Berry tracking]', tracking);
    if (this.trackingHud) {
      const number = (value: number | null | undefined, digits: number) => value?.toFixed(digits) ?? '–';
      this.trackingHud.textContent = [
        `${TRACKING_MODE_LABEL[tracking.mode]} · ${tracking.status} · ${tracking.referenceState}`,
        `Legs L ${tracking.legTracking?.left.mode ?? '–'} ${number(tracking.legAmounts.left, 2)} · R ${tracking.legTracking?.right.mode ?? '–'} ${number(tracking.legAmounts.right, 2)}`,
        `Center ${number(tracking.current?.center, 3)} / ref ${number(tracking.reference?.center, 3)}`,
        `Scale ${number(tracking.current?.scale, 3)} / ref ${number(tracking.reference?.scale, 3)}`,
        `Direction ${tracking.current?.direction ?? '–'} / ref ${tracking.reference?.direction ?? '–'}`,
        `Offset ${number(tracking.lateralOffset, 3)} · rootX ${number(tracking.rootX, 1)}`,
        `Frame age ${number(tracking.frameAgeMs, 0)} ms · pose/3D FPS ${number(tracking.poseFps, 1)}/${number(tracking.fps, 1)}`,
        `Reset ${tracking.resetReason} · ${tracking.rejection ?? 'valid'}`,
      ].join('\n');
    }
  }

  private updateTrackingVoice(reliable: boolean) {
    if (!reliable && this.voiceTrackingReliable) this.audio.stopVoice();
    this.voiceTrackingReliable = reliable;
    if (this.inputSource.mode !== 'camera' || reliable) {
      if (this.trackingLostAt !== undefined) this.audio.stopVoice('trackingLost');
      this.trackingLostAt = undefined;
      this.trackingVoiceIssued = false;
      return;
    }
    this.trackingLostAt ??= performance.now();
    if (!this.trackingVoiceIssued && performance.now() - this.trackingLostAt >= 1500) {
      this.trackingVoiceIssued = tryVoiceCue(this.audio, 'trackingLost', { cooldownMs: 15000 });
    }
  }

  private showScorePopup() {
    const element = document.createElement('span');
    element.className = 'berry-score-popup'; element.textContent = `🍓 +${C.berriesPerHit}`;
    element.style.left = `${[36, 64, 42, 58][this.popupIndex++ % 4]}%`;
    this.addEffect(element, 1000, this.round.elapsedMs, [
      { transform: 'translate(-50%, 16px) scale(.55) rotate(-8deg)', opacity: 0, offset: 0 },
      { transform: 'translate(-50%, -6px) scale(1.16) rotate(4deg)', opacity: 1, offset: .2 },
      { transform: 'translate(-50%, 0) scale(1)', opacity: 1, offset: .4 },
      { transform: 'translate(-50%, -20px) scale(1.04)', opacity: 1, offset: .65 },
      { transform: 'translate(-50%, -45px) scale(.95)', opacity: 0, offset: 1 },
    ]);
  }
  private showCountdown(value: number) {
    const element = document.createElement('span');
    element.className = 'berry-countdown-digit'; element.textContent = String(value); element.dataset.value = String(value);
    this.addEffect(element, 1100, this.round.durationMs - value * 1000, [
      { transform: 'translateX(-50%) scale(.45) rotate(-9deg)', opacity: 0, offset: 0 },
      { transform: 'translateX(-50%) scale(1.15) rotate(4deg)', opacity: 1, offset: .18 },
      { transform: 'translateX(-50%) scale(.96)', opacity: 1, offset: .32 },
      { transform: 'translateX(-50%) scale(1)', opacity: 1, offset: .5 },
      { transform: 'translate(-50%, -12px) scale(1.04)', opacity: 0, offset: 1 },
    ]);
  }
  private addEffect(element: HTMLElement, duration: number, startedAt: number, frames: Keyframe[], temporary = true) {
    if (temporary) this.ui.root.querySelector('[data-berry-effects]')!.append(element);
    const animation = element.animate(frames, { duration, fill: 'both', easing: 'ease-out' });
    animation.pause(); animation.currentTime = Math.max(0, this.round.elapsedMs - startedAt);
    this.effects.add({ element: temporary ? element : undefined, animation, startedAt, duration });
  }
  private updateEffects() {
    for (const effect of this.effects) {
      const elapsed = this.round.elapsedMs - effect.startedAt;
      if (elapsed >= effect.duration) {
        effect.animation.cancel(); effect.element?.remove(); this.effects.delete(effect);
      } else effect.animation.currentTime = elapsed;
    }
  }
  private finish() {
    if (this.completeShown) return;
    this.completeShown = true; this.active = false; this.inputSource.pause();
    if (this.trackingHud) this.trackingHud.hidden = true;
    if (this.trackingStatus) this.trackingStatus.hidden = true;
    this.audio.stopAll();
    this.audio.playSfx('complete');
    this.audio.playVoice('complete');
    this.clearAnimations();
    this.ui.text('[data-berry-hint]', '挑戰完成！');
    this.ui.dialog(`<div class="berry-result-art" aria-hidden="true"><img src="${import.meta.env.BASE_URL}assets/berry_kick/berry.png" alt=""></div>
      <h2 id="dialog-title">挑戰完成！</h2>
      <div class="berry-result-total"><span>本局收集莓果</span><strong data-berry-result-score>${this.round.score}</strong><span>顆</span></div>
      <p class="berry-result-duration">挑戰時長 <b data-berry-result-duration>${this.round.durationMs / 1000} 秒</b></p>
      <div class="dialog-actions"><button class="button primary" data-action="restart">再玩一次</button><button class="button quiet" data-action="home">返回主頁</button></div>`);
    this.ui.root.querySelector('dialog')?.classList.add('berry-results');
    this.ui.on('restart', () => this.scene.restart()); this.ui.on('home', () => this.home());
  }
  private clearAnimations() {
    this.tweens.killAll();
    for (const effect of this.effects) { effect.animation.cancel(); effect.element?.remove(); }
    this.effects.clear();
    this.targetBadge.hidden = true;
    this.trees.left.setTarget(false); this.trees.right.setTarget(false);
    this.trees.left.clearHarvests(); this.trees.right.clearHarvests();
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
    tracking: this.inputSource.mode === 'camera' ? this.trackingSnapshot() : null,
    audio: this.audio.snapshot(), fps: this.view?.fps ?? 0, mode: this.inputSource.mode, maxTravel: this.view?.maxTravel, effectCount: this.effects.size }; }
  private cleanup() {
    this.dead = true; this.active = false; this.request?.abort(); this.request = undefined;
    this.inputSource.destroy(); this.view?.destroy(); this.view = undefined;
    this.audio.destroy();
    this.clearAnimations(); this.ui.destroy();
    window.removeEventListener('blur', this.onBlur); document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
