import assert from 'node:assert/strict';
import test from 'node:test';
import { CalibrationController } from '../src/game/calibration/CalibrationController';
import { calibrationThresholds, partialMotionRange, validateCalibration } from '../src/game/calibration/calibrationMath';
import type { CalibrationProfile, PartialCalibrationProfile } from '../src/game/calibration/calibrationTypes';
import { PoseClassifier } from '../src/game/vision/PoseClassifier';
import { observePartialBend } from '../src/game/vision/partialBend';
import type { PoseFrame, PoseLandmark } from '../src/game/vision/poseTypes';

type FrameOptions = { cropped?: boolean; ankle?: boolean; offset?: number; scale?: number; kneeAngle?: number };
function frame(time: number, hipDrop = 0, options: FrameOptions = {}): PoseFrame & { landmarks: PoseLandmark[] } {
  const points = Array.from({ length: 33 }, () => ({ x: .5, y: -.1, visibility: .99 }));
  const scale = options.scale ?? 1;
  const center = .5 + (options.offset ?? 0);
  const point = (x: number, y: number) => ({ x: center + (x - .5) * scale, y: .4 + (y - .4) * scale, visibility: .99 });
  const angle = (options.kneeAngle ?? 170) * Math.PI / 180;
  for (const [s, h, k, a, x] of [[11, 23, 25, 27, .65], [12, 24, 26, 28, .35]]) {
    points[s] = point(x, .18 + hipDrop);
    points[h] = point(x, .48 + hipDrop);
    points[k] = point(x, .68);
    points[a] = point(x + .14 * Math.sin(angle), options.cropped ? 1.25 : .68 - .14 * Math.cos(angle));
  }
  if (options.ankle === false) points[28].visibility = .1;
  return { landmarks: points, timestampMs: time, poseFps: 25, inferenceMs: 5, imageWidth: 1000, imageHeight: 1000 };
}
const signal = (drop: number) => observePartialBend(frame(0, drop).landmarks, 1000, 1000)!.signal;
const partialProfile: PartialCalibrationProfile = {
  metric: 'partial', partial: partialMotionRange(signal(0), signal(.03)), timestamp: 1,
};
function run(classifier: PoseClassifier, from: number, to: number, hipDrop: number, options = {}) {
  let snapshot = classifier.update(frame(from, hipDrop, options));
  for (let t = from + 40; t <= to; t += 40) snapshot = classifier.update(frame(t, hipDrop, options));
  return snapshot;
}

test('optional face and ankle coordinates do not affect Carrot thigh observation', () => {
  const visible = frame(0, .02);
  const cropped = frame(0, .02, { cropped: true });
  assert.deepEqual(observePartialBend(cropped.landmarks, 1000, 1000),
    observePartialBend(visible.landmarks, 1000, 1000));
  assert.ok(signal(.025) > signal(0));
  cropped.landmarks[25].visibility = .1;
  assert.equal(observePartialBend(cropped.landmarks, 1000, 1000), undefined);
  const classifier = new PoseClassifier(true);
  assert.equal(run(classifier, 0, 240, 0).state, 'STANDING');
});

test('rigid translation and a uniform scale change leave the thigh projection constant', () => {
  const a = observePartialBend(frame(0, .025).landmarks, 1000, 1000)!;
  for (const offset of [-.14, .15]) for (const scale of [.8, 1.16]) {
    const b = observePartialBend(frame(0, .025, { offset, scale }).landmarks, 1000, 1000)!;
    assert.ok(Math.abs(a.signal - b.signal) < 1e-9);
  }
});

test('two-pose calibration with cropped ankles records no angle values and drives standing and bending', () => {
  const classifier = new PoseClassifier(true);
  const calibration = new CalibrationController();
  calibration.begin(0);
  for (let t = 0; t <= 2400; t += 40) calibration.update(classifier.update(frame(t, 0, { cropped: true })), t);
  assert.equal(calibration.getSnapshot().state, 'BEND_INSTRUCTIONS');
  assert.equal(calibration.getSnapshot().metric, 'partial');
  calibration.startBending(2440);
  for (let t = 2440; t <= 5000; t += 40) calibration.update(classifier.update(frame(t, .03, { cropped: true })), t);
  const done = calibration.getSnapshot();
  assert.equal(done.state, 'COMPLETE');
  assert.equal(done.activeAngle, undefined);
  const profile = done.profile!;
  assert.equal(profile.metric, 'partial');
  assert.ok(validateCalibration(profile));
  assert.equal(profile.standingAngle, undefined);
  assert.equal(profile.bendingThreshold, undefined);
  assert.ok((profile.partial?.range ?? 0) > .09);

  classifier.setCalibration(profile);
  const standing = run(classifier, 5040, 5400, 0, { cropped: true });
  assert.equal(standing.state, 'STANDING');
  let bending = run(classifier, 5440, 5840, .03, { cropped: true });
  assert.equal(bending.state, 'BENDING');
  assert.equal(bending.estimatedBendAmount! > .9, true);
  assert.equal(bending.activeKneeAngle, undefined);
  bending = run(classifier, 5880, 6280, .03, { kneeAngle: 150 });
  assert.equal(bending.trackingMode, 'partial');
  assert.equal(bending.state, 'BENDING');
  assert.equal(bending.leftKneeAngle! > 149 && bending.leftKneeAngle! < 151, true);
  assert.equal(run(classifier, 6320, 6720, 0, { cropped: true }).state, 'STANDING');
});

test('full calibration records a separate fallback only when both thigh poses are reliably distinct', () => {
  for (const drop of [.03, 0]) {
    const classifier = new PoseClassifier(true);
    const calibration = new CalibrationController();
    calibration.begin(0);
    for (let t = 0; t <= 2400; t += 40) calibration.update(classifier.update(frame(t)), t);
    calibration.startBending(2440);
    for (let t = 2440; t <= 5000; t += 40) {
      calibration.update(classifier.update(frame(t, drop, { kneeAngle: 150 })), t);
    }
    const done = calibration.getSnapshot();
    assert.equal(done.state, 'COMPLETE');
    assert.equal(done.profile?.metric, undefined);
    assert.ok(Math.abs(done.profile!.bendingAngle! - 150) < .1);
    assert.equal(Boolean(done.profile?.partial), drop > 0);
  }
});

test('exact and partial handovers wait for standing and preserve disjoint motion evidence', () => {
  const profile: CalibrationProfile = {
    standingAngle: 170, bendingAngle: 150, ...calibrationThresholds(170, 150),
    partial: partialProfile.partial, timestamp: 1, reliableSide: 'both',
    leftStanding: 170, rightStanding: 170, leftBending: 150, rightBending: 150, leftRange: 20, rightRange: 20,
  };
  const classifier = new PoseClassifier(true);
  classifier.setCalibration(profile);
  assert.equal(run(classifier, 0, 240, 0).state, 'STANDING');
  const early = run(classifier, 280, 720, .03, { cropped: true, kneeAngle: 150 });
  assert.equal(early.state, 'TRANSITION');
  assert.equal(early.trackingTransition, true);
  assert.equal(run(classifier, 760, 1160, 0, { cropped: true }).state, 'STANDING');
  assert.equal(run(classifier, 1200, 1600, .03, { cropped: true }).state, 'BENDING');
  const anklesVisible = run(classifier, 1640, 2040, .03, { kneeAngle: 150 });
  assert.equal(anklesVisible.trackingMode, 'partial');
  assert.equal(anklesVisible.state, 'BENDING');
  const ready = run(classifier, 2080, 3000, 0);
  assert.equal(ready.trackingMode, 'full');
  assert.equal(ready.state, 'STANDING');
  assert.ok(Math.abs(ready.activeKneeAngle! - 170) < .1);
});

test('partial stance rejects necessary-point loss and stale frames, then requires fresh debounce', () => {
  const classifier = new PoseClassifier(true);
  classifier.setCalibration(partialProfile);
  assert.equal(run(classifier, 0, 280, 0, { cropped: true }).state, 'STANDING');
  const noKnee = frame(320, .03, { cropped: true });
  noKnee.landmarks[25].visibility = .1;
  assert.equal(classifier.update(noKnee).state, 'TRACKING_LOST');
  const noShoulder = frame(360, .03, { cropped: true });
  noShoulder.landmarks[11].visibility = .1;
  assert.equal(classifier.update(noShoulder).state, 'TRACKING_LOST');
  assert.equal(classifier.update(frame(400, .03, { cropped: true }), 651).reason, 'stale-frame');
  assert.equal(run(classifier, 680, 840, .03, { cropped: true }).state, 'TRANSITION');
  assert.equal(classifier.update(frame(880, .03, { cropped: true })).state, 'BENDING');
  assert.equal(classifier.snapshot(1131).trackingMode, 'lost');
});
