import assert from 'node:assert/strict';
import test from 'node:test';
import { HumanPoseExtractor, type HumanPose } from '../src/game/mocap/HumanPoseExtractor';
import { MotionRetargeter } from '../src/game/mocap/MotionRetargeter';
import { neutralRabbitPose } from '../src/game/mocap/RabbitPose';
import type { KneeCalibrationProfile, PartialCalibrationProfile } from '../src/game/calibration/calibrationTypes';
import { partialMotionRange } from '../src/game/calibration/calibrationMath';
import type { PoseFrame, PoseLandmark, PoseSnapshot } from '../src/game/vision/poseTypes';
import { RABBIT_3D_CONFIG } from '../src/game/3d/rabbit3dConfig';
const profile: KneeCalibrationProfile = {
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
  const extractor = new HumanPoseExtractor(); const single: KneeCalibrationProfile = { ...profile, reliableSide: 'left' };
  const pose = snapshot({ leftKneeAngle: 155, rightKneeAngle: 110, activeKneeAngle: 155, reliableSides: 1 });
  close(extractor.extract(frame(), pose, single)!.activeKneeAngle!, 155);
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
  close(result.leftArmElevation, RABBIT_3D_CONFIG.limits.arm.max);
  close(result.leftElbowBend, RABBIT_3D_CONFIG.limits.forearm.max); close(result.torsoLean, 18);
  const held = mapper.update(human(680, { leftArmElevation: undefined, leftElbowBend: undefined,
    leftArmConfidence: 0, rightArmElevation: 40 }), profile)!;
  close(held.leftArmElevation, RABBIT_3D_CONFIG.limits.arm.max); close(held.rightArmElevation, 40);
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


test('monocular forward reach uses depth when image-plane arm segments collapse', () => {
  const raw = frame();
  const points = raw.landmarks as PoseLandmark[];
  points.forEach(point => { point.z = 0; });
  for (const [shoulder, elbow, wrist] of [[11, 13, 15], [12, 14, 16]]) {
    points[elbow] = { ...points[shoulder], z: -0.1 };
    points[wrist] = { ...points[shoulder], z: -0.2 };
  }
  const extracted = new HumanPoseExtractor().extract(raw, snapshot(), profile)!;
  close(extracted.leftArmElevation!, 90); close(extracted.rightArmElevation!, 90);
  close(extracted.leftArmPlane!, 90); close(extracted.rightArmPlane!, 90);
  close(extracted.leftElbowBend!, 0);
  const target = ready().update(extracted, profile)!;
  close(target.leftArmElevation, 90); close(target.leftArmPlane, 90);
});

test('optional forward and face cues preserve direction and subtract stable reference offsets', () => {
  const mapper = ready({ torsoForward: 12, headYaw: -3, headPitch: 5 });
  const target = mapper.update(human(640, { torsoForward: 22, headYaw: 17, headPitch: 12 }), profile)!;
  close(target.torsoForward, 10); close(target.headYaw, 20); close(target.headPitch, 7);
  const noDepth = mapper.update(human(680), profile)!;
  close(noDepth.torsoForward, 0); close(noDepth.headYaw, 0); close(noDepth.headPitch, 0);
  for (const bad of [NaN, Infinity, 91]) {
    assert.equal(mapper.update(human(720, { leftArmPlane: bad }), profile), undefined);
  }
});

test('forward torso and mirrored head direction are extracted from bounded image cues', () => {
  const raw = frame();
  const points = raw.landmarks as PoseLandmark[];
  points.forEach(point => { point.z = 0; });
  points[11].z = points[12].z = -0.05;
  points[7] = { x: 0.45, y: 0.15, visibility: 1 };
  points[8] = { x: 0.55, y: 0.15, visibility: 1 };
  points[0] = { x: 0.52, y: 0.17, visibility: 1 };
  const extracted = new HumanPoseExtractor().extract(raw, snapshot(), profile)!;
  close(extracted.torsoForward!, Math.atan2(80, 270) * 180 / Math.PI);
  assert.ok(extracted.headYaw! < 0); assert.ok(extracted.headPitch! > 0);
});

test('combined arm planes, torso and calibrated knees vary continuously without overwriting channels', () => {
  const mapper = ready();
  for (let index = 0; index <= 20; index++) {
    const amount = index / 20;
    const target = mapper.update(human(640 + 40 * index, {
      leftArmElevation: 145 * amount, rightArmElevation: 110 * amount,
      leftArmPlane: 90 * amount, rightArmPlane: 45 * amount,
      leftElbowBend: 100 * amount, torsoLean: -18 * amount,
      torsoForward: 16 * amount, activeKneeAngle: 170 - 30 * amount,
    }), profile)!;
    close(target.leftArmElevation, Math.min(RABBIT_3D_CONFIG.limits.arm.max, 145 * amount));
    close(target.rightArmElevation, Math.min(RABBIT_3D_CONFIG.limits.arm.max, 110 * amount));
    close(target.leftArmPlane, 90 * amount); close(target.leftElbowBend, 100 * amount);
    close(target.torsoLean, -18 * amount); close(target.torsoForward, 16 * amount);
    close(target.bendAmount, amount);
  }
});

test('relaxed projected arms acquire despite monocular depth inflating 3D elevation and elbow bend', () => {
  const extractor = new HumanPoseExtractor();
  const mapper = new MotionRetargeter();
  let last!: HumanPose;
  for (let time = 0; time <= 600; time += 40) {
    const raw = frame();
    raw.timestampMs = time;
    const points = raw.landmarks as PoseLandmark[];
    points.forEach(point => { point.z = 0; });
    const noise = time % 80 === 0 ? .008 : -.008;
    for (const [elbow, wrist] of [[13, 15], [14, 16]]) {
      points[elbow].z = -.075 + noise;
      points[wrist].z = -.02 - noise;
    }
    last = extractor.extract(raw, snapshot({ timestampMs: time }), profile)!;
    assert.ok(last.leftArmElevation! > 25);
    assert.ok(last.leftElbowBend! > 35);
    close(last.leftArmProjectedElevation!, 0);
    close(last.leftElbowProjectedBend!, 0);
    mapper.update(last, profile);
  }
  assert.equal(mapper.snapshot.referenceReady, true);
  assert.equal(mapper.snapshot.referenceProgress, 1);
  assert.ok(mapper.reference!.leftArmElevation > 25);
  assert.ok(mapper.reference!.leftElbowBend > 35);
});

test('image-plane reference gates still reject clear lateral raises and foreshortened forward reaches', () => {
  for (const forward of [false, true]) {
    const mapper = new MotionRetargeter();
    const extractor = new HumanPoseExtractor();
    for (let time = 0; time <= 1000; time += 40) {
      const raw = frame(forward ? 0 : 70, forward ? 0 : 70);
      raw.timestampMs = time;
      const points = raw.landmarks as PoseLandmark[];
      if (forward) {
        points.forEach(point => { point.z = 0; });
        for (const [shoulder, elbow, wrist] of [[11, 13, 15], [12, 14, 16]]) {
          points[elbow] = { ...points[shoulder], z: -.1 };
          points[wrist] = { ...points[shoulder], z: -.2 };
        }
      }
      const rawHuman = extractor.extract(raw, snapshot({ timestampMs: time }), profile)!;
      assert.equal(mapper.update(rawHuman, profile), undefined);
    }
    assert.equal(mapper.snapshot.referenceReady, false);
    assert.match(mapper.snapshot.rejectionReason!, forward ? /projected-upper-length-min/ : /ProjectedElevation-max/);
  }
});

test('one confidence dropout preserves accepted reference progress and receives no capture credit', () => {
  const mapper = new MotionRetargeter();
  for (let time = 0; time <= 320; time += 40) mapper.update(human(time), profile);
  const previous = mapper.snapshot;
  assert.ok(previous.referenceProgress > .5);
  mapper.update(human(360, { leftArmConfidence: .1 }), profile);
  close(mapper.snapshot.referenceProgress, previous.referenceProgress);
  assert.equal(mapper.snapshot.acceptedSamples, previous.acceptedSamples);
  assert.match(mapper.snapshot.rejectionReason!, /left-arm-confidence-min 0.10/);
  mapper.update(human(400), profile);
  close(mapper.snapshot.referenceProgress, previous.referenceProgress);
  for (let time = 440; time <= 680; time += 40) mapper.update(human(time), profile);
  assert.equal(mapper.snapshot.referenceReady, true);
});

test('isolated center outlier retains progress while sustained movement starts a fresh stable cluster', () => {
  const mapper = new MotionRetargeter();
  for (let time = 0; time <= 320; time += 40) mapper.update(human(time), profile);
  const progress = mapper.snapshot.referenceProgress;
  mapper.update(human(360, { centerX: .6 }), profile);
  close(mapper.snapshot.referenceProgress, progress);
  assert.match(mapper.snapshot.rejectionReason!, /center-spread-max/);
  for (let time = 400; time <= 640; time += 40) mapper.update(human(time, { centerX: .6 }), profile);
  assert.equal(mapper.snapshot.referenceProgress, 0);
  for (let time = 680; time <= 1280; time += 40) mapper.update(human(time, { centerX: .6 }), profile);
  assert.equal(mapper.snapshot.referenceReady, true);
  close(mapper.reference!.centerX, .6);
});

test('prolonged bent or raised posture reports failed conditions then recovers without recalibration', () => {
  const mapper = new MotionRetargeter();
  const before = JSON.stringify(profile);
  for (let time = 0; time <= 1600; time += 40) mapper.update(human(time, { activeKneeAngle: 150 }), profile);
  assert.equal(mapper.snapshot.referenceReady, false);
  assert.equal(mapper.snapshot.acceptedSamples, 0);
  assert.ok(mapper.snapshot.conditions.some(condition => condition.name === 'standing-knee-min' && !condition.pass));
  for (let time = 1640; time <= 2240; time += 40) mapper.update(human(time), profile);
  assert.equal(mapper.snapshot.referenceReady, true);
  assert.equal(JSON.stringify(profile), before);
  const status = mapper.snapshot;
  status.conditions[0].pass = false;
  assert.equal(mapper.snapshot.conditions[0].pass, true);
});

test('reference offsets use medians of reliable samples while projected posture stays stable', () => {
  const mapper = new MotionRetargeter();
  const angles = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 70];
  for (const [index, angle] of angles.entries()) mapper.update(human(index * 40, {
    leftArmElevation: angle, leftArmProjectedElevation: 2,
  }), profile);
  assert.equal(mapper.snapshot.referenceReady, true);
  close(mapper.reference!.leftArmElevation, 10);
});

test('extractor rejection identifies classifier, confidence and malformed knee stages', () => {
  const extractor = new HumanPoseExtractor();
  assert.equal(extractor.extract(frame(), snapshot({ state: 'TRACKING_LOST' }), profile), undefined);
  assert.equal(extractor.lastRejection, 'classifier-TRACKING_LOST');
  const raw = frame();
  (raw.landmarks as PoseLandmark[])[11].visibility = .1;
  assert.equal(extractor.extract(raw, snapshot(), profile), undefined);
  assert.match(extractor.lastRejection!, /torso-confidence 0.1 < 0.65/);
  assert.ok(extractor.extract(frame(), snapshot(), profile));
  assert.equal(extractor.lastRejection, undefined);
});


test('a short malformed depth cue cannot discard otherwise valid reference progress', () => {
  const mapper = new MotionRetargeter();
  for (let time = 0; time <= 320; time += 40) mapper.update(human(time), profile);
  const progress = mapper.snapshot.referenceProgress;
  mapper.update(human(360, { torsoForward: NaN }), profile);
  close(mapper.snapshot.referenceProgress, progress);
  assert.equal(mapper.snapshot.rejectionReason, 'invalid-human-pose');
  mapper.update(human(400), profile);
  close(mapper.snapshot.referenceProgress, progress);
  for (let time = 440; time <= 680; time += 40) mapper.update(human(time), profile);
  assert.equal(mapper.snapshot.referenceReady, true);
});


test('partially foreshortened forward arms cannot masquerade as relaxed image-plane posture', () => {
  const mapper = new MotionRetargeter();
  const extractor = new HumanPoseExtractor();
  for (let time = 0; time <= 1000; time += 40) {
    const raw = frame();
    raw.timestampMs = time;
    const points = raw.landmarks as PoseLandmark[];
    points.forEach(point => { point.z = 0; });
    for (const [shoulder, elbow, wrist] of [[11, 13, 15], [12, 14, 16]]) {
      const projectedStep = .08 * 270 / 900;
      points[elbow] = { ...points[shoulder], y: points[shoulder].y + projectedStep, z: -.135 };
      points[wrist] = { ...points[shoulder], y: points[shoulder].y + projectedStep * 2, z: -.27 };
    }
    const extracted = extractor.extract(raw, snapshot({ timestampMs: time }), profile)!;
    close(extracted.leftArmProjectedElevation!, 0);
    close(extracted.leftArmProjectedLength!, .08);
    assert.ok(extracted.leftArmElevation! > 80);
    assert.equal(mapper.update(extracted, profile), undefined);
  }
  assert.equal(mapper.snapshot.referenceReady, false);
  assert.match(mapper.snapshot.rejectionReason!, /left-projected-upper-length-min 0.08.*0.20/);
});

test('rejected whole frames do not contribute time to reference capture and cannot mutate a captured reference', () => {
  const mapper = new MotionRetargeter();
  for (let time = 0; time <= 1600; time += 40) {
    if (time % 80) mapper.rejectFrame(time, 'torso-confidence');
    else mapper.update(human(time), profile);
  }
  assert.equal(mapper.isReferenceReady, false);
  close(mapper.snapshot.referenceProgress, 0);
  assert.equal(mapper.requiresReferenceReset, false);
  for (let time = 1640; time <= 2280; time += 40) mapper.update(human(time), profile);
  assert.equal(mapper.isReferenceReady, true);
  const reference = mapper.reference;
  const status = mapper.snapshot;
  mapper.rejectFrame(2320, 'torso-confidence');
  assert.deepEqual(mapper.reference, reference);
  assert.deepEqual(mapper.snapshot, status);
});

test('required camera reference reset includes concrete scale and center conditions', () => {
  for (const change of [{ bodyScale: .3 }, { centerX: .9 }]) {
    const mapper = ready();
    assert.equal(mapper.update(human(640, change), profile), undefined);
    assert.equal(mapper.requiresReferenceReset, true);
    assert.match(mapper.snapshot.rejectionReason!, /camera-(scale|center)-shift-max/);
    assert.equal(mapper.snapshot.conditions.length, 2);
    assert.ok(mapper.snapshot.conditions.some(condition => !condition.pass && condition.value! > condition.limit));
  }
});


function depthBiasedArmFrame(timestampMs: number, leftDegrees = 8, rightDegrees = 8): PoseFrame {
  const raw = frame(0, 0, 640, 360);
  raw.timestampMs = timestampMs;
  const points = raw.landmarks as PoseLandmark[];
  points.forEach(point => { point.z = 0; });
  for (const [shoulder, elbow, wrist, angle, sign] of [[11, 13, 15, leftDegrees, -1], [12, 14, 16, rightDegrees, 1]]) {
    const radians = angle * Math.PI / 180;
    const dx = sign * Math.sin(radians) * 46.8 / 640;
    const dy = Math.cos(radians) * 46.8 / 360;
    points[elbow] = { ...points[shoulder], x: points[shoulder].x + dx, y: points[shoulder].y + dy, z: -.075 };
    points[wrist] = { ...points[shoulder], x: points[shoulder].x + dx * 2, y: points[shoulder].y + dy * 2, z: -.15 };
  }
  return raw;
}

test('visible lateral raises overcome a depth-inflated natural arm reference independently', () => {
  const extractor = new HumanPoseExtractor();
  const mapper = new MotionRetargeter();
  const extract = (time: number, left = 8, right = 8) =>
    extractor.extract(depthBiasedArmFrame(time, left, right), snapshot({ timestampMs: time }), profile)!;
  for (let time = 0; time <= 600; time += 40) mapper.update(extract(time), profile);
  assert.equal(mapper.isReferenceReady, true);
  assert.ok(Math.abs(mapper.reference!.leftArmElevation - 46.266) < .1);
  close(mapper.reference!.leftArmProjectedElevation!, 8);
  close(mapper.reference!.rightArmProjectedElevation!, 8);
  const natural = mapper.update(extract(640), profile)!;
  close(natural.leftArmElevation, 0);
  close(natural.rightArmElevation, 0);
  const raised = extract(680, 80, 8);
  const oldDepthChange = raised.leftArmElevation! - mapper.reference!.leftArmElevation;
  assert.ok(oldDepthChange < 40);
  const left = mapper.update(raised, profile)!;
  assert.ok(left.leftArmElevation >= 70);
  close(left.leftArmElevation, 72);
  close(left.rightArmElevation, 0);
  const right = mapper.update(extract(720, 8, 80), profile)!;
  close(right.leftArmElevation, 0);
  close(right.rightArmElevation, 72);
  const both = mapper.update(extract(760, 80, 80), profile)!;
  close(both.leftArmElevation, 72);
  close(both.rightArmElevation, 72);
  for (let time = 800; time <= 1200; time += 40) {
    const stable = mapper.update(extract(time), profile)!;
    close(stable.leftArmElevation, 0);
    close(stable.rightArmElevation, 0);
  }
});

test('legacy references retain depth mapping and invalid projected values do not amplify targets', () => {
  const mapper = ready({ leftArmElevation: 5 });
  assert.equal(mapper.reference!.leftArmProjectedElevation, undefined);
  const legacy = mapper.update(human(640, { leftArmElevation: 35, leftArmProjectedElevation: 80 }), profile)!;
  close(legacy.leftArmElevation, 30);
  const projected = ready({ leftArmElevation: 46.266, leftArmProjectedElevation: 8 });
  for (const [index, value] of [undefined, NaN, -1, 181].entries()) {
    const target = projected.update(human(640 + index * 40, {
      leftArmElevation: 83, leftArmProjectedElevation: value,
    }), profile)!;
    close(target.leftArmElevation, 83 - 46.266);
  }
  const bounded = projected.update(human(800, { leftArmElevation: 83, leftArmProjectedElevation: 180 }), profile)!;
  close(bounded.leftArmElevation, RABBIT_3D_CONFIG.limits.arm.max);
});

test('returning to the original camera volume confirms and resumes the same captured reference', () => {
  const mapper = ready({ leftArmElevation: 5, torsoLean: 3 });
  const original = mapper.reference;
  const calibration = JSON.stringify(profile);
  for (let time = 640; time <= 1600; time += 40) {
    assert.equal(mapper.update(human(time, { bodyScale: .3 }), profile), undefined);
    assert.equal(mapper.requiresReferenceReset, true);
    assert.equal(mapper.snapshot.referenceProgress, 0);
    assert.match(mapper.snapshot.rejectionReason!, /camera-scale-shift-max/);
  }
  for (let time = 1640; time < 2240; time += 40) {
    assert.equal(mapper.update(human(time), profile), undefined);
    assert.equal(mapper.requiresReferenceReset, true);
    assert.match(mapper.snapshot.rejectionReason!, /reference-return-confirmation/);
  }
  const restored = mapper.update(human(2240, { leftArmElevation: 45, torsoLean: 8 }), profile)!;
  assert.equal(mapper.requiresReferenceReset, false);
  assert.equal(mapper.isReferenceReady, true);
  close(restored.leftArmElevation, 40);
  close(restored.torsoLean, 5);
  assert.deepEqual(mapper.reference, original);
  assert.equal(JSON.stringify(profile), calibration);
  assert.equal(mapper.snapshot.rejectionReason, undefined);
});

test('reference return confirmation tolerates bounded noise and gives rejected frames zero time credit', () => {
  const mapper = ready();
  mapper.update(human(640, { centerX: .9 }), profile);
  for (let time = 680; time <= 1000; time += 40) {
    mapper.update(human(time, { centerX: time % 80 === 0 ? .501 : .499 }), profile);
  }
  const progress = mapper.snapshot.referenceProgress;
  assert.ok(progress > .5);
  mapper.rejectFrame(1040, 'unreliable-pose');
  close(mapper.snapshot.referenceProgress, progress);
  assert.match(mapper.snapshot.rejectionReason!, /unreliable-pose/);
  assert.equal(mapper.update(human(1080), profile), undefined);
  close(mapper.snapshot.referenceProgress, progress);
  for (let time = 1120; time < 1360; time += 40) assert.equal(mapper.update(human(time), profile), undefined);
  assert.ok(mapper.update(human(1360), profile));
  assert.equal(mapper.requiresReferenceReset, false);
});

test('alternating bad return frames and long gaps cannot complete reference recovery', () => {
  const mapper = ready();
  mapper.update(human(640, { centerX: .9 }), profile);
  for (let time = 680; time <= 2280; time += 40) {
    if (time % 80) mapper.update(human(time), profile);
    else mapper.rejectFrame(time, 'unreliable-pose');
  }
  assert.equal(mapper.requiresReferenceReset, true);
  close(mapper.snapshot.referenceProgress, 0);
  for (let time = 2320; time <= 2640; time += 40) mapper.update(human(time), profile);
  assert.ok(mapper.snapshot.referenceProgress > 0);
  assert.equal(mapper.update(human(2960), profile), undefined);
  close(mapper.snapshot.referenceProgress, 0);
  for (let time = 3000; time < 3560; time += 40) assert.equal(mapper.update(human(time), profile), undefined);
  assert.ok(mapper.update(human(3560), profile));
  assert.equal(mapper.requiresReferenceReset, false);
});

test('leaving the camera volume again restarts recovery and manual reference reset still recaptures', () => {
  const mapper = ready();
  mapper.update(human(640, { centerX: .9 }), profile);
  for (let time = 680; time <= 1000; time += 40) mapper.update(human(time), profile);
  assert.ok(mapper.snapshot.referenceProgress > 0);
  mapper.update(human(1040, { bodyScale: .3 }), profile);
  close(mapper.snapshot.referenceProgress, 0);
  assert.equal(mapper.requiresReferenceReset, true);
  mapper.resetReference();
  assert.equal(mapper.requiresReferenceReset, false);
  assert.equal(mapper.reference, undefined);
  for (let time = 1080; time <= 1680; time += 40) mapper.update(human(time, { centerX: .6 }), profile);
  assert.equal(mapper.isReferenceReady, true);
  close(mapper.reference!.centerX, .6);
  assert.equal(mapper.reference!.timestampMs, 1680);
});

test('optional garden movement retains the captured reference through ordinary lateral and depth travel', () => {
  const mapper = new MotionRetargeter(90, true);
  for (let time = 0; time <= 600; time += 40) mapper.update(human(time, { torsoScale: .3 }), profile);
  assert.equal(mapper.isReferenceReady, true);
  const original = mapper.reference;
  for (const [index, movement] of [
    { centerX: .88, bodyScale: .34, torsoScale: .51 },
    { centerX: .12, bodyScale: .12, torsoScale: .18 },
    { centerX: .5, bodyScale: .2, torsoScale: .3 },
  ].entries()) {
    const target = mapper.update(human(640 + index * 40, movement), profile);
    assert.ok(target);
    assert.equal(mapper.requiresReferenceReset, false);
    assert.ok(Object.values(target).every(Number.isFinite));
    assert.deepEqual(mapper.reference, original);
  }
  close(mapper.reference!.torsoScale!, .3);
  const legacy = ready();
  assert.equal(legacy.update(human(640, { centerX: .88, bodyScale: .34, torsoScale: .51 }), profile), undefined);
  assert.equal(legacy.requiresReferenceReset, true);
});

test('garden movement rejects degenerate body measurements and supports legacy torso-scale omission', () => {
  const mapper = new MotionRetargeter(90, true);
  for (let time = 0; time <= 600; time += 40) mapper.update(human(time), profile);
  assert.equal(mapper.isReferenceReady, true);
  assert.equal(mapper.reference!.torsoScale, undefined);
  const original = mapper.reference;
  for (const [index, invalid] of [
    { torsoScale: NaN }, { torsoScale: Infinity }, { torsoScale: 0 }, { torsoScale: .001 },
    { bodyScale: 0 }, { centerX: 1.1 }, { trackingConfidence: .1 },
  ].entries()) {
    assert.equal(mapper.update(human(640 + index * 40, invalid), profile), undefined);
    assert.deepEqual(mapper.reference, original);
  }
  assert.ok(mapper.update(human(1000, { centerX: .75, bodyScale: .3 }), profile));
  assert.equal(mapper.requiresReferenceReset, false);
});

test('torso scale uses projected torso length normalized by image height across aspect ratios', () => {
  const extractor = new HumanPoseExtractor();
  for (const [width, height] of [[1600, 900], [900, 1600], [640, 360]]) {
    const extracted = extractor.extract(frame(0, 0, width, height), snapshot(), profile)!;
    close(extracted.torsoScale!, .3);
  }
  const raw = frame();
  const points = raw.landmarks as PoseLandmark[];
  points[11].x += .03;
  points[12].x += .03;
  const leaned = extractor.extract(raw, snapshot(), profile)!;
  close(leaned.torsoScale!, Math.hypot(48, 270) / 900);
  points.forEach(point => { point.z = 0; });
  points[11] = { ...points[23], y: points[23].y - .001, z: -.5 };
  points[12] = { ...points[24], y: points[24].y - .001, z: -.5 };
  assert.equal(extractor.extract(raw, snapshot(), profile), undefined);
  assert.equal(extractor.lastRejection, 'torso-degenerate-geometry');
});

test('optional torso-scale reference uses reliable sample medians', () => {
  const mapper = new MotionRetargeter(90, true);
  for (let index = 0; index <= 15; index++) mapper.update(human(index * 40, {
    torsoScale: index === 15 ? .6 : .3,
  }), profile);
  assert.equal(mapper.isReferenceReady, true);
  close(mapper.reference!.torsoScale!, .3);
});


test('head, arms and ankles can be outside the frame during the Carrot standing reference', () => {
  const partial: PartialCalibrationProfile = { metric: 'partial', timestamp: 100,
    partial: partialMotionRange(-.56, -.43) };
  const source = frame();
  const points = [...source.landmarks!];
  for (const id of [0, 7, 8, 13, 14, 15, 16, 27, 28]) points[id] = { x: .5, y: 1.1, visibility: 1 };
  const raw = { ...source, landmarks: points };
  const classified = snapshot({ trackingMode: 'partial', partialBendSignal: -.56, estimatedBendAmount: 0,
    leftKneeAngle: undefined, rightKneeAngle: undefined, activeKneeAngle: undefined });
  const extractor = new HumanPoseExtractor(false, true);
  const standing = extractor.extract(raw, classified, partial)!;
  assert.equal(standing.headYaw, undefined);
  assert.equal(standing.activeKneeAngle, undefined);
  assert.equal(standing.estimatedBendAmount, 0);
  const mapper = new MotionRetargeter(90, true, true, 90, true);
  for (let time = 0; time <= 600; time += 40) mapper.update({ ...standing, timestampMs: time }, partial);
  assert.equal(mapper.isReferenceReady, true);
  const target = mapper.update({ ...standing, timestampMs: 640, estimatedBendAmount: .76 }, partial)!;
  close(target.bendAmount, .76);
  close(target.headPitch, 0);
  close(target.leftArmElevation, 0);
  assert.equal(mapper.update({ ...standing, timestampMs: 680, estimatedBendAmount: NaN }, partial), undefined);

  points[25] = { ...points[25], visibility: .1 };
  assert.equal(extractor.extract(raw, classified, partial), undefined);
});

test('Berry retargeting preserves a valid partial leg when the opposite knee is unavailable', () => {
  const mapper = new MotionRetargeter();
  const result = mapper.retargetLegMotion({ leftLegExtensionAmount: .74, rightLegExtensionAmount: NaN,
    reliable: true, lateralReliable: true, lateralOffset: -.4, timestampMs: 100,
    legTracking: { left: { mode: 'partial', reliable: true }, right: { mode: 'lost', reliable: false } },
  });
  close(result.leftLegExtensionAmount, .74);
  close(result.rightLegExtensionAmount, 0);
  close(result.lateralOffset, -.4);
  assert.deepEqual(result.legTracking, { left: { mode: 'partial', reliable: true },
    right: { mode: 'lost', reliable: false } });
});
