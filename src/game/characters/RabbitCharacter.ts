import Phaser from 'phaser';
import { Rabbit as RabbitPlaceholder } from '../art/Rabbit';
import { CARROT_PULL_DEPTHS } from '../assets/carrotPullLayout';
import { RabbitAttachmentTracker } from './RabbitAttachmentTracker';
import {
  RABBIT_ACTIONS, RABBIT_ORIGIN, RabbitAssetKeys, validateRabbitAssets,
  type RabbitAction, type RabbitAnimationConfig, type RabbitAttachmentConfig,
} from './rabbitAssets';

export const DEV_RABBIT_DEBUG = false;
interface Playback {
  action: RabbitAction;
  onStart?: () => void;
  onComplete?: () => void;
}

export class RabbitCharacter {
  readonly sprite?: Phaser.GameObjects.Sprite;
  readonly root: Phaser.GameObjects.Sprite | Phaser.GameObjects.Container;
  readonly fallback: boolean;
  action: RabbitAction = 'idle';
  onFrame?: (action: RabbitAction, index: number) => void;
  private readonly config?: RabbitAnimationConfig;
  private readonly tracker?: RabbitAttachmentTracker;
  private active?: Playback;
  private queue: Playback[] = [];
  private playing = false;
  private timer?: Phaser.Time.TimerEvent;
  private debug?: Phaser.GameObjects.Graphics;

  constructor(private readonly scene: Phaser.Scene, x: number, y: number, scale: number, depths = CARROT_PULL_DEPTHS) {
    const config = scene.cache.json.get(RabbitAssetKeys.animations) as RabbitAnimationConfig | undefined;
    const attachments = scene.cache.json.get(RabbitAssetKeys.attachments) as RabbitAttachmentConfig | undefined;
    try {
      validateRabbitAssets(config, attachments, (key, frame) => scene.textures.exists(key) && scene.textures.get(key).has(frame));
      this.config = config;
      this.tracker = new RabbitAttachmentTracker(attachments!);
      for (const action of RABBIT_ACTIONS) {
        const spec = config[action];
        if (!scene.anims.exists(spec.key)) scene.anims.create({
          key: spec.key, frames: spec.frames, frameRate: spec.frameRate, repeat: spec.repeat,
        });
      }
      scene.add.ellipse(x, y + 2, 120 * scale, 22 * scale, 0x54754a, .18).setDepth(depths.shadow);
      this.sprite = scene.add.sprite(x, y, config.idle.texture, config.idle.frames[0].frame)
        .setOrigin(RABBIT_ORIGIN.x, RABBIT_ORIGIN.y).setScale(scale).setDepth(depths.rabbit);
      this.root = this.sprite;
      this.fallback = false;
      this.sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, this.completed, this);
      this.sprite.on(Phaser.Animations.Events.ANIMATION_UPDATE, this.frameChanged, this);
    } catch (error) {
      console.error('Rabbit assets unavailable; using a single fallback character.', error);
      this.root = new RabbitPlaceholder(scene, x, y, scale).root.setDepth(depths.rabbit);
      this.fallback = true;
    }
    if (DEV_RABBIT_DEBUG) this.debug = scene.add.graphics().setDepth(depths.debug);
    this.playIdle();
  }

  get frameIndex() {
    return this.sprite ? (this.config?.[this.action].frames.findIndex(frame => frame.frame === this.sprite!.frame.name) ?? 0) : 0;
  }

  get frameName() { return this.sprite ? String(this.sprite.frame.name) : 'fallback'; }

  playIdle() {
    this.queue = [];
    if (this.sprite && this.playing && this.action === 'bend') {
      this.active = { action: 'bend', onComplete: () => this.start({ action: 'idle' }) };
      if (!this.sprite.anims.inReverse) this.sprite.anims.reverse();
      return;
    }
    if (this.action === 'idle' && this.playing) return;
    this.start({ action: 'idle' });
  }

  playBend() {
    if (this.sprite && this.playing && this.action === 'bend' && this.sprite.anims.inReverse) {
      this.active = { action: 'bend' };
      this.sprite.anims.reverse();
      return;
    }
    this.enqueue({ action: 'bend' });
  }
  playGrab() { this.enqueue({ action: 'grab' }); }
  playReturn() {
    if (this.sprite && this.playing && this.action === 'return' && this.sprite.anims.inReverse) {
      this.active = { action: 'return' };
      this.sprite.anims.reverse();
      return;
    }
    this.enqueue({ action: 'return' });
  }
  playPull(onStart: () => void, onComplete: () => void) { this.enqueue({ action: 'pull', onStart, onComplete }); }
  playCelebrate(onComplete: () => void) { this.enqueue({ action: 'celebrate', onComplete }); }

  cancelReturn() {
    this.queue = [];
    if (this.sprite && this.action === 'return' && this.playing) {
      this.active = { action: 'return', onComplete: () => this.holdGrab() };
      if (!this.sprite.anims.inReverse) this.sprite.anims.reverse();
    } else if (this.action === 'return') {
      this.holdGrab();
    } else if (this.action === 'bend') {
      this.playGrab();
    }
  }

  private holdGrab() {
    this.timer?.remove(false);
    this.timer = undefined;
    this.active = undefined;
    this.action = 'grab';
    this.playing = false;
    if (this.sprite && this.config) {
      const spec = this.config.grab;
      this.sprite.anims.stop();
      this.sprite.setTexture(spec.texture, spec.frames.at(-1)!.frame);
      this.sprite.setOrigin(RABBIT_ORIGIN.x, RABBIT_ORIGIN.y);
    }
  }

  private enqueue(request: Playback) {
    if (this.queue.at(-1)?.action === request.action || (!this.queue.length && this.action === request.action && this.playing)) return;
    if (this.playing && this.action !== 'idle') this.queue.push(request);
    else this.start(request);
  }

  private start(request: Playback) {
    this.timer?.remove(false);
    this.timer = undefined;
    this.active = request;
    this.action = request.action;
    this.playing = true;
    if (this.sprite && this.config) {
      this.sprite.play(this.config[request.action].key);
      this.sprite.setOrigin(RABBIT_ORIGIN.x, RABBIT_ORIGIN.y);
    } else if (request.action !== 'idle') {
      // Only missing-asset fallback needs a clock in place of animation events.
      this.timer = this.scene.time.delayedCall(request.action === 'celebrate' ? 1600 : 800, () => this.finish());
    }
    request.onStart?.();
    this.frameChanged();
  }

  private completed(animation: Phaser.Animations.Animation) {
    if (animation.key === this.config?.[this.active?.action ?? 'idle'].key) this.finish();
  }

  private finish() {
    const callback = this.active?.onComplete;
    this.active = undefined;
    this.playing = false;
    callback?.();
    if (!this.playing && this.queue.length) this.start(this.queue.shift()!);
  }

  private frameChanged() {
    this.sprite?.setOrigin(RABBIT_ORIGIN.x, RABBIT_ORIGIN.y);
    this.onFrame?.(this.action, this.frameIndex);
  }

  getAttachmentPoint() {
    if (this.sprite && this.tracker) return this.tracker.world(this.action, this.frameName, this.sprite);
    return { x: this.root.x, y: this.root.y - 170 * this.root.scaleY };
  }

  pause() { this.sprite?.anims.pause(); }
  resume() { this.sprite?.anims.resume(); }

  updateDebug() {
    if (!this.debug) return;
    const { x, y } = this.root;
    const point = this.getAttachmentPoint();
    const bounds = this.root.getBounds();
    this.debug.clear().lineStyle(1, 0x3388ff).strokeRect(bounds.x, bounds.y, bounds.width, bounds.height)
      .lineBetween(x - 100, y, x + 100, y).fillStyle(0xffff00).fillCircle(x, y, 4)
      .fillStyle(0xff3355).fillCircle(point.x, point.y, 5);
  }

  destroy() {
    this.queue = [];
    this.active = undefined;
    this.timer?.remove(false);
    this.sprite?.off(Phaser.Animations.Events.ANIMATION_COMPLETE, this.completed, this);
    this.sprite?.off(Phaser.Animations.Events.ANIMATION_UPDATE, this.frameChanged, this);
    this.onFrame = undefined;
    this.debug?.destroy();
  }
}
