import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { MotionSmoother } from '../src/game/mocap/MotionSmoother';
import { neutralRabbitPose } from '../src/game/mocap/RabbitPose';
import { RABBIT_3D_CONFIG } from '../src/game/3d/rabbit3dConfig';

const close = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);

function response(responsive: boolean, requested: number) {
  const smoother = new MotionSmoother(responsive);
  const target = { ...neutralRabbitPose(), leftArmElevation: requested };
  const actual = new Quaternion();
  const destination = new Quaternion();
  const axis = new Vector3(0, 0, 1);
  const dt = 1 / 240;
  let target90 = 0;
  let displayed90 = 0;
  for (let frame = 1; frame <= 480; frame++) {
    const value = smoother.update(target, dt).leftArmElevation;
    destination.setFromAxisAngle(axis, value * Math.PI / 180);
    actual.slerp(destination, 1 - Math.exp(-RABBIT_3D_CONFIG.smoothingRate * dt));
    if (!target90 && value >= requested * .9 - 1e-9) target90 = frame * dt;
    if (!displayed90 && actual.angleTo(new Quaternion()) * 180 / Math.PI >= requested * .9) displayed90 = frame * dt;
  }
  return { target90, displayed90 };
}

test('default and explicit legacy smoothing keep their original continuous rate limit', () => {
  const original = new MotionSmoother();
  const explicit = new MotionSmoother(false);
  const target = { ...neutralRabbitPose(), leftArmElevation: 120, rightArmElevation: 90,
    leftElbowBend: 100, rightElbowBend: 60, torsoLean: 18, bendAmount: 1, lateralOffset: .1 };
  for (let frame = 0; frame < 120; frame++) assert.deepEqual(original.update(target, 1 / 60), explicit.update(target, 1 / 60));
  close(original.pose.leftArmElevation, 120);
});

test('responsive active reaches reduce large-action latency while preserving small-noise behavior', () => {
  const legacy = response(false, 120);
  const responsive = response(true, 120);
  close(legacy.target90, .6, 1 / 240);
  close(responsive.target90, .2, 1 / 240);
  assert.ok(responsive.displayed90 < legacy.displayed90 * .65);
  const smallLegacy = response(false, 6);
  const smallResponsive = response(true, 6);
  assert.deepEqual(smallResponsive, smallLegacy);
  console.log('Target step response, excluding capture/inference/landmark latency', {
    largeStepDegrees: 120, legacy, responsive, smallStepDegrees: 6, smallResponsive,
  });
});

test('responsive two-band integration is invariant to render step partition and reversals', () => {
  const coarse = new MotionSmoother(true);
  const fine = new MotionSmoother(true);
  for (const requested of [120, 25, 150, -12, 60, 0]) {
    const target = { ...neutralRabbitPose(), leftArmElevation: requested,
      rightArmElevation: requested, leftElbowBend: Math.max(0, requested), rightArmPlane: Math.max(0, requested / 2) };
    for (let step = 0; step < 4; step++) {
      const whole = coarse.update(target, .05);
      fine.update(target, .025);
      const halves = fine.update(target, .025);
      for (const key of ['leftArmElevation', 'rightArmElevation', 'leftElbowBend', 'rightArmPlane'] as const) close(whole[key], halves[key], 1e-8);
    }
  }
});

test('responsive arms do not change body, head, calibrated knee or root rates', () => {
  const legacy = new MotionSmoother(false);
  const responsive = new MotionSmoother(true);
  const target = { ...neutralRabbitPose(), leftArmElevation: 150, torsoLean: 18,
    torsoForward: 16, headYaw: 25, headPitch: 18, bendAmount: 1, lateralOffset: .45 };
  for (let frame = 0; frame < 60; frame++) {
    const first = legacy.update(target, 1 / 60);
    const second = responsive.update(target, 1 / 60);
    for (const key of ['torsoLean', 'torsoForward', 'headYaw', 'headPitch', 'bendAmount', 'lateralOffset'] as const) close(first[key], second[key]);
  }
});

test('responsive slew holds invalid targets and resets without carrying stale motion', () => {
  const smoother = new MotionSmoother(true);
  const active = { ...neutralRabbitPose(), leftArmElevation: 120, leftElbowBend: 90 };
  smoother.update(active, .1);
  const before = smoother.pose;
  smoother.update({ ...active, leftArmElevation: NaN, leftElbowBend: Infinity }, .05);
  close(smoother.pose.leftArmElevation, before.leftArmElevation);
  close(smoother.pose.leftElbowBend, before.leftElbowBend);
  assert.deepEqual(smoother.update(active, NaN), smoother.pose);
  smoother.reset();
  assert.deepEqual(smoother.pose, neutralRabbitPose());
  smoother.update(active, 1 / 60);
  close(smoother.pose.leftArmElevation, 9);
});

async function mocapFixture() {
  const { readFileSync } = await import('node:fs');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { RabbitRigController } = await import('../src/game/3d/RabbitRigController');
  const { MocapController } = await import('../src/game/mocap/MocapController');
  const bytes = readFileSync(new URL('../model/dist/rabbit3d/rabbit_realtime_v3.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
  const rig = new RabbitRigController(gltf.scene);
  rig.setIKEnabled(true);
  let now = 0;
  const controller = new MocapController(rig, () => now);
  const profile = { standingAngle: 170, bendingAngle: 140, standingThreshold: 164,
    bendingThreshold: 150.5, range: 30, timestamp: 0 };
  const feed = (time: number, elevation = 0, knee = 170, center = .5) => {
    now = time;
    const point = (x: number, y: number) => ({ x, y, visibility: 1, presence: 1 });
    const points = Array.from({ length: 33 }, () => point(center, .5));
    for (const [shoulder, elbow, wrist, hip, leg, ankle, side] of [[11, 13, 15, 23, 25, 27, 1], [12, 14, 16, 24, 26, 28, -1]]) {
      const x = center + side * .1;
      const angle = elevation * Math.PI / 180;
      points[shoulder] = point(x, .25);
      points[elbow] = point(x + side * Math.sin(angle) * .1, .25 + Math.cos(angle) * .1);
      points[wrist] = point(x + side * Math.sin(angle) * .2, .25 + Math.cos(angle) * .2);
      points[hip] = point(x, .5); points[leg] = point(x, .7); points[ankle] = point(x, .9);
    }
    controller.acceptFrame({ landmarks: points, timestampMs: time, inferenceMs: 8, poseFps: 25,
      imageWidth: 1000, imageHeight: 1000 }, {
      state: 'STANDING', timestampMs: time, leftKneeAngle: knee, rightKneeAngle: knee, activeKneeAngle: knee,
      confidence: 1, reliableSides: 2, candidateMs: 200, inferenceMs: 8, poseFps: 25,
      trackingLostMs: 0, autoRestRecommended: false,
    }, profile);
    controller.update(.04); rig.update(.04);
  };
  const advance = (time: number, delta = 1 / 60) => { now = time; controller.update(delta); rig.update(delta); };
  controller.enable();
  for (let time = 0; time <= 640; time += 40) feed(time);
  assert.equal(controller.snapshot().referenceReady, true);
  return { rig, controller, feed, advance };
}

test('actual V3 IK holds contact through tracking loss, neutral return and bounded recovery', async () => {
  const f = await mocapFixture();
  try {
    for (let time = 680; time <= 1440; time += 40) f.feed(time, Math.min(100, (time - 640) / 2), 155, .52);
    assert.equal(f.controller.snapshot().trackingState, 'tracking');
    const activeArm = f.controller.snapshot().smoothed.leftArmElevation;
    assert.ok(activeArm > 95);
    assert.ok(f.rig.ikSnapshot().feet!.maximumContactError < .005);
    f.advance(1740);
    assert.equal(f.controller.snapshot().trackingState, 'holding');
    close(f.controller.snapshot().smoothed.leftArmElevation, activeArm);
    for (let frame = 0; frame < 90; frame++) {
      f.advance(2100 + frame * 1000 / 60);
      assert.ok(f.rig.ikSnapshot().feet!.maximumContactError < .005);
    }
    assert.equal(f.controller.snapshot().trackingState, 'returning-neutral');
    assert.ok(f.controller.snapshot().smoothed.leftArmElevation < 1);
    const before = new Map([...f.rig.bones].map(([name, bone]) => [name, bone.quaternion.clone().normalize()]));
    f.feed(3640, 30);
    assert.equal(f.controller.snapshot().trackingState, 'tracking');
    for (const [name, bone] of f.rig.bones) {
      const change = before.get(name)!.angleTo(bone.quaternion.clone().normalize()) * 180 / Math.PI;
      assert.ok(change < 15, `${name} recovered with a ${change} degree jump`);
    }
    assert.ok(f.rig.ikSnapshot().feet!.maximumContactError < .005);
  } finally { f.controller.dispose(); f.rig.dispose(); }
});

test('actual V3 IK pause, resume, reset and disposal preserve final pose ownership', async () => {
  const f = await mocapFixture();
  try {
    for (let time = 680; time <= 1200; time += 40) f.feed(time, Math.min(80, (time - 640) / 2), 150, .52);
    f.controller.pause();
    const held = f.controller.snapshot().smoothed;
    const transforms = [...f.rig.bones].map(([name, bone]) => [name, bone.quaternion.toArray(), bone.position.toArray()]);
    f.controller.acceptFrame({ timestampMs: 4000, inferenceMs: 0, poseFps: 25 }, {
      state: 'TRACKING_LOST', timestampMs: 4000, confidence: 0, reliableSides: 0, candidateMs: 0,
      inferenceMs: 0, poseFps: 25, trackingLostMs: 1000, autoRestRecommended: false,
    }, undefined);
    f.controller.update(10, 4000);
    assert.deepEqual(f.controller.snapshot().smoothed, held);
    assert.deepEqual([...f.rig.bones].map(([name, bone]) => [name, bone.quaternion.toArray(), bone.position.toArray()]), transforms);
    f.controller.resume();
    assert.equal(f.controller.snapshot().mapped, undefined);
    f.advance(4040, 1 / 60);
    assert.ok(f.rig.ikSnapshot().feet!.maximumContactError < .005);
    f.rig.resetPose(true);
    f.rig.update(1 / 60);
    assert.ok(f.rig.ikSnapshot().feet!.maximumContactError < .005);
    assert.ok([...f.rig.bones.values()].every(bone => [...bone.quaternion.toArray(), ...bone.position.toArray()].every(Number.isFinite)));
    f.controller.dispose(); f.rig.dispose();
    const disposed = [...f.rig.bones].map(([name, bone]) => [name, bone.quaternion.toArray(), bone.position.toArray()]);
    f.rig.setIKEnabled(true); f.rig.setKneeBend(1); f.rig.update(1 / 60);
    assert.deepEqual([...f.rig.bones].map(([name, bone]) => [name, bone.quaternion.toArray(), bone.position.toArray()]), disposed);
    assert.equal(f.controller.snapshot().controllerStatus, 'DISPOSED');
  } finally { f.controller.dispose(); f.rig.dispose(); }
});

test('IK diagnostic snapshots are isolated and distinguish solved from interpolating hand error', async () => {
  const f = await mocapFixture();
  try {
    f.controller.stop();
    f.rig.resetPose(true);
    f.rig.setArmRotation('left', 120, 45, 45);
    f.rig.setKneeBend(.5);
    f.rig.update(1 / 60);
    const first = f.rig.ikSnapshot();
    assert.ok(first.hands.L.residual > first.hands.L.solverResidual + .1);
    const retained = JSON.stringify(first);
    for (let frame = 0; frame < 120; frame++) f.rig.update(1 / 60);
    assert.equal(JSON.stringify(first), retained);
    const settled = f.rig.ikSnapshot();
    assert.ok(settled.hands.L.residual < .001);
    const target = settled.feet!.left.target[0];
    settled.feet!.left.target[0] = 999;
    settled.feet!.left.contact[1] = 999;
    settled.hands.L.target[0] = 999;
    close(f.rig.ikSnapshot().feet!.left.target[0], target);
    assert.notEqual(f.rig.ikSnapshot().feet!.left.contact[1], 999);
    assert.notEqual(f.rig.ikSnapshot().hands.L.target[0], 999);
  } finally { f.controller.dispose(); f.rig.dispose(); }
});
