import Phaser from 'phaser';
import { Quaternion, Vector3 } from 'three';
import type { RabbitCharacter } from '../characters/RabbitCharacter';
import { CARROT_PULL_DEPTHS, PLANTED_CARROT } from '../assets/carrotPullLayout';
import { Rabbit3D } from './Rabbit3D';
import { ThreeOverlay, CARROT_GRAB_VIEWPORT, RABBIT_VIEWPORT, phaserToRabbitWorld } from './ThreeOverlay';
import { DEV_RABBIT_3D_DEBUG, Rabbit3DDebug } from './Rabbit3DDebug';
import { MocapController } from '../mocap/MocapController';
import { DEV_MOCAP_DEBUG, MocapDebug } from '../mocap/MocapDebug';
import type { PoseFrame, PoseSnapshot } from '../vision/poseTypes';
import type { CalibrationProfile } from '../calibration/calibrationTypes';
import type { MotionInputStatus } from '../input/MotionInput';
import { rabbitPreviewModelUrl } from './rabbit3dConfig';
import { RabbitIKDebug } from './RabbitIKDebug';
import { Carrot3D } from './Carrot3D';
import { RabbitHandTracker } from './interaction/RabbitHandTracker';
import { CarrotAttachmentController } from './interaction/CarrotAttachmentController';
import { CarrotGrabDebug, DEV_CARROT_GRAB_DEBUG } from './CarrotGrabDebug';

export type RabbitRenderMode = '3d' | 'sprite';
export class Rabbit3DPreview {
  mode: RabbitRenderMode = 'sprite';
  status = 'sprite';
  private overlay?: ThreeOverlay;
  private image?: Phaser.GameObjects.Image;
  private texture?: Phaser.Textures.CanvasTexture;
  private debug?: Rabbit3DDebug;
  private ikDebug?: RabbitIKDebug;
  private mocap?: MocapController;
  private mocapDebug?: MocapDebug;
  private carrot?: Carrot3D;
  private handTracker?: RabbitHandTracker;
  private grabController?: CarrotAttachmentController;
  private grabDebug?: CarrotGrabDebug;
  private grabUpdateMs = 0;
  private paused = false;
  private tools?: HTMLElement;
  private mocapEnabled = false;
  private manualOverride = false;
  private inputStatus?: MotionInputStatus;
  private request?: AbortController;
  private generation = 0;
  private destroyed = false;
  private readonly bar = document.createElement('aside');
  private readonly label = document.createElement('span');
  private readonly select = document.createElement('select');
  private readonly textureKey = `rabbit-three-${crypto.randomUUID()}`;

  get isMocapActive() { return this.mode === '3d' && this.mocapEnabled; }
  get motionHint() { return this.isMocapActive ? this.mocap?.statusMessage : undefined; }
  get hasGrabPrototype() { return this.mode === '3d' && !!this.carrot; }

  constructor(private readonly scene: Phaser.Scene, private readonly sprite: RabbitCharacter,
    private readonly host: HTMLElement, private readonly changed: (preview: boolean) => void) {
    this.bar.className = 'rabbit-render-mode';
    this.bar.append(this.label);
    if (import.meta.env.DEV) {
      this.select.setAttribute('aria-label', '阿兔渲染模式');
      this.select.innerHTML = '<option value="3d">3D 開發預覽</option><option value="sprite">Sprite 完整遊戲</option>';
      this.select.addEventListener('change', () => { void this.setMode(this.select.value as RabbitRenderMode); });
      this.bar.append(this.select);
    }
    host.append(this.bar);
    const requested = new URLSearchParams(location.search).get('rabbitRender');
    void this.setMode(import.meta.env.DEV && requested !== 'sprite' ? '3d' : 'sprite');
  }

  async setMode(mode: RabbitRenderMode) {
    if (this.destroyed) return;
    const generation = ++this.generation;
    this.release();
    this.mode = 'sprite'; this.sprite.root.setVisible(true); this.restoreSpritePlayback();
    this.select.value = mode; this.changed(false);
    if (mode === 'sprite') { this.status = 'sprite'; this.label.textContent = 'Sprite · 完整拔蘿蔔'; this.bar.hidden = !import.meta.env.DEV; return; }
    this.bar.hidden = false;
    this.status = 'loading'; this.label.textContent = '正在載入 3D 阿兔…';
    this.request = new AbortController();
    try {
      const rabbit = await Rabbit3D.load(rabbitPreviewModelUrl(import.meta.env.BASE_URL, location.search), this.request.signal);
      if (generation !== this.generation || this.destroyed) { rabbit.dispose(); return; }
      let carrot: Carrot3D | undefined;
      try {
        if (DEV_CARROT_GRAB_DEBUG) {
          carrot = await Carrot3D.load(`${import.meta.env.BASE_URL}assets/carrot3d/carrot_realtime.glb`, this.request.signal);
        }
      } catch (error) { rabbit.dispose(); throw error; }
      if (generation !== this.generation || this.destroyed) { rabbit.dispose(); carrot?.dispose(); return; }
      this.carrot = carrot;
      const viewport = DEV_CARROT_GRAB_DEBUG ? CARROT_GRAB_VIEWPORT : RABBIT_VIEWPORT;
      try { this.overlay = new ThreeOverlay(rabbit, () => this.fallback('WebGL context lost'), viewport); }
      catch (error) { rabbit.dispose(); throw error; }
      this.texture = this.scene.textures.createCanvas(this.textureKey, viewport.width, viewport.height)!;
      if (!this.texture) throw new Error('Unable to allocate rabbit texture');
      this.image = this.scene.add.image(viewport.x, viewport.y, this.textureKey).setOrigin(0).setDepth(CARROT_PULL_DEPTHS.rabbit);
      this.mode = '3d'; this.status = 'ready'; this.sprite.root.setVisible(false); this.sprite.pause();
      rabbit.rig.setIKEnabled(rabbit.rig.version === 'v3' && new URLSearchParams(location.search).get('rabbitIK') !== '0');
      rabbit.rig.setArmInwardEnabled(DEV_CARROT_GRAB_DEBUG);
      this.mocap = new MocapController(rabbit.rig, undefined, DEV_CARROT_GRAB_DEBUG);
      if (this.carrot) {
        this.overlay.scene.add(this.carrot.root);
        this.carrot.setScale(.6);
        this.handTracker = new RabbitHandTracker(rabbit);
        const initial = phaserToRabbitWorld(PLANTED_CARROT.x, PLANTED_CARROT.y, rabbit.pixelsPerUnit);
        this.grabController = new CarrotAttachmentController(this.carrot, this.handTracker, {
          allowDistanceBypass: import.meta.env.DEV,
          initialGripPosition: new Vector3(initial.x, initial.y, .65),
        });
      }
      this.label.textContent = `3D ${rabbit.rig.version.toUpperCase()} 開發預覽 · 骨骼測試，拔蘿蔔請切回 Sprite`;
      this.changed(true);
      if (DEV_RABBIT_3D_DEBUG || DEV_MOCAP_DEBUG || DEV_CARROT_GRAB_DEBUG) {
        this.tools = document.createElement('aside'); this.tools.className = 'rabbit-tools'; this.host.append(this.tools);
        this.ikDebug = new RabbitIKDebug(this.tools, rabbit.rig);
        if (DEV_MOCAP_DEBUG) {
          this.host.classList.add('mocap-debug-visible');
          this.mocapDebug = new MocapDebug(this.tools, () => this.setMocapEnabled(!this.mocapEnabled), () => this.resetMotionReference());
        }
        this.restoreManualDebug();
        if (this.carrot && this.handTracker && this.grabController) {
          this.grabDebug = new CarrotGrabDebug(this.tools, this.overlay.scene, this.carrot, this.handTracker,
            this.grabController, () => this.placeCarrotAtHands(), () => this.mocapEnabled ? '體感' : '手動骨骼',
            () => this.grabController?.update(0, this.grabTrackingReliable()));
          this.grabDebug.setPaused(this.paused);
          if (this.paused) this.grabController.pause();
        }
      }
      this.update(0);
    } catch (error) {
      if (generation !== this.generation || this.destroyed) return;
      this.fallback(error instanceof Error ? error.message : String(error));
    }
  }

  private fallback(reason: string) {
    this.release(); this.mode = 'sprite'; this.status = `fallback: ${reason}`;
    this.select.value = 'sprite'; this.sprite.root.setVisible(true); this.restoreSpritePlayback(); this.changed(false);
    this.label.textContent = '3D 載入失敗，已使用 Sprite 完整遊戲';
    console.warn('Rabbit 3D preview fell back to sprite:', reason);
  }

  update(deltaSeconds: number) {
    if (this.paused) return;
    this.mocap?.update(deltaSeconds);
    if (!this.overlay || !this.texture || !this.overlay.render(deltaSeconds, step => {
      if (!this.grabController) return;
      const started = performance.now();
      this.grabController.update(step, this.grabTrackingReliable());
      this.grabDebug?.update(step);
      this.grabUpdateMs = performance.now() - started;
    })) return;
    const context = this.texture.context;
    const viewport = this.overlay.viewport;
    context.clearRect(0, 0, viewport.width, viewport.height);
    context.drawImage(this.overlay.renderer.domElement, 0, 0);
    this.texture.refresh();
    this.debug?.update(this.overlay.fps);
    this.ikDebug?.update(deltaSeconds);
    if (this.mocap && this.mocapDebug) this.mocapDebug.update(this.mocap.snapshot(), this.overlay.fps, this.inputStatus);
  }

  acceptMotionFrame(frame: PoseFrame, pose: PoseSnapshot, profile: CalibrationProfile) {
    if (this.mode !== '3d' || this.manualOverride || !this.mocap) return;
    if (!this.mocapEnabled) this.setMocapEnabled(true);
    this.mocap.acceptFrame(frame, pose, profile);
  }

  setInputStatus(status: MotionInputStatus) { this.inputStatus = status; }
  resetMotionInput() {
    this.manualOverride = false;
    this.mocap?.stop();
    this.mocap?.resetReference();
    this.mocapEnabled = false;
    if (this.mode === '3d') this.label.textContent = '3D 開發預覽 · 等待鏡頭動作設定';
    this.overlay?.rabbit.rig.resetPose();
    this.restoreManualDebug();
  }
  resetMotionReference() { this.mocap?.resetReference(); }
  pause() {
    this.paused = true; this.mocap?.pause(); this.grabController?.pause(); this.grabDebug?.setPaused(true);
  }
  resume() {
    this.paused = false; this.mocap?.resume(); this.grabController?.resume(); this.grabDebug?.setPaused(false);
  }

  private grabTrackingReliable() {
    if (!this.mocapEnabled) return this.inputStatus?.mode !== 'camera' || this.manualOverride;
    const motion = this.mocap?.snapshot();
    const raw = motion?.raw;
    return !!motion && motion.trackingState === 'tracking' && !motion.lastRejection && !!raw
      && raw.leftArmConfidence >= .65 && raw.rightArmConfidence >= .65
      && performance.now() - raw.timestampMs <= 250 && performance.now() >= raw.timestampMs
      && !!this.inputStatus?.ready && !this.inputStatus.suspended;
  }

  private placeCarrotAtHands() {
    if (this.paused || !this.carrot || !this.handTracker || !this.grabController) return;
    const hands = this.handTracker.sample(this.grabTrackingReliable());
    if (!hands.valid || !hands.reliable) return;
    this.grabController.reset();
    this.carrot.setGripWorld(hands.gripMidpoint, new Quaternion());
    this.grabController.update(0, hands.reliable);
  }

  setMocapEnabled(enabled: boolean) {
    if (!this.mocap || !this.overlay || this.mode !== '3d') return;
    this.manualOverride = !enabled;
    if (this.mocapEnabled === enabled) return;
    this.mocapEnabled = enabled;
    this.label.textContent = enabled ? '3D 即時動作同步 · 開發預覽，完整遊戲請切回 Sprite' : '3D 開發預覽 · 骨骼測試，拔蘿蔔請切回 Sprite';
    this.debug?.destroy(); this.debug = undefined;
    this.overlay.rabbit.rig.resetPose();
    if (enabled) this.mocap.enable();
    else { this.mocap.stop(); this.restoreManualDebug(); }
  }

  private restoreManualDebug() {
    if ((DEV_RABBIT_3D_DEBUG || DEV_CARROT_GRAB_DEBUG) && this.tools && this.overlay && !this.mocapEnabled && !this.debug) {
      this.debug = new Rabbit3DDebug(this.tools, this.overlay.rabbit.rig);
      if (DEV_CARROT_GRAB_DEBUG) {
        const grabPanel = this.tools.querySelector('.carrot-grab-debug');
        if (grabPanel) grabPanel.after(this.debug.root);
        else this.tools.prepend(this.debug.root);
      }
    }
  }

  private restoreSpritePlayback() {
    const waitingForCamera = this.inputStatus?.mode === 'camera' && (!this.inputStatus.ready || this.inputStatus.suspended);
    if (waitingForCamera || this.scene.scene.isPaused()) this.sprite.pause();
    else this.sprite.resume();
  }

  snapshot() {
    return { mode: this.mode, status: this.status, fps: this.overlay?.fps ?? 0, renderedFrames: this.overlay?.renderedFrames ?? 0,
      bones: this.overlay ? [...this.overlay.rabbit.rig.bones.keys()] : [],
      quaternions: this.overlay ? Object.fromEntries([...this.overlay.rabbit.rig.bones].map(([name, bone]) => [name, bone.quaternion.toArray()])) : {},
      pixelsPerUnit: this.overlay?.rabbit.pixelsPerUnit, viewport: this.overlay?.viewport ?? RABBIT_VIEWPORT, spriteVisible: this.sprite.root.visible,
      rootPosition: this.overlay?.rabbit.rig.bones.get('root')?.position.toArray(),
      camera: this.overlay ? { type: 'OrthographicCamera', position: this.overlay.camera.position.toArray(), direction: [0, 0, -1] } : null,
      textureExists: this.scene.textures.exists(this.textureKey), debug: !!this.debug,
      controlSource: this.mode === 'sprite' ? 'sprite' : this.mocapEnabled ? 'mocap' : 'manual',
      rigVersion: this.overlay?.rabbit.rig.version, limits: this.overlay?.rabbit.rig.limits,
      elbowLimitsByRaise: this.overlay?.rabbit.rig.elbowLimitsByRaise,
      headLimitsByRaise: this.overlay?.rabbit.rig.headLimitsByRaise,
      ik: this.overlay?.rabbit.rig.ikSnapshot(),
      grab: this.grabController ? { ...this.grabController.snapshot(), updateMs: this.grabUpdateMs,
        modelCount: this.overlay?.scene.getObjectByName('Carrot3D') ? 1 : 0 } : undefined,
      input: this.inputStatus, mocap: this.mocap?.snapshot() };
  }

  private release() {
    this.request?.abort(); this.request = undefined;
    this.grabDebug?.destroy(); this.grabDebug = undefined;
    this.grabController?.dispose(); this.grabController = undefined;
    this.handTracker?.dispose(); this.handTracker = undefined;
    this.carrot?.dispose(); this.carrot = undefined;
    this.debug?.destroy(); this.debug = undefined;
    this.ikDebug?.destroy(); this.ikDebug = undefined;
    this.mocap?.dispose(); this.mocap = undefined; this.mocapEnabled = false;
    this.mocapDebug?.destroy(); this.mocapDebug = undefined;
    this.tools?.remove(); this.tools = undefined;
    this.host.classList.remove('mocap-debug-visible');
    this.image?.destroy(); this.image = undefined;
    if (this.texture) this.scene.textures.remove(this.textureKey);
    this.texture = undefined;
    this.overlay?.dispose(); this.overlay = undefined;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true; ++this.generation; this.release(); this.bar.remove();
  }
}
