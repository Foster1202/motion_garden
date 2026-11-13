import type Phaser from 'phaser';
import type { Vector3 } from 'three';
import { CarrotPullAssetKeys } from '../../assets/carrotPullAssets';
import { CARROT_PULL_DEPTHS } from '../../assets/carrotPullLayout';

interface WorldPoint { x: number; y: number }

export interface CarrotPull3DEnvironmentOptions {
  project: (point: WorldPoint) => WorldPoint;
  plantedGrip: Readonly<Vector3>;
  soilWorldY: number;
}

/** A raised planting bed makes the existing short arms' reachable target legible. */
export class CarrotPull3DEnvironment {
  private readonly soilBack: Phaser.GameObjects.Image;
  private readonly soilFront: Phaser.GameObjects.Image;
  private readonly wood: Phaser.GameObjects.Graphics;
  private readonly anchor: WorldPoint;
  private readonly pixelsPerUnit: number;
  private visible = true;
  private destroyed = false;

  constructor(scene: Phaser.Scene, private readonly options: CarrotPull3DEnvironmentOptions) {
    const { plantedGrip, soilWorldY, project } = options;
    this.anchor = project({ x: plantedGrip.x, y: soilWorldY });
    const unit = project({ x: plantedGrip.x + 1, y: soilWorldY });
    const ground = project({ x: plantedGrip.x, y: .04 });
    this.pixelsPerUnit = Math.abs(unit.x - this.anchor.x);
    if (![plantedGrip.x, plantedGrip.y, plantedGrip.z, soilWorldY, this.anchor.x, this.anchor.y,
      ground.x, ground.y, this.pixelsPerUnit].every(Number.isFinite) || this.pixelsPerUnit <= 0) {
      throw new Error('Raised carrot bed requires a finite world projection');
    }
    const p = this.pixelsPerUnit;
    const { x, y } = this.anchor;
    const boxWidth = 1.95 * p;
    const boxHeight = .5 * p;
    const boxTop = y + .1 * p;
    const legTop = boxTop + boxHeight - .08 * p;
    const legHeight = Math.max(.1 * p, ground.y - legTop);
    this.wood = scene.add.graphics().setDepth(CARROT_PULL_DEPTHS.soilFront);
    this.wood.fillStyle(0x9f734b, 1);
    for (const offset of [-.72, .72]) {
      this.wood.fillRoundedRect(x + offset * p - .07 * p, legTop, .14 * p, legHeight, .025 * p);
    }
    this.wood.fillStyle(0xc99b67, 1);
    this.wood.fillRoundedRect(x - boxWidth / 2, boxTop, boxWidth, boxHeight, .07 * p);
    this.wood.lineStyle(.022 * p, 0x9d7048, .8);
    for (const offset of [.18, .34]) {
      this.wood.lineBetween(x - boxWidth / 2 + .05 * p, boxTop + offset * p,
        x + boxWidth / 2 - .05 * p, boxTop + offset * p);
    }
    this.wood.fillStyle(0xe0b77e, 1);
    this.wood.fillRoundedRect(x - boxWidth / 2 - .05 * p, boxTop - .04 * p,
      boxWidth + .1 * p, .12 * p, .045 * p);
    const key = scene.textures.exists(CarrotPullAssetKeys.soilPatch) ? CarrotPullAssetKeys.soilPatch : '__MISSING';
    // Texture pixel 249 is the authored opening center; only its front half covers the shared render.
    const soilScale = 3.3 * p / 512;
    this.soilBack = scene.add.image(x, y, key).setOrigin(.5, 249 / 512)
      .setScale(soilScale).setDepth(CARROT_PULL_DEPTHS.soilBack);
    this.soilFront = scene.add.image(x, y, key).setOrigin(.5, 249 / 512)
      .setScale(soilScale).setDepth(CARROT_PULL_DEPTHS.soilFront + .1);
    if (key !== '__MISSING') this.soilFront.setCrop(0, 249, 512, 512 - 249);
  }

  setVisible(visible: boolean): void {
    if (this.destroyed) return;
    this.visible = visible;
    this.soilBack.setVisible(visible);
    this.soilFront.setVisible(visible);
    this.wood.setVisible(visible);
  }

  snapshot() {
    return {
      kind: 'raised-garden-bed', visible: this.visible, destroyed: this.destroyed,
      plantedGrip: [this.options.plantedGrip.x, this.options.plantedGrip.y, this.options.plantedGrip.z],
      soilWorldY: this.options.soilWorldY, soilScreenPosition: { ...this.anchor },
      pixelsPerUnit: this.pixelsPerUnit,
      soilFrontVisible: this.visible && !this.destroyed,
      soilBackDepth: CARROT_PULL_DEPTHS.soilBack, soilFrontDepth: CARROT_PULL_DEPTHS.soilFront + .1,
      woodDepth: CARROT_PULL_DEPTHS.soilFront,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.visible = false;
    this.soilBack.destroy();
    this.soilFront.destroy();
    this.wood.destroy();
  }
}
