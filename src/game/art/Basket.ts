import Phaser from 'phaser';
import { CARROT_PULL_LAYERS, CarrotPullAssetKeys } from '../assets/carrotPullAssets';
import { BASKET_POSITION, BASKET_SCALE, BASKET_DROP_TARGET, CARROT_PULL_DEPTHS, CARROT_SCALE } from '../assets/carrotPullLayout';
import { Carrot } from './Carrot';

export class Basket {
  readonly image: Phaser.GameObjects.Image;
  private contents: Carrot[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    const origin = CARROT_PULL_LAYERS.basket.origin;
    const key = scene.textures.exists(CarrotPullAssetKeys.basket) ? CarrotPullAssetKeys.basket : '__MISSING';
    this.image = scene.add.image(BASKET_POSITION.x, BASKET_POSITION.y, key)
      .setOrigin(origin.x, origin.y).setScale(BASKET_SCALE).setDepth(CARROT_PULL_DEPTHS.basket);
  }

  setScore(score: number) {
    this.contents.forEach(carrot => carrot.root.destroy(true));
    this.contents = [];
    for (let i = 0; i < score; i++) {
      const carrot = new Carrot(this.scene, BASKET_DROP_TARGET.x - 28 + i * 14, BASKET_DROP_TARGET.y - (i % 2) * 7, CARROT_SCALE * 0.75);
      carrot.root.setAngle(-18 + i * 9).setDepth(CARROT_PULL_DEPTHS.basketContents);
      this.contents.push(carrot);
    }
  }
}
