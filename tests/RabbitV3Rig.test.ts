import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { Box3, DoubleSide, Group, Mesh, OrthographicCamera, Quaternion, Raycaster, SkinnedMesh, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Rabbit3D } from '../src/game/3d/Rabbit3D';
import { projectToLogical } from '../src/game/3d/RabbitFootTracker';
import { RABBIT_3D_CONFIG, RABBIT_REQUIRED_BONES, rabbitPreviewModelUrl, rabbitRigProfile } from '../src/game/3d/rabbit3dConfig';

const v2Url = new URL('../model/dist/rabbit3d/rabbit_realtime.glb', import.meta.url);
const v3Url = new URL('../model/dist/rabbit3d/rabbit_realtime_v3.glb', import.meta.url);
const missingV3 = !existsSync(v3Url);
const degrees = (angle: number) => angle * 180 / Math.PI;
const close = (actual: number, expected: number, tolerance = 1e-5) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
const position = (object: Object3D) => object.getWorldPosition(new Vector3());

async function fixture(url = v3Url) {
  const bytes = readFileSync(url);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(data, '');
  const rabbit = new Rabbit3D(gltf.scene);
  const skins: SkinnedMesh[] = [];
  gltf.scene.traverse(object => { if (object instanceof SkinnedMesh) skins.push(object); });
  return { gltf, rabbit, rig: rabbit.rig, skins };
}

function settle(rabbit: Rabbit3D) {
  rabbit.rig.update(10);
  rabbit.pivot.updateMatrixWorld(true);
  rabbit.model.traverse(object => { if (object instanceof SkinnedMesh) object.skeleton.update(); });
}

function vertices(mesh: Mesh): Vector3[] {
  return Array.from({ length: mesh.geometry.getAttribute('position').count }, (_, index) =>
    mesh.getVertexPosition(index, new Vector3()).applyMatrix4(mesh.matrixWorld));
}

test('untagged V2 keeps its physical limits and head-clearance behavior under larger signal targets', async () => {
  const { rabbit, rig } = await fixture(v2Url);
  try {
    assert.equal(rig.version, 'v2');
    assert.equal(rig.limits.arm.max, 90);
    assert.equal(rig.limits.forearm.max, 100);
    assert.equal(rig.limits.headMotionEnvelope, 12);
    assert.ok(RABBIT_3D_CONFIG.limits.arm.max >= 120);
    const shoulder = rig.bones.get('upper_arm.L')!;
    const head = rig.bones.get('head')!;
    const shoulderRest = shoulder.quaternion.clone().normalize();
    const headRest = head.quaternion.clone().normalize();
    rig.setHeadRotation(25, 18, 7.2);
    rig.setArmRotation('left', 150, 110, 45);
    settle(rabbit);
    close(degrees(shoulderRest.angleTo(shoulder.quaternion.clone().normalize())), 90);
    close(degrees(headRest.angleTo(head.quaternion.clone().normalize())), 0);
    assert.ok(Object.isFrozen(rig.limits) && Object.isFrozen(rig.limits.arm));
  } finally { rabbit.dispose(); }
});

test('versioned metadata accepts narrower verified ranges and rejects unsafe or unknown limits', () => {
  const model = new Group();
  model.userData.rig_version = 'v3';
  model.userData.rig_motion_limits = JSON.stringify({ arm: { max: 120 }, forearm: { max: 90 } });
  model.userData.elbow_limits_by_raise = JSON.stringify([[0, 90], [120, 0]]);
  model.userData.head_limits_by_raise = JSON.stringify([[0, 40], [120, 0]]);
  const profile = rabbitRigProfile(model);
  assert.equal(profile.version, 'v3');
  assert.equal(profile.limits.arm.max, 120);
  assert.equal(profile.limits.forearm.max, 90);
  assert.deepEqual(profile.elbowLimitsByRaise, [[0, 90], [120, 0]]);
  for (const metadata of [
    '{broken', null, [], { arm: { max: 180 } }, { forearm: { max: 180 } },
    { headMotionEnvelope: Infinity }, { headYaw: null }, { arm: null },
    { root: { x: -1 } }, { unknown: 1 }, { arm: { unknown: 1 } },
  ]) {
    model.userData.rig_motion_limits = metadata;
    assert.throws(() => rabbitRigProfile(model));
  }
  model.userData.rig_version = 'v4';
  assert.throws(() => rabbitRigProfile(model), /Unsupported Rabbit rig version/);
  model.userData.rig_version = 'v3';
  model.userData.rig_motion_limits = '{}';
  model.userData.head_limits_by_raise = [[0, 40], [150, 0]];
  for (const invalidCurve of [undefined, null, [], [[0, 110]], [[1, 110], [150, 0]],
    [[0, 110], [150, 120]], [[0, 110], [90, 20], [75, 10], [150, 0]],
    [[0, 110], [90, 20], [120, 25], [150, 0]], [[0, 110], [150, NaN]], [[0, 110], [120, 0]]]) {
    model.userData.elbow_limits_by_raise = invalidCurve;
    assert.throws(() => rabbitRigProfile(model));
  }
});

test('preview asset selection preserves an explicit V2 fallback and uses the application base URL', () => {
  assert.equal(rabbitPreviewModelUrl('/'), '/assets/rabbit3d/rabbit_realtime_v3.glb');
  assert.equal(rabbitPreviewModelUrl('/garden/', '?rabbitRig=v2'), '/garden/assets/rabbit3d/rabbit_realtime.glb');
  assert.equal(rabbitPreviewModelUrl('/garden', '?rabbitRig=v3'), '/garden/assets/rabbit3d/rabbit_realtime_v3.glb');
});

test('socket targets persist through interpolation and reset safely without moving the arms', async () => {
  const { rabbit, rig } = await fixture(v2Url);
  try {
    const socket = rig.bones.get('carrot_socket')!;
    const attachment = rabbit.model.getObjectByName('Carrot_Attach_Point')!;
    const rest = position(socket);
    const attachmentRest = position(attachment);
    const left = position(rig.bones.get('hand.L')!);
    assert.equal(socket.parent, rig.bones.get('root'));
    rig.setCarrotSocketOffset(.2, .1, .25);
    settle(rabbit);
    assert.ok(position(socket).distanceTo(rest.clone().add(new Vector3(.2, .1, .25))) < 1e-6);
    assert.ok(position(attachment).distanceTo(attachmentRest.clone().add(new Vector3(.2, .1, .25))) < 1e-6);
    settle(rabbit);
    assert.ok(position(socket).distanceTo(rest.clone().add(new Vector3(.2, .1, .25))) < 1e-6);
    assert.ok(position(rig.bones.get('hand.L')!).distanceTo(left) < 1e-6);
    rig.setCarrotSocketOffset(1000, -1000, NaN);
    settle(rabbit);
    const limit = RABBIT_3D_CONFIG.socketOffset;
    assert.ok(position(socket).distanceTo(rest.clone().add(new Vector3(limit, -limit, 0))) < 1e-6);
    rig.resetPose(true);
    assert.ok(position(socket).distanceTo(rest) < 1e-6);
    rig.dispose();
    rig.setCarrotSocketOffset(1, 1, 1);
    settle(rabbit);
    assert.ok(position(socket).distanceTo(rest) < 1e-6);
  } finally { rabbit.dispose(); }
});

test('socket offsets use model units under a rotated parent frame', async () => {
  const { rabbit, rig } = await fixture(v2Url);
  try {
    const socket = rig.bones.get('carrot_socket')!;
    rabbit.pivot.rotation.set(.1, .3, -.2);
    settle(rabbit);
    const rest = position(socket);
    const offset = new Vector3(.2, .1, -.25);
    const expected = rest.clone().add(offset.clone().applyQuaternion(rabbit.model.getWorldQuaternion(new Quaternion())));
    rig.setCarrotSocketOffset(offset.x, offset.y, offset.z);
    settle(rabbit);
    assert.ok(position(socket).distanceTo(expected) < 1e-6);
  } finally { rabbit.dispose(); }
});

test('named V3 loads all original bones, hybrid bindings and normalized linear skin weights', { skip: missingV3 }, async () => {
  const { rabbit, rig, gltf, skins } = await fixture();
  try {
    assert.equal(rig.version, 'v3');
    assert.equal(rig.bones.size, 19);
    assert.ok(rig.limits.arm.max >= 120 && rig.limits.arm.max <= 150);
    assert.ok(rig.limits.forearm.max >= 90 && rig.limits.forearm.max <= 110);
    assert.equal(gltf.animations.length, 0);
    for (const name of RABBIT_REQUIRED_BONES) assert.equal(rig.bones.get(name)?.userData.originalBoneName, name);
    assert.equal(rig.bones.get('thigh.L')?.parent, rig.bones.get('root'));
    assert.equal(rig.bones.get('carrot_socket')?.parent, rig.bones.get('root'));
    assert.equal(gltf.scene.getObjectByName('Rabbit_Head')?.parent, rig.bones.get('head'));
    assert.equal(gltf.scene.getObjectByName('Rabbit_Ear_L')?.parent, rig.bones.get('ear.L'));
    assert.equal(gltf.scene.getObjectByName('Rabbit_Eye_L')?.parent?.name, 'Rabbit_Head');
    assert.ok(skins.length >= 4);
    for (const mesh of skins) {
      assert.equal(mesh.skeleton.bones.length, 19);
      const weights = mesh.geometry.getAttribute('skinWeight');
      for (let index = 0; index < weights.count; index++) close(weights.getX(index) + weights.getY(index)
        + weights.getZ(index) + weights.getW(index), 1, 1e-4);
    }
  } finally { rabbit.dispose(); }
});

test('V3 measured coupled limits interpolate continuously and retain explicit unsupported combinations', { skip: missingV3 }, async () => {
  const { rabbit, rig } = await fixture();
  try {
    const cases = [[0, 110, 40], [75, 110, 25], [82.5, 92.5, 22.5], [90, 75, 20],
      [105, 60, 15], [120, 45, 10], [135, 20, 5], [142.5, 10, 2.5], [150, 0, 0]];
    for (const [raise, elbow, head] of cases) {
      close(rig.maximumElbowBend(raise), elbow);
      close(rig.maximumHeadEnvelope(raise), head);
    }
    assert.ok(Object.isFrozen(rig.elbowLimitsByRaise) && Object.isFrozen(rig.elbowLimitsByRaise[0]));
    assert.equal(rig.maximumElbowBend(0), 110);
    assert.ok(rig.maximumElbowBend(120) < 90);
    assert.equal(rig.maximumElbowBend(150), 0);
    console.log('V3 verified shoulder/elbow/head envelopes', cases);
  } finally { rabbit.dispose(); }
});

test('V3 reaches actual independent lateral, forward and diagonal angles with a fixed elbow hinge', { skip: missingV3 }, async () => {
  const { rabbit, rig } = await fixture();
  try {
    const left = rig.bones.get('hand.L')!;
    const right = rig.bones.get('hand.R')!;
    const upper = rig.bones.get('upper_arm.L')!;
    const forearm = rig.bones.get('forearm.L')!;
    const head = rig.bones.get('head')!;
    const upperRest = upper.quaternion.clone().normalize();
    const forearmRest = forearm.quaternion.clone().normalize();
    const headRest = head.quaternion.clone().normalize();
    const pivots = new Map([...rig.bones].map(([name, bone]) => [name, bone.position.clone()]));
    const rightRest = position(right);
    const leftRest = position(left);
    const measured: { plane: number; requested: number; actual: number }[] = [];
    for (const plane of [0, 45, 90]) {
      for (const requested of [0, 90, 120, 150]) {
        rig.resetPose(true);
        rig.setArmRotation('left', requested, 0, plane);
        settle(rabbit);
        const actual = degrees(upperRest.angleTo(upper.quaternion.clone().normalize()));
        close(actual, Math.min(requested, rig.limits.arm.max));
        measured.push({ plane, requested, actual });
        assert.ok(position(right).distanceTo(rightRest) < 1e-6);
        if (requested === 120) assert.ok(position(left).y > leftRest.y + .5);
        for (const [name, bone] of rig.bones) assert.ok(bone.position.distanceTo(pivots.get(name)!) < 1e-6);
      }
      for (const elbow of [0, 45, 90, 110]) {
        rig.setArmRotation('left', 120, elbow, plane);
        rig.setArmRotation('right', 120, elbow, plane);
        settle(rabbit);
        close(degrees(forearmRest.angleTo(forearm.quaternion.clone().normalize())), Math.min(elbow, rig.maximumElbowBend(120)));
        close(position(left).x + position(right).x, 0, 1e-5);
        close(position(left).y, position(right).y, 1e-5);
        close(position(left).z, position(right).z, 1e-5);
      }
    }
    rig.setArmRotation('left', 0, 110);
    rig.setArmRotation('right', 0, 110);
    rig.setHeadRotation(15);
    settle(rabbit);
    assert.ok(degrees(headRest.angleTo(head.quaternion.clone().normalize())) > 10);
    close(degrees(forearmRest.angleTo(forearm.quaternion.clone().normalize())), 110);
    rig.setArmRotation('left', 150, 110);
    rig.setHeadRotation(0);
    settle(rabbit);
    close(degrees(headRest.angleTo(head.quaternion.clone().normalize())), 0);
    assert.ok([...head.quaternion.toArray()].every(Number.isFinite));
    console.log('V3 requested and actual shoulder degrees', measured);
  } finally { rabbit.dispose(); }
});

test('V3 knee progression preserves approximate support, mesh scale and exact rest restoration', { skip: missingV3 }, async () => {
  const { rabbit, rig, skins } = await fixture();
  try {
    settle(rabbit);
    const initial = new Map([...rig.bones].map(([name, bone]) => [name, {
      position: bone.position.clone(), quaternion: bone.quaternion.clone(),
    }]));
    const feet = ['L', 'R'].map(side => rig.bones.get(`foot.${side}` as 'foot.L' | 'foot.R')!);
    const feetRest = feet.map(foot => position(foot));
    const legs = skins.filter(mesh => mesh.name.startsWith('Rabbit_Leg_'));
    const soles = legs.map(mesh => Math.min(...vertices(mesh).map(point => point.y)));
    const heights: number[] = [];
    for (const amount of [0, .25, .5, .75, 1]) {
      rig.setKneeBend(amount);
      settle(rabbit);
      heights.push(position(rig.bones.get('root')!).y);
      feet.forEach((foot, index) => close(position(foot).y, feetRest[index].y, .001));
      legs.forEach((mesh, index) => close(Math.min(...vertices(mesh).map(point => point.y)), soles[index], .005));
      for (const mesh of skins) assert.ok(vertices(mesh).every(point => point.toArray().every(Number.isFinite)));
    }
    assert.ok(heights.every((height, index) => index === 0 || height < heights[index - 1]));
    rig.setArmRotation('left', 120, 90, 45);
    rig.setBodyLean(18, 16);
    rig.setHeadRotation(20, 12, -7.2);
    rig.setCarrotSocketOffset(.2, .3, .4);
    settle(rabbit);
    rig.resetPose(true);
    for (const [name, bone] of rig.bones) {
      assert.ok(bone.position.distanceTo(initial.get(name)!.position) < 1e-6);
      assert.ok(bone.quaternion.clone().normalize().angleTo(initial.get(name)!.quaternion.clone().normalize()) < 1e-5);
    }
  } finally { rabbit.dispose(); }
});

test('V3 linear skinning avoids collapsed faces and excessive edge stretching through joint samples', { skip: missingV3 }, async () => {
  const { rabbit, rig, skins } = await fixture();
  try {
    settle(rabbit);
    const reference = skins.map(mesh => {
      const points = vertices(mesh);
      const indices = mesh.geometry.index?.array ?? Array.from({ length: points.length }, (_, index) => index);
      const triangles: { indices: number[]; lengths: number[]; area: number }[] = [];
      for (let offset = 0; offset < indices.length; offset += 3) {
        const ids = [indices[offset], indices[offset + 1], indices[offset + 2]];
        const [a, b, c] = ids.map(index => points[index]);
        const lengths = [a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)];
        const area = b.clone().sub(a).cross(c.clone().sub(a)).length();
        if (area > 1e-10 && Math.min(...lengths) > 1e-6) triangles.push({ indices: ids, lengths, area });
      }
      return { mesh, triangles };
    });
    const metrics: { raise: number; elbow: number; appliedElbow: number; bend: number;
      minimumAreaRatio: number; minimumEdgeRatio: number; maximumEdgeRatio: number }[] = [];
    for (const [raise, elbow, bend] of [[0, 0, 0], [0, 45, .25], [0, 90, .5], [0, 110, .75], [120, 110, 1]]) {
      rig.resetPose(true);
      rig.setArmRotation('left', raise, elbow, 45);
      rig.setArmRotation('right', raise, elbow, 45);
      rig.setKneeBend(bend);
      settle(rabbit);
      let minimumAreaRatio = Infinity;
      let minimumEdgeRatio = Infinity;
      let maximumEdgeRatio = 0;
      for (const { mesh, triangles } of reference) {
        const points = vertices(mesh);
        for (const triangle of triangles) {
          const [a, b, c] = triangle.indices.map(index => points[index]);
          const areaRatio = b.clone().sub(a).cross(c.clone().sub(a)).length() / triangle.area;
          const ratios = [a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)]
            .map((length, index) => length / triangle.lengths[index]);
          minimumAreaRatio = Math.min(minimumAreaRatio, areaRatio);
          minimumEdgeRatio = Math.min(minimumEdgeRatio, ...ratios);
          maximumEdgeRatio = Math.max(maximumEdgeRatio, ...ratios);
          assert.ok(Number.isFinite(areaRatio) && areaRatio >= .03, `${mesh.name} face collapse at elbow ${elbow}, bend ${bend}`);
          assert.ok(ratios.every(ratio => Number.isFinite(ratio) && ratio > 0 && ratio <= 2.5),
            `${mesh.name} edge distortion at elbow ${elbow}, bend ${bend}: ratios ${ratios}, rest lengths ${triangle.lengths}`);
        }
      }
      metrics.push({ raise, elbow, appliedElbow: Math.min(elbow, rig.maximumElbowBend(raise)),
        bend, minimumAreaRatio, minimumEdgeRatio, maximumEdgeRatio });
    }
    console.log('V3 actual linear skin deformation ratios', metrics);
  } finally { rabbit.dispose(); }
});

test('V3 supported high arm combinations keep distal arms outside head and torso and inside the preview', { skip: missingV3 }, async () => {
  const { rabbit, rig, gltf } = await fixture();
  try {
    const head = gltf.scene.getObjectByName('Rabbit_Head') as Mesh;
    const torso = gltf.scene.getObjectByName('Rabbit_Body') as Mesh;
    for (const mesh of [head, torso]) {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.side = DoubleSide;
    }
    const ray = new Raycaster();
    const rayDirection = new Vector3(1, .173, .397).normalize();
    const camera = new OrthographicCamera((634 - 894) / rabbit.pixelsPerUnit, (1154 - 894) / rabbit.pixelsPerUnit,
      (681 - 229) / rabbit.pixelsPerUnit, (681 - 749) / rabbit.pixelsPerUnit, .1, 50);
    camera.position.set(0, 0, 12); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
    const viewport = { x: 634, y: 229, width: 520, height: 520 };
    const inside = (point: Vector3, mesh: Mesh, bounds: Box3) => {
      if (!bounds.containsPoint(point)) return false;
      ray.set(point, rayDirection);
      const crossings = ray.intersectObject(mesh, false).map(hit => hit.distance)
        .filter((distance, index, distances) => index === 0 || Math.abs(distance - distances[index - 1]) > 1e-5);
      return crossings.length % 2 === 1;
    };
    const assertClearPose = (description: string) => {
      const headBounds = new Box3().setFromObject(head);
      const torsoBounds = new Box3().setFromObject(torso);
      for (const side of ['L', 'R'] as const) {
        const arm = gltf.scene.getObjectByName(`Rabbit_Arm_${side}`) as SkinnedMesh;
        const shoulder = position(rig.bones.get(`upper_arm.${side}`)!);
        for (const point of vertices(arm)) {
          assert.equal(inside(point, head, headBounds), false, `${side}, ${description} arm enters head`);
          if (point.distanceTo(shoulder) > .2) assert.equal(inside(point, torso, torsoBounds), false, `${side}, ${description} distal arm enters torso`);
          assert.ok(projectToLogical(point, camera, viewport).visible, `${side}, ${description} leaves preview`);
        }
      }
    };
    for (const plane of [0, 45, 90]) {
      for (const requested of [90, 120, 150]) {
        for (const elbow of [0, 90, 110]) {
          rig.resetPose(true);
          rig.setArmRotation('left', requested, elbow, plane);
          rig.setArmRotation('right', requested, elbow, plane);
          rig.setBodyLean(18, 16);
          rig.setHeadRotation(20, 12, -7.2);
          rig.setKneeBend(.5);
          settle(rabbit);
          assertClearPose(`shoulder request ${requested}, elbow ${elbow}, plane ${plane}`);
        }
      }
    }
    rig.resetPose(true);
    const rests = new Map([...rig.bones].map(([name, bone]) => [name, bone.quaternion.clone().normalize()]));
    const actualAngle = (name: 'upper_arm.L' | 'upper_arm.R' | 'forearm.L' | 'forearm.R' | 'head') =>
      degrees(rests.get(name)!.angleTo(rig.bones.get(name)!.quaternion.clone().normalize()));
    for (const plane of [0, 45, 90]) {
      rig.resetPose(true);
      rig.setArmRotation('left', 75, 110, plane);
      rig.setArmRotation('right', 75, 110, plane);
      rig.setHeadRotation(25, 18, 14);
      settle(rabbit);
      for (const target of [120, 75, 150, 0]) {
        rig.setArmRotation('left', target, 110, (plane + 45) % 135);
        rig.setArmRotation('right', target, 110, plane);
        rig.setHeadRotation(25, 18, 14);
        for (let frame = 0; frame < 90; frame++) {
          rig.update(1 / 60);
          let maximumRaise = 0;
          for (const side of ['L', 'R'] as const) {
            const elevation = actualAngle(`upper_arm.${side}`);
            maximumRaise = Math.max(maximumRaise, elevation);
            assert.ok(actualAngle(`forearm.${side}`) <= rig.maximumElbowBend(elevation) + 1e-4);
          }
          assert.ok(actualAngle('head') <= rig.maximumHeadEnvelope(maximumRaise) + 1e-4);
          if ([0, 14, 44, 89].includes(frame)) {
            rabbit.pivot.updateMatrixWorld(true);
            rabbit.model.traverse(object => { if (object instanceof SkinnedMesh) object.skeleton.update(); });
            assertClearPose(`interpolated plane ${plane}, target ${target}, frame ${frame}`);
          }
        }
      }
    }
  } finally { rabbit.dispose(); }
});
