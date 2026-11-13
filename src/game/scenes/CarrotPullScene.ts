import Phaser from 'phaser';
import { SceneLayerGroup } from '../art/SceneLayerGroup';
import { Basket } from '../art/Basket';
import { CARROT_PULL_LAYERS, CarrotPullAssetKeys, getMissingCarrotPullAssets } from '../assets/carrotPullAssets';
import { CARROT_PULL_DEPTHS, RABBIT_SCALE, CARROT_SCALE, CARRIED_CARROT_ANGLE, SOIL_SCALE, RABBIT_FOOT_POSITION, PLANTED_CARROT, SOIL_POSITION, SOIL_FRONT_START_Y, BASKET_DROP_TARGET } from '../assets/carrotPullLayout';
import { RabbitCharacter } from '../characters/RabbitCharacter';
import { Carrot } from '../art/Carrot';
import { MotionInputController } from '../input/MotionInputController';
import type { MotionInput } from '../input/MotionInput';
import { CarrotRound, type RoundState } from '../systems/CarrotRound';
import { AudioManager } from '../systems/AudioManager';
import { resumeTweenClock } from '../systems/pauseTweenClock';
import { Overlay, sproutIcon, carrotIcon } from '../ui/Overlay';
import { REDUCED_MOTION, SHOW_KEYBOARD_HINTS } from '../config';
import { Rabbit3DPreview } from '../3d/Rabbit3DPreview';
import { DEV_CARROT_GRAB_DEBUG } from '../3d/CarrotGrabDebug';

// Zero-based atlas index 5 is Blender Pull source frame 10; peak is index 8.
export const PULL_CARROT_ATTACH_FRAME = 5;
// Celebrate source frame 12 reaches the raised pose, then releases the harvest.
const CELEBRATE_CARROT_RELEASE_FRAME = 5;
const PROMPTS: Record<RoundState, [string, string]> = {
  READY: ['慢慢屈膝，幫阿兔捉住蘿蔔啦！', '舒服地淺屈膝就得，唔使蹲得深。'],
  BENDING: ['慢慢嚟，就快捉到喇。', '保持舒服的姿勢，唔使急。'],
  GRABBED: ['捉實喇！慢慢企返起身。', '放開屈膝鍵，再按住站立鍵。'],
  RETURNING: ['慢慢企返起身，阿兔陪住你。', '就快收穫今次的蘿蔔喇。'],
  SUCCESS: ['成功拔到蘿蔔啦！', '做得好！慢慢嚟，唔使急。'],
  NEXT_ROUND: ['下一棵蘿蔔準備好喇。', '準備好先再繼續。'],
  COMPLETE: ['完成啦！', '做得好，休息一下啦。'],
};
const GAME_3D_PROMPTS: Record<RoundState, [string, string]> = {
  READY: ['慢慢屈膝，幫阿兔拔蘿蔔啦！', '舒服地淺屈膝就得，阿兔會幫你捉穩蘿蔔。'],
  BENDING: ['做得好，保持舒服嘅幅度。', '慢慢嚟，唔使蹲得深。'],
  GRABBED: ['阿兔捉實蘿蔔喇！慢慢企返起身。', '阿兔會輔助捉穩，你照自己舒服嘅節奏活動。'],
  RETURNING: ['慢慢企直，蘿蔔就快出嚟喇！', '企穩一陣，唔使急。'],
  SUCCESS: ['成功拔到一棵蘿蔔！', '阿兔幫你放入籃，稍等一陣。'],
  NEXT_ROUND: ['準備好再拔下一棵啦！', '慢慢嚟，阿兔陪住你。'],
  COMPLETE: ['完成啦！你已經拔到五棵蘿蔔！', '做得好，休息一下啦。'],
};

export class CarrotPullScene extends Phaser.Scene {
  private model!: CarrotRound;
  private motion!: MotionInput;
  private audio!: AudioManager;
  private ui!: Overlay;
  private garden!: SceneLayerGroup;
  private rabbit!: RabbitCharacter;
  private rabbit3d?: Rabbit3DPreview;
  private carrot!: Carrot;
  private basket!: Basket;
  private soil!: Phaser.GameObjects.Image;
  private soilBack!: Phaser.GameObjects.Image;
  private gameplayRendering = false;
  private disposed = false;
  private paused = false;
  private trackingSuspended = false;
  private attached = false;
  private attachmentBlend = { x: 0, y: 0, remaining: 0 };
  private successPhase: 'waiting' | 'pull' | 'celebrate' | null = null;

  constructor() { super('CarrotPull'); }

  create() {
    this.disposed = false;
    this.gameplayRendering = false;
    this.model = new CarrotRound();
    this.audio = new AudioManager();
    this.paused = false;
    this.trackingSuspended = false;
    this.time.paused = false;
    this.attached = false;
    this.attachmentBlend = { x: 0, y: 0, remaining: 0 };
    this.successPhase = null;
    this.garden = new SceneLayerGroup(this);
    this.carrot = new Carrot(this, PLANTED_CARROT.x, PLANTED_CARROT.y, CARROT_SCALE);
    this.carrot.root.setDepth(CARROT_PULL_DEPTHS.plantedCarrot);
    const soilOrigin = CARROT_PULL_LAYERS.soilPatch.origin;
    const soilKey = this.textures.exists(CarrotPullAssetKeys.soilPatch) ? CarrotPullAssetKeys.soilPatch : '__MISSING';
    this.soilBack = this.add.image(SOIL_POSITION.x, SOIL_POSITION.y, soilKey)
      .setOrigin(soilOrigin.x, soilOrigin.y).setScale(SOIL_SCALE).setDepth(CARROT_PULL_DEPTHS.soilBack);
    // Reuse the soil's lower lip to cover the intact root without a carrot mask.
    this.soil = this.add.image(SOIL_POSITION.x, SOIL_POSITION.y, soilKey)
      .setOrigin(soilOrigin.x, soilOrigin.y).setScale(SOIL_SCALE).setDepth(CARROT_PULL_DEPTHS.soilFront);
    if (soilKey !== '__MISSING') this.soil.setCrop(0, SOIL_FRONT_START_Y, 512, 512 - SOIL_FRONT_START_Y);
    this.rabbit = new RabbitCharacter(this, RABBIT_FOOT_POSITION.x, RABBIT_FOOT_POSITION.y, RABBIT_SCALE, CARROT_PULL_DEPTHS);
    this.rabbit.onFrame = (action, index) => {
      if (this.rabbit3d?.mode === '3d') return;
      if (action === 'pull' && index >= PULL_CARROT_ATTACH_FRAME && !this.attached) this.attachCarrot();
      if (action === 'celebrate' && index >= CELEBRATE_CARROT_RELEASE_FRAME && this.attached) this.releaseCarrot();
      if (this.attached) this.followHands();
    };
    this.basket = new Basket(this);
    this.ui = new Overlay();
    this.ui.render(`
      <header class="game-hud">
        <div class="score-panel"><span class="score-label">${carrotIcon}<strong id="score">分數：0</strong></span><span id="progress-label">進度：0 / 5</span></div>
        <div class="game-name">${sproutIcon}<span>拔蘿蔔</span></div>
        <button class="button light" data-action="pause"><span aria-hidden="true">Ⅱ</span> 暫停</button>
      </header>
      <section class="instruction" aria-label="遊戲提示"><h1 id="prompt" aria-live="polite">${PROMPTS.READY[0]}</h1><p id="helper">${PROMPTS.READY[1]}</p></section>
      <div class="steps" aria-label="拔蘿蔔步驟"><span data-step="bend" class="current"><b>1</b> 淺屈膝</span><i aria-hidden="true">—</i><span data-step="stand"><b>2</b> 企返起身</span><i aria-hidden="true">—</i><span data-step="collect"><b>3</b> 收穫蘿蔔</span></div>
      <div class="hold-indicator" aria-hidden="true"><span id="hold-caption">準備好未？</span><div class="hold-track"><div id="hold-fill"></div></div></div>
      <footer class="game-footer"><div class="keyboard-hints" ${SHOW_KEYBOARD_HINTS ? '' : 'hidden'}><span>測試操作</span><span><kbd>↓</kbd> / <kbd>S</kbd>：屈膝</span><span><kbd>↑</kbd> / <kbd>W</kbd>：站立</span><span><kbd>Esc</kbd>：休息</span></div><p>慢慢嚟，唔使急。</p></footer>`);
    this.ui.on('pause', () => this.pauseGame());
    window.addEventListener('keydown', this.onEscape);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
    this.ui.root.classList.add('carrot-pull-ui');
    this.ui.root.style.zIndex = String(CARROT_PULL_DEPTHS.hud);
    const missing = getMissingCarrotPullAssets(this);
    if (missing.length) {
      const notice = document.createElement('p');
      notice.className = 'asset-notice';
      notice.textContent = '部分場景圖像未能載入，仍可繼續遊戲。';
      this.ui.root.append(notice);
    }
    this.motion = new MotionInputController(this.ui.root, {
      onFrame: (frame, pose, profile) => this.rabbit3d?.acceptMotionFrame(frame, pose, profile),
      onReset: () => this.rabbit3d?.resetMotionInput(),
      onStatus: status => {
        this.rabbit3d?.setInputStatus(status);
        this.setTrackingSuspended(status.mode === 'camera' && (!status.ready || status.suspended));
      },
      isContinuousPreview: () => this.rabbit3d?.isMocapActive ?? false,
      getMotionHint: () => this.rabbit3d?.motionHint,
    });
    this.rabbit3d = new Rabbit3DPreview(this, this.rabbit, this.ui.root,
      preview => this.renderModeChanged(preview), () => this.finishCelebration('3d'));
    this.rabbit3d.setRoundState(this.model.state, this.model.progress, this.model.score);
    this.ui.root.dataset.roundState = this.model.state;
    this.audio.playVoice('ready');
  }

  private renderModeChanged(preview: boolean) {
    const wasGameplay = this.gameplayRendering;
    this.gameplayRendering = this.rabbit3d?.isGameplay ?? false;
    this.ui.root.classList.toggle('rabbit-preview', preview && !this.gameplayRendering);
    this.ui.root.classList.toggle('carrot-3d-game', this.gameplayRendering);
    this.ui.root.dataset.carrotRender = !preview ? 'sprite' : this.gameplayRendering ? '3d-game' : '3d-debug';
    const hideSpriteCarrot = preview && (this.gameplayRendering || DEV_CARROT_GRAB_DEBUG);
    this.carrot.root.setVisible(!hideSpriteCarrot);
    this.soil.setVisible(!hideSpriteCarrot);
    this.soilBack.setVisible(!this.gameplayRendering);
    if (preview && !this.gameplayRendering) {
      this.ui.text('#prompt', '3D 阿兔 · 開發預覽');
      this.ui.text('#helper', DEV_CARROT_GRAB_DEBUG ? '用手動骨骼或鏡頭移動雙手，再以開發按鈕測試抓握。'
        : '骨骼滑塊與即時同步只供開發測試；完整拔蘿蔔請切回 Sprite。');
      return;
    }
    const prompts = this.gameplayRendering ? GAME_3D_PROMPTS : PROMPTS;
    this.ui.text('#prompt', prompts[this.model.state][0]);
    this.ui.text('#helper', prompts[this.model.state][1]);
    if (wasGameplay && !preview && this.model.state !== 'COMPLETE') this.stateChanged(this.model.state);
  }

  private readonly onEscape = (event: KeyboardEvent) => {
    if (event.code !== 'Escape' || event.repeat || this.paused) return;
    event.preventDefault();
    this.pauseGame();
  };
  private readonly onBlur = () => { if (this.motion?.getStatus?.().ready) this.pauseGame(); };
  private readonly onVisibility = () => { if (document.hidden) this.pauseGame(); };

  private pauseGame() {
    if (this.paused || this.model.state === 'COMPLETE') return;
    this.paused = true;
    this.motion.pause?.();
    this.motion.reset();
    this.rabbit.pause();
    this.rabbit3d?.pause();
    this.scene.pause();
    this.ui.dialog(`<div class="dialog-symbol">${sproutIcon}</div><h2 id="dialog-title">休息一下</h2><p>準備好先再繼續，唔使急。</p><div class="dialog-actions"><button class="button primary" data-action="resume">繼續</button><button class="button secondary" data-action="restart">重新開始</button><button class="button quiet" data-action="home">返回主頁</button></div>`, () => this.resumeGame());
    this.ui.on('resume', () => this.resumeGame());
    this.ui.on('restart', () => this.scene.restart());
    this.ui.on('home', () => this.scene.start('Menu'));
  }

  private resumeGame() {
    this.motion.reset();
    this.ui.closeModal();
    this.paused = false;
    resumeTweenClock(this.tweens);
    this.scene.resume();
    if (this.rabbit3d?.mode !== '3d' && !this.trackingSuspended) this.rabbit.resume();
    this.rabbit3d?.resume();
    this.motion.resume?.();
  }

  private complete() {
    this.motion.pause?.();
    this.motion.reset();
    this.audio.playVoice('complete');
    this.ui.dialog(`<div class="dialog-symbol harvest">${carrotIcon}</div><h2 id="dialog-title">完成啦！</h2><p class="completion-score">今次拔到 <strong>5</strong> 棵蘿蔔</p><p>做得好，休息一下啦。</p><div class="dialog-actions"><button class="button primary" data-action="again">再玩一次</button><button class="button secondary" data-action="home">返回主頁</button></div>`);
    this.ui.on('again', () => this.scene.restart());
    this.ui.on('home', () => this.scene.start('Menu'));
  }

  private stateChanged(previous: RoundState) {
    const state = this.model.state;
    this.ui.root.dataset.roundState = state;
    this.rabbit3d?.setRoundState(state, this.model.progress, this.model.score);
    const retry = previous === 'BENDING' && state === 'READY';
    const prompts = this.rabbit3d?.isGameplay ? GAME_3D_PROMPTS : PROMPTS;
    this.ui.text('#prompt', retry ? '慢慢嚟，準備好再試一次。' : prompts[state][0]);
    this.ui.text('#helper', prompts[state][1]);
    if (!REDUCED_MOTION) this.ui.root.querySelector('#prompt')?.animate([{ opacity: .25, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 320 });
    const activeStep = ['READY', 'BENDING'].includes(state) ? 'bend' : ['GRABBED', 'RETURNING'].includes(state) ? 'stand' : 'collect';
    this.ui.root.querySelectorAll<HTMLElement>('[data-step]').forEach(el => el.classList.toggle('current', el.dataset.step === activeStep));
    if (this.rabbit3d?.isGameplay) {
      if (state === 'GRABBED' && previous !== 'RETURNING') this.audio.playVoice('grabbed');
      if (state === 'SUCCESS') {
        this.audio.playVoice('success'); this.audio.playSfx('success');
        this.garden.celebrate(RABBIT_FOOT_POSITION.x, 476, REDUCED_MOTION);
      }
      if (state === 'COMPLETE') this.complete();
      return;
    }
    if (state === 'BENDING') this.rabbit.playBend();
    if (state === 'GRABBED') {
      if (previous === 'RETURNING') this.rabbit.cancelReturn();
      else this.rabbit.playGrab();
      this.audio.playVoice('grabbed');
    }
    if (state === 'RETURNING') this.rabbit.playReturn();
    if (state === 'SUCCESS') {
      this.successPhase = 'waiting';
      this.ui.text('#prompt', PROMPTS.RETURNING[0]);
      this.rabbit.playPull(() => {
        if (this.rabbit3d?.mode === '3d' || this.disposed) return;
        this.successPhase = 'pull';
        this.ui.text('#prompt', PROMPTS.SUCCESS[0]);
        this.ui.text('#helper', PROMPTS.SUCCESS[1]);
        this.audio.playVoice('success');
        this.audio.playSfx('success');
        if (this.rabbit.fallback) this.attachCarrot();
      }, () => {
        if (this.model.state !== 'SUCCESS' || this.rabbit3d?.mode === '3d' || this.disposed) return;
        this.successPhase = 'celebrate';
        this.ui.text('#prompt', '好叻呀！');
        this.garden.celebrate(RABBIT_FOOT_POSITION.x, 476, REDUCED_MOTION);
        this.rabbit.playCelebrate(() => this.finishCelebration());
      });
    }
    if (state === 'NEXT_ROUND' || state === 'READY') {
      this.successPhase = null;
      this.attached = false;
      this.carrot.root.setPosition(PLANTED_CARROT.x, PLANTED_CARROT.y).setAlpha(1).setAngle(0).setDepth(CARROT_PULL_DEPTHS.plantedCarrot);
      this.soil.setVisible(true);
      this.rabbit.playIdle();
    }
    if (state === 'COMPLETE') {
      this.attached = false;
      this.carrot.root.setAlpha(0);
      this.rabbit.playIdle();
      this.complete();
    }
  }

  private finishCelebration(source: 'sprite' | '3d' = 'sprite') {
    if (this.disposed || this.trackingSuspended || this.paused) return;
    if (source === 'sprite' && (this.rabbit3d?.mode === '3d' || this.rabbit3d?.gameplaySelected)) return;
    if ((source === '3d') !== Boolean(this.rabbit3d?.isGameplay)) return;
    const previous = this.model.state;
    if (!this.model.completeCelebration()) return;
    this.ui.text('#score', `分數：${this.model.score}`);
    this.ui.text('#progress-label', `進度：${this.model.score} / ${this.model.target}`);
    this.basket.setScore(this.model.score);
    if (source === 'sprite') this.motion.reset();
    this.stateChanged(previous);
  }

  update(_time: number, delta: number) {
    if (!this.model || this.paused) return;
    const inputSample = this.motion.sample();
    const inputStatus = this.motion.getStatus?.();
    if (inputStatus?.requestPause) { this.pauseGame(); return; }
    this.rabbit3d?.setMotionSample(inputSample);
    this.rabbit3d?.setRoundState(this.model.state, this.model.progress, this.model.score);
    if (this.rabbit3d?.mode === '3d') this.rabbit3d.update(delta / 1000);
    if (this.model.state === 'COMPLETE') return;
    if (this.rabbit3d?.gameplaySelected && !this.rabbit3d.canAdvanceGameRound) { this.renderHoldIndicator(); return; }
    if (this.rabbit3d?.isDebugPreview) return;
    if (inputStatus && (!inputStatus.ready || inputStatus.suspended)) {
      if (this.rabbit3d?.isGameplay) this.renderHoldIndicator();
      else this.animateWorld();
      return;
    }
    if (!this.rabbit3d?.isGameplay && this.model.state === 'GRABBED') this.ui.text('#helper', inputStatus?.mode === 'camera' ? '慢慢企返起身，唔使急。' : PROMPTS.GRABBED[1]);
    const dt = Math.min(delta, 100);
    const previous = this.model.state;
    this.model.update(dt, inputSample);
    if (previous !== this.model.state) this.stateChanged(previous);
    this.rabbit3d?.setRoundState(this.model.state, this.model.progress, this.model.score);
    if (this.rabbit3d?.isGameplay) this.renderHoldIndicator();
    else this.animateWorld();
  }

  private setTrackingSuspended(suspended: boolean) {
    if (this.trackingSuspended === suspended) return;
    this.trackingSuspended = suspended;
    this.time.paused = suspended;
    if (suspended) {
      this.rabbit.pause();
      this.tweens.pauseAll();
    } else {
      resumeTweenClock(this.tweens);
      this.tweens.resumeAll();
      if (!this.paused && this.rabbit3d?.mode !== '3d') this.rabbit.resume();
    }
  }

  private attachCarrot() {
    this.attached = true;
    this.carrot.root.setAngle(CARRIED_CARROT_ANGLE).setDepth(CARROT_PULL_DEPTHS.carriedCarrot);
    const socket = this.rabbit.getAttachmentPoint();
    const grip = this.carrot.gripWorld();
    this.attachmentBlend = { x: grip.x - socket.x, y: grip.y - socket.y, remaining: 1 };
    this.tweens.add({ targets: this.attachmentBlend, remaining: 0, duration: 150, ease: 'Sine.Out' });
  }

  private releaseCarrot() {
    this.attached = false;
    this.tweens.add({
      targets: this.carrot.root, x: BASKET_DROP_TARGET.x, y: BASKET_DROP_TARGET.y, angle: -15, alpha: 0,
      duration: REDUCED_MOTION ? 100 : 450, ease: 'Sine.InOut',
    });
  }

  private followHands() {
    const socket = this.rabbit.getAttachmentPoint();
    this.carrot.alignGrip({
      x: socket.x + this.attachmentBlend.x * this.attachmentBlend.remaining,
      y: socket.y + this.attachmentBlend.y * this.attachmentBlend.remaining,
    });
  }

  private animateWorld() {
    if (this.attached) this.followHands();
    this.rabbit.updateDebug();
    this.renderHoldIndicator();
  }

  private renderHoldIndicator() {
    const state = this.model.state;
    const holding = state === 'BENDING' || state === 'RETURNING';
    const full = state === 'GRABBED' || state === 'SUCCESS';
    const fill = this.ui.root.querySelector<HTMLElement>('#hold-fill');
    if (fill) fill.style.width = `${holding ? this.model.progress * 100 : full ? 100 : 0}%`;
    const caption = state === 'GRABBED' ? '捉實喇！' : state === 'RETURNING' ? '慢慢企返起身' : state === 'SUCCESS' ? '做得好！' : state === 'BENDING' ? '慢慢屈膝…' : '準備好未？';
    this.ui.text('#hold-caption', caption);
  }

  getDebugSnapshot() {
    const sprite = this.rabbit.sprite;
    return {
      state: this.model.state, score: this.model.score, progress: this.model.progress,
      paused: this.paused, trackingSuspended: this.trackingSuspended, scenePaused: this.scene.isPaused(), action: this.rabbit.action,
      frame: this.rabbit.frameName, frameIndex: this.rabbit.frameIndex, fallback: this.rabbit.fallback,
      animationPlaying: sprite?.anims.isPlaying, animationPaused: sprite?.anims.isPaused,
      rabbit: { x: this.rabbit.root.x, y: this.rabbit.root.y, scale: this.rabbit.root.scaleX,
        originX: sprite?.originX, originY: sprite?.originY },
      attached: this.attached, phase: this.successPhase, socket: this.rabbit.getAttachmentPoint(),
      carrot: { x: this.carrot.root.x, y: this.carrot.root.y, alpha: this.carrot.root.alpha, depth: this.carrot.root.depth, visible: this.carrot.root.visible },
      grip: this.carrot.gripWorld(), attachmentBlend: this.attachmentBlend.remaining,
      carrotOrigin: { x: this.carrot.vegetable.originX, y: this.carrot.vegetable.originY },
      carrotScale: this.carrot.root.scaleX, soil: { x: this.soil.x, y: this.soil.y, scale: this.soil.scaleX, visible: this.soil.visible },
      basket: { x: this.basket.image.x, y: this.basket.image.y, scale: this.basket.image.scaleX, dropTarget: BASKET_DROP_TARGET },
      layers: this.garden.layers.map(layer => ({ name: layer.name, key: layer.texture.key, x: layer.x, y: layer.y, scaleX: layer.scaleX, scaleY: layer.scaleY, originX: layer.originX, originY: layer.originY, depth: layer.depth })),
      missingAssets: getMissingCarrotPullAssets(this),
      input: this.motion.getStatus?.(),
      rabbit3d: this.rabbit3d?.snapshot(),
    };
  }

  private cleanup() {
    this.disposed = true;
    window.removeEventListener('keydown', this.onEscape);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.motion.destroy();
    this.rabbit3d?.destroy();
    this.rabbit3d = undefined;
    this.rabbit.destroy();
    this.audio.destroy();
    this.ui.root.classList.remove('carrot-pull-ui');
    this.ui.root.classList.remove('rabbit-preview');
    this.ui.root.classList.remove('carrot-3d-game');
    delete this.ui.root.dataset.carrotRender;
    delete this.ui.root.dataset.roundState;
    this.ui.root.style.removeProperty('z-index');
    this.ui.destroy();
  }
}
