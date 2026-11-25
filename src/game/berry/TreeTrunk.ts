import Phaser from 'phaser';
import { BERRY_CONFIG as C, BERRY_FRUIT_ANCHORS, berryKey, type BerrySide, type TreeTrunkHitZone } from './berryConfig';

const GLOW_PADDING = 34;
const OUTLINE_COLOR = '#ffe26b';
const OUTER_EDGE_COLOR = '#664019';

function createTargetGlow(scene: Phaser.Scene, treeKey: string, glowKey: string) {
  const { width, height } = C.tree;
  const texture = scene.textures.createCanvas(glowKey, width + 2 * GLOW_PADDING, height + 2 * GLOW_PADDING)!;
  const source = scene.textures.get(treeKey).getSourceImage() as HTMLImageElement;
  const context = texture.context;
  const stencil = document.createElement('canvas');
  stencil.width = texture.width;
  stencil.height = texture.height;
  const ink = stencil.getContext('2d')!;
  const paintOutline = (radius: number, color: string) => {
    ink.clearRect(0, 0, stencil.width, stencil.height);
    ink.drawImage(source, GLOW_PADDING, GLOW_PADDING, width, height);
    // Expand the tree silhouette with overlapping opaque copies.
    for (let index = 0; index < 20; index++) {
      const angle = index * Math.PI / 10;
      ink.drawImage(source, GLOW_PADDING + radius * Math.cos(angle),
        GLOW_PADDING + radius * Math.sin(angle), width, height);
    }
    ink.globalCompositeOperation = 'source-in';
    ink.fillStyle = color;
    ink.fillRect(0, 0, stencil.width, stencil.height);
    ink.globalCompositeOperation = 'source-over';
    context.drawImage(stencil, 0, 0);
  };

  paintOutline(15, OUTER_EDGE_COLOR);
  paintOutline(9, OUTLINE_COLOR);
  context.globalCompositeOperation = 'destination-out';
  context.drawImage(source, GLOW_PADDING, GLOW_PADDING, width, height);
  context.globalCompositeOperation = 'destination-over';
  // Place the matching ground cue beneath the roots.
  context.beginPath();
  context.ellipse(texture.width / 2, height + GLOW_PADDING + 1, 79, 15, 0, 0, 2 * Math.PI);
  context.lineWidth = 4;
  context.strokeStyle = OUTLINE_COLOR;
  context.stroke();
  context.lineWidth = 8;
  context.strokeStyle = OUTER_EDGE_COLOR;
  context.stroke();
  context.fillStyle = '#ffe26b42';
  context.fill();
  context.globalCompositeOperation = 'source-over';
  texture.refresh();
}

export class TreeTrunk {
  readonly root: Phaser.GameObjects.Container;
  readonly zone: TreeTrunkHitZone;
  private readonly targetGlow: Phaser.GameObjects.Image;
  private readonly fruit: Phaser.GameObjects.Image[] = [];
  private readonly falling = new Set<Phaser.GameObjects.Image>();
  constructor(private readonly scene: Phaser.Scene, readonly side: BerrySide) {
    const x = C.tree[side];
    this.root = scene.add.container(x, C.tree.y).setDepth(3);
    const treeKey = berryKey(`tree_${side}`);
    const glowKey = berryKey(`target-glow-${side}`);
    const { width, height } = C.tree;
    if (!scene.textures.exists(glowKey)) createTargetGlow(scene, treeKey, glowKey);
    this.targetGlow = scene.add.image(0, GLOW_PADDING, glowKey).setOrigin(.5, 1).setName(glowKey).setAlpha(0);
    this.root.add(this.targetGlow);
    this.root.add(scene.add.image(0, 0, treeKey).setOrigin(.5, 1).setDisplaySize(width, height));
    this.zone = { x: x - C.tree.width * .045, y: C.tree.y - C.tree.height * .55, width: C.tree.width * .09, height: C.tree.height * .52 };
    for (let i = 0; i < 9; i++) {
      const [u, v] = BERRY_FRUIT_ANCHORS[side][i];
      const size = 33 + (i % 3) * 2;
      const fruit = scene.add.image((u - .5) * C.tree.width, (v - 1) * C.tree.height,
        berryKey('berry')).setDisplaySize(size, size).setAngle((i % 3 - 1) * 8);
      this.root.add(fruit); this.fruit.push(fruit);
    }
  }
  setTarget(active: boolean, transitionMs = 0) {
    this.scene.tweens.killTweensOf(this.targetGlow);
    const alpha = active ? 1 : 0;
    if (transitionMs > 0) {
      this.scene.tweens.add({ targets: this.targetGlow, alpha, duration: transitionMs, ease: 'Sine.easeInOut' });
    } else {
      this.targetGlow.setAlpha(alpha);
    }
  }
  harvest() {
    this.scene.tweens.add({ targets: this.root, angle: { from: -2, to: 2 }, duration: 110, yoyo: true, repeat: 3,
      onComplete: () => this.root.setAngle(0) });
    for (const fruit of this.fruit.splice(0, C.berriesPerHit)) {
      const replacement = this.scene.add.image(fruit.x, fruit.y, berryKey('berry'))
        .setDisplaySize(fruit.displayWidth, fruit.displayHeight).setAngle(fruit.angle).setAlpha(0);
      this.root.add(replacement);
      this.fruit.push(replacement);
      this.scene.tweens.add({ targets: replacement, alpha: 1, delay: 500, duration: 250 });
      const x = this.root.x + fruit.x; const y = this.root.y + fruit.y;
      this.root.remove(fruit); fruit.setPosition(x, y).setDepth(8);
      this.falling.add(fruit);
      this.scene.tweens.add({ targets: fruit, x: x + (x < 800 ? 35 : -35), y: 758, angle: 30,
        duration: 650, ease: 'Quad.easeIn', onComplete: () => {
          this.scene.tweens.add({ targets: fruit, y: 721, duration: 130, yoyo: true, ease: 'Sine.easeOut', onComplete: () => {
            this.scene.tweens.add({ targets: fruit, x: 800, y: 780, scaleX: fruit.scaleX * .55,
              scaleY: fruit.scaleY * .55, alpha: 0, duration: 430, ease: 'Quad.easeInOut', onComplete: () => {
                this.falling.delete(fruit);
                fruit.destroy();
              } });
          } });
        } });
    }
  }
  clearHarvests() {
    for (const fruit of this.falling) fruit.destroy();
    this.falling.clear();
    this.root.setAngle(0);
    for (const fruit of this.fruit) fruit.setAlpha(1);
  }
}
