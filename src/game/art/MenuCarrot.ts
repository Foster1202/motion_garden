import Phaser from 'phaser';

// Retain the home illustration independently of the gameplay asset.
export class MenuCarrot {
  readonly root: Phaser.GameObjects.Container;
  constructor(scene: Phaser.Scene, x: number, y: number, scale = 1) {
    this.root = scene.add.container(x, y).setScale(scale);
    const g = scene.add.graphics();
    g.fillStyle(0xeb984f).beginPath().moveTo(-29, 0).lineTo(24, 0).lineTo(14, 46).lineTo(-2, 86).lineTo(-22, 40).closePath().fillPath();
    g.fillStyle(0xf2ae61).fillEllipse(0, 0, 56, 29);
    g.lineStyle(4, 0xd87940).lineBetween(-22, 20, -6, 24).lineBetween(5, 39, 16, 37).lineBetween(-11, 56, -3, 57);
    g.lineStyle(8, 0x507c48).lineBetween(0, 0, -5, -44).lineBetween(0, -5, -31, -33).lineBetween(0, -6, 27, -43);
    g.fillStyle(0x6c984e).fillEllipse(-8, -55, 17, 45);
    g.fillStyle(0x86ab59).fillEllipse(-33, -35, 37, 18);
    g.fillStyle(0x527e47).fillEllipse(27, -45, 24, 38);
    this.root.add(g);
  }
}
