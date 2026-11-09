import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Box3, DoubleSide, Mesh, Object3D, Quaternion, Raycaster, SkinnedMesh, Vector3 } from 'three';
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

test('bounded shoulder swing reaches head level sideways and forward without translating the joints', async () => {
  const { rig } = await fixture();
  const pivots = new Map([...rig.bones].map(([name, bone]) => [name, bone.position.clone()]));
  const left = rig.bones.get('hand.L')!;
  const shoulder = rig.bones.get('upper_arm.L')!;
  const shoulderRest = position(shoulder);
  const handRest = position(left);
  rig.setArmRotation('left', 145);
  settle(rig);
  assert.ok(position(left).y > position(rig.bones.get('head')!).y + 0.1);
  assert.ok(position(left).y - handRest.y > 0.95);
  closeVector(position(shoulder), shoulderRest);
  rig.setArmRotation('left', 90, 0, 90);
  settle(rig);
  assert.ok(position(left).z - handRest.z > 0.65);
  assert.ok(position(left).y - handRest.y > 0.65);
  for (const [name, bone] of rig.bones) closeVector(bone.position, pivots.get(name)!);
  const maximumPlane = left.quaternion.clone();
  rig.setArmRotation('left', 90, 0, 1000);
  settle(rig);
  assert.ok(left.quaternion.angleTo(maximumPlane) < 1e-7);
});

test('elbows flex outward and forward with pose-dependent head clearance', async () => {
  const { rig } = await fixture();
  const hand = rig.bones.get('hand.L')!;
  const elbow = rig.bones.get('forearm.L')!;
  const handRest = position(hand);
  const elbowRest = position(elbow);
  rig.setArmRotation('left', 0, 100);
  settle(rig);
  assert.ok(position(hand).z > handRest.z + 0.2);
  closeVector(position(elbow), elbowRest);
  rig.setArmRotation('left', 145, 100);
  settle(rig);
  const limited = elbow.quaternion.clone();
  rig.setArmRotation('left', 100, 100);
  settle(rig);
  assert.ok(limited.angleTo(elbow.quaternion) < 1e-7);
});

test('combined FK motion preserves segment lengths, planted legs and bounded head roll', async () => {
  const { rig } = await fixture();
  const length = (first: 'upper_arm.L' | 'upper_arm.R', second: 'forearm.L' | 'forearm.R') =>
    position(rig.bones.get(first)!).distanceTo(position(rig.bones.get(second)!));
  const restLengths = [length('upper_arm.L', 'forearm.L'), length('upper_arm.R', 'forearm.R')];
  const feetRest = ['foot.L', 'foot.R'].map(name => position(rig.bones.get(name as 'foot.L' | 'foot.R')!));
  for (let step = 0; step <= 20; step++) {
    const amount = step / 20;
    rig.setArmRotation('left', 145 * amount, 100 * amount, 90 * amount);
    rig.setArmRotation('right', 120 * amount, 80 * amount, 45 * amount);
    rig.setBodyLean(18 * amount, 16 * amount);
    rig.setHeadRotation(20 * amount, 0, -7.2 * amount);
    rig.setKneeBend(amount);
    settle(rig);
    assert.ok(Math.abs(length('upper_arm.L', 'forearm.L') - restLengths[0]) < 1e-6);
    assert.ok(Math.abs(length('upper_arm.R', 'forearm.R') - restLengths[1]) < 1e-6);
    for (const [index, name] of ['foot.L', 'foot.R'].entries()) {
      assert.ok(Math.abs(position(rig.bones.get(name as 'foot.L' | 'foot.R')!).y - feetRest[index].y) < 0.001);
    }
    for (const bone of rig.bones.values()) {
      assert.ok([...bone.position.toArray(), ...bone.quaternion.toArray()].every(Number.isFinite));
      assert.ok(Math.abs(bone.quaternion.lengthSq() - 1) < 1e-5);
    }
  }
  rig.resetPose(true);
  const neutral = rig.bones.get('head')!.getWorldQuaternion(new Quaternion());
  rig.setBodyLean(18);
  rig.setHeadRotation(0, 0, -7.2);
  settle(rig);
  const roll = neutral.angleTo(rig.bones.get('head')!.getWorldQuaternion(new Quaternion())) * 180 / Math.PI;
  assert.ok(Math.abs(roll - 10.8) < 1e-4);
});


test('coordinated FK avoids head penetration beyond sub-pixel shoulder seam contacts', async () => {
  const { gltf, rig } = await fixture();
  const head = gltf.scene.getObjectByName('Rabbit_Head') as Mesh;
  for (const material of Array.isArray(head.material) ? head.material : [head.material]) material.side = DoubleSide;
  const ray = new Raycaster();
  const rayDirection = new Vector3(1, 0.123, 0.321).normalize();
  const contactDirections = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0),
    new Vector3(0, 1, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)];
  const assertClear = (side: 'L' | 'R', description: string) => {
    const arm = gltf.scene.getObjectByName(`Rabbit_Arm_${side}`) as SkinnedMesh;
    arm.skeleton.update();
    const bounds = new Box3().setFromObject(head);
    const shoulder = position(rig.bones.get(`upper_arm.${side}`)!);
    for (let index = 0; index < arm.geometry.getAttribute('position').count; index++) {
      const vertex = arm.getVertexPosition(index, new Vector3()).applyMatrix4(arm.matrixWorld);
      if (!bounds.containsPoint(vertex)) continue;
      ray.set(vertex, rayDirection);
      const crossings = ray.intersectObject(head, false).map(hit => hit.distance)
        .filter((distance, hitIndex, distances) => hitIndex === 0 || Math.abs(distance - distances[hitIndex - 1]) > 1e-5);
      if (crossings.length % 2 === 0) continue;
      let penetration = Infinity;
      for (const direction of contactDirections) {
        ray.set(vertex, direction);
        penetration = Math.min(penetration, ray.intersectObject(head, false)[0]?.distance ?? Infinity);
      }
      // Imported shoulder seams may touch by less than half a logical pixel.
      assert.ok(vertex.distanceTo(shoulder) <= 0.12 && penetration <= 0.005,
        `${description}, ${side} arm vertex ${index} penetrates ${penetration} model units`);
    }
    ray.set(position(rig.bones.get(`hand.${side}`)!), rayDirection);
    const wristCrossings = ray.intersectObject(head, false).map(hit => hit.distance)
      .filter((distance, index, distances) => index === 0 || Math.abs(distance - distances[index - 1]) > 1e-5);
    assert.equal(wristCrossings.length % 2, 0, `${description}, ${side} wrist is inside the head`);
  };
  for (const plane of [0, 30, 45, 60, 90]) {
    for (const requested of [0, 60, 90, 100, 120, 145]) {
      for (const elbow of [0, 30, 60, 100]) {
        rig.resetPose(true);
        rig.setArmRotation('left', requested, elbow, plane);
        settle(rig);
        assertClear('L', `shoulder ${requested}, elbow ${elbow}, plane ${plane}`);
      }
    }
  }
  for (const sign of [-1, 1]) {
    for (const plane of [0, 30, 45, 60, 90]) {
      for (const requested of [0, 60, 75, 85, 90]) {
        for (const elbow of [0, 60, 100]) {
          rig.resetPose(true);
          rig.setArmRotation('left', requested, elbow, plane);
          rig.setArmRotation('right', requested, elbow, plane);
          rig.setBodyLean(sign * 18, 16);
          rig.setHeadRotation(sign * 25, sign * 18, -sign * 7.2);
          rig.setKneeBend(1);
          settle(rig);
          assertClear('L', `combined pose, shoulder ${requested}, plane ${plane}, elbow ${elbow}, sign ${sign}`);
          assertClear('R', `combined pose, shoulder ${requested}, plane ${plane}, elbow ${elbow}, sign ${sign}`);
        }
      }
    }
  }
});


test('head clearance coordinates both setter orders and changes continuously as arms rise', async () => {
  const first = await fixture();
  const second = await fixture();
  const firstHead = first.rig.bones.get('head')!;
  const secondHead = second.rig.bones.get('head')!;
  const rest = firstHead.quaternion.clone();
  first.rig.setHeadRotation(25, 18, 7.2);
  let previous = Infinity;
  for (let elevation = 0; elevation <= 90; elevation += 3) {
    first.rig.setArmRotation('left', elevation, 60, 45);
    second.rig.setArmRotation('left', elevation, 60, 45);
    second.rig.setHeadRotation(25, 18, 7.2);
    settle(first.rig); settle(second.rig);
    assert.ok(firstHead.quaternion.angleTo(secondHead.quaternion) < 1e-7);
    const angle = rest.angleTo(firstHead.quaternion) * 180 / Math.PI;
    assert.ok(angle <= previous + 1e-7);
    assert.ok(angle <= 12.5);
    previous = angle;
  }
  assert.ok(rest.angleTo(firstHead.quaternion) < 1e-7);
  first.rig.setArmRotation('left', 0);
  settle(first.rig);
  assert.ok(rest.angleTo(firstHead.quaternion) > 0.1);
  first.rig.resetPose(true);
  first.rig.setArmRotation('left', 0);
  settle(first.rig);
  assert.ok(rest.angleTo(firstHead.quaternion) < 1e-7);
  first.rig.dispose();
  first.rig.setHeadRotation(25, 18, 7.2);
  settle(first.rig);
  assert.ok(rest.angleTo(firstHead.quaternion) < 1e-7);
});
