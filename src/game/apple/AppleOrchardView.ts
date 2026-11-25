import type Phaser from 'phaser';
import { InstancedMesh, MathUtils, Vector3, type Group } from 'three';
import { disposeModel, Rabbit3D } from '../3d/Rabbit3D';
import { ThreeOverlay } from '../3d/ThreeOverlay';
import { RabbitHandTracker, type HandGripSample } from '../3d/interaction/RabbitHandTracker';
import { GAME_HEIGHT, GAME_WIDTH } from '../layout';
import { neutralRabbitPose, type RabbitPose } from '../mocap/RabbitPose';
import { APPLE_CONFIG, isInAppleZone } from './appleConfig';
import { AppleOrchardEnvironment, ORCHARD_PIXELS_PER_UNIT as P, ORCHARD_X_TRAVEL } from './AppleOrchardEnvironment';
import { getGameSettings } from '../settings/gameSettings';
import { recordThreeFrame } from '../performance/performanceMetrics';

type Side = 'left' | 'right';
type Goal = Side | 'basket';

export interface AppleOrchardFrame {
  x: number;
  target: Goal | null;
  pose: RabbitPose;
}

interface ReachSample {
  x: number;
  tree: Side;
  position: Vector3;
}
interface PickContact {
  tree: Side;
  hand: Side;
  apple: Vector3;
  reach: Vector3;
}
interface MovingApple {
  tree: Side;
  hand: Side;
  source: Group;
  phase: 'taking' | 'held' | 'dropping';
  start: Vector3;
  elapsed: number;
}

const TEXTURE_WIDTH = 1120;
const TEXTURE_HEIGHT = 630;
const VIEWPORT = { x: 0, y: 0, width: GAME_WIDTH, height: GAME_HEIGHT };
const TAKE_SECONDS = .23;
const WALK_SPEED = 8;

export class AppleOrchardView {
  private readonly abort = new AbortController();
  private readonly textureKey = 'apple-orchard-frame';
  private readonly lowPerformance = getGameSettings().lowPerformanceMode;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly reaches: Partial<Record<Side, ReachSample>> = {};
  private overlay?: ThreeOverlay;
  private orchard?: AppleOrchardEnvironment;
  private tracker?: RabbitHandTracker;
  private image?: Phaser.GameObjects.Image;
  private texture?: Phaser.Textures.CanvasTexture;
  private hands?: HandGripSample;
  private pickContact?: PickContact;
  private fruit?: MovingApple;
  private x = 0;
  private target: Goal | null = null;
  private stored = 0;
  private time = 0;
  private distance = 0;
  private stride = 0;
  private frames = 0;
  private rabbitScale = 1;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly onFailure: () => void) {}

  async load(): Promise<boolean> {
    let rabbit: Rabbit3D | undefined;
    try {
      rabbit = await Rabbit3D.load(`${import.meta.env.BASE_URL}assets/rabbit3d/rabbit_carrot.glb`, this.abort.signal);
      if (this.destroyed) { rabbit.dispose(); return false; }
      const overlay = new ThreeOverlay(rabbit, this.onFailure, VIEWPORT, {
        lowPerformance: this.lowPerformance,
        outputSize: { width: TEXTURE_WIDTH, height: TEXTURE_HEIGHT },
      });
      this.overlay = overlay;
      overlay.renderer.domElement.dataset.appleOrchard = 'true';
      Object.assign(overlay.camera, {
        left: -GAME_WIDTH / (2 * P), right: GAME_WIDTH / (2 * P),
        top: GAME_HEIGHT / (2 * P), bottom: -GAME_HEIGHT / (2 * P), near: .1, far: 66,
      });
      overlay.camera.position.set(0, 5.58, 18);
      overlay.camera.lookAt(0, 2.63, 0);
      overlay.camera.updateProjectionMatrix();

      // The shared rigid-arm rabbit is mirrored so anatomical left stays on the player's left.
      this.rabbitScale = MathUtils.clamp(rabbit.pixelsPerUnit * .91, 74, 92) / P;
      rabbit.pivot.scale.set(-this.rabbitScale, this.rabbitScale, this.rabbitScale);
      rabbit.pivot.position.y = -rabbit.bounds.min.y * this.rabbitScale;
      this.tracker = new RabbitHandTracker(rabbit);
      this.orchard = new AppleOrchardEnvironment();
      overlay.scene.add(this.orchard.root);
      const { width, height } = overlay.renderSize;
      this.texture = this.scene.textures.createCanvas(this.textureKey, width, height)!;
      this.image = this.scene.add.image(0, 0, this.textureKey).setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
      this.update(0, { x: 0, target: null, pose: neutralRabbitPose() });
      return true;
    } catch (error) {
      if (!this.overlay) rabbit?.dispose();
      if (!this.abort.signal.aborted) console.warn('Apple Harvest orchard unavailable.', error);
      this.destroy();
      return false;
    }
  }

  update(dt: number, { x, target, pose }: AppleOrchardFrame) {
    if (!this.overlay || !this.orchard || !this.tracker || this.destroyed) return;
    const { rabbit } = this.overlay;
    this.time += dt;
    this.target = target;
    const dx = Math.abs(x - this.x);
    const strideGoal = this.reducedMotion || dt <= 0 ? 0 : Math.min(1, dx * ORCHARD_X_TRAVEL / (dt * 3));
    this.stride = MathUtils.lerp(this.stride, strideGoal, 1 - Math.exp(-WALK_SPEED * dt));
    this.distance += dx * ORCHARD_X_TRAVEL;
    const step = Math.sin(this.distance * 8) * this.stride;
    this.x = x;
    rabbit.pivot.position.set(x * ORCHARD_X_TRAVEL,
      -rabbit.bounds.min.y * this.rabbitScale + .042 * Math.abs(step), 0);
    rabbit.rig.applyPose({ ...pose, bendAmount: 0, lateralOffset: 0, torsoLean: pose.torsoLean + step * 3 });
    rabbit.rig.setLegExtension('left', Math.max(0, step) * .17);
    rabbit.rig.setLegExtension('right', Math.max(0, -step) * .17);
    this.orchard.rabbitShadow.position.x = rabbit.pivot.position.x;
    this.orchard.highlight(target, this.time, dt, this.reducedMotion);

    const afterPose = () => {
      this.hands = this.tracker?.sample();
      if ((target === 'left' || target === 'right') && isInAppleZone(x, target)) {
        this.rememberReach('left', pose.leftArmElevation, target);
        this.rememberReach('right', pose.rightArmElevation, target);
      }
      this.animateFruit(dt);
    };
    if (dt === 0) {
      afterPose();
      this.overlay.renderer.render(this.overlay.scene, this.overlay.camera);
      this.upload();
    } else if (this.overlay.render(dt, afterPose)) {
      this.upload();
    }
  }

  private rememberReach(hand: Side, angle: number, tree: Side) {
    const grip = this.gripPoint(hand);
    if (grip && angle >= 55) {
      const previous = this.reaches[hand];
      if (!previous || previous.tree !== tree || Math.abs(previous.x - this.x) > .045 ||
        grip.y >= previous.position.y - .025) {
        this.reaches[hand] = { x: this.x, tree, position: grip.clone() };
      }
    }
  }

  private gripPoint(hand: Side) {
    if (!this.hands?.valid) return undefined;
    return hand === 'left' ? this.hands.leftGripPosition : this.hands.rightGripPosition;
  }

  private heldPosition(hand: Side) {
    const direction = hand === 'left' ? -1 : 1;
    const palm = this.gripPoint(hand);
    // The front offset seats the apple against the paw without growing into the mesh.
    return palm ? palm.clone().add(new Vector3(direction * .080, .035, .125))
      : new Vector3(this.x * ORCHARD_X_TRAVEL + direction * .56, .65, .27);
  }

  pick(tree: Side, hand: Side) {
    if (!this.orchard || this.fruit) return;
    const previous = this.reaches[hand];
    const reach = (previous?.tree === tree && Math.abs(previous.x - this.x) < .16 ? previous.position
      : this.gripPoint(hand))?.clone() ?? this.heldPosition(hand);
    let source: Group | undefined;
    let nearest = Infinity;
    const candidatePosition = new Vector3();
    for (const apple of this.orchard.trees[tree].reachableApples) {
      if (!apple.visible) continue;
      apple.getWorldPosition(candidatePosition);
      const distance = candidatePosition.distanceToSquared(reach);
      if (distance < nearest) { nearest = distance; source = apple; }
    }
    if (!source) return;
    const position = source.getWorldPosition(new Vector3());
    this.pickContact = { tree, hand, apple: position.clone(), reach };
    source.visible = false;
    this.fruit = { tree, hand, source, phase: 'taking', start: position, elapsed: 0 };
    this.animateFruit(0);
  }

  deposit() {
    if (!this.fruit || !this.orchard || this.fruit.phase === 'dropping') return;
    this.fruit.phase = 'dropping';
    this.fruit.start.copy(this.orchard.movingApple.position);
    this.fruit.elapsed = 0;
  }

  private animateFruit(dt: number) {
    const fruit = this.fruit, orchard = this.orchard;
    if (!fruit || !orchard) return;
    const apple = orchard.movingApple;
    const held = this.heldPosition(fruit.hand);
    fruit.elapsed += dt;
    apple.visible = true;
    if (fruit.phase === 'taking') {
      const ratio = Math.min(1, fruit.elapsed / TAKE_SECONDS);
      apple.position.copy(fruit.start).lerp(held, MathUtils.smoothstep(ratio, 0, 1));
      apple.position.y += .07 * Math.sin(Math.PI * ratio);
      if (ratio >= 1) fruit.phase = 'held';
    }
    if (fruit.phase === 'held') {
      apple.position.copy(held);
      apple.rotation.set(0, 0, fruit.hand === 'left' ? -.22 : .22);
    }
    if (fruit.phase === 'dropping') {
      const ratio = Math.min(1, (fruit.elapsed * 1000 + .00001) / APPLE_CONFIG.depositMs);
      apple.position.copy(fruit.start).lerp(orchard.basket.dropPoint, ratio);
      if (!this.reducedMotion) apple.position.y += .205 * Math.sin(ratio * Math.PI);
      apple.rotation.z = this.reducedMotion ? 0 : ratio * Math.PI * 1.55;
      if (ratio >= 1) {
        this.stored++;
        orchard.showStored(this.stored);
        this.clearFruit();
      }
    }
  }

  private clearFruit() {
    if (this.fruit) this.fruit.source.visible = true;
    if (this.orchard) {
      this.orchard.movingApple.visible = false;
      this.orchard.movingApple.rotation.set(0, 0, 0);
    }
    delete this.reaches.left;
    delete this.reaches.right;
    this.fruit = undefined;
  }

  finish() {
    this.clearFruit();
    this.target = null;
    this.orchard?.highlight(null, this.time, 0, this.reducedMotion);
    if (this.overlay && !this.overlay.renderer.getContext().isContextLost()) {
      this.overlay.renderer.render(this.overlay.scene, this.overlay.camera);
      this.upload();
    }
  }

  private upload() {
    if (!this.texture || !this.overlay) return;
    this.texture.context.clearRect(0, 0, this.texture.width, this.texture.height);
    this.texture.context.drawImage(this.overlay.renderer.domElement, 0, 0);
    this.texture.refresh();
    recordThreeFrame();
    this.frames++;
  }

  private project(point: Vector3) {
    const p = point.clone().project(this.overlay!.camera);
    return { x: (p.x + 1) * GAME_WIDTH / 2, y: (1 - p.y) * GAME_HEIGHT / 2 };
  }

  snapshot() {
    const orchard = this.orchard, overlay = this.overlay;
    if (!orchard || !overlay || !this.hands) return null;
    const contact = this.pickContact;
    const apple = contact && this.project(contact.apple);
    const reach = contact && this.project(contact.reach);
    const treeSnapshot = (side: Side) => {
      const tree = orchard.trees[side];
      return { ...this.project(tree.root.position),
        visibleApples: tree.highAppleCount + tree.reachableApples.filter(apple => apple.visible).length };
    };
    return {
      renderedFrames: this.frames, renderSize: overlay.renderSize, x: this.x, target: this.target,
      root: this.project(new Vector3(overlay.rabbit.pivot.position.x, 0, 0)),
      hands: { left: this.project(this.hands.leftGripPosition), right: this.project(this.hands.rightGripPosition) },
      glow: { left: orchard.trees.left.zoneMarker.material.opacity, right: orchard.trees.right.zoneMarker.material.opacity,
        basket: orchard.basket.zoneMarker.material.opacity },
      crownGlow: { left: orchard.trees.left.crownMarker.gold.opacity, right: orchard.trees.right.crownMarker.gold.opacity },
      fruit: this.fruit ? { phase: this.fruit.phase, hand: this.fruit.hand,
        ...this.project(orchard.movingApple.position) } : null,
      pickContact: contact && apple && reach ? { tree: contact.tree, hand: contact.hand,
        apple, reach, distance: Math.hypot(apple.x - reach.x, apple.y - reach.y) } : null,
      trees: { left: treeSnapshot('left'), right: treeSnapshot('right') },
      basket: { ...this.project(orchard.basket.dropPoint), apples: this.stored },
      rig: { armControl: overlay.rabbit.rig.armControl, forearmRotations: {
        left: overlay.rabbit.rig.bones.get('forearm.L')!.quaternion.toArray(),
        right: overlay.rabbit.rig.bones.get('forearm.R')!.quaternion.toArray(),
      } },
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abort.abort();
    this.tracker?.dispose();
    this.image?.destroy();
    if (this.scene.textures.exists(this.textureKey)) this.scene.textures.remove(this.textureKey);
    if (this.orchard) {
      this.orchard.root.traverse(object => { if (object instanceof InstancedMesh) object.dispose(); });
      disposeModel(this.orchard.root);
    }
    this.overlay?.dispose();
    this.overlay = undefined;
    this.orchard = undefined;
    this.texture = undefined;
    this.fruit = undefined;
  }
}
