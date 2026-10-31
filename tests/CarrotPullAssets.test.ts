import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type Phaser from 'phaser';
import {
  CARROT_ORIGIN, CARROT_PULL_DESIGN_SIZE, CARROT_PULL_FULL_SCENE_LAYERS, CARROT_PULL_LAYERS,
  CarrotPullAssetKeys, getCarrotPullAssetUrl, getMissingCarrotPullAssets, preloadCarrotPullAssets,
  type CarrotPullLayer,
} from '../src/game/assets/carrotPullAssets';

const sourceMetadata = JSON.parse(readFileSync(new URL('../model/assets/rendered/carrot_pull/carrot_scene_assets.json', import.meta.url), 'utf8'));
const publicMetadata = JSON.parse(readFileSync(new URL('../public/assets/carrot_pull/carrot_scene_assets.json', import.meta.url), 'utf8'));

test('each unique scene asset key resolves to a synchronized PNG matching authored dimensions and hash', () => {
  assert.equal(new Set(Object.values(CarrotPullAssetKeys)).size, 7);
  assert.deepEqual(publicMetadata, sourceMetadata);
  for (const [name, layer] of Object.entries(CARROT_PULL_LAYERS)) {
    assert.equal(CarrotPullAssetKeys[name as CarrotPullLayer], layer.key);
    const authored = sourceMetadata.layers[layer.file.replace('.png', '')];
    const png = readFileSync(new URL(`../public/assets/carrot_pull/${layer.file}`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], layer.size);
    assert.deepEqual(layer.size, authored.size);
    assert.equal(createHash('sha256').update(png).digest('hex'), authored.sha256);
    assert.equal(getCarrotPullAssetUrl(name as CarrotPullLayer, '/garden/'), `/garden/assets/carrot_pull/${layer.file}`);
  }
});

test('carrot origin preserves the authored leaf-root grip pivot', () => {
  const carrot = sourceMetadata.layers.carrot;
  assert.deepEqual(CARROT_ORIGIN, carrot.origin);
  assert.equal(CARROT_ORIGIN.x, carrot.pivotPixels.x / carrot.size[0]);
  assert.equal(CARROT_ORIGIN.y, carrot.pivotPixels.y / carrot.size[1]);
  assert.notEqual(CARROT_ORIGIN.y, 0.5);
  for (const name of ['carrot', 'soilPatch', 'basket'] as const) {
    const layer = CARROT_PULL_LAYERS[name];
    const authored = sourceMetadata.layers[layer.file.replace('.png', '')];
    assert.deepEqual(layer.origin, authored.origin);
    assert.deepEqual(layer.anchor, authored.anchorCanvasPixels);
    assert.equal(layer.displayScale, authored.displayScale);
  }
});

test('full scene layers share the authored canvas size and centered origin', () => {
  assert.deepEqual(sourceMetadata.canvas, [CARROT_PULL_DESIGN_SIZE.width, CARROT_PULL_DESIGN_SIZE.height]);
  assert.equal(CARROT_PULL_FULL_SCENE_LAYERS.length, 4);
  for (const name of CARROT_PULL_FULL_SCENE_LAYERS) {
    assert.deepEqual(CARROT_PULL_LAYERS[name].size, sourceMetadata.canvas);
    assert.deepEqual(CARROT_PULL_LAYERS[name].origin, { x: 0.5, y: 0.5 });
  }
});

test('preload queues every scene image and removes its error listener after completion', () => {
  const queued: { key: string; url: string }[] = [];
  let errorHandler: unknown;
  let complete: (() => void) | undefined;
  let removed: unknown;
  const scene = { load: {
    image: (key: string, url: string) => queued.push({ key, url }),
    on: (_event: string, handler: unknown) => { errorHandler = handler; },
    once: (_event: string, handler: () => void) => { complete = handler; },
    off: (_event: string, handler: unknown) => { removed = handler; },
  } } as unknown as Phaser.Scene;
  preloadCarrotPullAssets(scene);
  assert.equal(queued.length, 7);
  assert.deepEqual(queued.map(item => item.key), Object.values(CarrotPullAssetKeys));
  assert.ok(queued.every(item => item.url.startsWith('./assets/carrot_pull/')));
  assert.equal(typeof errorHandler, 'function');
  complete?.();
  assert.equal(removed, errorHandler);
});

test('missing images can be reported without throwing or blocking other scene assets', () => {
  const scene = { textures: { exists: (key: string) => key !== CarrotPullAssetKeys.carrot } } as unknown as Phaser.Scene;
  assert.deepEqual(getMissingCarrotPullAssets(scene), [CarrotPullAssetKeys.carrot]);
  const empty = { textures: { exists: () => false } } as unknown as Phaser.Scene;
  assert.deepEqual(getMissingCarrotPullAssets(empty), Object.values(CarrotPullAssetKeys));
  assert.equal(getCarrotPullAssetUrl('carrot', '/garden'), '/garden/assets/carrot_pull/carrot.png');
  assert.equal(getCarrotPullAssetUrl('carrot', './'), './assets/carrot_pull/carrot.png');
});
