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

/** Places the soil opening directly under the 3D carrot's fixed planting point. */
export class CarrotPull3DEnvironment {
  private readonly soil: Phaser.GameObjects.Image;
  private readonly anchor: WorldPoint;
  private readonly pixelsPerUnit: number;
  private visible = true;
  private destroyed = false;

  constructor(scene: Phaser.Scene, private readonly options: CarrotPull3DEnvironmentOptions) {
    const { plantedGrip, soilWorldY, project } = options;
    this.anchor = project({ x: plantedGrip.x, y: soilWorldY });
    const unit = project({ x: plantedGrip.x + 1, y: soilWorldY });
    this.pixelsPerUnit = Math.abs(unit.x - this.anchor.x);
    if (![plantedGrip.x, plantedGrip.y, plantedGrip.z, soilWorldY, this.anchor.x, this.anchor.y,
      this.pixelsPerUnit].every(Number.isFinite) || this.pixelsPerUnit <= 0) {
      throw new Error('Carrot soil requires a finite world projection');
    }
    const p = this.pixelsPerUnit;
    const { x, y } = this.anchor;
    const key = scene.textures.exists(CarrotPullAssetKeys.soilPatch) ? CarrotPullAssetKeys.soilPatch : '__MISSING';
    // The carrot's clipping plane hides the root without masking the rabbit's feet.
    const soilScale = 2.4 * p / 512;
    this.soil = scene.add.image(x, y, key).setOrigin(.5, 249 / 512)
      .setScale(soilScale).setDepth(CARROT_PULL_DEPTHS.soilBack);
  }

  setVisible(visible: boolean): void {
    if (this.destroyed) return;
    this.visible = visible;
    this.soil.setVisible(visible);
  }

  snapshot() {
    return {
      kind: 'ground-soil', visible: this.visible, destroyed: this.destroyed,
      plantedGrip: [this.options.plantedGrip.x, this.options.plantedGrip.y, this.options.plantedGrip.z],
      soilWorldY: this.options.soilWorldY, soilScreenPosition: { ...this.anchor },
      pixelsPerUnit: this.pixelsPerUnit,
      soilDepth: CARROT_PULL_DEPTHS.soilBack,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.visible = false;
    this.soil.destroy();
  }
}
