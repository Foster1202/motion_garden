import assert from 'node:assert/strict';
import test from 'node:test';
import { CARROT_PULL_DEPTHS, FULL_SCENE_LAYERS, fullSceneTransform, DESIGN_WIDTH, DESIGN_HEIGHT, BASKET_DROP_TARGET, BASKET_POSITION } from '../src/game/assets/carrotPullLayout';

test('full scene layers share one centered transform at the design resolution', () => {
  assert.deepEqual(fullSceneTransform(DESIGN_WIDTH, DESIGN_HEIGHT), { x: 960, y: 540, scale: 1, originX: .5, originY: .5 });
  assert.deepEqual(fullSceneTransform(1600, 900), { x: 800, y: 450, scale: 5 / 6, originX: .5, originY: .5 });
  assert.deepEqual(FULL_SCENE_LAYERS, ['backgroundFar', 'backgroundMid', 'platform', 'foreground']);
  assert.ok(CARROT_PULL_DEPTHS.platform < CARROT_PULL_DEPTHS.rabbit);
  assert.ok(CARROT_PULL_DEPTHS.plantedCarrot < CARROT_PULL_DEPTHS.soilFront);
  assert.ok(CARROT_PULL_DEPTHS.soilFront < CARROT_PULL_DEPTHS.carriedCarrot);
  assert.ok(CARROT_PULL_DEPTHS.basketContents < CARROT_PULL_DEPTHS.basket);
  assert.ok(CARROT_PULL_DEPTHS.foreground < CARROT_PULL_DEPTHS.hud);
  assert.ok(BASKET_DROP_TARGET.y < BASKET_POSITION.y);
});

test('cover transform fills resized viewports without stretching or layer seams', () => {
  for (const [width, height] of [[1440, 900], [1512, 982], [600, 800], [844, 390]]) {
    const t = fullSceneTransform(width, height);
    assert.equal(t.x, width / 2);
    assert.equal(t.y, height / 2);
    assert.ok(DESIGN_WIDTH * t.scale >= width);
    assert.ok(DESIGN_HEIGHT * t.scale >= height);
    assert.ok(Math.abs(DESIGN_WIDTH * t.scale - width) < 1e-8 || Math.abs(DESIGN_HEIGHT * t.scale - height) < 1e-8);
  }
  for (const size of [0, -1, Infinity, NaN]) assert.throws(() => fullSceneTransform(size, 900), RangeError);
});
