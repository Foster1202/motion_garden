import Phaser from 'phaser';
import { Quaternion, Vector3 } from 'three';
import type { RabbitCharacter } from '../characters/RabbitCharacter';
import { BASKET_DROP_TARGET, CARROT_PULL_DEPTHS, PLANTED_CARROT } from '../assets/carrotPullLayout';
import { Rabbit3D } from './Rabbit3D';
import { ThreeOverlay, CARROT_GAME_VIEWPORT, CARROT_GRAB_VIEWPORT, RABBIT_VIEWPORT, phaserToRabbitWorld, rabbitWorldToPhaser } from './ThreeOverlay';
import { DEV_RABBIT_3D_DEBUG, Rabbit3DDebug } from './Rabbit3DDebug';
import { MocapController } from '../mocap/MocapController';
import { DEV_MOCAP_DEBUG, MocapDebug } from '../mocap/MocapDebug';
import type { PoseFrame, PoseSnapshot } from '../vision/poseTypes';
import type { CalibrationProfile } from '../calibration/calibrationTypes';
import type { MotionInputStatus, MotionSample } from '../input/MotionInput';
import { rabbitPreviewModelUrl } from './rabbit3dConfig';
import { RabbitIKDebug } from './RabbitIKDebug';
import { Carrot3D } from './Carrot3D';
import { RabbitHandTracker } from './interaction/RabbitHandTracker';
import { CarrotAttachmentController } from './interaction/CarrotAttachmentController';
import { CarrotGrabDebug, DEV_CARROT_GRAB_DEBUG } from './CarrotGrabDebug';
import { CarrotGameDebug, DEV_CARROT_GAME_DEBUG, DEV_CARROT_GAME_SIM } from './CarrotGameDebug';
import { CarrotPull3DCoordinator } from './gameplay/CarrotPull3DCoordinator';
import { CarrotPull3DEnvironment } from './gameplay/CarrotPull3DEnvironment';
import { neutralRabbitPose } from '../mocap/RabbitPose';
import type { RoundState } from '../systems/CarrotRound';

export type RabbitRenderMode = '3d' | 'sprite';
export class Rabbit3DPreview {
  mode: RabbitRenderMode = 'sprite';
  status = 'sprite';
  purpose: 'debug' | 'game' = 'debug';
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
  private coordinator?: CarrotPull3DCoordinator;
  private environment?: CarrotPull3DEnvironment;
  private gameDebug?: CarrotGameDebug;
  private gameUpdateMs = 0;
  private target: 'sprite' | 'debug' | 'game' = 'sprite';
  private manualRenderOverride = false;
  private cameraFallback = false;
  private gameWasReady = false;
  private pendingFallback?: string;
  private roundState: RoundState = 'READY';
  private roundProgress = 0;
  private score = 0;
  private motionSample: MotionSample = { bending: false, standing: false };
  private readonly simulation = neutralRabbitPose();
  private readonly rigDebug = (DEV_RABBIT_3D_DEBUG || DEV_MOCAP_DEBUG || DEV_CARROT_GRAB_DEBUG)
    && !DEV_CARROT_GAME_DEBUG && !DEV_CARROT_GAME_SIM;
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
  get isGameplay() { return this.mode === '3d' && this.purpose === 'game'; }
  get isDebugPreview() { return this.mode === '3d' && this.purpose === 'debug'; }
  get gameplaySelected() { return this.target === 'game'; }
  get canAdvanceGameRound() { return this.gameplayReady && !!this.coordinator?.canAdvanceRound; }
  get gameplayReady() {
    if (this.paused || !this.isGameplay || !this.inputStatus?.ready || this.inputStatus.suspended) return false;
    if (this.inputStatus.mode === 'keyboard') return true;
    const motion = this.mocap?.snapshot();
    const timestamp = motion?.raw?.timestampMs;
    return !!motion?.referenceReady && !motion.lastRejection && timestamp !== undefined
      && performance.now() >= timestamp && performance.now() - timestamp <= 250;
  }

  constructor(private readonly scene: Phaser.Scene, private readonly sprite: RabbitCharacter,
    private readonly host: HTMLElement, private readonly changed: (preview: boolean) => void,
    private readonly onHarvestComplete?: () => void) {
    this.bar.className = 'rabbit-render-mode';
    this.bar.append(this.label);
    if (import.meta.env.DEV) {
      this.select.setAttribute('aria-label', '阿兔渲染模式');
      this.select.innerHTML = `<option value="3d">${this.rigDebug ? '3D 開發預覽' : '3D 即時遊戲'}</option><option value="sprite">Sprite 完整遊戲</option>`;
      this.select.addEventListener('change', () => {
        this.manualRenderOverride = true;
        void this.setMode(this.select.value as RabbitRenderMode, this.rigDebug ? 'debug' : 'game');
      });
      this.bar.append(this.select);
    }
    host.append(this.bar);
    const requested = new URLSearchParams(location.search).get('rabbitRender');
    void this.setMode(this.rigDebug && requested !== 'sprite' ? '3d' : 'sprite');
  }

  async setMode(mode: RabbitRenderMode, purpose: 'debug' | 'game' = 'debug') {
    if (this.destroyed) return;
    const generation = ++this.generation;
    this.release();
    this.purpose = purpose;
    this.target = mode === 'sprite' ? 'sprite' : purpose;
    if (mode === '3d') this.cameraFallback = false;
    this.mode = 'sprite'; this.sprite.root.setVisible(true); this.restoreSpritePlayback();
    this.select.value = mode; this.changed(false);
    if (mode === 'sprite') { this.status = 'sprite'; this.label.textContent = 'Sprite · 完整拔蘿蔔'; this.bar.hidden = !import.meta.env.DEV; return; }
    this.bar.hidden = false;
    this.status = 'loading'; this.label.textContent = purpose === 'game' ? '正在準備阿兔…' : '正在載入 3D 阿兔…';
    this.request = new AbortController();
    try {
      const rabbit = await Rabbit3D.load(rabbitPreviewModelUrl(import.meta.env.BASE_URL, purpose === 'game' ? '' : location.search), this.request.signal);
      if (generation !== this.generation || this.destroyed) { rabbit.dispose(); return; }
      let carrot: Carrot3D | undefined;
      try {
        if (purpose === 'game' || DEV_CARROT_GRAB_DEBUG) {
          carrot = await Carrot3D.load(`${import.meta.env.BASE_URL}assets/carrot3d/carrot_realtime.glb`, this.request.signal);
        }
      } catch (error) { rabbit.dispose(); throw error; }
      if (generation !== this.generation || this.destroyed) { rabbit.dispose(); carrot?.dispose(); return; }
      this.carrot = carrot;
      const viewport = purpose === 'game' ? CARROT_GAME_VIEWPORT : DEV_CARROT_GRAB_DEBUG ? CARROT_GRAB_VIEWPORT : RABBIT_VIEWPORT;
      try { this.overlay = new ThreeOverlay(rabbit, () => {
        if (generation === this.generation && !this.destroyed) this.fallback('WebGL context lost');
      }, viewport); }
      catch (error) { rabbit.dispose(); throw error; }
      this.texture = this.scene.textures.createCanvas(this.textureKey, viewport.width, viewport.height)!;
      if (!this.texture) throw new Error('Unable to allocate rabbit texture');
      this.image = this.scene.add.image(viewport.x, viewport.y, this.textureKey).setOrigin(0).setDepth(CARROT_PULL_DEPTHS.rabbit);
      this.mode = '3d'; this.status = 'ready'; this.sprite.root.setVisible(false); this.sprite.pause();
      rabbit.rig.setIKEnabled(rabbit.rig.version === 'v3' && (purpose === 'game' || new URLSearchParams(location.search).get('rabbitIK') !== '0'));
      rabbit.rig.setArmInwardEnabled(purpose === 'game' || DEV_CARROT_GRAB_DEBUG);
      if (this.carrot) {
        this.overlay.scene.add(this.carrot.root);
        this.handTracker = new RabbitHandTracker(rabbit);
        if (purpose === 'game') {
          const basket = phaserToRabbitWorld(BASKET_DROP_TARGET.x, BASKET_DROP_TARGET.y, rabbit.pixelsPerUnit);
          this.coordinator = new CarrotPull3DCoordinator(rabbit, this.carrot, this.handTracker, {
            basketTarget: new Vector3(basket.x, basket.y, 1),
            onHarvestComplete: () => {
              if (generation === this.generation && !this.destroyed) this.onHarvestComplete?.();
            },
            onAssistanceUnavailable: reason => { this.pendingFallback = reason; },
          });
          this.environment = new CarrotPull3DEnvironment(this.scene, {
            plantedGrip: this.coordinator.plantedGrip,
            soilWorldY: this.coordinator.soilWorldY,
            project: point => rabbitWorldToPhaser(point.x, point.y, rabbit.pixelsPerUnit),
          });
          this.coordinator.onRoundState(this.roundState);
        } else {
          this.carrot.setScale(.6);
          const initial = phaserToRabbitWorld(PLANTED_CARROT.x, PLANTED_CARROT.y, rabbit.pixelsPerUnit);
          this.grabController = new CarrotAttachmentController(this.carrot, this.handTracker, {
            allowDistanceBypass: import.meta.env.DEV,
            initialGripPosition: new Vector3(initial.x, initial.y, .65),
          });
        }
      }
      this.mocap = new MocapController(rabbit.rig, undefined, purpose === 'game' || DEV_CARROT_GRAB_DEBUG);
      this.label.textContent = purpose === 'game' ? '阿兔即時跟隨你 · 自動輔助抓握' : `3D ${rabbit.rig.version.toUpperCase()} 開發預覽 · 骨骼測試，拔蘿蔔請切回 Sprite`;
      this.bar.hidden = !import.meta.env.DEV;
      this.changed(true);
      if (purpose === 'game' && DEV_CARROT_GAME_DEBUG) {
        this.tools = document.createElement('aside'); this.tools.className = 'rabbit-tools'; this.host.append(this.tools);
        this.gameDebug = new CarrotGameDebug(this.tools, () => this.gameDebugSnapshot());
      }
      if (purpose === 'debug' && (DEV_RABBIT_3D_DEBUG || DEV_MOCAP_DEBUG || DEV_CARROT_GRAB_DEBUG)) {
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
      if (this.paused) this.coordinator?.pause();
      this.update(0);
    } catch (error) {
      if (generation !== this.generation || this.destroyed) return;
      this.fallback(error instanceof Error ? error.message : String(error));
    }
  }

  private fallback(reason: string) {
    this.cameraFallback = this.purpose === 'game';
    this.target = 'sprite';
    this.release(); this.mode = 'sprite'; this.status = `fallback: ${reason}`;
    this.select.value = 'sprite'; this.sprite.root.setVisible(true); this.restoreSpritePlayback(); this.changed(false);
    this.bar.hidden = false;
    this.label.textContent = this.purpose === 'game' ? '暫時未能顯示立體阿兔，已轉用原有遊戲畫面。' : '3D 載入失敗，已使用 Sprite 完整遊戲';
    console.warn('Rabbit 3D preview fell back to sprite:', reason);
  }

  update(deltaSeconds: number) {
    if (this.paused) return;
    const gameReady = this.gameplayReady;
    this.coordinator?.setTrackingReliable(gameReady);
    if (this.isGameplay && this.gameWasReady && !gameReady) {
      this.gameDebug?.update(deltaSeconds);
      return;
    }
    if (gameReady) this.gameWasReady = true;
    this.mocap?.update(deltaSeconds);
    let preparationMs = 0;
    if (this.coordinator) {
      const started = performance.now();
      const pose = this.mocapEnabled ? this.mocap!.snapshot().smoothed : this.updateSimulation(deltaSeconds);
      this.coordinator.preparePose(deltaSeconds, pose.bendAmount, pose, this.roundProgress);
      preparationMs = performance.now() - started;
    }
    if (!this.overlay || !this.texture || !this.overlay.render(deltaSeconds, step => {
      const started = performance.now();
      if (this.coordinator) {
        this.coordinator.afterPose(step);
        this.gameUpdateMs = preparationMs + performance.now() - started;
      }
      if (this.grabController) {
        this.grabController.update(step, this.grabTrackingReliable());
        this.grabDebug?.update(step);
        this.grabUpdateMs = performance.now() - started;
      }
    })) return;
    if (this.pendingFallback) { this.fallback(this.pendingFallback); return; }
    const context = this.texture.context;
    const viewport = this.overlay.viewport;
    context.clearRect(0, 0, viewport.width, viewport.height);
    context.drawImage(this.overlay.renderer.domElement, 0, 0);
    this.texture.refresh();
    this.debug?.update(this.overlay.fps);
    this.ikDebug?.update(deltaSeconds);
    this.gameDebug?.update(deltaSeconds);
    if (this.mocap && this.mocapDebug) this.mocapDebug.update(this.mocap.snapshot(), this.overlay.fps, this.inputStatus);
  }

  acceptMotionFrame(frame: PoseFrame, pose: PoseSnapshot, profile: CalibrationProfile) {
    if (this.paused || this.mode !== '3d' || this.manualOverride || !this.mocap) return;
    if (!this.mocapEnabled) this.setMocapEnabled(true);
    this.mocap.acceptFrame(frame, pose, profile);
  }

  setInputStatus(status: MotionInputStatus) {
    this.inputStatus = status;
    if (this.rigDebug || this.manualRenderOverride || this.cameraFallback || this.destroyed) return;
    const game = status.mode === 'camera' || (status.mode === 'keyboard' && DEV_CARROT_GAME_SIM);
    const desired = game ? 'game' : 'sprite';
    if (desired !== this.target) void this.setMode(game ? '3d' : 'sprite', 'game');
  }

  setRoundState(state: RoundState, progress: number, score: number) {
    this.roundState = state;
    this.roundProgress = progress;
    this.score = score;
    this.coordinator?.onRoundState(state);
  }

  setMotionSample(sample: MotionSample) { this.motionSample = sample; }

  private updateSimulation(seconds: number) {
    const step = Number.isFinite(seconds) ? Math.max(0, Math.min(seconds, .05)) : 0;
    const target = this.motionSample.bending ? 1 : this.motionSample.standing ? 0 : this.simulation.bendAmount;
    const distance = target - this.simulation.bendAmount;
    this.simulation.bendAmount += Math.sign(distance) * Math.min(Math.abs(distance), step * 1.8);
    this.simulation.timestampMs = performance.now();
    this.simulation.trackingConfidence = 1;
    this.overlay?.rabbit.rig.applyPose(this.simulation);
    return this.simulation;
  }
  resetMotionInput() {
    this.cameraFallback = false;
    this.manualRenderOverride = false;
    this.manualOverride = false;
    this.mocap?.stop();
    this.mocap?.resetReference();
    this.mocapEnabled = false;
    if (this.mode === '3d') this.label.textContent = this.isGameplay ? '等待鏡頭動作設定，準備好先開始。' : '3D 開發預覽 · 等待鏡頭動作設定';
    this.overlay?.rabbit.rig.resetPose();
    this.restoreManualDebug();
  }
  resetMotionReference() { this.mocap?.resetReference(); }
  pause() {
    this.paused = true; this.mocap?.pause(); this.grabController?.pause(); this.grabDebug?.setPaused(true); this.coordinator?.pause();
  }
  resume() {
    this.paused = false; this.mocap?.resume(); this.grabController?.resume(); this.grabDebug?.setPaused(false); this.coordinator?.resume();
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
    this.label.textContent = this.isGameplay ? '阿兔即時跟隨你 · 自動輔助抓握'
      : enabled ? '3D 即時動作同步 · 開發預覽，完整遊戲請切回 Sprite' : '3D 開發預覽 · 骨骼測試，拔蘿蔔請切回 Sprite';
    this.debug?.destroy(); this.debug = undefined;
    if (!this.isGameplay) this.overlay.rabbit.rig.resetPose();
    if (enabled) this.mocap.enable();
    else { this.mocap.stop(); this.restoreManualDebug(); }
  }

  private restoreManualDebug() {
    if (!this.isGameplay && (DEV_RABBIT_3D_DEBUG || DEV_CARROT_GRAB_DEBUG) && this.tools && this.overlay && !this.mocapEnabled && !this.debug) {
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
      renderMode: this.mode === 'sprite' ? 'sprite' : this.isGameplay ? '3d-game' : '3d-debug',
      purpose: this.purpose, gameplayReady: this.gameplayReady, gameplaySelected: this.gameplaySelected,
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
      gameplay: this.coordinator ? { ...this.coordinator.snapshot(), updateMs: this.gameUpdateMs,
        environment: this.environment?.snapshot() } : undefined,
      environment: this.environment?.snapshot(),
      grab: this.grabController ? { ...this.grabController.snapshot(), updateMs: this.grabUpdateMs,
        modelCount: this.overlay?.scene.getObjectByName('Carrot3D') ? 1 : 0 } : undefined,
      input: this.inputStatus, mocap: this.mocap?.snapshot() };
  }

  private release() {
    this.request?.abort(); this.request = undefined;
    this.pendingFallback = undefined;
    this.gameDebug?.destroy(); this.gameDebug = undefined;
    this.coordinator?.dispose(); this.coordinator = undefined;
    this.environment?.destroy(); this.environment = undefined;
    this.gameWasReady = false;
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

  private gameDebugSnapshot() {
    const ik = this.overlay?.rabbit.rig.ikSnapshot();
    return { '回合狀態': this.roundState, '分數': this.score,
      '屈膝保持進度': this.roundState === 'BENDING' ? this.roundProgress : this.roundState === 'GRABBED' ? 1 : 0,
      '站立保持進度': this.roundState === 'RETURNING' ? this.roundProgress : this.roundState === 'SUCCESS' ? 1 : 0,
      '追蹤狀態': this.inputStatus?.trackingState ?? this.inputStatus?.mode,
      '即時同步': this.mocap?.snapshot().trackingState, FPS: this.overlay?.fps ?? 0,
      'IK時間ms': ik?.solverTimeMs, '手部IK目標': ik?.hands,
      '遊戲協調': this.coordinator?.snapshot(), '泥土遮擋': this.environment?.snapshot() };
  }
}
