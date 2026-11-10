import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RabbitRigController } from '../src/game/3d/RabbitRigController';
import { RABBIT_3D_CONFIG } from '../src/game/3d/rabbit3dConfig';
import { MocapController } from '../src/game/mocap/MocapController';
import { MotionSmoother } from '../src/game/mocap/MotionSmoother';
import { neutralRabbitPose } from '../src/game/mocap/RabbitPose';
import type { PoseFrame, PoseLandmark, PoseSnapshot } from '../src/game/vision/poseTypes';
import type { CalibrationProfile } from '../src/game/calibration/calibrationTypes';
import { DEFAULT_GAME_SETTINGS } from '../src/game/settings/gameSettings';

const profile: CalibrationProfile = {
  standingAngle: 170, bendingAngle: 140, standingThreshold: 164, bendingThreshold: 150.5,
  range: 30, timestamp: 0,
};

function signal(timestampMs: number, left = 0, right = 0, knee = 170, center = 0.5) {
  const point = (x: number, y: number): PoseLandmark => ({ x, y, visibility: 1, presence: 1 });
  const points = Array.from({ length: 33 }, () => point(center, 0.5));
  for (const [shoulder, elbow, wrist, hip, leg, ankle, side, angle] of [
    [11, 13, 15, 23, 25, 27, 1, left], [12, 14, 16, 24, 26, 28, -1, right],
  ]) {
    const x = center + side * 0.1;
    const radians = angle * Math.PI / 180;
    points[shoulder] = point(x, 0.25);
    points[elbow] = point(x + side * Math.sin(radians) * 0.1, 0.25 + Math.cos(radians) * 0.1);
    points[wrist] = point(x + side * Math.sin(radians) * 0.2, 0.25 + Math.cos(radians) * 0.2);
    points[hip] = point(x, 0.5);
    points[leg] = point(x, 0.7);
    points[ankle] = point(x, 0.9);
  }
  const frame: PoseFrame = { landmarks: points, timestampMs, inferenceMs: 8, poseFps: 25, imageWidth: 1000, imageHeight: 1000 };
  const pose: PoseSnapshot = {
    state: 'STANDING', timestampMs, leftKneeAngle: knee, rightKneeAngle: knee, activeKneeAngle: knee,
    confidence: 1, reliableSides: 2, candidateMs: 200, inferenceMs: 8, poseFps: 25,
    trackingLostMs: 0, autoRestRecommended: false,
  };
  return { frame, pose, points };
}

function fixture() {
  let now = 0;
  let writes = 0;
  const angles = { left: 0, right: 0, leftElbow: 0, rightElbow: 0, body: 0, knee: 0, root: 0 };
  const rig = {
    setArmRotation(side: string, upper: number, elbow = 0) {
      writes++;
      if (side === 'left') { angles.left = upper; angles.leftElbow = elbow; }
      else { angles.right = upper; angles.rightElbow = elbow; }
    },
    setBodyLean(value: number) { writes++; angles.body = value; },
    setKneeBend(value: number) { writes++; angles.knee = value; },
    setRootOffset(value: number) { writes++; angles.root = value; },
    update() { throw new Error('The overlay owns rig interpolation.'); },
  };
  const controller = new MocapController(rig, () => now);
  const feed = (time: number, left = 0, right = 0, knee = 170, center = 0.5) => {
    now = time;
    const input = signal(time, left, right, knee, center);
    controller.acceptFrame(input.frame, input.pose, profile);
    controller.update(0.04);
    return input;
  };
  const calibrate = () => {
    controller.enable();
    controller.resetReference();
    for (let time = 0; time <= 640; time += 40) feed(time);
    assert.equal(controller.snapshot().referenceReady, true);
  };
  return { controller, angles, feed, calibrate, setNow: (value: number) => { now = value; }, get writes() { return writes; } };
}

test('target rate limits are continuous and invariant across normal render frame rates', () => {
  const target = { ...neutralRabbitPose(), leftArmElevation: 110, rightArmElevation: 70,
    leftElbowBend: 50, torsoLean: 14, bendAmount: 1, lateralOffset: 0.45 };
  const slow = new MotionSmoother();
  const fast = new MotionSmoother();
  for (let i = 0; i < 15; i++) slow.update(target, 1 / 30);
  for (let i = 0; i < 60; i++) fast.update(target, 1 / 120);
  for (const key of Object.keys(target) as (keyof typeof target)[]) {
    assert.ok(Math.abs(slow.pose[key] - fast.pose[key]) < 1e-8, key);
  }
  assert.ok(Math.abs(slow.pose.leftArmElevation - 90) < 1e-8);
  assert.ok(Math.abs(slow.pose.bendAmount - 0.9) < 1e-8);
  assert.ok(Math.abs(slow.pose.lateralOffset - 0.3) < 1e-8);
});

test('smoother rejects nonfinite values and clamps every target to rig constraints', () => {
  const smoother = new MotionSmoother();
  const target = { ...neutralRabbitPose(), leftArmElevation: 1e6, rightArmElevation: -1e6,
    leftElbowBend: 1e6, rightElbowBend: -1e6, torsoLean: -1e6, bendAmount: 100, lateralOffset: 100 };
  smoother.update(target, 100);
  assert.deepEqual(smoother.pose, { ...target, leftArmElevation: RABBIT_3D_CONFIG.limits.arm.max, rightArmElevation: -12,
    leftElbowBend: RABBIT_3D_CONFIG.limits.forearm.max, rightElbowBend: 0, torsoLean: -18, bendAmount: 1, lateralOffset: 0.45 });
  const before = smoother.pose;
  const invalid = Object.fromEntries(Object.keys(before).map(key => [key, Number.NaN])) as unknown as typeof before;
  smoother.update(invalid, 1 / 60);
  assert.deepEqual(smoother.pose, before);
  for (const delta of [0, -1, Infinity, NaN]) smoother.update(neutralRabbitPose(), delta);
  assert.deepEqual(smoother.pose, before);
});

test('disabled and disposed controllers never write bones or create an animation loop', () => {
  const f = fixture();
  const input = signal(0);
  f.controller.acceptFrame(input.frame, input.pose, profile);
  f.controller.update(1 / 60);
  assert.equal(f.writes, 0);
  f.calibrate();
  f.controller.stop();
  const stoppedWrites = f.writes;
  f.feed(680, 20);
  assert.equal(f.writes, stoppedWrites);
  f.controller.dispose();
  f.controller.enable();
  f.controller.resetReference();
  f.feed(720, 30);
  assert.equal(f.writes, stoppedWrites);
  assert.equal(f.controller.snapshot().trackingState, 'disposed');
});

test('controller waits for a stable natural reference and follows independent continuous arm targets', () => {
  const f = fixture();
  f.controller.enable();
  f.feed(0, 50);
  assert.equal(f.controller.snapshot().referenceReady, false);
  assert.equal(f.angles.left, 0);
  f.calibrate();
  const values: number[] = [];
  for (const [time, angle] of [[680, 10], [720, 20], [760, 30], [800, 40]]) {
    f.feed(time, angle);
    values.push(f.angles.left);
    assert.equal(f.angles.right, 0);
  }
  assert.ok(values.every((value, i) => i === 0 || value > values[i - 1]));
  assert.ok(Math.abs(f.controller.snapshot().mapped!.leftArmElevation - 40) < 1e-8);
  f.feed(840, 50, 10);
  assert.ok(f.angles.left > values[3] && f.angles.right > 0);
  assert.equal(f.controller.snapshot().trackingState, 'tracking');
  assert.equal(f.controller.snapshot().mediaPipeFps, 25);
  assert.equal(f.controller.snapshot().threeFps, 25);
});

test('short tracking loss freezes the target, sustained loss returns gradually, recovery has no snap', () => {
  const f = fixture();
  f.calibrate();
  for (let time = 680; time <= 1000; time += 40) f.feed(time, Math.min(60, (time - 640) / 4));
  const current = f.angles.left;
  f.setNow(1300);
  f.controller.update(1 / 60);
  assert.equal(f.controller.snapshot().trackingState, 'holding');
  assert.equal(f.angles.left, current);
  f.setNow(1700);
  f.controller.update(1 / 60);
  assert.equal(f.controller.snapshot().trackingState, 'returning-neutral');
  assert.ok(f.angles.left < current && current - f.angles.left <= 3.000001);
  const beforeRecovery = f.angles.left;
  f.feed(1740, 90);
  assert.equal(f.controller.snapshot().trackingState, 'tracking');
  assert.ok(f.angles.left - beforeRecovery <= 7.200001);
  assert.ok(f.angles.left < 90);
});

test('short tracking loss holds exactly once when a stored motion gain is above one', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => JSON.stringify({ ...DEFAULT_GAME_SETTINGS, mocapGain: 2 }),
  } });
  try {
    const f = fixture();
    f.calibrate();
    for (let time = 680; time <= 1000; time += 40) f.feed(time, 30);
    const held = f.angles.left;
    f.setNow(1300);
    for (let frame = 0; frame < 10; frame++) f.controller.update(1 / 60);
    assert.equal(f.controller.snapshot().trackingState, 'holding');
    assert.equal(f.angles.left, held);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('forward arm, torso and head channels share bounded continuous target smoothing', () => {
  const smoother = new MotionSmoother();
  const target = { ...neutralRabbitPose(), leftArmPlane: 90, rightArmPlane: 90,
    torsoForward: 100, headYaw: -100, headPitch: 100 };
  const first = smoother.update(target, 1 / 60);
  assert.ok(first.leftArmPlane > 0 && first.leftArmPlane < 90);
  assert.ok(first.torsoForward > 0 && first.headYaw < 0);
  const final = smoother.update(target, 100);
  assert.equal(final.leftArmPlane, 90);
  assert.equal(final.rightArmPlane, 90);
  assert.equal(final.torsoForward, 16);
  assert.equal(final.headYaw, -25);
  assert.equal(final.headPitch, 18);
});

test('invalid calibration, stale, future, replay, mismatched, low-confidence and jump frames are rejected', () => {
  const f = fixture();
  f.calibrate();
  const check = (input: ReturnType<typeof signal>, expected: string, selectedProfile = profile) => {
    f.controller.acceptFrame(input.frame, input.pose, selectedProfile);
    assert.equal(f.controller.snapshot().lastRejection, expected);
  };
  f.setNow(1000);
  check(signal(1001), 'stale-or-future-frame');
  check(signal(700), 'stale-or-future-frame');
  f.setNow(680);
  check(signal(640), 'non-increasing-timestamp');
  check(signal(680), 'invalid-calibration', { ...profile, range: 0 });
  const mismatch = signal(680); mismatch.pose.timestampMs = 679;
  check(mismatch, 'mismatched-pose');
  f.setNow(720);
  const unreliable = signal(720); unreliable.pose.confidence = 0.1;
  check(unreliable, 'unreliable-pose');
  f.setNow(760);
  check(signal(760, 150), 'angle-jump');
  f.setNow(800);
  check(signal(800, 0, 0, 170, 0.86), 'position-jump');
  assert.equal(f.controller.snapshot().mapped!.leftArmElevation, 0);
  f.setNow(840);
  const invalid = signal(840); invalid.points[23].x = NaN;
  check(invalid, 'unreliable-pose');
  assert.equal(f.controller.snapshot().rejectedFrames, 9);
});

test('a rejected retargeted pose cannot report active tracking or refresh the reliable pose clock', () => {
  const f = fixture();
  f.calibrate();
  for (let time = 680; time <= 1640; time += 40) {
    f.setNow(time);
    const input = signal(time);
    input.points[0].x = 0.99;
    input.points[7].x = input.points[8].x = 0.01;
    f.controller.acceptFrame(input.frame, input.pose, profile);
    f.controller.update(0.04);
    assert.equal(f.controller.snapshot().lastRejection, 'invalid-retargeted-pose');
    assert.notEqual(f.controller.snapshot().controllerStatus, 'ACTIVE');
  }
  assert.equal(f.controller.snapshot().trackingState, 'returning-neutral');
});

test('pause blocks inference callbacks and writes; resume preserves reference and rejects old targets', () => {
  const f = fixture();
  f.calibrate();
  f.feed(680, 20);
  f.controller.pause();
  const before = f.writes;
  f.feed(3000, 90);
  assert.equal(f.writes, before);
  assert.equal(f.controller.snapshot().paused, true);
  f.controller.resume();
  assert.equal(f.controller.snapshot().referenceReady, true);
  assert.equal(f.controller.snapshot().mapped, undefined);
  const old = f.angles.left;
  f.controller.update(10);
  assert.ok(Math.abs(f.angles.left - old) <= 9.000001);
  f.feed(3040, 90);
  assert.equal(f.controller.snapshot().trackingState, 'tracking');
  assert.ok(f.angles.left < 90);
});

test('reference reset clears stale mapped targets and snapshot objects are isolated', () => {
  const f = fixture();
  f.calibrate();
  f.feed(680, 20, 10, 155, 0.52);
  assert.ok(f.angles.knee > 0 && f.angles.root < 0);
  const snapshot = f.controller.snapshot();
  snapshot.smoothed.leftArmElevation = 1000;
  snapshot.mapped!.bendAmount = 1000;
  assert.notEqual(f.controller.snapshot().smoothed.leftArmElevation, 1000);
  assert.notEqual(f.controller.snapshot().mapped!.bendAmount, 1000);
  f.controller.resetReference();
  assert.equal(f.controller.snapshot().referenceReady, false);
  assert.equal(f.controller.snapshot().mapped, undefined);
  assert.equal(f.controller.snapshot().raw, undefined);
  f.controller.update(1 / 60);
  assert.equal(f.controller.snapshot().trackingState, 'waiting');
});

test('synthetic continuous landmarks drive the real GLB anatomical left arm and normalized bone diagnostics', async () => {
  const bytes = readFileSync(new URL('../model/dist/rabbit3d/rabbit_realtime.glb', import.meta.url));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(data, '');
  const rig = new RabbitRigController(gltf.scene);
  let now = 0;
  const controller = new MocapController(rig, () => now);
  assert.ok(Object.values(controller.snapshot().boneDeltasDegrees).every(value => value < 1e-5));
  const handPosition = (side: 'L' | 'R') => rig.bones.get(`hand.${side}`)!.getWorldPosition(new Vector3());
  const restLeft = handPosition('L');
  const restRight = handPosition('R');
  let renderFrame = 0;
  let nextInference = 0;
  const renderUntil = (end: number, angleAt: (time: number) => number, knee = 170, center = 0.5) => {
    while (renderFrame * 1000 / 60 <= end) {
      now = renderFrame++ * 1000 / 60;
      if (now + 1e-8 >= nextInference) {
        const input = signal(nextInference, angleAt(nextInference), 0, knee, center);
        controller.acceptFrame(input.frame, input.pose, profile);
        nextInference += 40;
      }
      controller.update(1 / 60);
      rig.update(1 / 60);
    }
  };
  const feed = (time: number, left = 0, knee = 170, center = 0.5) => {
    now = time;
    const input = signal(time, left, 0, knee, center);
    controller.acceptFrame(input.frame, input.pose, profile);
    controller.update(0.04);
    rig.update(0.04);
  };
  controller.enable();
  renderUntil(650, () => 0);
  renderUntil(1600, time => Math.min(70, (time - 640) / 4));
  assert.ok(handPosition('L').y - restLeft.y > 0.3);
  assert.ok(handPosition('R').distanceTo(restRight) < 1e-7);
  assert.ok(controller.snapshot().boneDeltasDegrees['upper_arm.L'] > 65);
  assert.ok(controller.snapshot().boneDeltasDegrees['upper_arm.R'] < 1e-5);
  assert.equal(controller.snapshot().mediaPipeFps, 25);
  assert.equal(controller.snapshot().threeFps, 60);
  feed(1640, 70, 155, 0.52);
  for (let time = 1680; time <= 2000; time += 40) feed(time, 70, 155, 0.52);
  assert.ok(rig.bones.get('root')!.position.x < -0.01);
  assert.ok(controller.snapshot().smoothed.bendAmount > 0.49);
  const lastArm = controller.snapshot().smoothed.leftArmElevation;
  now = 2300;
  controller.update(1 / 60); rig.update(1 / 60);
  assert.equal(controller.snapshot().trackingState, 'holding');
  assert.equal(controller.snapshot().smoothed.leftArmElevation, lastArm);
  now = 2700;
  controller.update(1 / 60); rig.update(1 / 60);
  assert.equal(controller.snapshot().trackingState, 'returning-neutral');
  assert.ok(controller.snapshot().smoothed.leftArmElevation < lastArm);
  feed(2740, 40, 170, 0.5);
  assert.equal(controller.snapshot().trackingState, 'tracking');
  assert.ok([...rig.bones.values()].every(bone => [...bone.quaternion.toArray(), ...bone.position.toArray()].every(Number.isFinite)));
  controller.dispose();
  rig.dispose();
});
