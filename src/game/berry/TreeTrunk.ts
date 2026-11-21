import Phaser from 'phaser';
import { BERRY_CONFIG as C, BERRY_FRUIT_ANCHORS, berryKey, type BerrySide, type TreeTrunkHitZone } from './berryConfig';
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
    const padding = 32;
    if (!scene.textures.exists(glowKey)) {
      const texture = scene.textures.createCanvas(glowKey, width + 2 * padding, height + 2 * padding)!;
      const source = scene.textures.get(treeKey).getSourceImage() as HTMLImageElement;
      const context = texture.context;
      context.shadowColor = '#ffc347';
      context.shadowBlur = 22;
      context.drawImage(source, padding, padding, width, height);
      context.shadowColor = '#fff09a';
      context.shadowBlur = 7;
      context.drawImage(source, padding, padding, width, height);
      // Retain the glow outside the tree silhouette.
      context.shadowBlur = 0;
      context.shadowColor = 'transparent';
      context.globalCompositeOperation = 'destination-out';
      context.drawImage(source, padding, padding, width, height);
      context.globalCompositeOperation = 'source-over';
      texture.refresh();
    }
    this.targetGlow = scene.add.image(0, padding, glowKey).setOrigin(.5, 1).setName(glowKey).setAlpha(0);
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
