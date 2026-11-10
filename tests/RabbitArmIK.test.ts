import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RabbitRigController } from '../src/game/3d/RabbitRigController';
import { RabbitArmIK, type RabbitArmAngles } from '../src/game/3d/ik/RabbitArmIK';
import { RABBIT_V3_LIMITS, rabbitRaiseLimit, type RabbitRaiseLimitCurve } from '../src/game/3d/rabbit3dConfig';

const curve: RabbitRaiseLimitCurve = [[0, 110], [75, 110], [90, 75], [105, 60], [120, 45], [135, 20], [150, 0]];
const upper = new Vector3(.04072559, -.38747811, 0);
const lower = new Vector3(.03790599, -.36065143, 0);
const solver = (sign = 1) => new RabbitArmIK(new Vector3(sign * upper.x, upper.y, upper.z),
  new Vector3(sign * lower.x, lower.y, lower.z), sign, curve, RABBIT_V3_LIMITS);
const point = new Vector3();
const close = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
const feasible = (pose: RabbitArmAngles) => {
  assert.ok(pose.raise >= -12 && pose.raise <= 150);
  assert.ok(pose.plane >= 0 && pose.plane <= 90);
  assert.ok(pose.elbow >= 0 && pose.elbow <= rabbitRaiseLimit(curve, Math.max(0, pose.raise)) + 1e-8);
};

test('arm IK validates immutable measured rest segments and side', () => {
  assert.throws(() => new RabbitArmIK(new Vector3(), lower, 1, curve, RABBIT_V3_LIMITS));
  assert.throws(() => new RabbitArmIK(upper, new Vector3(NaN, 0, 0), 1, curve, RABBIT_V3_LIMITS));
  assert.throws(() => new RabbitArmIK(upper, lower, 0, curve, RABBIT_V3_LIMITS));
  const a = upper.clone(), b = lower.clone(), ik = new RabbitArmIK(a, b, 1, curve, RABBIT_V3_LIMITS);
  a.set(9, 9, 9); b.set(8, 8, 8);
  assert.ok(ik.forward(0, 0, 0, point).distanceTo(upper.clone().add(lower)) < 1e-10);
});

test('arm target forward geometry matches actual V3 bone transforms in all raise planes', async () => {
  const bytes = readFileSync(new URL('../model/dist/rabbit3d/rabbit_realtime_v3.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
  const rig = new RabbitRigController(gltf.scene);
  const position = (name: 'upper_arm.L' | 'forearm.L' | 'hand.L') =>
    gltf.scene.worldToLocal(rig.bones.get(name)!.getWorldPosition(new Vector3()));
  const shoulder = position('upper_arm.L');
  const elbow = position('forearm.L');
  const hand = position('hand.L');
  const ik = new RabbitArmIK(elbow.clone().sub(shoulder), hand.clone().sub(elbow), 1,
    rig.elbowLimitsByRaise, rig.limits);
  try {
    for (const plane of [0, 22.5, 45, 67.5, 90]) {
      for (const [raise, flexion] of [[0, 0], [0, 110], [75, 110], [90, 75], [120, 45], [150, 0]]) {
        rig.resetPose(true);
        rig.setArmRotation('left', raise, flexion, plane);
        rig.update(10);
        assert.ok(ik.forward(raise, flexion, plane, point).distanceTo(position('hand.L').sub(shoulder)) < 2e-6,
          `Mismatch at ${raise}/${flexion}/${plane}`);
      }
    }
  } finally { rig.dispose(); }
});

test('feasible human-derived targets solve exactly without an extra filter or iteration loop', () => {
  const ik = solver();
  for (const pose of [{ raise: 0, elbow: 0, plane: 0 }, { raise: 65, elbow: 110, plane: 30 },
    { raise: 120, elbow: 45, plane: 90 }, { raise: 150, elbow: 0, plane: 45 }]) {
    const target = ik.forward(pose.raise, pose.elbow, pose.plane, new Vector3());
    const result = ik.solve(target, pose);
    feasible(result);
    close(result.residual, 0);
    close(result.raise, pose.raise);
    close(result.elbow, pose.elbow);
    assert.equal(result.iterations, 1);
    assert.equal(result.clamped, false);
  }
});

test('external relative hand targets are solved through the coupled manifold', () => {
  const ik = solver();
  for (const [raise, elbow, plane] of [[50, 60, 45], [120, 30, 85], [90, 70, 25], [145, 0, 60]]) {
    const target = ik.forward(raise, elbow, plane, new Vector3());
    ik.reset();
    const result = ik.solve(target);
    feasible(result);
    assert.ok(result.residual < .002, `${JSON.stringify(result)} target ${raise}/${elbow}/${plane}`);
    assert.ok(result.iterations <= 1000);
  }
});

test('high raise with deep elbow seeks a closer safe hand point than independent elbow clamping', () => {
  const ik = solver();
  const requested = { raise: 120, elbow: 110, plane: 45 };
  const target = ik.forward(requested.raise, requested.elbow, requested.plane, new Vector3());
  const independentlyClamped = ik.forward(120, 45, 45, new Vector3()).distanceTo(target);
  const result = ik.solve(target, requested);
  feasible(result);
  assert.equal(result.clamped, true);
  assert.ok(result.residual < independentlyClamped * .8);
  assert.ok(result.raise < 120);
  assert.ok(result.elbow > 45);
});

test('unreachable targets stay on tested joint bounds and approximate the nearest feasible surface', () => {
  const ik = solver();
  for (const target of [new Vector3(5, 5, 5), new Vector3(-.2, .3, .6), new Vector3(.5, -.1, -.5)]) {
    let reference = Infinity;
    for (let raise = -12; raise <= 150; raise += 3) {
      const maximum = rabbitRaiseLimit(curve, Math.max(0, raise));
      for (let elbow = 0; elbow <= maximum; elbow += 5) {
        for (let plane = 0; plane <= 90; plane += 5) reference = Math.min(reference,
          ik.forward(raise, elbow, plane, point).distanceTo(target));
      }
    }
    ik.reset();
    const result = ik.solve(target);
    feasible(result);
    assert.ok(result.residual <= reference + .002, `${result.residual} exceeds grid ${reference}`);
    assert.equal(result.clamped, true);
    assert.ok(ik.forward(result.raise, result.elbow, result.plane, point).length() <= upper.length() + lower.length() + 1e-8);
  }
});

test('left and right arm goals mirror symmetrically and have independent persistent state', () => {
  const left = solver(1), right = solver(-1);
  for (const [raise, elbow, plane] of [[120, 110, 45], [40, 90, 90], [145, 80, 15]]) {
    const targetL = left.forward(raise, elbow, plane, new Vector3());
    const targetR = new Vector3(-targetL.x, targetL.y, targetL.z);
    const seed = { raise, elbow, plane };
    const l = { ...left.solve(targetL, seed) }, r = { ...right.solve(targetR, seed) };
    close(l.raise, r.raise); close(l.elbow, r.elbow); close(l.plane, r.plane); close(l.residual, r.residual);
    left.solve(new Vector3(.5, .1, .3));
    const rightHeld = right.solve(new Vector3(NaN, 0, 0));
    close(rightHeld.raise, r.raise); close(rightHeld.elbow, r.elbow); close(rightHeld.plane, r.plane);
  }
});

test('invalid targets hold the last valid joints and reset returns an exact neutral state', () => {
  const ik = solver(), seed = { raise: 90, elbow: 30, plane: 45 };
  const valid = { ...ik.solve(ik.forward(90, 30, 45, new Vector3()), seed) };
  for (const target of [new Vector3(NaN, 0, 0), new Vector3(0, Infinity, 0), new Vector3(1e300, 0, 0)]) {
    const held = ik.solve(target);
    close(held.raise, valid.raise); close(held.elbow, valid.elbow); close(held.plane, valid.plane);
    assert.equal(held.valid, false);
    assert.ok(Object.values(held).every(value => typeof value !== 'number' || Number.isFinite(value)));
  }
  ik.reset();
  const result = ik.solve(upper.clone().add(lower), { raise: 0, elbow: 0, plane: 0 });
  close(result.raise, 0); close(result.elbow, 0); close(result.residual, 0);
  assert.equal(result.valid, true);
});

test('continuous noisy hand requests retain bounded joint changes across the coupled elbow boundary', () => {
  const ik = solver();
  let previous: RabbitArmAngles | undefined;
  let largestJointStep = 0;
  for (let frame = 0; frame < 301; frame++) {
    const requested = { raise: 70 + frame * .2, elbow: 100, plane: 45 + 2 * Math.sin(frame * .05) };
    const target = ik.forward(requested.raise, requested.elbow, requested.plane, new Vector3());
    target.z += .0002 * Math.sin(frame);
    const result = ik.solve(target, requested);
    feasible(result);
    if (previous) largestJointStep = Math.max(largestJointStep, Math.abs(result.raise - previous.raise),
      Math.abs(result.elbow - previous.elbow), Math.abs(result.plane - previous.plane));
    previous = { ...result };
  }
  assert.ok(largestJointStep < 5, `Largest parameter step ${largestJointStep}`);
});
