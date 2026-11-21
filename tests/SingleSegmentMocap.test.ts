import assert from 'node:assert/strict';
import test from 'node:test';
import type { CalibrationProfile } from '../src/game/calibration/calibrationTypes';
import { HumanPoseExtractor, type HumanPose } from '../src/game/mocap/HumanPoseExtractor';
import { MocapController } from '../src/game/mocap/MocapController';
import { MotionRetargeter } from '../src/game/mocap/MotionRetargeter';
import { RABBIT_V3_LIMITS } from '../src/game/3d/rabbit3dConfig';
import { DEFAULT_GAME_SETTINGS } from '../src/game/settings/gameSettings';
import type { PoseFrame, PoseLandmark, PoseSnapshot } from '../src/game/vision/poseTypes';

const profile: CalibrationProfile = {
  standingAngle: 170, bendingAngle: 140, range: 30, standingThreshold: 164, bendingThreshold: 150.5,
  timestamp: 100, reliableSide: 'both',
};
const close = (actual: number | undefined, expected: number, tolerance = 1e-7) =>
  assert.ok(actual !== undefined && Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);

function input(timestampMs: number, left = 0, right = 0, leftPlane = 0, rightPlane = 0) {
  const point = (x: number, y: number, z = 0): PoseLandmark => ({ x, y, z, visibility: 1, presence: 1 });
  const points: PoseLandmark[] = Array.from({ length: 33 }, () => ({ ...point(.5, .5), visibility: 0, presence: 0 }));
  for (const [shoulder, elbow, wrist, hip, knee, ankle, x, sign, elevation, plane] of [
    [11, 13, 15, 23, 25, 27, .4, -1, left, leftPlane],
    [12, 14, 16, 24, 26, 28, .6, 1, right, rightPlane],
  ]) {
    const theta = elevation * Math.PI / 180, phi = plane * Math.PI / 180;
    const dx = sign * .1 * Math.sin(theta) * Math.cos(phi);
    const dy = .1 * Math.cos(theta), dz = -.1 * Math.sin(theta) * Math.sin(phi);
    points[shoulder] = point(x, .25);
    points[elbow] = point(x + dx, .25 + dy, dz);
    points[wrist] = point(x + dx * 2, .25 + dy * 2, dz * 2);
    points[hip] = point(x, .5); points[knee] = point(x, .7); points[ankle] = point(x, .9);
  }
  const frame: PoseFrame = { landmarks: points, timestampMs, inferenceMs: 8, poseFps: 25,
    imageWidth: 1000, imageHeight: 1000 };
  const pose: PoseSnapshot = { state: 'STANDING', timestampMs, leftKneeAngle: 170, rightKneeAngle: 170,
    activeKneeAngle: 170, reliableSides: 2, confidence: 1, candidateMs: 200,
    inferenceMs: 8, poseFps: 25, trackingLostMs: 0, autoRestRecommended: false };
  return { frame, pose, points };
}

function human(timestampMs: number, changes: Partial<HumanPose> = {}): HumanPose {
  return { leftArmElevation: 0, rightArmElevation: 0, leftArmPlane: 0, rightArmPlane: 0,
    leftArmConfidence: 1, rightArmConfidence: 1, leftArmProjectedLength: .4, rightArmProjectedLength: .4,
    torsoLean: 0, activeKneeAngle: 170, centerX: .5, bodyScale: .2, trackingConfidence: 1,
    timestampMs, ...changes };
}

function readyMapper() {
  const mapper = new MotionRetargeter(145, true, true, 90);
  for (let time = 0; time <= 640; time += 40) mapper.update(human(time, {
    leftElbowBend: NaN, rightElbowBend: Infinity,
    leftElbowProjectedBend: 170, rightElbowProjectedBend: 150,
  }), profile);
  assert.equal(mapper.snapshot.referenceReady, true);
  return mapper;
}

function controllerFixture() {
  let now = 0;
  const writes = { left: 0, right: 0, leftElbow: 0, rightElbow: 0, root: 0 };
  const rig = {
    armControl: 'shoulder' as const, version: 'v3' as const,
    limits: { ...RABBIT_V3_LIMITS, arm: { min: -12, max: 90 } },
    setArmRotation(side: string, elevation: number, bend = 0) {
      if (side === 'left') { writes.left = elevation; writes.leftElbow = bend; }
      else { writes.right = elevation; writes.rightElbow = bend; }
    },
    setBodyLean() {}, setKneeBend() {}, setRootOffset(value: number) { writes.root = value; },
  };
  const controller = new MocapController(rig, () => now, true, true);
  const feed = (time: number, left = 0, right = 0, centerShift = 0) => {
    now = time;
    const sample = input(time, left, right);
    for (const index of [15, 16]) sample.points[index] = { x: NaN, y: NaN, z: NaN, visibility: 0, presence: 0 };
    for (const index of [11, 12, 13, 14, 23, 24, 25, 26, 27, 28]) sample.points[index].x += centerShift;
    controller.acceptFrame(sample.frame, sample.pose, profile);
    controller.update(.04);
  };
  controller.enable();
  for (let time = 0; time <= 640; time += 40) feed(time);
  assert.equal(controller.snapshot().referenceReady, true);
  return { controller, writes, feed, advance(time: number) { now = time; controller.update(.04); } };
}

test('shoulder extraction preserves independent anatomical arms with no wrist evidence', () => {
  const extractor = new HumanPoseExtractor(true, true);
  for (const [left, right] of [[70, 0], [0, 45], [35, 60]]) {
    const sample = input(640, left, right);
    for (const index of [15, 16]) sample.points[index] = { x: NaN, y: Infinity, z: NaN, visibility: 0, presence: 0 };
    const result = extractor.extract(sample.frame, sample.pose, profile)!;
    close(result.leftArmElevation, left); close(result.rightArmElevation, right);
    close(result.leftArmConfidence, 1); close(result.rightArmConfidence, 1);
    close(result.leftElbowBend, 0); close(result.rightElbowBend, 0);
  }
});

test('wrist position, forearm angle and wrist depth do not affect shoulder-mode output', () => {
  const extractor = new HumanPoseExtractor(false, true);
  const sample = input(640, 55, 30, 45, 90);
  const original = extractor.extract(sample.frame, sample.pose, profile)!;
  for (const wrist of [
    { x: .9, y: .1, z: -100, visibility: 1, presence: 1 },
    { x: .2, y: .9, z: 100, visibility: 1, presence: 1 },
    { x: NaN, y: NaN, z: NaN, visibility: 0, presence: 0 },
  ]) {
    sample.points[15] = wrist; sample.points[16] = wrist;
    assert.deepEqual(extractor.extract(sample.frame, sample.pose, profile), original);
  }
});

test('shoulder mode separates forward and lateral reach from shoulder-to-elbow depth alone', () => {
  const extractor = new HumanPoseExtractor(true, true);
  for (const [leftPlane, rightPlane] of [[0, 90], [90, 0], [45, 45]]) {
    const sample = input(640, 80, 60, leftPlane, rightPlane);
    sample.points[15].z = undefined; sample.points[16].z = NaN;
    const result = extractor.extract(sample.frame, sample.pose, profile)!;
    close(result.leftArmElevation, 80); close(result.rightArmElevation, 60);
    close(result.leftArmPlane, leftPlane); close(result.rightArmPlane, rightPlane);
  }
});

test('missing elbow evidence disables only its shoulder chain while the other arm stays reliable', () => {
  const extractor = new HumanPoseExtractor(false, true), sample = input(640, 70, 45);
  sample.points[13].visibility = 0;
  const result = extractor.extract(sample.frame, sample.pose, profile)!;
  assert.equal(result.leftArmElevation, undefined);
  close(result.leftArmConfidence, 0); close(result.rightArmConfidence, 1); close(result.rightArmElevation, 45);
});

test('articulated extraction retains its original wrist and forearm requirements', () => {
  const sample = input(640, 70, 45);
  sample.points[15].visibility = 0;
  const result = new HumanPoseExtractor().extract(sample.frame, sample.pose, profile)!;
  close(result.leftArmConfidence, 0); close(result.rightArmConfidence, 1);
});

test('shoulder reference ignores elbow bends and maps live arms within their physical profile', () => {
  const mapper = readyMapper();
  assert.ok(mapper.snapshot.conditions.every(condition => !condition.name.includes('Elbow')));
  close(mapper.reference!.leftElbowBend, 0); close(mapper.reference!.rightElbowBend, 0);
  const mapped = mapper.update(human(680, { leftArmElevation: 150, rightArmElevation: 45,
    leftArmPlane: 130, rightArmPlane: 45, leftElbowBend: NaN, rightElbowBend: Infinity }), profile)!;
  close(mapped.leftArmElevation, 90); close(mapped.rightArmElevation, 45);
  close(mapped.leftArmPlane, 90); close(mapped.rightArmPlane, 45);
  close(mapped.leftElbowBend, 0); close(mapped.rightElbowBend, 0);
});

test('individual arm occlusion holds briefly then returns to neutral while all elbow targets remain zero', () => {
  const mapper = readyMapper();
  mapper.update(human(680, { leftArmElevation: 60, rightArmElevation: 20 }), profile);
  const held = mapper.update(human(720, { leftArmConfidence: 0, leftArmElevation: undefined,
    leftElbowBend: 175, rightArmElevation: 40 }), profile)!;
  close(held.leftArmElevation, 60); close(held.rightArmElevation, 40); close(held.leftElbowBend, 0);
  const neutral = mapper.update(human(1320, { leftArmConfidence: 0, leftArmElevation: undefined,
    leftElbowBend: 175, rightArmElevation: 45 }), profile)!;
  close(neutral.leftArmElevation, 0); close(neutral.leftElbowBend, 0); close(neutral.rightArmElevation, 45);
});

test('garden shoulder controller preserves anatomical sides and independent world translation ownership', () => {
  const f = controllerFixture();
  try {
    for (let time = 680; time <= 1080; time += 40) f.feed(time, Math.min(75, (time - 640) * .25), 0, .1);
    const state = f.controller.snapshot();
    assert.equal(state.trackingState, 'tracking'); assert.equal(state.mirrored, false);
    close(state.mapped!.leftArmElevation, 75); close(state.mapped!.rightArmElevation, 0);
    close(f.writes.left, 75); close(f.writes.right, 0); close(f.writes.root, 0);
    close(state.raw!.centerX, .6); close(f.writes.leftElbow, 0); close(f.writes.rightElbow, 0);
    assert.equal(state.rejectedFrames, 0);
  } finally { f.controller.dispose(); }
});

test('physical shoulder limit is applied after gain so release never waits on an oversized smoother target', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true,
    value: { getItem: () => JSON.stringify({ ...DEFAULT_GAME_SETTINGS, mocapGain: 2 }) } });
  const f = controllerFixture();
  try {
    for (let time = 680; time <= 1200; time += 40) f.feed(time, Math.min(160, (time - 640) * .4));
    close(f.controller.snapshot().mapped!.leftArmElevation, 90);
    close(f.controller.pose.leftArmElevation, 90);
    close(f.writes.left, 90); close(f.writes.leftElbow, 0);
  } finally {
    f.controller.dispose();
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('shoulder controller holds short tracking loss, eases to neutral and resumes without elbow motion', () => {
  const f = controllerFixture();
  try {
    for (let time = 680; time <= 1000; time += 40) f.feed(time, Math.min(70, (time - 640) * .25), 25);
    const held = f.controller.pose.leftArmElevation;
    f.advance(1300);
    assert.equal(f.controller.snapshot().trackingState, 'holding'); close(f.controller.pose.leftArmElevation, held);
    for (let time = 1640; time <= 2120; time += 40) f.advance(time);
    assert.equal(f.controller.snapshot().trackingState, 'returning-neutral'); close(f.controller.pose.leftArmElevation, 0);
    f.feed(2160, 30, 0);
    assert.equal(f.controller.snapshot().trackingState, 'tracking');
    assert.ok(f.controller.pose.leftArmElevation > 0 && f.controller.pose.leftArmElevation < 30);
    close(f.writes.leftElbow, 0); close(f.writes.rightElbow, 0);
    f.controller.pause();
    const paused = f.controller.pose;
    f.advance(2200); assert.deepEqual(f.controller.pose, paused);
  } finally { f.controller.dispose(); }
});
