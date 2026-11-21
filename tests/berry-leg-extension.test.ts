import test from 'node:test';
import assert from 'node:assert/strict';
import { LegExtensionDetector } from '../src/game/mocap/LegExtensionDetector';
import { HumanPoseExtractor } from '../src/game/mocap/HumanPoseExtractor';
import { MotionRetargeter } from '../src/game/mocap/MotionRetargeter';
import type { PoseFrame, PoseLandmark } from '../src/game/vision/poseTypes';

function frame(timestampMs: number, left = 0, right = 0, translation = 0, mirror = false, scale = 1, aspect = 1280 / 720): PoseFrame {
  const landmarks: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 1 }));
  const set = (index: number, x: number, y: number) => {
    const rawX = .5 + (x - .5) * scale + translation;
    landmarks[index] = { x: mirror ? 1 - rawX : rawX, y: .5 + (y - .5) * scale, visibility: 1 };
  };
  set(11, .57, .28); set(12, .43, .28);
  set(23, .54, .5); set(24, .46, .5);
  set(25, .54 + left * .5, .7); set(26, .46 - right * .5, .7);
  set(27, .54 + left, .9); set(28, .46 - right, .9);
  return { landmarks, timestampMs, imageWidth: 720 * aspect, imageHeight: 720, inferenceMs: 8, poseFps: 30 };
}
function establish(detector: LegExtensionDetector, mirror = false, scale = 1) {
  for (let time = 0; time <= 400; time += 40) detector.update(frame(time, 0, 0, 0, mirror, scale));
}
function settle(detector: LegExtensionDetector, left = 0, right = 0, translation = 0, mirror = false, scale = 1) {
  let sample = detector.update(frame(440, left, right, translation, mirror, scale));
  for (let time = 480; time <= 840; time += 40) sample = detector.update(frame(time, left, right, translation, mirror, scale));
  return sample;
}

test('left and right leg extensions remain continuous and anatomically independent', () => {
  for (const side of ['left', 'right'] as const) {
    const detector = new LegExtensionDetector(); establish(detector);
    const result = settle(detector, side === 'left' ? .07 : 0, side === 'right' ? .07 : 0);
    assert.equal(result.reliable, true);
    assert.ok(result[`${side}LegExtensionAmount`] > .9);
    assert.equal(result[`${side === 'left' ? 'right' : 'left'}LegExtensionAmount`], 0);
    assert.equal(result.lateralOffset, 0);
  }
  const detector = new LegExtensionDetector(); establish(detector);
  const partial = settle(detector, .035);
  assert.ok(partial.leftLegExtensionAmount > .2 && partial.leftLegExtensionAmount < .6);
});

test('mirroring and camera distance preserve anatomical extension and movement direction', () => {
  for (const mirror of [false, true]) for (const scale of [.6, 1]) {
    const detector = new LegExtensionDetector(); establish(detector, mirror, scale);
    const sample = settle(detector, .07, 0, .04, mirror, scale);
    assert.ok(sample.leftLegExtensionAmount > .9);
    assert.equal(sample.rightLegExtensionAmount, 0);
    assert.ok(sample.lateralOffset < -.3);
  }
});

test('whole-body translation produces no extension; translation and extension can coexist', () => {
  const detector = new LegExtensionDetector(); establish(detector);
  const sample = settle(detector, 0, 0, -.07);
  assert.equal(sample.leftLegExtensionAmount, 0);
  assert.equal(sample.rightLegExtensionAmount, 0);
  assert.ok(sample.lateralOffset > .6);
});

test('loss and pause suppress commands immediately and recover away from the original center', () => {
  for (const interruption of ['missing-pose', 'frame-gap', 'paused'] as const) {
    const detector = new LegExtensionDetector(); establish(detector);
    const before = settle(detector, .07, 0, .09);
    const reference = detector.snapshot().reference;
    if (interruption === 'missing-pose') {
      const lost = detector.update({ ...frame(880), landmarks: undefined });
      assert.equal(lost.leftLegExtensionAmount, 0);
      assert.equal(lost.lateralReliable, false);
      assert.equal(lost.lateralOffset, before.lateralOffset);
      detector.update({ ...frame(1520), landmarks: undefined });
    } else if (interruption === 'paused') detector.interrupt('paused');
    assert.equal(detector.update(frame(1560, .07, 0, -.09)).lateralReliable, false);
    assert.equal(detector.update(frame(1600, .07, 0, -.09)).lateralReliable, false);
    assert.equal(detector.update(frame(1640, .07, 0, -.09)).lateralReliable, true);
    assert.deepEqual(detector.snapshot().reference, reference);
    const recovered = detector.update(frame(1680, .07, 0, -.09));
    assert.ok(recovered.lateralOffset > .3);
    assert.ok(recovered.leftLegExtensionAmount >= .9);
  }
});

test('low confidence, invalid coordinates, duplicate timestamps and unstable wide stance are rejected', () => {
  for (const modify of [
    (value: PoseFrame) => { (value.landmarks![27] as PoseLandmark).visibility = .1; },
    (value: PoseFrame) => { (value.landmarks![24] as PoseLandmark).x = NaN; },
    (value: PoseFrame) => { (value.landmarks![11] as PoseLandmark).x += .2; },
  ]) {
    const detector = new LegExtensionDetector(); establish(detector);
    const bad = frame(440); modify(bad); assert.equal(detector.update(bad).reliable, false);
  }
  const detector = new LegExtensionDetector(); establish(detector);
  assert.equal(detector.update(frame(400, .07)).reliable, false);
  assert.equal(detector.update(frame(440, .07, .07)).reliable, false);
});

test('natural stance has a deadzone and retraction returns amounts to zero', () => {
  const detector = new LegExtensionDetector(); establish(detector);
  assert.equal(settle(detector, .01).leftLegExtensionAmount, 0);
  for (let t = 880; t < 1200; t += 40) detector.update(frame(t, .07));
  let sample = detector.update(frame(1200));
  for (let t = 1240; t < 1600; t += 40) sample = detector.update(frame(t));
  assert.ok(sample.leftLegExtensionAmount < .01);
});

test('existing named extractor and retargeter support Berry without any calibration profile', () => {
  const extractor = new HumanPoseExtractor();
  const retargeter = new MotionRetargeter();
  for (let t = 0; t <= 400; t += 40) extractor.extractLegMotion(frame(t));
  const sample = retargeter.retargetLegMotion(extractor.extractLegMotion(frame(440, .07)));
  assert.equal(sample.reliable, true); assert.ok(sample.leftLegExtensionAmount > 0);
  assert.equal(retargeter.reference, undefined);
  extractor.resetLegMotion();
  assert.equal(extractor.extractLegMotion(frame(480)).reliable, false);
  assert.equal(retargeter.retargetLegMotion({ ...sample, lateralOffset: NaN }).reliable, false);
});

test('standing reference requires a continuous stable window and a fresh session can re-anchor', () => {
  const detector = new LegExtensionDetector();
  for (let t = 0; t < 400; t += 40) assert.equal(detector.update(frame(t)).reliable, false);
  for (let t = 400; t < 1000; t += 40) {
    assert.equal(detector.update(frame(t, 0, 0, .024 * (t % 80 === 0 ? -1 : 1))).reliable, false);
  }
  for (let t = 1000; t <= 1520; t += 40) assert.equal(detector.update(frame(t, .07)).reliable, false);
  for (let t = 1560; t < 1960; t += 40) assert.equal(detector.update(frame(t)).reliable, false);
  assert.equal(detector.update(frame(1960)).reliable, true);
  assert.equal(detector.snapshot().reference?.center, .5);
  detector.reset();
  assert.equal(detector.snapshot().reference, null);
  assert.equal(detector.snapshot().resetReason, 'manual');
  for (let t = 2000; t <= 2400; t += 40) detector.update(frame(t, 0, 0, .08));
  assert.ok(Math.abs(detector.snapshot().reference!.center - .58) < 1e-8);
});

test('isolated coherent jump, flipped orientation and low-visibility torso cannot steer the rabbit', () => {
  const detector = new LegExtensionDetector(); establish(detector);
  const reference = detector.snapshot().reference;
  assert.equal(detector.update(frame(440, 0, 0, .2)).lateralReliable, false);
  assert.equal(detector.snapshot().rejection, 'lateral-jump');
  for (const timestamp of [480, 520, 560]) assert.equal(detector.update(frame(timestamp)).lateralOffset, 0);
  assert.equal(detector.update(frame(600, 0, 0, 0, true)).lateralReliable, false);
  assert.equal(detector.snapshot().rejection, 'direction-change');
  const low = frame(640);
  (low.landmarks![23] as PoseLandmark).visibility = .2;
  assert.equal(detector.update(low).lateralReliable, false);
  assert.deepEqual(detector.snapshot().reference, reference);
});

test('one high-confidence hip spike below the jump threshold cannot steer the rabbit', () => {
  const detector = new LegExtensionDetector(); establish(detector);
  const impulse = frame(440);
  (impulse.landmarks![23] as PoseLandmark).x += .1;
  assert.equal(detector.update(impulse).lateralOffset, 0);
  assert.equal(detector.update(frame(480)).lateralOffset, 0);
  assert.equal(detector.update(frame(520)).lateralOffset, 0);
});

test('temporarily hidden feet disallow kicks while torso motion continues', () => {
  const detector = new LegExtensionDetector(); establish(detector);
  const value = frame(440, 0, 0, -.035);
  (value.landmarks![27] as PoseLandmark).x = -.01;
  detector.update(value);
  const sample = new MotionRetargeter().retargetLegMotion(detector.update({ ...value, timestampMs: 480 }));
  assert.equal(sample.reliable, false);
  assert.equal(sample.lateralReliable, true);
  assert.equal(sample.leftLegExtensionAmount, 0);
  assert.ok(sample.lateralOffset > .1);
});

test('120 seconds of mirrored sweeps, depth changes and aspect changes retain the initial travel', () => {
  for (const mirror of [false, true]) {
    const detector = new LegExtensionDetector(); establish(detector, mirror);
    const reference = detector.snapshot().reference;
    for (let t = 440; t <= 120400; t += 40) {
      const translation = .14 * Math.sin((t - 400) * Math.PI / 2000);
      const scale = 1 + .43 * Math.sin(t * Math.PI / 6400);
      const aspect = t < 60000 ? 16 / 9 : 4 / 3;
      const sample = detector.update(frame(t, 0, 0, translation, mirror, scale, aspect));
      assert.equal(sample.lateralReliable, true);
      assert.deepEqual(detector.snapshot().reference, reference);
      if (Math.abs(translation) > .125) assert.ok(sample.lateralOffset * -Math.sign(translation) > .98);
    }
  }
});

test('cross-body ankle and inward knee are not outward leg extensions', () => {
  const detector = new LegExtensionDetector(); establish(detector);
  assert.equal(detector.update(frame(440, -.07)).reliable, false);
  const bad = frame(480, .07);
  (bad.landmarks![25] as PoseLandmark).x = .50;
  assert.equal(detector.update(bad).reliable, false);
});
