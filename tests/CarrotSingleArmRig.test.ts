import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Box3, DoubleSide, MathUtils, Mesh, Raycaster, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Rabbit3D } from '../src/game/3d/Rabbit3D';
import { RabbitShoulderArm } from '../src/game/3d/ik/RabbitShoulderArm';
import { RabbitHandTracker } from '../src/game/3d/interaction/RabbitHandTracker';

async function load(name: string) {
  const bytes = readFileSync(new URL(`../model/dist/rabbit3d/${name}.glb`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  return new Rabbit3D(gltf.scene);
}
const sides = ['L', 'R'] as const;
const point = (rabbit: Rabbit3D, mesh: Mesh, i: number, out: Vector3) =>
  rabbit.model.worldToLocal(mesh.getVertexPosition(i, out).applyMatrix4(mesh.matrixWorld));
const position = (rabbit: Rabbit3D, name: 'upper_arm.L' | 'upper_arm.R' | 'hand.L' | 'hand.R') =>
  rabbit.model.worldToLocal(rabbit.rig.bones.get(name)!.getWorldPosition(new Vector3()));

test('Contact correction aims a rigid arm at a reachable wrist without bending or stretching', () => {
  const rest = new Vector3(.29, -.69, 0);
  const solver = new RabbitShoulderArm(rest, 1, 90);
  const goal = solver.forward(68, 53, new Vector3());
  const solve = solver.solve(goal, 65, 90);
  const endpoint = solver.forward(solve.raise, solve.plane, new Vector3());
  assert.equal(solve.elbow, 0);
  assert.ok(endpoint.distanceTo(goal) < .002);
  assert.ok(Math.abs(endpoint.length() - rest.length()) < 1e-8);
  const unreachable = solver.solve(goal.clone().multiplyScalar(3), 65, 90);
  assert.equal(unreachable.clamped, true);
  assert.ok(unreachable.raise >= 0 && unreachable.raise <= 90 && unreachable.residual > 1);
});

test('Carrot rest arm surfaces and measured palms come from the actual Berry asset', async () => {
  const [carrot, berry] = await Promise.all([load('rabbit_carrot'), load('rabbit_realtime')]);
  try {
    assert.equal(carrot.rig.armControl, 'shoulder');
    assert.equal(carrot.rig.limits.forearm.max, 0);
    assert.equal(carrot.model.getObjectByName('Rabbit_Shoulder_L'), undefined);
    assert.equal(carrot.model.getObjectByName('Rabbit_Shoulder_R'), undefined);
    // Match renderer matrix updates after the display pivot offsets the skinned donor.
    berry.pivot.updateMatrixWorld(true);
    const [a, b] = [new RabbitHandTracker(carrot), new RabbitHandTracker(berry)];
    for (const side of sides) {
      const arm = carrot.model.getObjectByName(`Rabbit_Arm_${side}`) as Mesh;
      const donor = berry.model.getObjectByName(`Rabbit_Arm_${side}`) as SkinnedMesh;
      assert.equal(arm.parent, carrot.rig.bones.get(`upper_arm.${side}`));
      assert.ok(!(arm instanceof SkinnedMesh));
      donor.skeleton.update();
      assert.deepEqual(arm.geometry.index!.array, donor.geometry.index!.array);
      assert.equal(arm.geometry.attributes.position.count, donor.geometry.attributes.position.count);
      for (let i = 0; i < arm.geometry.attributes.position.count; i++) {
        assert.ok(point(carrot, arm, i, new Vector3()).distanceTo(point(berry, donor, i, new Vector3())) < 1e-5);
      }
      assert.ok(a.HandGripOffset[side].distanceTo(b.HandGripOffset[side]) < 1e-5);
      assert.ok(position(carrot, `upper_arm.${side}`).distanceTo(position(berry, `upper_arm.${side}`)) < 1e-5);
      assert.ok(position(carrot, `hand.${side}`).distanceTo(position(berry, `hand.${side}`)) < 1e-5);
    }
    assert.ok(Math.abs(a.palmRadius - b.palmRadius) < 1e-5);
  } finally { carrot.dispose(); berry.dispose(); }
});

test('Shoulder rotations move the entire arm and palm rigidly through independent raises and return', async () => {
  const rabbit = await load('rabbit_carrot');
  try {
    const { rig } = rabbit;
    const tracker = new RabbitHandTracker(rabbit);
    const leftShoulder = position(rabbit, 'upper_arm.L');
    const rightHand = position(rabbit, 'hand.R');
    const restPalm = rabbit.model.worldToLocal(tracker.sample().leftGripPosition);
    const forearm = rig.bones.get('forearm.L')!;
    const neutralElbow = forearm.quaternion.clone().normalize();
    rig.setIKEnabled(true);
    for (const plane of [0, 45, 90]) {
      for (const raise of [20, 50, 80, 90]) {
        rig.setArmRotation('left', raise, 110, plane);
        for (let i = 0; i < 90; i++) rig.update(1 / 60);
        const direction = MathUtils.degToRad(plane);
        const axis = new Vector3(-Math.sin(direction), 0, Math.cos(direction)).normalize();
        const currentShoulder = position(rabbit, 'upper_arm.L');
        const expected = restPalm.clone().sub(leftShoulder).applyAxisAngle(axis, MathUtils.degToRad(raise)).add(currentShoulder);
        assert.ok(currentShoulder.distanceTo(leftShoulder) <= .04601);
        assert.ok(expected.distanceTo(rabbit.model.worldToLocal(tracker.sample().leftGripPosition)) < 1e-5);
        assert.ok(position(rabbit, 'hand.R').distanceTo(rightHand) < 1e-5);
        assert.ok(neutralElbow.angleTo(forearm.quaternion.clone().normalize()) < 1e-6);
      }
    }
    rig.setArmRotation('left', 0, 110, 0);
    for (let i = 0; i < 90; i++) rig.update(1 / 60);
    assert.ok(restPalm.distanceTo(rabbit.model.worldToLocal(tracker.sample().leftGripPosition)) < 1e-5);
  } finally { rabbit.dispose(); }
});

test('Swept shoulder-only poses keep the arm surface outside the head and distal torso', async () => {
  const rabbit = await load('rabbit_carrot');
  try {
    const { rig, model } = rabbit;
    const head = model.getObjectByName('Rabbit_Head') as Mesh;
    const torso = model.getObjectByName('Rabbit_Body') as Mesh;
    const obstacles = [head, torso];
    for (const mesh of obstacles) {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.side = DoubleSide;
    }
    const ray = new Raycaster(), direction = new Vector3(.391, .217, 1).normalize();
    const surface = new Vector3(), shoulder = new Vector3();
    const clear = (description: string) => {
      const bounds = obstacles.map(mesh => new Box3().setFromObject(mesh));
      for (const side of sides) {
        const arm = model.getObjectByName(`Rabbit_Arm_${side}`) as Mesh;
        rig.bones.get(`upper_arm.${side}`)!.getWorldPosition(shoulder);
        let seated = false;
        for (let i = 0; i < arm.geometry.attributes.position.count; i++) {
          surface.fromBufferAttribute(arm.geometry.attributes.position, i).applyMatrix4(arm.matrixWorld);
          for (let j = 0; j < obstacles.length; j++) {
            if (!bounds[j].containsPoint(surface)) continue;
            ray.set(surface, direction);
            const hits = ray.intersectObject(obstacles[j], false).map(hit => hit.distance)
              .filter((d, index, all) => index === 0 || Math.abs(d - all[index - 1]) > 1e-5);
            if (hits.length % 2 === 0) continue;
            // The proximal arm stays seated inside the torso at the shoulder seam.
            assert.ok(j === 1 && surface.distanceTo(shoulder) < .31,
              `${description}: ${side} arm enters ${obstacles[j].name} at ${surface.distanceTo(shoulder)}`);
            seated = true;
          }
        }
        assert.ok(seated, `${description}: ${side} shoulder separates from torso`);
      }
    };
    for (const plane of [0, 30, 60, 90, 0]) {
      for (const raise of [0, 30, 60, 90]) {
        rig.setArmRotation('left', raise, 110, plane);
        rig.setArmRotation('right', raise, 110, plane);
        rig.setHeadRotation(15, 10, 7);
        for (let frame = 0; frame < 60; frame++) {
          rig.update(1 / 60);
          if (frame === 5 || frame === 59) clear(`${raise}° at plane ${plane}, frame ${frame}`);
        }
      }
    }
  } finally { rabbit.dispose(); }
});
