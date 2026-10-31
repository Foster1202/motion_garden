import Phaser from 'phaser';
import { CARROT_ORIGIN, CarrotPullAssetKeys } from '../assets/carrotPullAssets';

// Container origin is the grip; the image's pixel pivot comes from Blender metadata.
export const CARROT_GRIP = { x: 0, y: 0 } as const;

export class Carrot {
  readonly root: Phaser.GameObjects.Container;
  readonly vegetable: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene, x: number, y: number, scale = 1) {
    this.root = scene.add.container(x, y).setScale(scale);
    const key = scene.textures.exists(CarrotPullAssetKeys.carrot) ? CarrotPullAssetKeys.carrot : '__MISSING';
    this.vegetable = scene.add.image(0, 0, key).setOrigin(CARROT_ORIGIN.x, CARROT_ORIGIN.y);
    this.root.add(this.vegetable);
  }

  gripWorld() { return this.root.getWorldTransformMatrix().transformPoint(CARROT_GRIP.x, CARROT_GRIP.y); }

  alignGrip(point: { x: number; y: number }) {
    const grip = this.gripWorld();
    this.root.setPosition(this.root.x + point.x - grip.x, this.root.y + point.y - grip.y);
  }
}
