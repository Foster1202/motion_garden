import Phaser from 'phaser';
import { CARROT_PULL_LAYERS } from '../assets/carrotPullAssets';
import { CARROT_PULL_DEPTHS, FULL_SCENE_LAYERS, fullSceneTransform } from '../assets/carrotPullLayout';

export class SceneLayerGroup {
  readonly layers: Phaser.GameObjects.Image[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    for (const name of FULL_SCENE_LAYERS) {
      const key = CARROT_PULL_LAYERS[name].key;
      if (scene.textures.exists(key)) {
        this.layers.push(scene.add.image(0, 0, key).setName(name).setDepth(CARROT_PULL_DEPTHS[name]));
      }
    }
    this.resize();
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.resize, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.scale.off(Phaser.Scale.Events.RESIZE, this.resize, this));
  }

  private resize() {
    // FIT changes display size; transforms always use the unchanged logical world.
    const { width, height } = this.scene.scale.gameSize;
    const transform = fullSceneTransform(width, height);
    for (const layer of this.layers) {
      layer.setOrigin(transform.originX, transform.originY).setPosition(transform.x, transform.y).setScale(transform.scale);
    }
  }

  celebrate(x: number, y: number, reducedMotion: boolean) {
    if (reducedMotion) return;
    for (let i = 0; i < 14; i++) {
      const angle = i / 14 * Math.PI * 2;
      const star = this.scene.add.star(x, y, 4, 4, i % 2 ? 13 : 9, i % 3 ? 0xf3c45a : 0xfffbdf).setDepth(CARROT_PULL_DEPTHS.celebration);
      this.scene.tweens.add({ targets: star, x: x + Math.cos(angle) * 145, y: y + Math.sin(angle) * 110 - 30, angle: 50, alpha: 0, duration: 1100, ease: 'Cubic.Out', onComplete: () => star.destroy() });
    }
  }
}
