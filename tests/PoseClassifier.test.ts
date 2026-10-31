import assert from 'node:assert/strict';
import test from 'node:test';
import { PoseClassifier } from '../src/game/vision/PoseClassifier';
import { PoseSmoother } from '../src/game/vision/PoseSmoother';
import { POSE_CONFIG, POSE_LANDMARK as ID } from '../src/game/vision/poseConfig';
import { imagePoint, calculateAngle } from '../src/game/vision/poseMath';
import type { PoseFrame, PoseLandmark } from '../src/game/vision/poseTypes';
import type { CalibrationProfile } from '../src/game/calibration/calibrationTypes';

const profileC: CalibrationProfile = {
  standingAngle: 155, bendingAngle: 135, range: 20,
  standingThreshold: 151, bendingThreshold: 142, timestamp: 1000,
};

function landmarks(angle = 180): PoseLandmark[] {
  const points: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0, presence: 0 }));
  const radians = angle * Math.PI / 180;
  for (const side of ['left', 'right'] as const) {
    const x = side === 'left' ? 0.35 : 0.65;
    points[ID[`${side}Shoulder`]] = { x, y: 0.1, visibility: 1, presence: 1 };
    points[ID[`${side}Hip`]] = { x, y: 0.4, visibility: 1, presence: 1 };
    points[ID[`${side}Knee`]] = { x, y: 0.65, visibility: 1, presence: 1 };
    points[ID[`${side}Ankle`]] = { x: x + 0.25 * Math.sin(radians), y: 0.65 - 0.25 * Math.cos(radians), visibility: 1, presence: 1 };
  }
  return points;
}

function frame(timestampMs: number, angle = 180, points = landmarks(angle)): PoseFrame {
  return { landmarks: points, timestampMs, inferenceMs: 9, poseFps: 25, imageWidth: 1000, imageHeight: 1000 };
}

function confirm(classifier: PoseClassifier, angle = 180, start = 0): void {
  for (let time = start; time <= start + 200; time += 40) classifier.update(frame(time, angle));
}

test('knee geometry clamps angle and rejects zero or invalid limbs', () => {
  assert.equal(calculateAngle({ x: 0, y: -1 }, { x: 0, y: 0 }, { x: 0, y: 1 }), 180);
  assert.equal(calculateAngle({ x: 0, y: -1 }, { x: 0, y: 0 }, { x: 1, y: 0 }), 90);
  assert.equal(calculateAngle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }), undefined);
  assert.equal(calculateAngle({ x: NaN, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }), undefined);
});

test('angle uses aspect-correct pixels rather than normalized-square coordinates', () => {
  const hip = { x: 0.5, y: 0.2 };
  const knee = { x: 0.5, y: 0.5 };
  const ankle = { x: 0.7, y: 0.8 };
  const angle = calculateAngle(imagePoint(hip, 1600, 900), imagePoint(knee, 1600, 900), imagePoint(ankle, 1600, 900));
  assert.ok(Math.abs(angle! - (180 - Math.atan2(320, 270) * 180 / Math.PI)) < 1e-9);
  assert.ok(Math.abs(angle! - calculateAngle(hip, knee, ankle)!) > 10);
});

test('requires continuously qualifying frames through debounce before a standing or bending output', () => {
  for (const angle of [180, 140]) {
    const classifier = new PoseClassifier();
    assert.equal(classifier.snapshot(0).state, 'UNKNOWN');
    assert.equal(classifier.update(frame(0, angle)).state, 'TRANSITION');
    assert.equal(classifier.update(frame(160, angle)).state, 'TRANSITION');
    const snapshot = classifier.update(frame(200, angle));
    assert.equal(snapshot.state, angle === 180 ? 'STANDING' : 'BENDING');
    assert.equal(snapshot.candidateMs, 200);
    assert.equal(snapshot.reliableSides, 2);
  }
});

test('neutral band immediately removes a formerly confirmed state and resets debounce', () => {
  const classifier = new PoseClassifier();
  confirm(classifier, 165);
  assert.equal(classifier.snapshot(200).state, 'STANDING');
  const neutral = classifier.update(frame(240, 155));
  assert.equal(neutral.state, 'TRANSITION');
  assert.equal(neutral.candidateState, undefined);
  assert.equal(neutral.candidateMs, 0);
  classifier.reset();
  confirm(classifier, 145);
  assert.equal(classifier.update(frame(240, 155)).state, 'TRANSITION');
});

test('opposite candidate must settle again and history does not bridge a long frame gap', () => {
  const classifier = new PoseClassifier();
  confirm(classifier, 180);
  const afterGap = classifier.update(frame(600, 140));
  assert.equal(afterGap.activeKneeAngle, 140);
  assert.equal(afterGap.state, 'TRANSITION');
  assert.equal(afterGap.candidateMs, 0);
  classifier.update(frame(760, 140));
  assert.equal(classifier.update(frame(800, 140)).state, 'BENDING');
});

test('each leg can fall back independently and both reliable legs are averaged', () => {
  for (const unavailable of ['left', 'right'] as const) {
    const classifier = new PoseClassifier();
    const points = landmarks(140);
    points[ID[`${unavailable}Ankle`]].visibility = 0.49;
    const snapshot = classifier.update(frame(0, 140, points));
    assert.equal(snapshot.reliableSides, 1);
    assert.ok(Math.abs(snapshot.activeKneeAngle! - 140) < 1e-9);
    assert.equal(snapshot[`${unavailable}KneeAngle`], undefined);
  }
  const points = landmarks(180);
  points[ID.rightAnkle] = landmarks(140)[ID.rightAnkle];
  const snapshot = new PoseClassifier().update(frame(0, 180, points));
  assert.ok(Math.abs(snapshot.activeKneeAngle! - 160) < 1e-9);
  assert.equal(snapshot.state, 'TRANSITION');
});

test('low presence, missing visibility and clipped landmarks are rejected before smoothing', () => {
  for (const property of ['visibility', 'presence'] as const) {
    const classifier = new PoseClassifier();
    confirm(classifier, 180);
    const low = landmarks(90);
    low[ID.leftKnee][property] = 0.1;
    low[ID.rightKnee][property] = 0.1;
    assert.equal(classifier.update(frame(240, 90, low)).state, 'TRACKING_LOST');
    const recovered = classifier.update(frame(280, 140));
    assert.equal(recovered.activeKneeAngle, 140);
    assert.equal(recovered.state, 'TRANSITION');
  }
  const missing = landmarks();
  delete missing[ID.leftKnee].visibility;
  missing[ID.rightKnee].x = 1.01;
  assert.equal(new PoseClassifier().update(frame(0, 180, missing)).state, 'TRACKING_LOST');
});

test('official landmarks without optional presence remain valid, but supplied low presence is rejected', () => {
  const points = landmarks();
  for (const point of points) delete point.presence;
  const classifier = new PoseClassifier();
  const initial = classifier.update(frame(0, 180, points));
  assert.equal(initial.reliableSides, 2);
  assert.equal(initial.confidence, 1);
  points[ID.leftKnee].presence = 0.1;
  assert.equal(classifier.update(frame(40, 180, points)).reliableSides, 1);
  points[ID.rightKnee].presence = 0.1;
  assert.equal(classifier.update(frame(80, 180, points)).state, 'TRACKING_LOST');
});

test('classifier smooths trusted landmark coordinates before calculating the angle', () => {
  const classifier = new PoseClassifier();
  classifier.update(frame(0, 180));
  const bentPoints = landmarks(100);
  const snapshot = classifier.update(frame(40, 100, bentPoints));
  const standingAnkle = landmarks(180)[ID.leftAnkle];
  const bentAnkle = bentPoints[ID.leftAnkle];
  const expectedAnkle = {
    x: 0.35 * bentAnkle.x + 0.65 * standingAnkle.x,
    y: 0.35 * bentAnkle.y + 0.65 * standingAnkle.y,
  };
  const expectedAngle = calculateAngle(bentPoints[ID.leftHip], bentPoints[ID.leftKnee], expectedAnkle)!;
  assert.ok(Math.abs(snapshot.leftKneeAngle! - expectedAngle) < 1e-9);
  assert.ok(Math.abs(snapshot.leftKneeAngle! - (0.35 * 100 + 0.65 * 180)) > 1);
});

test('coordinate EMA damps point jitter, returns isolated snapshots and resets without stale history', () => {
  const smoother = new PoseSmoother();
  const original = { x: 0.4, y: 0.6, z: 0.1, visibility: 0.8 };
  smoother.updateLandmarks([original]);
  const smoothed = smoother.updateLandmarks([{ ...original, x: 0.42, y: 0.58, z: 0.2 }]);
  assert.ok(Math.abs(smoothed[0].x - 0.407) < 1e-12);
  assert.ok(Math.abs(smoothed[0].y - 0.593) < 1e-12);
  assert.ok(Math.abs(smoothed[0].z! - 0.135) < 1e-12);
  smoothed[0].x = 1;
  assert.ok(smoother.updateLandmarks([original])[0].x < 0.41);
  smoother.reset();
  assert.equal(smoother.updateLandmarks([{ ...original, x: 0.8 }])[0].x, 0.8);
});

test('unknown torso or leaned upper body cannot drive knee output', () => {
  for (const type of ['missing', 'leaning', 'inverted'] as const) {
    const points = landmarks(140);
    for (const side of ['left', 'right'] as const) {
      const shoulder = points[ID[`${side}Shoulder`]];
      if (type === 'missing') shoulder.presence = 0.2;
      if (type === 'leaning') shoulder.x += 0.3;
      if (type === 'inverted') shoulder.y = 0.5;
    }
    const snapshot = new PoseClassifier().update(frame(0, 140, points));
    assert.equal(snapshot.state, 'TRACKING_LOST');
    assert.equal(snapshot.activeKneeAngle, undefined);
  }
});

test('confidence summarizes actual accepted legs and torso', () => {
  const points = landmarks();
  points[ID.leftKnee].presence = 0.7;
  points[ID.rightShoulder].visibility = 0.6;
  const snapshot = new PoseClassifier().update(frame(0, 180, points));
  assert.equal(snapshot.confidence, 0.6);
  assert.equal(snapshot.reliableSides, 2);
});

test('lost frame immediately clears output and starts grace and automatic-rest clocks', () => {
  const classifier = new PoseClassifier();
  confirm(classifier);
  const lost = classifier.update({ timestampMs: 240, inferenceMs: 8, poseFps: 25 });
  assert.equal(lost.state, 'TRACKING_LOST');
  assert.equal(lost.activeKneeAngle, undefined);
  assert.equal(lost.candidateState, undefined);
  assert.equal(lost.confidence, 0);
  assert.equal(lost.trackingLostMs, 0);
  assert.equal(classifier.snapshot(840).trackingLostMs, POSE_CONFIG.lossGraceMs);
  assert.equal(classifier.snapshot(3239).autoRestRecommended, false);
  assert.equal(classifier.snapshot(3240).autoRestRecommended, true);
  assert.equal(classifier.update(frame(3280)).state, 'TRANSITION');
});

test('snapshot expires results without needing another inference frame', () => {
  const classifier = new PoseClassifier();
  confirm(classifier);
  assert.equal(classifier.snapshot(450).state, 'STANDING');
  const stale = classifier.snapshot(451);
  assert.equal(stale.state, 'TRACKING_LOST');
  assert.equal(stale.trackingLostMs, 1);
  assert.equal(stale.activeKneeAngle, undefined);
  assert.equal(classifier.snapshot(3450).autoRestRecommended, true);
});

test('old or repeated timestamps cannot extend a confirmed state', () => {
  const classifier = new PoseClassifier();
  confirm(classifier);
  assert.equal(classifier.update(frame(200), 240).state, 'TRACKING_LOST');
  assert.equal(classifier.update(frame(300), 600).state, 'TRACKING_LOST');
  assert.equal(classifier.update(frame(700), 650).state, 'TRACKING_LOST');
});

test('EMA is deterministic, resettable and starts from the first accepted sample', () => {
  const smoother = new PoseSmoother();
  assert.equal(smoother.update(180), 180);
  assert.equal(smoother.update(140), 166);
  smoother.reset();
  assert.equal(smoother.update(140), 140);
  assert.ok(Number.isNaN(smoother.update(NaN)));
  assert.equal(smoother.update(145), 145);
  assert.throws(() => new PoseSmoother(0));
});

test('personal thresholds classify limited standing extension without the default 165 degree gate', () => {
  const classifier = new PoseClassifier();
  confirm(classifier, 155);
  assert.equal(classifier.snapshot(200).state, 'TRANSITION');
  classifier.setCalibration(profileC);
  assert.equal(classifier.snapshot(200).state, 'UNKNOWN');
  assert.equal(classifier.update(frame(240, 155)).state, 'TRANSITION');
  assert.equal(classifier.update(frame(400, 155)).state, 'TRANSITION');
  assert.equal(classifier.update(frame(440, 155)).state, 'STANDING');
  classifier.reset();
  confirm(classifier, 135, 480);
  assert.equal(classifier.snapshot(680).state, 'BENDING');
  classifier.reset();
  confirm(classifier, 146, 720);
  assert.equal(classifier.snapshot(920).state, 'TRANSITION');
});

test('threshold replacement restarts smoothing and debounce, while ordinary resets retain calibration', () => {
  const classifier = new PoseClassifier();
  confirm(classifier);
  classifier.setCalibration(profileC);
  assert.equal(classifier.update(frame(240, 155)).candidateMs, 0);
  assert.equal(classifier.update(frame(400, 155)).state, 'TRANSITION');
  assert.equal(classifier.update(frame(440, 155)).state, 'STANDING');
  classifier.reset();
  assert.deepEqual(classifier.getCalibration(), profileC);
  confirm(classifier, 155, 480);
  assert.equal(classifier.snapshot(680).state, 'STANDING');
  classifier.setCalibration(undefined);
  assert.equal(classifier.getCalibration(), undefined);
  confirm(classifier, 155, 720);
  assert.equal(classifier.snapshot(920).state, 'TRANSITION');
  classifier.reset();
  confirm(classifier, 145, 960);
  assert.equal(classifier.snapshot(1160).state, 'BENDING');
});

test('calibration profiles are copied on both assignment and retrieval', () => {
  const classifier = new PoseClassifier();
  const supplied = { ...profileC };
  classifier.setCalibration(supplied);
  supplied.standingThreshold = 179;
  const retrieved = classifier.getCalibration()!;
  retrieved.standingThreshold = 179;
  assert.deepEqual(classifier.getCalibration(), profileC);
  confirm(classifier, 155);
  assert.equal(classifier.snapshot(200).state, 'STANDING');
});

test('invalid calibration is rejected atomically rather than replacing a valid session profile', () => {
  const classifier = new PoseClassifier();
  classifier.setCalibration(profileC);
  confirm(classifier, 155);
  for (const invalid of [
    { ...profileC, standingAngle: NaN },
    { ...profileC, standingThreshold: 141 },
    { ...profileC, range: 1 },
    { ...profileC, bendingThreshold: -10 },
  ]) {
    assert.throws(() => classifier.setCalibration(invalid), RangeError);
    assert.deepEqual(classifier.getCalibration(), profileC);
    assert.equal(classifier.snapshot(200).state, 'STANDING');
  }
});

test('asymmetric per-leg ranges remain valid and use the fused personal thresholds', () => {
  const classifier = new PoseClassifier();
  const asymmetric: CalibrationProfile = { ...profileC,
    leftStanding: 165, rightStanding: 145, leftBending: 135, rightBending: 135,
    leftRange: 30, rightRange: 10,
  };
  classifier.setCalibration(asymmetric);
  const points = landmarks(165);
  points[ID.rightAnkle] = landmarks(145)[ID.rightAnkle];
  let snapshot = classifier.update(frame(0, 165, points));
  for (let time = 40; time <= 200; time += 40) snapshot = classifier.update(frame(time, 165, points));
  assert.ok(Math.abs(snapshot.activeKneeAngle! - 155) < 1e-9);
  assert.equal(snapshot.state, 'STANDING');
  assert.deepEqual(classifier.getCalibration(), asymmetric);
});

test('a calibrated single-leg cohort stays fixed when the other leg enters the frame', () => {
  const classifier = new PoseClassifier();
  classifier.setCalibration({ ...profileC, reliableSide: 'left',
    leftStanding: 155, leftBending: 135, leftRange: 20 });
  const points = landmarks(155);
  points[ID.rightAnkle] = landmarks(135)[ID.rightAnkle];
  let snapshot = classifier.update(frame(0, 155, points));
  for (let time = 40; time <= 200; time += 40) snapshot = classifier.update(frame(time, 155, points));
  assert.equal(snapshot.state, 'STANDING');
  assert.ok(Math.abs(snapshot.activeKneeAngle! - 155) < 1e-9);
  assert.equal(snapshot.reliableSides, 1);
  points[ID.leftAnkle].visibility = 0;
  snapshot = classifier.update(frame(240, 155, points));
  assert.equal(snapshot.state, 'TRACKING_LOST');
  assert.equal(snapshot.reason, 'calibrated-legs-unavailable');
});

test('a two-leg calibration freezes on a missing leg instead of changing the fused angle basis', () => {
  const classifier = new PoseClassifier();
  classifier.setCalibration({ ...profileC, reliableSide: 'both',
    leftStanding: 165, rightStanding: 145, leftBending: 135, rightBending: 135,
    leftRange: 30, rightRange: 10 });
  confirm(classifier, 155);
  const points = landmarks(155);points[ID.rightAnkle].visibility = 0;
  assert.equal(classifier.update(frame(240, 155, points)).state, 'TRACKING_LOST');
  assert.equal(classifier.update(frame(280, 155)).state, 'TRANSITION');
  assert.equal(classifier.update(frame(440, 155)).state, 'TRANSITION');
  assert.equal(classifier.update(frame(480, 155)).state, 'STANDING');
});
