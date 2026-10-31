import Phaser from 'phaser';

export class GardenView {
  constructor(private scene: Phaser.Scene) {
    scene.add.image(800, 450, 'garden');
    this.smallPatch(239, 569, .8);
    this.smallPatch(1330, 593, .65);
  }

  private smallPatch(x: number, y: number, scale: number) {
    const g = this.scene.add.graphics().setPosition(x, y).setScale(scale);
    g.fillStyle(0x9e7851).fillRoundedRect(-130, -22, 260, 68, 24);
    g.fillStyle(0xb99361).fillEllipse(0, -9, 265, 90);
    g.lineStyle(3, 0x9e7851, .6).lineBetween(-91, -18, 91, -18).lineBetween(-91, 4, 91, 4).lineBetween(-78, 25, 78, 25);
    for (const offset of [-74, 0, 74]) {
      const sprout = this.scene.add.graphics().setPosition(x + offset * scale, y - 20 * scale).setScale(scale);
      sprout.fillStyle(0x4e7c4f).fillEllipse(-9, -6, 27, 12).fillEllipse(9, -15, 13, 30);
    }
  }

}
