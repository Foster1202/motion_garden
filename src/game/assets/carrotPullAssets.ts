import type Phaser from 'phaser';

export const CARROT_PULL_DESIGN_SIZE = { width: 1920, height: 1080 } as const;
export const CARROT_ORIGIN = { x: 0.4972858130931854, y: 0.4156215786933899 } as const;

export const CarrotPullAssetKeys = {
  backgroundFar: 'carrot-pull-background-far',
  backgroundMid: 'carrot-pull-background-mid',
  platform: 'carrot-pull-platform',
  foreground: 'carrot-pull-foreground',
  soilPatch: 'carrot-pull-soil-patch',
  carrot: 'carrot-pull-carrot',
  basket: 'carrot-pull-basket',
} as const;

// Object anchors are in the authored 1920 x 1080 design space.
export const CARROT_PULL_LAYERS = {
  backgroundFar: { key: CarrotPullAssetKeys.backgroundFar, file: 'background_far.png', size: [1920, 1080], origin: { x: 0.5, y: 0.5 } },
  backgroundMid: { key: CarrotPullAssetKeys.backgroundMid, file: 'background_mid.png', size: [1920, 1080], origin: { x: 0.5, y: 0.5 } },
  platform: { key: CarrotPullAssetKeys.platform, file: 'platform.png', size: [1920, 1080], origin: { x: 0.5, y: 0.5 } },
  foreground: { key: CarrotPullAssetKeys.foreground, file: 'foreground.png', size: [1920, 1080], origin: { x: 0.5, y: 0.5 } },
  soilPatch: { key: CarrotPullAssetKeys.soilPatch, file: 'soil_patch.png', size: [512, 512],
    origin: { x: 0.5, y: 0.47945713996887207 }, anchor: { x: 1073, y: 833 }, displayScale: 0.4 },
  carrot: { key: CarrotPullAssetKeys.carrot, file: 'carrot.png', size: [512, 512],
    origin: CARROT_ORIGIN, anchor: { x: 1073, y: 827 }, displayScale: 0.44 },
  basket: { key: CarrotPullAssetKeys.basket, file: 'basket.png', size: [512, 512],
    origin: { x: 0.5, y: 0.7304617464542389 }, anchor: { x: 1494, y: 858 }, displayScale: 0.6 },
} as const;

export type CarrotPullLayer = keyof typeof CARROT_PULL_LAYERS;
export const CARROT_PULL_FULL_SCENE_LAYERS = ['backgroundFar', 'backgroundMid', 'platform', 'foreground'] as const;

export function getCarrotPullAssetUrl(layer: CarrotPullLayer, baseUrl = import.meta.env?.BASE_URL ?? './') {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}assets/carrot_pull/${CARROT_PULL_LAYERS[layer].file}`;
}

export function preloadCarrotPullAssets(scene: Phaser.Scene) {
  const onLoadError = (file: Phaser.Loader.File) => {
    if (import.meta.env?.DEV && Object.values(CarrotPullAssetKeys).some(key => key === file.key)) {
      console.error(`Carrot Pull asset could not load: ${file.key} (${file.url}). Run npm run sync:assets in game/.`);
    }
  };
  scene.load.on('loaderror', onLoadError);
  scene.load.once('complete', () => scene.load.off('loaderror', onLoadError));
  for (const layer of Object.keys(CARROT_PULL_LAYERS) as CarrotPullLayer[]) {
    scene.load.image(CARROT_PULL_LAYERS[layer].key, getCarrotPullAssetUrl(layer));
  }
}

export function getMissingCarrotPullAssets(scene: Pick<Phaser.Scene, 'textures'>) {
  return Object.values(CarrotPullAssetKeys).filter(key => !scene.textures.exists(key));
}
