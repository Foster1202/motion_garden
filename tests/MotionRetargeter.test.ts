import assert from 'node:assert/strict';
import test from 'node:test';
import { HumanPoseExtractor, type HumanPose } from '../src/game/mocap/HumanPoseExtractor';
import { MotionRetargeter } from '../src/game/mocap/MotionRetargeter';
import { neutralRabbitPose } from '../src/game/mocap/RabbitPose';
import type { CalibrationProfile } from '../src/game/calibration/calibrationTypes';
import type { PoseFrame, PoseLandmark, PoseSnapshot } from '../src/game/vision/poseTypes';
const profile: CalibrationProfile = {
  standingAngle: 170, bendingAngle: 140, range: 30, standingThreshold: 164, bendingThreshold: 150.5, timestamp: 100,
  reliableSide: 'both', leftStanding: 170, rightStanding: 170, leftBending: 140, rightBending: 140, leftRange: 30, rightRange: 30,
};
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function human(timestampMs: number, changes: Partial<HumanPose> = {}): HumanPose {
  return { leftArmElevation: 0, rightArmElevation: 0, leftElbowBend: 0, rightElbowBend: 0,
    leftArmConfidence: 1, rightArmConfidence: 1, torsoLean: 0, activeKneeAngle: 170,
    centerX: 0.5, bodyScale: 0.2, trackingConfidence: 1, timestampMs, ...changes };
}
function ready(changes: Partial<HumanPose> = {}): MotionRetargeter {
  const mapper = new MotionRetargeter();
  for (let time = 0; time <= 600; time += 40) mapper.update(human(time, changes), profile);
  assert.equal(mapper.snapshot.referenceReady, true); return mapper;
}
function frame(leftDegrees = 0, rightDegrees = 0, width = 1600, height = 900): PoseFrame {
  const points: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0, presence: 0 }));
  const set = (i: number, x: number, y: number) => { points[i] = { x: x / width, y: y / height, visibility: 1, presence: 1 }; };
  for (const [shoulder, elbow, wrist, hip, knee, ankle, x, degrees, sign] of [
    [11, 13, 15, 23, 25, 27, width * 0.4, leftDegrees, -1], [12, 14, 16, 24, 26, 28, width * 0.6, rightDegrees, 1],
  ]) {
    const sy = height * 0.2; const angle = degrees * Math.PI / 180;
    const length = Math.min(width, height) * 0.10;
    const dx = sign * length * Math.sin(angle); const dy = length * Math.cos(angle);
    set(shoulder, x, sy); set(elbow, x + dx, sy + dy); set(wrist, x + 2 * dx, sy + 2 * dy);
    set(hip, x, height * 0.5); set(knee, x, height * 0.7); set(ankle, x, height * 0.9);
  }
  return { landmarks: points, timestampMs: 640, inferenceMs: 5, poseFps: 25, imageWidth: width, imageHeight: height };
}
function snapshot(changes: Partial<PoseSnapshot> = {}): PoseSnapshot {
  return { state: 'STANDING', leftKneeAngle: 170, rightKneeAngle: 170, activeKneeAngle: 170,
    confidence: 1, reliableSides: 2, candidateMs: 200, timestampMs: 640, inferenceMs: 5, poseFps: 25,
    trackingLostMs: 0, autoRestRecommended: false, ...changes };
}
test('anatomical left/right IDs remain unchanged by CSS mirror and drive independent rabbit arms', () => {
  const extractor = new HumanPoseExtractor();
  const left = extractor.extract(frame(70, 0), snapshot(), profile)!;
  close(left.leftArmElevation!, 70); close(left.rightArmElevation!, 0);
  const right = extractor.extract(frame(0, 45), snapshot(), profile)!;
  close(right.leftArmElevation!, 0); close(right.rightArmElevation!, 45);
  const both = extractor.extract(frame(35, 60), snapshot(), profile)!;
  const target = ready().update(both, profile)!;
  close(target.leftArmElevation, 35); close(target.rightArmElevation, 60);
});
test('arms are continuous and aspect-correct across landscape and portrait image geometry', () => {
  const extractor = new HumanPoseExtractor();
  for (const angle of [0, 20, 40, 60, 90, 110]) {
    const a = extractor.extract(frame(angle, angle, 1600, 900), snapshot(), profile)!;
    const b = extractor.extract(frame(angle, angle, 900, 1600), snapshot(), profile)!;
    close(a.leftArmElevation!, angle); close(b.leftArmElevation!, angle); close(a.leftElbowBend!, 0);
  }
});
test('classifier EMA knee value preserves fixed calibrated leg cohort', () => {
  const extractor = new HumanPoseExtractor(); const single: CalibrationProfile = { ...profile, reliableSide: 'left' };
  const pose = snapshot({ leftKneeAngle: 155, rightKneeAngle: 110, activeKneeAngle: 155, reliableSides: 1 });
  close(extractor.extract(frame(), pose, single)!.activeKneeAngle, 155);
  assert.equal(extractor.extract(frame(), { ...pose, activeKneeAngle: 132.5 }, single), undefined);
  assert.equal(extractor.extract(frame(), { ...pose, leftKneeAngle: undefined }, single), undefined);
});
test('elbow flexion is continuous projected 180-minus-inner-angle and rejects collapsed segments', () => {
  const extractor = new HumanPoseExtractor();
  const raw = frame(); const points = raw.landmarks as PoseLandmark[];
  points[15] = { ...points[13], x: points[13].x + 90 / 1600 };
  close(extractor.extract(raw, snapshot(), profile)!.leftElbowBend!, 90);
  points[15] = { ...points[13] };
  assert.equal(extractor.extract(raw, snapshot(), profile)!.leftElbowBend, undefined);
});
test('per-arm confidence filtering preserves the other arm and rejects malformed torso or knees', () => {
  const extractor = new HumanPoseExtractor(); const raw = frame(60, 30); const points = raw.landmarks as PoseLandmark[];
  points[13].visibility = 0.1; const pose = extractor.extract(raw, snapshot(), profile)!;
  assert.equal(pose.leftArmElevation, undefined); close(pose.rightArmElevation!, 30);
  points[11].x = NaN; assert.equal(extractor.extract(raw, snapshot(), profile), undefined);
  const kneeRaw = frame(); const knees = kneeRaw.landmarks as PoseLandmark[]; knees[25] = { ...knees[23] };
  assert.equal(extractor.extract(kneeRaw, snapshot(), profile), undefined);
  assert.equal(extractor.extract(frame(), snapshot({ state: 'TRACKING_LOST' }), profile), undefined);
});
test('signed torso lean uses raw shoulder versus hip center and aspect-correct pixels', () => {
  const extractor = new HumanPoseExtractor();
  for (const sign of [-1, 1]) {
    const raw = frame(); const points = raw.landmarks as PoseLandmark[];
    points[11].x += sign * 0.03; points[12].x += sign * 0.03;
    const extracted = extractor.extract(raw, snapshot(), profile)!;
    close(extracted.torsoLean, Math.atan2(sign * 48, 270) * 180 / Math.PI);
    assert.equal(Math.sign(ready().update(extracted, profile)!.torsoLean), sign);
  }
});
test('reference requires 600ms stable relaxed standing and reset clears runtime reference', () => {
  const mapper = new MotionRetargeter();
  for (let time = 0; time <= 800; time += 40) assert.equal(mapper.update(human(time, { leftArmElevation: 50 }), profile), undefined);
  for (let time = 840; time < 1440; time += 40) assert.equal(mapper.update(human(time), profile), undefined);
  assert.equal(mapper.update(human(1440), profile)!.bendAmount, 0);
  const reference = mapper.reference!; reference.centerX = 0; close(mapper.reference!.centerX, 0.5);
  mapper.resetReference(); assert.equal(mapper.reference, undefined);
  assert.equal(mapper.update(human(1500), profile), undefined);
});
test('natural reference offsets are subtracted while personal calibration remains untouched', () => {
  const before = JSON.stringify(profile); const mapper = ready({ leftArmElevation: 5, torsoLean: 4, leftElbowBend: 6 });
  const result = mapper.update(human(640, { leftArmElevation: 25, torsoLean: 9, leftElbowBend: 26 }), profile)!;
  close(result.leftArmElevation, 20); close(result.torsoLean, 5); close(result.leftElbowBend, 20);
  assert.equal(JSON.stringify(profile), before);
});
test('bend continuously uses exact calibrated standingAngle/range and clamps comfortable extremes', () => {
  const mapper = ready();
  for (const [i, angle] of [170, 162.5, 155, 147.5, 140, 130, 175].entries()) {
    close(mapper.update(human(640 + i * 40, { activeKneeAngle: angle }), profile)!.bendAmount,
      Math.max(0, Math.min(1, (170 - angle) / 30)));
  }
});
test('relative shoulder-width translation has deadzone, mirrored sign, clamp and return without drift', () => {
  const mapper = ready(); close(mapper.update(human(640, { centerX: 0.505 }), profile)!.lateralOffset, 0);
  const left = mapper.update(human(680, { centerX: 0.45 }), profile)!.lateralOffset;
  const right = mapper.update(human(720, { centerX: 0.55 }), profile)!.lateralOffset;
  assert.ok(left > 0); close(left, -right);
  close(mapper.update(human(760, { centerX: 0.3 }), profile)!.lateralOffset, 0.45);
  close(mapper.update(human(800), profile)!.lateralOffset, 0);
});
test('joint limits and missing-arm hold never emit invalid values or unsafe range', () => {
  const mapper = ready(); const result = mapper.update(human(640,
    { leftArmElevation: 180, rightArmElevation: 170, leftElbowBend: 150, torsoLean: 45 }), profile)!;
  close(result.leftArmElevation, 115); close(result.leftElbowBend, 55); close(result.torsoLean, 14);
  const held = mapper.update(human(680, { leftArmElevation: undefined, leftElbowBend: undefined,
    leftArmConfidence: 0, rightArmElevation: 40 }), profile)!;
  close(held.leftArmElevation, 115); close(held.rightArmElevation, 40);
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(mapper.update(human(720, { torsoLean: value }), profile), undefined);
  assert.ok(Object.values(neutralRabbitPose(NaN)).every(Number.isFinite));
});
test('calibration changes and large camera scale changes require fresh reference', () => {
  const mapper = ready(); assert.equal(mapper.update(human(640, { bodyScale: 0.3 }), profile), undefined);
  assert.equal(mapper.snapshot.requiresReset, true); assert.equal(mapper.update(human(680), profile), undefined);
  mapper.resetReference(); for (let time = 720; time <= 1320; time += 40) mapper.update(human(time), profile);
  assert.equal(mapper.snapshot.referenceReady, true);
  assert.equal(mapper.update(human(1360), { ...profile, timestamp: 101 }), undefined);
  assert.equal(mapper.snapshot.referenceReady, false);
});
test('short arm occlusion holds, sustained occlusion targets neutral, and fresh tracking restores independently', () => {
  const mapper = ready();
  mapper.update(human(640, { leftArmElevation: 80, leftElbowBend: 30 }), profile);
  const missing: Partial<HumanPose> = { leftArmElevation: undefined, leftElbowBend: undefined,
    leftArmConfidence: 0, rightArmElevation: 40, torsoLean: 6, activeKneeAngle: 155 };
  for (const time of [680, 880, 1080, 1240]) {
    const held = mapper.update(human(time, missing), profile)!;
    close(held.leftArmElevation, 80); close(held.leftElbowBend, 30);
    close(held.rightArmElevation, 40); close(held.torsoLean, 6); close(held.bendAmount, 0.5);
  }
  const neutral = mapper.update(human(1280, missing), profile)!;
  close(neutral.leftArmElevation, 0); close(neutral.leftElbowBend, 0); close(neutral.rightArmElevation, 40);
  const restored = mapper.update(human(1320, { leftArmElevation: 55, leftElbowBend: 20, rightArmElevation: 40 }), profile)!;
  close(restored.leftArmElevation, 55); close(restored.leftElbowBend, 20); close(restored.rightArmElevation, 40);
});
test('reference cannot bridge timestamp reversal, long gaps, unstable center, or crouching', () => {
  const mapper = new MotionRetargeter(); mapper.update(human(0), profile); mapper.update(human(200), profile);
  assert.equal(mapper.update(human(100), profile), undefined); assert.equal(mapper.update(human(600), profile), undefined);
  assert.equal(mapper.snapshot.referenceProgress, 0);
  assert.equal(mapper.update(human(640, { centerX: 0.55 }), profile), undefined); assert.equal(mapper.snapshot.referenceProgress, 0);
  assert.equal(mapper.update(human(680, { activeKneeAngle: 150 }), profile), undefined); assert.equal(mapper.snapshot.referenceProgress, 0);
});
