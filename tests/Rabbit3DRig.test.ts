import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RabbitRigController } from '../src/game/3d/RabbitRigController';
import { RABBIT_3D_CONFIG, RABBIT_REQUIRED_BONES } from '../src/game/3d/rabbit3dConfig';

const glbUrl = new URL('../model/dist/rabbit3d/rabbit_realtime.glb', import.meta.url);

async function fixture() {
  const bytes = readFileSync(glbUrl);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(data, '');
  const rig = new RabbitRigController(gltf.scene);
  return { gltf, rig };
}

const closeVector = (first: Vector3, second: Vector3, tolerance = 1e-7) => {
  assert.ok(first.distanceTo(second) < tolerance, `${first.toArray()} differs from ${second.toArray()}`);
};
const position = (object: Object3D) => object.getWorldPosition(new Vector3());
const settle = (rig: RabbitRigController) => rig.update(10);

test('real GLB parses with all 19 original bone identities and hybrid bindings', async () => {
  const { gltf, rig } = await fixture();
  assert.equal(gltf.animations.length, 0);
  assert.equal(rig.bones.size, 19);
  for (const name of RABBIT_REQUIRED_BONES) {
    assert.equal(rig.bones.get(name)?.userData.originalBoneName, name);
  }
  const skins: SkinnedMesh[] = [];
  gltf.scene.traverse(object => { if (object instanceof SkinnedMesh) skins.push(object); });
  assert.equal(skins.length, 4);
  assert.ok(skins.every(mesh => mesh.skeleton.bones.length === 19));
  assert.equal(gltf.scene.getObjectByName('Rabbit_Head')?.parent, rig.bones.get('head'));
  assert.equal(gltf.scene.getObjectByName('Rabbit_Eye_L')?.parent?.name, 'Rabbit_Head');
  assert.equal(gltf.scene.getObjectByName('Rabbit_Ear_L')?.parent, rig.bones.get('ear.L'));
});

test('left and right arm controls raise their own hand and deform their own skin independently', async () => {
  const { gltf, rig } = await fixture();
  const left = rig.bones.get('hand.L')!;
  const right = rig.bones.get('hand.R')!;
  const leftRest = position(left);
  const rightRest = position(right);
  const arm = gltf.scene.getObjectByName('Rabbit_Arm_L') as SkinnedMesh;
  arm.skeleton.update();
  const restVertices = Array.from({ length: arm.geometry.getAttribute('position').count }, (_, index) => arm.getVertexPosition(index, new Vector3()));
  rig.setArmRotation('left', 70);
  settle(rig);
  assert.ok(position(left).y > leftRest.y + 0.35);
  closeVector(position(right), rightRest);
  arm.skeleton.update();
  const maximumMovement = Math.max(...restVertices.map((vertex, index) => vertex.distanceTo(arm.getVertexPosition(index, new Vector3()))));
  assert.ok(maximumMovement > 0.2, `Skinned arm did not deform: ${maximumMovement}`);
  const movedLeft = position(left);
  rig.setArmRotation('right', 70);
  settle(rig);
  assert.ok(position(right).y > rightRest.y + 0.35);
  closeVector(position(left), movedLeft);
  assert.ok(Math.abs(position(left).y - position(right).y) < 1e-5);
});

test('body side lean and forward lean use verified model axes while head carries features', async () => {
  const { gltf, rig } = await fixture();
  const headRest = position(rig.bones.get('head')!);
  rig.setBodyLean(10, 0);
  settle(rig);
  assert.ok(position(rig.bones.get('head')!).x < headRest.x - 0.1);
  rig.resetPose(true);
  rig.setBodyLean(0, 10);
  settle(rig);
  assert.ok(position(rig.bones.get('head')!).z > headRest.z + 0.1);
  rig.resetPose(true);
  const eye = gltf.scene.getObjectByName('Rabbit_Eye_L')!;
  const ear = rig.bones.get('ear.L')!;
  const eyeRest = position(eye);
  const earRest = position(ear);
  rig.setHeadRotation(20, 8, 5);
  settle(rig);
  assert.ok(position(eye).distanceTo(eyeRest) > 0.04);
  assert.ok(position(ear).distanceTo(earRest) > 0.04);
});

test('continuous shallow FK knee bend lowers body and approximately preserves sole height', async () => {
  const { gltf, rig } = await fixture();
  const foot = rig.bones.get('foot.L')!;
  const footRest = position(foot);
  const footRotation = foot.getWorldQuaternion(new Quaternion()).normalize();
  const root = rig.bones.get('root')!;
  const rootRest = position(root);
  const legs = ['L', 'R'].map(side => gltf.scene.getObjectByName(`Rabbit_Leg_${side}`) as SkinnedMesh);
  const soleHeight = (mesh: SkinnedMesh) => {
    mesh.skeleton.update();
    let minimum = Infinity;
    for (let index = 0; index < mesh.geometry.getAttribute('position').count; index++) {
      minimum = Math.min(minimum, mesh.getVertexPosition(index, new Vector3()).applyMatrix4(mesh.matrixWorld).y);
    }
    return minimum;
  };
  const soleRest = legs.map(soleHeight);
  const samples: number[] = [];
  for (const amount of [0, 0.25, 0.5, 0.75, 1]) {
    rig.setKneeBend(amount);
    settle(rig);
    samples.push(position(root).y);
    assert.ok(Math.abs(position(foot).y - footRest.y) < 0.001);
    assert.ok(Math.abs(position(foot).z - footRest.z) < 0.003);
    const worldRotation = foot.getWorldQuaternion(new Quaternion()).normalize();
    assert.ok(worldRotation.angleTo(footRotation) < 1e-5);
    legs.forEach((leg, index) => assert.ok(Math.abs(soleHeight(leg) - soleRest[index]) < 0.001));
  }
  assert.ok(samples.every((value, index) => index === 0 || value < samples[index - 1]));
  assert.ok(rootRest.y - samples[4] > 0.03);
  const maximum = root.position.clone();
  rig.setKneeBend(100);
  settle(rig);
  closeVector(root.position, maximum);
});

test('root offset and all angle controls clamp nonfinite and extreme inputs', async () => {
  const { rig } = await fixture();
  const root = rig.bones.get('root')!;
  const rest = position(root);
  const limits = RABBIT_3D_CONFIG.limits;
  rig.setRootOffset(100, 100, -100);
  settle(rig);
  closeVector(position(root), rest.clone().add(new Vector3(limits.root.x, limits.root.y, -limits.root.z)));
  rig.setArmRotation('L', 1000, 1000);
  settle(rig);
  const upper = rig.bones.get('upper_arm.L')!.quaternion.clone();
  const forearm = rig.bones.get('forearm.L')!.quaternion.clone();
  rig.setArmRotation('L', limits.arm.max, limits.forearm.max);
  settle(rig);
  assert.ok(upper.angleTo(rig.bones.get('upper_arm.L')!.quaternion) < 1e-7);
  assert.ok(forearm.angleTo(rig.bones.get('forearm.L')!.quaternion) < 1e-7);
  rig.setRootOffset(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY);
  settle(rig);
  closeVector(position(root), rest);
});

test('targets are rest-relative with no accumulating rotation and reset restores exact rest', async () => {
  const { rig } = await fixture();
  const rest = new Map([...rig.bones].map(([name, bone]) => [name, { q: bone.quaternion.clone(), p: bone.position.clone() }]));
  rig.setArmRotation('L', 60, 25);
  settle(rig);
  const target = rig.bones.get('upper_arm.L')!.quaternion.clone();
  for (let index = 0; index < 1000; index++) {
    rig.setArmRotation('L', 60, 25);
    rig.update(1 / 60);
  }
  assert.ok(target.angleTo(rig.bones.get('upper_arm.L')!.quaternion) < 1e-7);
  rig.setBodyLean(8, 6);
  rig.setHeadRotation(12, 8, 5);
  rig.setKneeBend(0.6);
  rig.setRootOffset(0.3, 0.02, 0.1);
  settle(rig);
  rig.resetPose();
  settle(rig);
  for (const [name, bone] of rig.bones) {
    assert.deepEqual(bone.quaternion.toArray(), rest.get(name)!.q.toArray(), name);
    closeVector(bone.position, rest.get(name)!.p);
  }
});

test('exponential interpolation is smooth and invariant across frame rates', async () => {
  const first = await fixture();
  const second = await fixture();
  first.rig.setArmRotation('L', 90);
  second.rig.setArmRotation('L', 90);
  const rest = first.rig.bones.get('upper_arm.L')!.quaternion.clone();
  first.rig.update(1 / 60);
  const firstStep = rest.angleTo(first.rig.bones.get('upper_arm.L')!.quaternion);
  assert.ok(firstStep > 0 && firstStep < Math.PI / 2);
  for (let index = 1; index < 30; index++) first.rig.update(1 / 60);
  for (let index = 0; index < 60; index++) second.rig.update(1 / 120);
  assert.ok(first.rig.bones.get('upper_arm.L')!.quaternion.angleTo(second.rig.bones.get('upper_arm.L')!.quaternion) < 1e-7);
  first.rig.dispose();
  first.rig.setArmRotation('L', 90);
  first.rig.update(1);
  assert.ok(rest.angleTo(first.rig.bones.get('upper_arm.L')!.quaternion) < 1e-7);
});

test('incomplete rigs fail explicitly before preview activation', () => {
  assert.throws(() => new RabbitRigController(new Object3D()), /missing bones: root, body, head/);
});


test('independent bounded leg extension preserves the support foot and counterrotates the raised foot', async () => {
  const { rig } = await fixture();
  const left = rig.bones.get('foot.L')!;
  const right = rig.bones.get('foot.R')!;
  for (const bend of [0, 0.5, 1]) {
    rig.resetPose(true);
    rig.setKneeBend(bend);
    settle(rig);
    const leftRest = position(left);
    const rightRest = position(right);
    const leftRotation = left.getWorldQuaternion(new Quaternion()).normalize();
    rig.setLegExtension('L', 1);
    settle(rig);
    assert.ok(position(left).x > leftRest.x + 0.15);
    assert.ok(position(left).y > leftRest.y + 0.03);
    closeVector(position(right), rightRest);
    assert.ok(left.getWorldQuaternion(new Quaternion()).normalize().angleTo(leftRotation) < 1e-5);
    const maximum = position(left);
    rig.setLegExtension('L', 100);
    settle(rig);
    closeVector(position(left), maximum);
    rig.setLegExtension('L', Number.NaN);
    settle(rig);
    closeVector(position(left), leftRest);
    rig.setLegExtension('R', 1);
    settle(rig);
    assert.ok(position(right).x < rightRest.x - 0.15);
    closeVector(position(left), leftRest);
  }
});

test('v2 body lean preserves planted feet during shallow knee bend', async () => {
  const { gltf, rig } = await fixture();
  rig.setKneeBend(0.6);
  settle(rig);
  const feet = ['L', 'R'].map(side => gltf.scene.getObjectByName(`Rabbit_Leg_${side}`) as SkinnedMesh);
  const vertices = () => feet.map(mesh => {
    mesh.skeleton.update();
    return Array.from({ length: mesh.geometry.getAttribute('position').count }, (_, index) =>
      mesh.getVertexPosition(index, new Vector3()).applyMatrix4(mesh.matrixWorld));
  });
  const planted = vertices();
  for (const sideLean of [-14, 14]) {
    rig.setBodyLean(sideLean, 8);
    settle(rig);
    vertices().forEach((points, side) => points.forEach((point, index) => closeVector(point, planted[side][index])));
  }
  rig.setRootOffset(0.35);
  settle(rig);
  vertices().forEach((points, side) => points.forEach((point, index) =>
    closeVector(point, planted[side][index].clone().add(new Vector3(0.35, 0, 0)))));
});
