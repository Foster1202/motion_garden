import Phaser from 'phaser';
import { gardenSvg } from '../art/garden';
import { preloadRabbitAssets } from '../characters/rabbitAssets';
import { preloadCarrotPullAssets } from '../assets/carrotPullAssets';

export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }
  preload() {
    this.load.svg('garden', `data:image/svg+xml;base64,${btoa(gardenSvg)}`);
    preloadRabbitAssets(this);
    preloadCarrotPullAssets(this);
  }
  create() { this.scene.start('Menu'); }
}
