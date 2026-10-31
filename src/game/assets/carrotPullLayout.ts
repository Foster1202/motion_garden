import { GAME_HEIGHT, GAME_WIDTH } from '../layout';
import { CARROT_PULL_DESIGN_SIZE, CARROT_PULL_FULL_SCENE_LAYERS } from './carrotPullAssets';

export const DESIGN_WIDTH = CARROT_PULL_DESIGN_SIZE.width;
export const DESIGN_HEIGHT = CARROT_PULL_DESIGN_SIZE.height;
export const CARROT_PULL_DEPTHS = {
  backgroundFar: 0, backgroundMid: 10, platform: 20, shadow: 25,
  soilBack: 30, rabbit: 40, plantedCarrot: 41, soilFront: 42,
  carriedCarrot: 43, celebration: 45, basketContents: 49, basket: 50,
  foreground: 60, debug: 90, hud: 100,
} as const;
export const FULL_SCENE_LAYERS = CARROT_PULL_FULL_SCENE_LAYERS;
export const RABBIT_SCALE = GAME_HEIGHT * 0.38 / 439;
export const CARROT_SCALE = 0.44;
export const CARRIED_CARROT_ANGLE = -35;
export const BASKET_SCALE = 0.6 * GAME_WIDTH / DESIGN_WIDTH;
export const SOIL_SCALE = 0.8;
export const SOIL_FRONT_START_Y = 220;
export const RABBIT_FOOT_POSITION = { x: 894, y: 681 } as const;
export const PLANTED_CARROT = { x: 894, y: 668 } as const;
export const SOIL_POSITION = { x: 894, y: 704 } as const;
export const BASKET_POSITION = { x: 1245, y: 715 } as const;
// Local texture pixels relative to the basket's ground pivot, above its front rim.
export const BASKET_DROP_OFFSET = { x: 0, y: -155 } as const;
export const BASKET_DROP_TARGET = {
  x: BASKET_POSITION.x + BASKET_DROP_OFFSET.x * BASKET_SCALE,
  y: BASKET_POSITION.y + BASKET_DROP_OFFSET.y * BASKET_SCALE,
} as const;

export function fullSceneTransform(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError('Scene viewport must have positive finite dimensions');
  }
  return { x: width / 2, y: height / 2, scale: Math.max(width / DESIGN_WIDTH, height / DESIGN_HEIGHT), originX: 0.5, originY: 0.5 };
}
