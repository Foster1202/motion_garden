import type Phaser from 'phaser';
import { type Bone, MathUtils, Quaternion, Vector3 } from 'three';
import { Rabbit3D } from '../3d/Rabbit3D';
import { RABBIT_3D_CONFIG, type RabbitBoneName } from '../3d/rabbit3dConfig';
import { ThreeOverlay } from '../3d/ThreeOverlay';
import { Rabbit } from '../art/Rabbit';
import { RABBIT_ORIGIN, RabbitAssetKeys, type RabbitAnimationConfig } from '../characters/rabbitAssets';
import { recordThreeFrame } from '../performance/performanceMetrics';

const VIEWPORT = { x: 704, y: 349, width: 380, height: 368 };
const HEIGHT_SCALE = .78;
const X_AXIS = new Vector3(1, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);

type Side = 'left' | 'right';

export interface HomeRabbitFrame {
  x: number;
  y: number;
  side: Side | null;
  steps: number;
  timeMs: number;
  arrivedMs: number | null;
}

class RestJoint {
  private readonly rest: Quaternion;
  private readonly axis: Vector3;
  private readonly rotation = new Quaternion();

  constructor(model: Rabbit3D, private readonly bone: Bone, axis: Vector3) {
    this.rest = bone.quaternion.clone();
    this.axis = axis.clone().applyQuaternion(model.model.getWorldQuaternion(new Quaternion()))
      .applyQuaternion(bone.getWorldQuaternion(new Quaternion()).invert()).normalize();
  }

  set(degrees: number) {
    this.bone.quaternion.copy(this.rest).multiply(this.rotation.setFromAxisAngle(this.axis, MathUtils.degToRad(degrees)));
  }
}

function bindJoints(rabbit: Rabbit3D) {
  const joint = (name: RabbitBoneName, axis = X_AXIS) => new RestJoint(rabbit, rabbit.rig.bones.get(name)!, axis);
  return {
    left: { thigh: joint('thigh.L'), shin: joint('shin.L'), foot: joint('foot.L'), ear: joint('ear.L', Z_AXIS) },
    right: { thigh: joint('thigh.R'), shin: joint('shin.R'), foot: joint('foot.R'), ear: joint('ear.R', Z_AXIS) },
  };
}

export class HomeRabbitView {
  private readonly abort = new AbortController();
  private readonly fallback: Phaser.GameObjects.Sprite | Phaser.GameObjects.Container;
  private readonly atlas?: RabbitAnimationConfig;
  private readonly placeholder?: Rabbit;
  private readonly key = 'rabbit-home-character';
  private charImage?: Phaser.GameObjects.Image;
  private texture?: Phaser.Textures.CanvasTexture;
  private overlay?: ThreeOverlay;
  private joints?: ReturnType<typeof bindJoints>;
  private lastTime = 0;
  private lastSteps = 0;
  private lastStepTime = -Infinity;
  private stepDuration = 490;
  private readonly footTimes = { left: -Infinity, right: -Infinity };
  private lastX?: number;
  private turn = 0;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly lowPerformance: boolean,
    private readonly reducedMotion: boolean) {
    const atlas: RabbitAnimationConfig | undefined = scene.cache.json.get(RabbitAssetKeys.animations);
    const idle = atlas?.idle?.frames[0];
    if (idle && scene.textures.exists(idle.key) && scene.textures.get(idle.key).has(idle.frame)) {
      this.atlas = atlas;
      this.fallback = scene.add.sprite(800, 750, idle.key, idle.frame)
        .setOrigin(RABBIT_ORIGIN.x, RABBIT_ORIGIN.y);
    } else {
      this.placeholder = new Rabbit(scene, 800, 750);
      this.fallback = this.placeholder.root;
    }
    this.fallback.setDepth(4).setScale(.76 * RABBIT_3D_CONFIG.visibleHeight / 342);
    void this.load();
  }

  private async load() {
    let rabbit: Rabbit3D | undefined;
    try {
      rabbit = await Rabbit3D.load(`${import.meta.env.BASE_URL}assets/rabbit3d/rabbit_carrot.glb`, this.abort.signal);
      if (this.destroyed) { rabbit.dispose(); return; }
      this.joints = bindJoints(rabbit);
      this.overlay = new ThreeOverlay(rabbit, () => this.releaseThree(), VIEWPORT,
        { lowPerformance: this.lowPerformance });
      const { width, height } = this.overlay.renderSize;
      this.texture = this.scene.textures.createCanvas(this.key, width, height)!;
      this.charImage = this.scene.add.image(0, 0, this.key).setOrigin(0)
        .setDisplaySize(VIEWPORT.width, VIEWPORT.height).setDepth(4).setVisible(false);
    } catch {
      if (!this.overlay) rabbit?.dispose();
      this.releaseThree();
    }
  }

  update(frame: HomeRabbitFrame) {
    if (this.destroyed) return;
    const dt = Math.max(0, Math.min(100, frame.timeMs - this.lastTime)) / 1000;
    this.lastTime = frame.timeMs;
    if (frame.steps !== this.lastSteps && frame.side !== null) {
      const interval = frame.timeMs - this.lastStepTime;
      this.stepDuration = MathUtils.clamp(interval * 1.08, 285, 610);
      this.lastStepTime = frame.timeMs;
      this.footTimes[frame.side] = frame.timeMs;
    }
    this.lastSteps = frame.steps;
    const walk = (side: Side) => Math.sin(Math.PI * MathUtils.clamp(
      (frame.timeMs - this.footTimes[side]) / this.stepDuration, 0, 1));
    const left = walk('left');
    const right = walk('right');
    const stride = left - right;
    const activity = Math.max(left, right);
    const moveFactor = this.reducedMotion ? .45 : 1;
    const bob = Math.pow(activity, 1.4) * 5 * moveFactor;
    const waveIn = frame.arrivedMs === null ? 0 : MathUtils.smoothstep(frame.arrivedMs, 120, 550);
    const waveOut = frame.arrivedMs === null ? 0 : 1 - MathUtils.smoothstep(frame.arrivedMs, 4800, 5700);
    const wave = this.reducedMotion ? 0 : waveIn * waveOut;
    const waveSway = Math.sin((frame.arrivedMs ?? 0) / 105);
    const y = frame.y - bob;
    const dx = frame.x - (this.lastX ?? frame.x);
    this.lastX = frame.x;
    this.turn += (MathUtils.clamp(dx * .055, -.35, .35) - this.turn) * (1 - Math.exp(-8 * dt));
    if (this.fallback.visible) this.updateSprite(frame, y, stride, moveFactor, activity);

    const overlay = this.overlay;
    const joints = this.joints;
    if (!overlay || !this.charImage || !this.texture || !joints) return;
    const rabbit = overlay.rabbit;
    rabbit.pivot.rotation.y = MathUtils.lerp(-.61 + this.turn, -.08, waveIn);
    rabbit.pivot.scale.set(-HEIGHT_SCALE, HEIGHT_SCALE, HEIGHT_SCALE);
    rabbit.pivot.position.y = -rabbit.bounds.min.y * HEIGHT_SCALE;
    rabbit.rig.setBodyLean(stride * 3.6 * moveFactor + wave * 3, activity * 2.4 * moveFactor);
    rabbit.rig.setHeadRotation(wave * 8, stride * 2.3 * moveFactor, wave * -4);
    rabbit.rig.setArmRotation('left', 6 + left * 11 * moveFactor, 0, 72);
    rabbit.rig.setArmRotation('right', 6 + right * 11 * moveFactor + wave * (66 + waveSway * 13), 0, 28 + wave * 12);
    const afterPose = () => {
      for (const [side, lift, counter] of [['left', left, right], ['right', right, left]] as const) {
        const { thigh, shin, foot, ear } = joints[side];
        thigh.set((-32 * lift + 6 * counter) * moveFactor);
        shin.set((41 * lift + 7 * counter) * moveFactor);
        foot.set((-14 * lift - 8 * counter) * moveFactor);
        const bounce = this.reducedMotion ? 0 : stride * 7 + Math.sin(frame.timeMs / 260) * (1 + 2 * activity);
        ear.set((side === 'left' ? 1 : -1) * bounce + wave * waveSway * 2);
      }
      rabbit.pivot.updateWorldMatrix(true, true);
    };
    this.charImage.setPosition(frame.x - (894 - VIEWPORT.x), y - (681 - VIEWPORT.y));
    let drawn = false;
    if (!this.charImage.visible) {
      afterPose();
      overlay.renderer.render(overlay.scene, overlay.camera);
      drawn = true;
    } else if (dt > 0) {
      drawn = overlay.render(dt, afterPose);
    }
    if (drawn && this.overlay === overlay) this.upload();
  }

  private updateSprite(frame: HomeRabbitFrame, y: number, stride: number, scale: number, activity: number) {
    const spec = this.atlas?.[frame.arrivedMs === null ? 'idle' : 'celebrate'];
    if (spec && 'setTexture' in this.fallback) {
      const t = frame.arrivedMs ?? frame.timeMs;
      const index = this.reducedMotion ? 0 : Math.floor(t / 1000 * spec.frameRate);
      const spriteFrame = spec.frames[frame.arrivedMs === null ? index % spec.frames.length
        : Math.min(index, spec.frames.length - 1)];
      if (this.scene.textures.exists(spriteFrame.key) && this.scene.textures.get(spriteFrame.key).has(spriteFrame.frame)) {
        this.fallback.setTexture(spriteFrame.key, spriteFrame.frame).setOrigin(RABBIT_ORIGIN.x, RABBIT_ORIGIN.y);
      }
    }
    this.placeholder?.setHappy(frame.arrivedMs !== null);
    this.fallback.setPosition(frame.x, y).setAngle(stride * 3.4 * scale);
    this.fallback.scaleY = this.fallback.scaleX * (1 + activity * .023 * scale);
  }

  private upload() {
    if (!this.overlay || !this.texture || !this.charImage) return;
    const { context, width, height } = this.texture;
    context.clearRect(0, 0, width, height);
    context.drawImage(this.overlay.renderer.domElement, 0, 0);
    this.texture.refresh();
    this.charImage.setVisible(true);
    this.fallback.setVisible(false);
    recordThreeFrame();
  }

  private releaseThree() {
    const overlay = this.overlay;
    this.overlay = undefined;
    this.joints = undefined;
    this.charImage?.destroy();
    this.charImage = undefined;
    if (this.scene.textures.exists(this.key)) this.scene.textures.remove(this.key);
    this.texture = undefined;
    overlay?.dispose();
    if (!this.destroyed) this.fallback.setVisible(true);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abort.abort();
    this.releaseThree();
    this.fallback.destroy();
  }
}
