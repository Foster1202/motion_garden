import Phaser from 'phaser';
import { BERRY_CONFIG as C, BERRY_FRUIT_ANCHORS, berryKey, type BerrySide, type TreeTrunkHitZone } from './berryConfig';
export class TreeTrunk {
  readonly root: Phaser.GameObjects.Container;
  readonly zone: TreeTrunkHitZone;
  private readonly fruit: Phaser.GameObjects.Image[] = [];
  constructor(private readonly scene: Phaser.Scene, readonly side: BerrySide) {
    const x = C.tree[side];
    this.root = scene.add.container(x, C.tree.y).setDepth(3);
    this.root.add(scene.add.image(0, 0, berryKey(`tree_${side}`)).setOrigin(.5, 1).setDisplaySize(C.tree.width, C.tree.height));
    this.zone = { x: x - C.tree.width * .045, y: C.tree.y - C.tree.height * .55, width: C.tree.width * .09, height: C.tree.height * .52 };
    for (let i = 0; i < 9; i++) {
      const [u, v] = BERRY_FRUIT_ANCHORS[side][i];
      const size = 33 + (i % 3) * 2;
      const fruit = scene.add.image((u - .5) * C.tree.width, (v - 1) * C.tree.height,
        berryKey('berry')).setDisplaySize(size, size).setAngle((i % 3 - 1) * 8);
      this.root.add(fruit); this.fruit.push(fruit);
    }
  }
  harvest() {
    this.scene.tweens.add({ targets: this.root, angle: { from: -2, to: 2 }, duration: 110, yoyo: true, repeat: 3,
      onComplete: () => this.root.setAngle(0) });
    for (const fruit of this.fruit.splice(0, 3)) {
      const x = this.root.x + fruit.x; const y = this.root.y + fruit.y;
      this.root.remove(fruit); fruit.setPosition(x, y).setDepth(8);
      this.scene.tweens.add({ targets: fruit, x: x + (x < 800 ? 35 : -35), y: 758, angle: 30,
        duration: 650, ease: 'Quad.easeIn', onComplete: () => {
          this.scene.tweens.add({ targets: fruit, y: 721, duration: 130, yoyo: true, ease: 'Sine.easeOut', onComplete: () => {
            this.scene.tweens.add({ targets: fruit, x: 800, y: 780, scaleX: fruit.scaleX * .55,
              scaleY: fruit.scaleY * .55, alpha: 0, duration: 430, ease: 'Quad.easeInOut', onComplete: () => fruit.destroy() });
          } });
        } });
    }
  }
}
