import assert from 'node:assert/strict';
import test from 'node:test';
import { Group, Vector3 } from 'three';
import { RabbitWorldMotion, type WorldMotionSample } from '../src/game/3d/RabbitWorldMotion';

const reference: WorldMotionSample = { centerX: .5, bodyScale: .2, torsoScale: .25 };

function fixture() {
  const pivot = new Group();
  pivot.position.set(.2, .15, -.1);
  pivot.scale.set(1.1, 1.2, 1.3);
  const motion = new RabbitWorldMotion(pivot);
  const feed = (sample: WorldMotionSample, frames = 120, movable = true) => {
    for (let index = 0; index < frames; index++) motion.update(1 / 60, sample, reference, movable);
    return motion.snapshot();
  };
  return { pivot, motion, feed };
}

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test('garden translation follows the mirrored camera horizontally across the enlarged world range', () => {
  const { pivot, feed } = fixture();
  let state = feed({ ...reference, centerX: .28 });
  close(state.offset.x, 2.5);
  close(pivot.position.x, 2.7);
  state = feed({ ...reference, centerX: .72 });
  close(state.offset.x, -2.5);
  close(pivot.position.x, -2.3);
  close(state.offset.z, 0);
  assert.equal(state.reliable, true);
});

test('forward and backward movement changes world depth, ground projection and uniform scale around the sole anchor', () => {
  const { pivot, feed } = fixture();
  let state = feed({ ...reference, bodyScale: .32, torsoScale: .4 });
  close(state.offset.z, 2);
  close(state.groundY, -.8);
  close(state.scaleFactor, 1.2);
  close(pivot.position.y, .15 * 1.2 - .8);
  close(pivot.position.z, 1.9);
  close(pivot.scale.x / 1.1, pivot.scale.y / 1.2);
  close(pivot.scale.y / 1.2, pivot.scale.z / 1.3);
  // The model's neutral sole is -restY / restScaleY below the floor pivot.
  const sole = pivot.localToWorld(new Vector3(0, -.15 / 1.2, 0));
  close(sole.y, state.groundY);
  state = feed({ ...reference, bodyScale: .144, torsoScale: .18 });
  close(state.offset.z, -2);
  close(state.groundY, .8);
  close(state.scaleFactor, .8);
  close(pivot.position.z, -2.1);
});

test('torso scale avoids shoulder-width depth artifacts and legacy inputs retain a body-scale fallback', () => {
  const { motion, feed } = fixture();
  let state = feed({ ...reference, bodyScale: .28 });
  close(state.normalizedDepth, 0);
  close(state.scaleFactor, 1);
  assert.equal(state.depthReliable, false);
  assert.match(state.rejectionReason!, /depth-scale-disagreement/);
  for (let index = 0; index < 120; index++) {
    motion.update(1 / 60, { centerX: .5, bodyScale: .32 }, { centerX: .5, bodyScale: .2 });
  }
  state = motion.snapshot();
  close(state.normalizedDepth, 1);
  close(state.offset.z, 2);
});

test('height-only pose changes preserve depth while reliable horizontal movement remains available', () => {
  const { feed } = fixture();
  let state = feed({ ...reference, centerX: .28, torsoScale: .4 });
  close(state.offset.x, 2.5);
  close(state.offset.z, 0);
  assert.equal(state.reliable, true);
  assert.equal(state.depthReliable, false);
  assert.match(state.rejectionReason!, /depth-scale-disagreement/);
  state = feed({ ...reference, centerX: .28, bodyScale: .32, torsoScale: .4 });
  close(state.offset.z, 2);
  assert.equal(state.depthReliable, true);
  state = feed({ ...reference, centerX: .72, bodyScale: .32, torsoScale: .25 });
  close(state.offset.x, -2.5);
  close(state.offset.z, 2);
  assert.equal(state.depthReliable, false);
});

test('natural standing jitter within lateral and depth deadzones leaves the character stable', () => {
  const { motion, pivot } = fixture();
  const position = pivot.position.clone();
  const scale = pivot.scale.clone();
  for (let index = 0; index < 200; index++) {
    motion.update(1 / 60, { ...reference,
      centerX: .5 + Math.sin(index) * .01,
      torsoScale: .25 * (1 + Math.cos(index) * .025) }, reference);
  }
  assert.deepEqual(pivot.position.toArray(), position.toArray());
  assert.deepEqual(pivot.scale.toArray(), scale.toArray());
  close(motion.snapshot().normalizedLateral, 0);
  close(motion.snapshot().normalizedDepth, 0);
});

test('non-standing samples retain the depth target while horizontal movement continues', () => {
  const { feed } = fixture();
  const state = feed({ ...reference, centerX: .28, bodyScale: .32, torsoScale: .4, depthReliable: false });
  close(state.offset.x, 2.5);
  close(state.offset.z, 0);
  close(state.target.z, 0);
  assert.equal(state.reliable, true);
  assert.equal(state.depthReliable, false);
  assert.equal(state.rejectionReason, 'non-standing-depth');
});

test('reliable standing restores depth updates after non-standing observations', () => {
  const { feed } = fixture();
  feed({ ...reference, bodyScale: .32, torsoScale: .4 });
  const backward = { ...reference, centerX: .72, bodyScale: .144, torsoScale: .18 };
  let state = feed({ ...backward, depthReliable: false });
  close(state.offset.x, -2.5);
  close(state.target.z, 2);
  close(state.offset.z, 2);
  assert.equal(state.depthReliable, false);
  state = feed({ ...backward, depthReliable: true });
  close(state.target.z, -2);
  close(state.offset.z, -2);
  assert.equal(state.depthReliable, true);
  assert.equal(state.rejectionReason, undefined);
});

test('interaction lock freezes the current transform and discards stale movement targets', () => {
  const { motion, pivot } = fixture();
  const far = { ...reference, centerX: .28, bodyScale: .32, torsoScale: .4 };
  motion.update(.05, far, reference);
  const position = pivot.position.clone();
  const scale = pivot.scale.clone();
  for (let index = 0; index < 100; index++) motion.update(.05, far, reference, false);
  assert.deepEqual(pivot.position.toArray(), position.toArray());
  assert.deepEqual(pivot.scale.toArray(), scale.toArray());
  assert.equal(motion.snapshot().locked, true);
  motion.update(.05);
  assert.deepEqual(pivot.position.toArray(), position.toArray());
  motion.update(.05, far, reference);
  close(pivot.position.x - position.x, .15);
  close(pivot.position.z - position.z, .1);
  assert.equal(motion.snapshot().locked, false);
});

test('missing and rejected observations retain the last valid target without introducing invalid transforms', () => {
  const { motion, feed, pivot } = fixture();
  feed({ ...reference, centerX: .4, torsoScale: .3 });
  const position = pivot.position.clone();
  const target = motion.snapshot().target;
  const invalid = [
    { ...reference, centerX: NaN },
    { ...reference, bodyScale: 0 },
    { ...reference, torsoScale: Infinity },
    { ...reference, torsoScale: .001 },
    { ...reference, torsoScale: .09 },
    { ...reference, torsoScale: .7 },
  ];
  for (const sample of invalid) {
    motion.update(.05, sample, reference);
    assert.equal(motion.snapshot().reliable, false);
    assert.deepEqual(motion.snapshot().target, target);
    assert.deepEqual(pivot.position.toArray(), position.toArray());
  }
  motion.update(.05);
  assert.deepEqual(pivot.position.toArray(), position.toArray());
  assert.ok([...pivot.position.toArray(), ...pivot.scale.toArray()].every(Number.isFinite));
});

test('dropout keeps easing toward the last accepted target at the bounded movement rate', () => {
  const { motion } = fixture();
  motion.update(.05, { ...reference, centerX: .28 }, reference);
  const first = motion.snapshot().offset.x;
  motion.update(.05);
  close(motion.snapshot().offset.x - first, .15);
  assert.equal(motion.snapshot().reliable, false);
});

test('rate limits agree across supported render steps and cap long or invalid updates', () => {
  const sample = { ...reference, centerX: .28, bodyScale: .32, torsoScale: .4 };
  const states = [20, 30, 60].map(fps => {
    const { motion } = fixture();
    for (let index = 0; index < fps / 2; index++) motion.update(1 / fps, sample, reference);
    return motion.snapshot();
  });
  for (const state of states) {
    close(state.offset.x, 1.5);
    close(state.offset.z, 1);
  }
  const { motion, pivot } = fixture();
  motion.update(5, sample, reference);
  close(motion.snapshot().offset.x, .15);
  close(motion.snapshot().offset.z, .1);
  const position = pivot.position.clone();
  for (const delta of [0, -1, NaN, Infinity]) motion.update(delta, sample, reference);
  assert.deepEqual(pivot.position.toArray(), position.toArray());
});

test('reset restores the original world transform and clears all movement state', () => {
  const { motion, pivot, feed } = fixture();
  const position = pivot.position.clone();
  const scale = pivot.scale.clone();
  feed({ ...reference, centerX: .28, bodyScale: .32, torsoScale: .4 });
  motion.update(.05, undefined, undefined, false);
  motion.reset();
  assert.deepEqual(pivot.position.toArray(), position.toArray());
  assert.deepEqual(pivot.scale.toArray(), scale.toArray());
  const state = motion.snapshot();
  assert.deepEqual(state.target, { x: 0, z: 0 });
  assert.equal(state.locked, false);
  assert.equal(state.reliable, false);
  motion.update(.05);
  assert.deepEqual(pivot.position.toArray(), position.toArray());
});
