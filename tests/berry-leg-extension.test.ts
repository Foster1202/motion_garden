import test from 'node:test';
import assert from 'node:assert/strict';
import { LegExtensionDetector } from '../src/game/mocap/LegExtensionDetector';
import { HumanPoseExtractor } from '../src/game/mocap/HumanPoseExtractor';
import { MotionRetargeter } from '../src/game/mocap/MotionRetargeter';
import type { PoseFrame, PoseLandmark } from '../src/game/vision/poseTypes';

function frame(timestampMs: number, left = 0, right = 0, translation = 0, mirror = false, scale = 1): PoseFrame {
  const landmarks: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 1 }));
  const set = (index: number, x: number, y: number) => {
    const rawX = .5 + (x - .5 + translation) * scale;
    landmarks[index] = { x: mirror ? 1 - rawX : rawX, y: .5 + (y - .5) * scale, visibility: 1 };
  };
  set(11, .57, .28); set(12, .43, .28);
  set(23, .54, .5); set(24, .46, .5);
  set(25, .54 + left * .5, .7); set(26, .46 - right * .5, .7);
  set(27, .54 + left, .9); set(28, .46 - right, .9);
  return { landmarks, timestampMs, imageWidth: 1280, imageHeight: 720, inferenceMs: 8, poseFps: 30 };
}
function establish(detector: LegExtensionDetector, mirror = false, scale = 1) {
  for (const time of [0, 33, 66]) detector.update(frame(time, 0, 0, 0, mirror, scale));
}
function settle(detector: LegExtensionDetector, left = 0, right = 0, translation = 0, mirror = false, scale = 1) {
  let sample = detector.update(frame(100, left, right, translation, mirror, scale));
  for (let time = 133; time <= 430; time += 33) sample = detector.update(frame(time, left, right, translation, mirror, scale));
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

test('tracking loss immediately suppresses amounts, and long loss acquires a new ephemeral center', () => {
  const detector = new LegExtensionDetector(); establish(detector); settle(detector, .07);
  const lost = detector.update({ ...frame(450), landmarks: undefined });
  assert.equal(lost.reliable, false); assert.equal(lost.leftLegExtensionAmount, 0);
  detector.update({ ...frame(1050), landmarks: undefined });
  assert.equal(detector.update(frame(1080, 0, 0, .1)).reliable, false);
  detector.update(frame(1113, 0, 0, .1));
  const recovered = detector.update(frame(1146, 0, 0, .1));
  assert.equal(recovered.reliable, true); assert.ok(Math.abs(recovered.lateralOffset) < 1e-6);
});

test('low confidence, invalid coordinates, duplicate timestamps and unstable wide stance are rejected', () => {
  for (const modify of [
    (value: PoseFrame) => { (value.landmarks![27] as PoseLandmark).visibility = .1; },
    (value: PoseFrame) => { (value.landmarks![24] as PoseLandmark).x = NaN; },
    (value: PoseFrame) => { (value.landmarks![11] as PoseLandmark).x += .2; },
  ]) {
    const detector = new LegExtensionDetector(); establish(detector);
    const bad = frame(100); modify(bad); assert.equal(detector.update(bad).reliable, false);
  }
  const detector = new LegExtensionDetector(); establish(detector);
  assert.equal(detector.update(frame(66, .07)).reliable, false);
  assert.equal(detector.update(frame(100, .07, .07)).reliable, false);
});

test('natural stance has a deadzone and retraction returns amounts to zero', () => {
  const detector = new LegExtensionDetector(); establish(detector);
  assert.equal(settle(detector, .01).leftLegExtensionAmount, 0);
  for (let t = 500; t < 800; t += 33) detector.update(frame(t, .07));
  let sample = detector.update(frame(800));
  for (let t = 833; t < 1200; t += 33) sample = detector.update(frame(t));
  assert.ok(sample.leftLegExtensionAmount < .01);
});

test('existing named extractor and retargeter support Berry without any calibration profile', () => {
  const extractor = new HumanPoseExtractor();
  const retargeter = new MotionRetargeter();
  for (const t of [0, 33, 66]) extractor.extractLegMotion(frame(t));
  const sample = retargeter.retargetLegMotion(extractor.extractLegMotion(frame(100, .07)));
  assert.equal(sample.reliable, true); assert.ok(sample.leftLegExtensionAmount > 0);
  assert.equal(retargeter.reference, undefined);
  extractor.resetLegMotion();
  assert.equal(extractor.extractLegMotion(frame(133)).reliable, false);
  assert.equal(retargeter.retargetLegMotion({ ...sample, lateralOffset: NaN }).reliable, false);
});

test('automatic reference needs only three coherent frames and rejects stale gaps without a wizard', () => {
  const detector = new LegExtensionDetector();
  assert.equal(detector.update(frame(0)).reliable, false);
  assert.equal(detector.update(frame(33)).reliable, false);
  assert.equal(detector.update(frame(66)).reliable, true);
  assert.equal(detector.update(frame(900, .07)).reliable, false);
  assert.equal(detector.update(frame(933, .07)).reliable, false);
  assert.equal(detector.update(frame(966, .07)).reliable, true);
  detector.reset();
  assert.equal(detector.update(frame(1000)).reliable, false);
  assert.equal(detector.update(frame(1033, 0, 0, .1)).reliable, false);
  assert.equal(detector.update(frame(1066, 0, 0, -.1)).reliable, false);
});

test('cross-body ankle and inward knee are not outward leg extensions', () => {
  const detector = new LegExtensionDetector(); establish(detector);
  assert.equal(detector.update(frame(100, -.07)).reliable, false);
  const bad = frame(133, .07);
  (bad.landmarks![25] as PoseLandmark).x = .50;
  assert.equal(detector.update(bad).reliable, false);
});
