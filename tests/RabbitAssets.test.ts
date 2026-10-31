import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  RABBIT_ACTIONS, RABBIT_ORIGIN, validateRabbitAssets,
  type RabbitAnimationConfig, type RabbitAttachmentConfig,
} from '../src/game/characters/rabbitAssets';
import { attachmentToWorld, RabbitAttachmentTracker } from '../src/game/characters/RabbitAttachmentTracker';

const config: RabbitAnimationConfig = JSON.parse(readFileSync(new URL('../public/assets/rabbit/rabbit_animations.json', import.meta.url), 'utf8'));
const points: RabbitAttachmentConfig = JSON.parse(readFileSync(new URL('../public/assets/rabbit/rabbit_attachment_points.json', import.meta.url), 'utf8'));
const hasFrame = (texture: string, name: string) => {
  const atlas = JSON.parse(readFileSync(new URL(`../public/assets/rabbit/${texture}.json`, import.meta.url), 'utf8'));
  return name in atlas.frames;
};

test('all synchronized animation names resolve to atlas and attachment frames', () => {
  assert.doesNotThrow(() => validateRabbitAssets(config, points, hasFrame));
  const tracker = new RabbitAttachmentTracker(points);
  for (const action of RABBIT_ACTIONS) for (const frame of config[action].frames) {
    assert.equal(tracker.get(action, frame.frame).name, frame.frame);
  }
  assert.equal(tracker.get('pull', config.pull.frames[5].frame).sourceFrame, 10);
  assert.equal(points.actions.pull.find(point => point.sourceFrame === 14)?.index, 8);
});

test('missing atlas or metadata fails validation before creating the rabbit sprite', () => {
  assert.throws(() => validateRabbitAssets(config, points, () => false));
  assert.throws(() => validateRabbitAssets(undefined, points, hasFrame));
  assert.throws(() => validateRabbitAssets(config, undefined, hasFrame));
  const broken = structuredClone(points);
  broken.actions.pull[5].name = 'wrong-frame.png';
  assert.throws(() => validateRabbitAssets(config, broken, hasFrame));
});

test('nonfinite attachment and incorrect anchor are rejected', () => {
  const broken = structuredClone(points);
  broken.actions.grab[0].x = Number.NaN;
  assert.throws(() => validateRabbitAssets(config, broken, hasFrame));
  const wrongOrigin = structuredClone(config);
  wrongOrigin.idle.origin.y = 0.5;
  assert.throws(() => validateRabbitAssets(wrongOrigin, points, hasFrame));
});

test('frame pixels transform around exact foot origin with uniform scale', () => {
  const transform = { x: 894, y: 681, scaleX: 0.78, scaleY: 0.78, ...{originX:RABBIT_ORIGIN.x, originY:RABBIT_ORIGIN.y} };
  assert.deepEqual(attachmentToWorld({x:256,y:512*RABBIT_ORIGIN.y}, transform), {x:894,y:681});
  const source = points.actions.pull[5];
  const point = attachmentToWorld(source, transform);
  assert.equal(point.x, 894);
  assert.ok(Math.abs(point.y - (681 + (source.y - 512 * 0.928719) * 0.78)) < 1e-8);
  const resizedDisplay = attachmentToWorld(source, transform);
  assert.deepEqual(resizedDisplay, point);
});

test('attachment transform supports rotation and sprite flips', () => {
  const point = { x: 266, y: 512 * RABBIT_ORIGIN.y - 20 };
  const turned = attachmentToWorld(point, { x:100,y:200,scaleX:2,scaleY:2,rotation:Math.PI/2 });
  assert.ok(Math.abs(turned.x - 140) < 1e-8);
  assert.ok(Math.abs(turned.y - 220) < 1e-8);
  const flipped = attachmentToWorld(point, { x:100,y:200,scaleX:2,scaleY:2,flipX:true });
  assert.equal(flipped.x, 80);
  assert.equal(flipped.y, 160);
});
