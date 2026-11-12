import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Box3, DoubleSide, MathUtils, Mesh, Quaternion, Raycaster, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Rabbit3D } from '../src/game/3d/Rabbit3D';
import { RabbitArmIK } from '../src/game/3d/ik/RabbitArmIK';
import { RABBIT_V3_LIMITS, type RabbitRaiseLimitCurve } from '../src/game/3d/rabbit3dConfig';

const curve: RabbitRaiseLimitCurve = [[0, 110], [75, 110], [90, 75], [105, 60], [120, 45], [135, 20], [150, 0]];
const upper = new Vector3(.04072559, -.38747811, 0);
const lower = new Vector3(.03790599, -.36065143, 0);
const solver = () => new RabbitArmIK(upper, lower, 1, curve, RABBIT_V3_LIMITS);

async function fixture(version = 'v3') {
  const file = version === 'v3' ? 'rabbit_realtime_v3.glb' : 'rabbit_realtime.glb';
  const bytes = readFileSync(new URL(`../model/dist/rabbit3d/${file}`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  return new Rabbit3D(gltf.scene);
}

function advance(rabbit: Rabbit3D, frames = 120) {
  for (let frame = 0; frame < frames; frame++) rabbit.rig.update(1 / 60);
}

test('inward shoulder planes require explicit opt-in and V2 keeps its original range', async () => {
  const ik = solver();
  assert.equal(ik.maximumPlane, 90);
  const original = ik.forward(90, 10, 145, new Vector3());
  assert.ok(original.distanceTo(ik.forward(90, 10, 90, new Vector3())) < 1e-12);
  ik.setInwardEnabled(true);
  assert.equal(ik.maximumPlane, 145);
  assert.ok(original.distanceTo(ik.forward(90, 10, 145, new Vector3())) > .4);
  ik.setInwardEnabled(false);
  assert.equal(ik.maximumPlane, 90);
  const legacy = await fixture('v2');
  try {
    legacy.rig.setArmInwardEnabled(true);
    assert.equal(legacy.rig.armInwardEnabled, false);
  } finally { legacy.dispose(); }
});

test('inward bounds cover shoulder raise, low-raise torso clearance and elbow flexion together', () => {
  const ik = solver();
  ik.setInwardEnabled(true);
  assert.deepEqual(ik.constrain(150, 110, 145), { raise: 90, elbow: 10, plane: 145 });
  assert.deepEqual(ik.constrain(60, 10, 145), { raise: 60, elbow: 10, plane: 140 });
  assert.equal(ik.maximumPlaneForRaise(80), 142.5);
  assert.equal(ik.maximumRaise(145), 90);
  for (const plane of [90, 91, 95, 100, 120, 140, 145]) {
    for (const raise of [0, 30, 60, 80, 90, 120, 150]) {
      const pose = ik.constrain(raise, 110, plane);
      assert.ok(pose.plane <= ik.maximumPlaneForRaise(pose.raise) + 1e-8);
      assert.ok(pose.raise <= ik.maximumRaise(pose.plane) + 1e-8);
      assert.ok(pose.elbow <= ik.maximumElbow(pose.raise, pose.plane) + 1e-8);
    }
  }
});

test('enabled solver and actual V3 FK/IK agree on feasible inward hand transforms', async () => {
  const rabbit = await fixture();
  const { rig, model } = rabbit;
  const point = (name: 'upper_arm.L' | 'forearm.L' | 'hand.L') =>
    model.worldToLocal(rig.bones.get(name)!.getWorldPosition(new Vector3()));
  const shoulder = point('upper_arm.L');
  const elbow = point('forearm.L');
  const hand = point('hand.L');
  const ik = new RabbitArmIK(elbow.clone().sub(shoulder), hand.clone().sub(elbow), 1,
    rig.elbowLimitsByRaise, rig.limits);
  ik.setInwardEnabled(true);
  rig.setArmInwardEnabled(true);
  try {
    for (const [raise, flexion, plane] of [[60, 10, 120], [80, 0, 140], [85, 10, 145], [90, 10, 145]]) {
      const expected = ik.forward(raise, flexion, plane, new Vector3());
      const solution = ik.solve(expected, { raise, elbow: flexion, plane });
      assert.ok(solution.residual < 1e-7);
      assert.equal(solution.iterations, 1);
      ik.reset();
      assert.ok(ik.solve(expected).residual < .002);
      for (const enabled of [false, true]) {
        rig.setIKEnabled(enabled);
        rig.setArmRotation('left', raise, flexion, plane);
        rig.setArmRotation('right', raise, flexion, plane);
        advance(rabbit);
        assert.ok(point('hand.L').sub(point('upper_arm.L')).distanceTo(expected) < 3e-6);
      }
    }
    const finalLeft = rig.bones.get('hand.L')!.getWorldPosition(new Vector3());
    const finalRight = rig.bones.get('hand.R')!.getWorldPosition(new Vector3());
    assert.ok(Math.abs(finalLeft.x + finalRight.x) < 1e-6);
    assert.ok(finalLeft.distanceTo(finalRight) < .44);
  } finally { rabbit.dispose(); }
});

test('interpolated final V3 joints satisfy inward constraints on every applied frame', async () => {
  const rabbit = await fixture();
  const { rig, model } = rabbit;
  const bone = rig.bones.get('upper_arm.L')!;
  const rest = bone.quaternion.clone().normalize();
  const inverseWorld = bone.getWorldQuaternion(new Quaternion()).invert();
  const modelRotation = model.getWorldQuaternion(new Quaternion());
  const axisX = new Vector3(1, 0, 0).applyQuaternion(modelRotation).applyQuaternion(inverseWorld);
  const axisZ = new Vector3(0, 0, 1).applyQuaternion(modelRotation).applyQuaternion(inverseWorld);
  const elbowRest = rig.bones.get('forearm.L')!.quaternion.clone().normalize();
  const ik = solver();
  ik.setInwardEnabled(true);
  rig.setArmInwardEnabled(true);
  rig.setIKEnabled(true);
  try {
    for (const [raise, elbow, plane] of [[150, 0, 90], [90, 10, 145], [45, 110, 145],
      [85, 10, 145], [0, 110, 0], [120, 110, 120]]) {
      rig.setArmRotation('left', raise, elbow, plane);
      for (let frame = 0; frame < 45; frame++) {
        rig.update(1 / 60);
        const rotation = bone.quaternion.clone().normalize();
        const elevation = MathUtils.radToDeg(rest.angleTo(rotation));
        const delta = rest.clone().invert().multiply(rotation);
        const vector = new Vector3(delta.x, delta.y, delta.z);
        const appliedPlane = Math.max(0, MathUtils.radToDeg(Math.atan2(-vector.dot(axisX), vector.dot(axisZ))));
        const flexion = MathUtils.radToDeg(elbowRest.angleTo(rig.bones.get('forearm.L')!.quaternion.clone().normalize()));
        assert.ok(elevation <= ik.maximumRaise(appliedPlane) + 1e-4);
        assert.ok(appliedPlane <= ik.maximumPlaneForRaise(elevation) + 1e-4);
        assert.ok(flexion <= ik.maximumElbow(elevation, appliedPlane) + 1e-4);
      }
    }
  } finally { rabbit.dispose(); }
});

test('representative inward V3 skins remain outside head and distal torso surfaces', async () => {
  const rabbit = await fixture();
  const { rig, model } = rabbit;
  rig.setArmInwardEnabled(true);
  rig.setIKEnabled(true);
  const targets = ['Rabbit_Head', 'Rabbit_Body'].map(name => model.getObjectByName(name) as Mesh);
  for (const mesh of targets) {
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.side = DoubleSide;
  }
  const arms: SkinnedMesh[] = [];
  model.traverse(mesh => { if (mesh instanceof SkinnedMesh && mesh.name.startsWith('Rabbit_Arm_')) arms.push(mesh); });
  const ray = new Raycaster();
  const direction = new Vector3(.953, .123, .278).normalize();
  try {
    for (const [raise, elbow, plane, lean, bend] of [[90, 10, 145, 0, 0], [85, 10, 145, 12, .65],
      [85, 10, 145, -12, .65], [60, 10, 140, 0, 0], [80, 0, 140, 0, .65]]) {
      rig.setArmRotation('left', raise, elbow, plane);
      rig.setArmRotation('right', raise, elbow, plane);
      rig.setBodyLean(lean);
      rig.setKneeBend(bend);
      advance(rabbit);
      for (const arm of arms) {
        arm.skeleton.update();
        const shoulder = rig.bones.get(arm.name.endsWith('L') ? 'upper_arm.L' : 'upper_arm.R')!.getWorldPosition(new Vector3());
        for (const target of targets) {
          const bounds = new Box3().setFromObject(target);
          for (let index = 0; index < arm.geometry.getAttribute('position').count; index++) {
            const point = arm.getVertexPosition(index, new Vector3()).applyMatrix4(arm.matrixWorld);
            if (!bounds.containsPoint(point) || (target.name === 'Rabbit_Body' && point.distanceTo(shoulder) <= .24)) continue;
            ray.set(point, direction);
            const distances = ray.intersectObject(target, false).map(hit => hit.distance)
              .filter((value, i, all) => i === 0 || Math.abs(value - all[i - 1]) > 1e-5);
            assert.equal(distances.length % 2, 0, `${arm.name} inside ${target.name} at ${raise}/${elbow}/${plane}`);
          }
        }
      }
    }
  } finally { rabbit.dispose(); }
});

test('invalid inward requests remain finite and reset/disable retain the original control lifecycle', async () => {
  const rabbit = await fixture();
  const { rig } = rabbit;
  rig.setArmInwardEnabled(true);
  rig.setIKEnabled(true);
  try {
    rig.setArmRotation('left', Infinity, NaN, Infinity);
    rig.setArmRotation('right', 1e300, 1e300, 1e300);
    advance(rabbit);
    assert.ok([...rig.bones.values()].every(bone => bone.quaternion.toArray().every(Number.isFinite)));
    rig.resetPose(true);
    rig.setArmInwardEnabled(false);
    assert.equal(rig.armInwardEnabled, false);
    rig.setArmRotation('left', 90, 10, 145);
    advance(rabbit);
    assert.ok(rig.ikSnapshot().hands.L.plane <= 90);
  } finally { rabbit.dispose(); }
});
