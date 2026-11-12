import assert from 'node:assert/strict';
import test from 'node:test';
import { HumanPoseExtractor, type HumanPose } from '../src/game/mocap/HumanPoseExtractor';
import { MotionRetargeter } from '../src/game/mocap/MotionRetargeter';
import { MotionSmoother } from '../src/game/mocap/MotionSmoother';
import { neutralRabbitPose } from '../src/game/mocap/RabbitPose';
import type { CalibrationProfile } from '../src/game/calibration/calibrationTypes';
import type { PoseFrame, PoseLandmark, PoseSnapshot } from '../src/game/vision/poseTypes';

const profile: CalibrationProfile = {
  standingAngle: 170, bendingAngle: 140, range: 30, standingThreshold: 164,
  bendingThreshold: 150.5, reliableSide: 'both', timestamp: 0,
};
const snapshot: PoseSnapshot = {
  state: 'STANDING', leftKneeAngle: 170, rightKneeAngle: 170, activeKneeAngle: 170,
  confidence: 1, reliableSides: 2, candidateMs: 200, timestampMs: 640, inferenceMs: 4,
  poseFps: 25, trackingLostMs: 0, autoRestRecommended: false,
};
function frame(inward: boolean, reverseShoulders = false): PoseFrame {
  const points: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 0 }));
  const point = (x: number, y: number, z = 0): PoseLandmark => ({ x, y, z, visibility: 1, presence: 1 });
  for (const [shoulder, elbow, wrist, hip, knee, ankle, sign] of [
    [11, 13, 15, 23, 25, 27, reverseShoulders ? 1 : -1],
    [12, 14, 16, 24, 26, 28, reverseShoulders ? -1 : 1],
  ]) {
    const x = .5 + sign * .15;
    const direction = inward ? -sign : sign;
    points[shoulder] = point(x, .2);
    points[elbow] = point(x + direction * .08, .23, -.07);
    points[wrist] = point(x + direction * .16, .26, -.14);
    points[hip] = point(x, .5);
    points[knee] = point(x, .7);
    points[ankle] = point(x, .9);
  }
  return { landmarks: points, timestampMs: 640, imageWidth: 1000, imageHeight: 1000, inferenceMs: 4, poseFps: 25 };
}
function human(timestampMs: number, plane = 0): HumanPose {
  return { leftArmElevation: 0, rightArmElevation: 0, leftElbowBend: 0, rightElbowBend: 0,
    leftArmPlane: plane, rightArmPlane: plane, leftArmConfidence: 1, rightArmConfidence: 1,
    torsoLean: 0, activeKneeAngle: 170, centerX: .5, bodyScale: .3, trackingConfidence: 1, timestampMs };
}
function ready(maximumPlane = 90) {
  const mapper = new MotionRetargeter(maximumPlane);
  for (let time = 0; time <= 600; time += 40) mapper.update(human(time), profile);
  assert.equal(mapper.snapshot.referenceReady, true);
  return mapper;
}

test('Opt-in extractor preserves inward arm direction on both anatomical sides', () => {
  for (const reverse of [false, true]) {
    const input = frame(true, reverse);
    const inward = new HumanPoseExtractor(true).extract(input, snapshot, profile)!;
    const legacy = new HumanPoseExtractor().extract(input, snapshot, profile)!;
    assert.ok(inward.leftArmPlane! > 90 && inward.rightArmPlane! > 90);
    assert.ok(legacy.leftArmPlane! <= 90 && legacy.rightArmPlane! <= 90);
    assert.equal(inward.leftArmElevation, legacy.leftArmElevation);
    assert.equal(inward.leftElbowBend, legacy.leftElbowBend);
  }
});

test('Opt-in extractor retains outward and forward ranges and filters missing arms', () => {
  const input = frame(false);
  const enabled = new HumanPoseExtractor(true).extract(input, snapshot, profile)!;
  const legacy = new HumanPoseExtractor().extract(input, snapshot, profile)!;
  assert.equal(enabled.leftArmPlane, legacy.leftArmPlane);
  assert.equal(enabled.rightArmPlane, legacy.rightArmPlane);
  (input.landmarks as PoseLandmark[])[13].visibility = .1;
  const missing = new HumanPoseExtractor(true).extract(input, snapshot, profile)!;
  assert.equal(missing.leftArmPlane, undefined);
  assert.ok(missing.rightArmPlane! <= 90);
});

test('Inward retargeting is opt-in, bounded and uses the existing standing reference', () => {
  const before = JSON.stringify(profile);
  assert.equal(ready().update(human(640, 140), profile), undefined);
  const mapper = ready(145);
  const mapped = mapper.update(human(640, 170), profile)!;
  assert.equal(mapped.leftArmPlane, 145);
  assert.equal(mapped.rightArmPlane, 145);
  assert.equal(mapped.bendAmount, 0);
  assert.equal(mapper.reference?.timestampMs, 600);
  assert.equal(JSON.stringify(profile), before);
  assert.equal(mapper.update(human(680, NaN), profile), undefined);
});

test('Existing target slew carries inward planes only for the enabled preview', () => {
  const pose = { ...neutralRabbitPose(), leftArmPlane: 145, rightArmPlane: 145 };
  const legacy = new MotionSmoother(true);
  const enabled = new MotionSmoother(true, 145);
  for (let frame = 0; frame < 90; frame++) {
    legacy.update(pose, 1 / 60);
    enabled.update(pose, 1 / 60);
  }
  assert.equal(legacy.pose.leftArmPlane, 90);
  assert.equal(enabled.pose.leftArmPlane, 145);
  assert.equal(enabled.pose.rightArmPlane, 145);
});
