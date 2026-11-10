import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Group, MathUtils, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Rabbit3D } from '../src/game/3d/Rabbit3D';
import { TwoBoneIK } from '../src/game/3d/ik/TwoBoneIK';
import { FootContactController } from '../src/game/3d/ik/FootContactController';
import { RabbitLegIK } from '../src/game/3d/ik/RabbitLegIK';

const close = (a: number, b: number, epsilon = 1e-6) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const vector = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
async function fixture() {
  const buffer = readFileSync(new URL('../model/dist/rabbit3d/rabbit_realtime_v3.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  const rabbit = new Rabbit3D(gltf.scene); const ik = new RabbitLegIK(rabbit.model, rabbit.rig.bones);
  return { rabbit, rig: rabbit.rig, ik };
}

function soles(rabbit: Rabbit3D) {
  const result = { L: Infinity, R: Infinity }; const point = vector();
  rabbit.model.updateWorldMatrix(true, true);
  rabbit.model.traverse(object => {
    if (!(object instanceof SkinnedMesh) || !object.name.startsWith('Rabbit_Leg_')) return;
    object.skeleton.update(); const side = object.name.endsWith('L') ? 'L' : 'R';
    for (let index = 0; index < object.geometry.getAttribute('position').count; index++) {
      object.getVertexPosition(index, point).applyMatrix4(object.matrixWorld);
      rabbit.model.worldToLocal(point); result[side] = Math.min(result[side], point.y);
    }
  });
  return result;
}

test('analytic two-bone IK reaches a valid target with exact segment lengths and forward pole', () => {
  const solver = new TwoBoneIK(); const start = vector(); const target = vector(0, -1.5, 0);
  const result = solver.solve(start, target, vector(0, 0, 1), 1, 1);
  close(result.joint.distanceTo(start), 1); close(result.end.distanceTo(result.joint), 1);
  close(result.end.distanceTo(target), 0); assert.ok(result.joint.z > 0 && result.valid && !result.clamped);
});

test('unreachable two-bone targets are projected without stretch or reverse bend', () => {
  const solver = new TwoBoneIK();
  for (const target of [vector(0, -10), vector()]) {
    const result = solver.solve(vector(), target, vector(0, 0, 1), .4, .3, MathUtils.degToRad(48));
    close(result.joint.length(), .4); close(result.joint.distanceTo(result.end), .3);
    assert.ok(result.clamped && result.bendRadians >= 0 && result.bendRadians <= MathUtils.degToRad(48) + 1e-7);
    assert.ok(result.joint.z >= 0);
  }
});

test('degenerate pole and invalid two-bone input have finite deterministic results', () => {
  const solver = new TwoBoneIK();
  const a = solver.solve(vector(), vector(0, -1), vector(0, -1), .6, .6);
  assert.ok(a.joint.toArray().every(Number.isFinite));
  assert.equal(solver.solve(vector(), vector(NaN), vector(), 1, 1).valid, false);
  assert.equal(solver.solve(vector(), vector(), vector(), 0, 1).valid, false);
  const huge = solver.solve(vector(), vector(1e300, 0, 0), vector(0, 0, 1), .4, .3);
  assert.ok(huge.clamped && huge.end.toArray().every(Number.isFinite));
  close(huge.end.length(), .7);
});

test('independent sole targets preserve their model ground plane and reject illegal input', () => {
  const contacts = new FootContactController({ L: vector(.3, .1), R: vector(-.3, .1) }, { L: 0, R: 0 });
  const output = vector();
  assert.equal(contacts.setTarget('L', vector(.32, 100, .02)), true);
  assert.deepEqual(contacts.getTarget('L', output).toArray(), [.32, 0, .02]);
  assert.deepEqual(contacts.getTarget('R', output).toArray(), [-.3, 0, 0]);
  assert.equal(contacts.setTarget('R', vector(NaN)), false);
  contacts.setTarget('L', vector(100, 0, -100));
  assert.deepEqual(contacts.getTarget('L', output).toArray(), [.36, 0, -.06]);
  contacts.reset(); assert.deepEqual(contacts.getAnkleTarget('L', output).toArray(), [.3, .1, 0]);
});

test('V3 standing IK returns exact local Rest Pose', async () => {
  const { rabbit, rig, ik } = await fixture();
  try {
    const rest = new Map([...rig.bones].map(([name, bone]) => [name, { position: bone.position.clone(), quaternion: bone.quaternion.clone() }]));
    const result = ik.solve(rabbit.model, rig.bones);
    assert.ok(result.maximumContactError < 1e-6);
    for (const [name, bone] of rig.bones) {
      assert.ok(bone.position.distanceTo(rest.get(name)!.position) < 1e-6);
      assert.ok(bone.quaternion.clone().normalize().angleTo(rest.get(name)!.quaternion.clone().normalize()) < 1e-5, name);
    }
  } finally { rabbit.dispose(); }
});

test('V3 IK shallow bend25/50/75/100 keeps exact sole contacts and non-reversed knees', async () => {
  const { rabbit, rig, ik } = await fixture();
  try {
    const restSoles = soles(rabbit); let previousHeight = Infinity;
    for (const amount of [0, .25, .5, .75, 1]) {
      rig.setKneeBend(amount); rig.update(10);
      const result = ik.solve(rabbit.model, rig.bones);
      const rootHeight = rig.bones.get('root')!.getWorldPosition(vector()).y;
      assert.ok(rootHeight < previousHeight + 1e-6, JSON.stringify({amount,rootHeight,previousHeight,result})); previousHeight = rootHeight;
      assert.ok(result.maximumContactError < 1e-6);
      const actualSoles = soles(rabbit);
      close(actualSoles.L, restSoles.L, .001); close(actualSoles.R, restSoles.R, .001);
      for (const side of ['L', 'R'] as const) {
        const knee = rabbit.model.worldToLocal(rig.bones.get(`shin.${side}`)!.getWorldPosition(vector()));
        const hip = rabbit.model.worldToLocal(rig.bones.get(`thigh.${side}`)!.getWorldPosition(vector()));
        assert.ok(knee.z >= hip.z - 1e-6);
        assert.ok(result[side === 'L' ? 'left' : 'right'].kneeDegrees <= 48.0001);
      }
    }
  } finally { rabbit.dispose(); }
});

test('V3 grounded legs tolerate side/forward body lean and bounded lateral displacement', async () => {
  const { rabbit, rig, ik } = await fixture();
  try {
    const restSoles = soles(rabbit);
    for (const amount of [0, .5, 1]) for (const x of [-.45, -.06, 0, .06, .45]) {
      rig.resetPose(true); rig.setKneeBend(amount); rig.setRootOffset(x, .04, .12);
      rig.setBodyLean(x < 0 ? -18 : 18, 16); rig.update(10);
      const result = ik.solve(rabbit.model, rig.bones); const actualSoles = soles(rabbit);
      assert.ok(result.maximumContactError < 1e-6, JSON.stringify({ amount, x, result }));
      assert.ok(result.left.kneeDegrees <= 48.0001 && result.right.kneeDegrees <= 48.0001);
      close(actualSoles.L, restSoles.L, .001); close(actualSoles.R, restSoles.R, .001);
      if (Math.abs(x) > .12) assert.ok(result.rootClamped);
    }
  } finally { rabbit.dispose(); }
});

test('V3 IK solves independent foot targets without moving the opposite anchor', async () => {
  const { rabbit, rig, ik } = await fixture();
  try {
    const left = ik.contacts.getTarget('L', vector()).add(vector(.02, 0, .02));
    const right = ik.contacts.getTarget('R', vector());
    ik.contacts.setTarget('L', left); rig.setKneeBend(.5); rig.update(10);
    const result = ik.solve(rabbit.model, rig.bones);
    assert.ok(result.maximumContactError < 1e-6);
    assert.ok(vector().fromArray(result.right.contact).distanceTo(right) < 1e-6);
    assert.ok(vector().fromArray(result.left.contact).distanceTo(left) < 1e-6);
  } finally { rabbit.dispose(); }
});

test('V3 IK uses model units under rotated uniformly scaled scene parents', async () => {
  const { rabbit, rig, ik } = await fixture();
  try {
    const parent = new Group(); parent.position.set(3, 2, -4); parent.rotation.set(.3, -.4, .2); parent.scale.setScalar(1.7);
    parent.add(rabbit.pivot); parent.updateMatrixWorld(true);
    rig.setKneeBend(.7); rig.setRootOffset(.06, 0, .02); rig.update(10);
    const result = ik.solve(rabbit.model, rig.bones);
    assert.ok(result.maximumContactError < 1e-6);
    assert.ok(result.left.kneeDegrees <= 48.0001 && result.right.kneeDegrees <= 48.0001);
    const quaternions = [...rig.bones.values()].map(bone => bone.quaternion);
    assert.ok(quaternions.every(q => q.toArray().every(Number.isFinite) && Math.abs(q.length() - 1) < 1e-5));
  } finally { rabbit.dispose(); }
});

test('fixed contacts do not accumulate drift through1000 alternating body/root/bend frames', async () => {
  const { rabbit, rig, ik } = await fixture();
  try {
    let maximumError = 0;
    for (let frame = 0; frame < 1000; frame++) {
      rig.setKneeBend(.5 + .5 * Math.sin(frame / 40)); rig.setRootOffset(.08 * Math.sin(frame / 50));
      rig.setBodyLean(18 * Math.sin(frame / 60), 10 * Math.sin(frame / 35)); rig.update(1 / 60);
      maximumError = Math.max(maximumError, ik.solve(rabbit.model, rig.bones).maximumContactError);
    }
    assert.ok(maximumError < 1e-6);
    ik.reset(); rig.resetPose(true); const rest = ik.solve(rabbit.model, rig.bones);
    assert.ok(rest.maximumContactError < 1e-6);
    console.log('V3 analytic legIK maximum contact error,1000 frames:', maximumError);
  } finally { rabbit.dispose(); }
});

test('V3 planted IK retains finite fixed-index leg mesh area and edge lengths across mixed poses', async () => {
  const { rabbit, rig, ik } = await fixture();
  try {
    const legs: SkinnedMesh[] = [];
    rabbit.model.traverse(object => { if (object instanceof SkinnedMesh && object.name.startsWith('Rabbit_Leg_')) legs.push(object); });
    const points = (mesh: SkinnedMesh) => {
      mesh.skeleton.update();
      return Array.from({ length: mesh.geometry.getAttribute('position').count }, (_, index) => mesh.getVertexPosition(index, vector()));
    };
    const rest = legs.map(mesh => {
      const vertices = points(mesh); const ids = mesh.geometry.index!.array;
      return { mesh, triangles: Array.from({ length: ids.length / 3 }, (_, index) => {
        const indices = [ids[index * 3], ids[index * 3 + 1], ids[index * 3 + 2]];
        const [a, b, c] = indices.map(id => vertices[id]);
        return { indices, area: b.clone().sub(a).cross(c.clone().sub(a)).length(),
          edges: [a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)] };
      }).filter(triangle => triangle.area > 1e-10 && Math.min(...triangle.edges) > 1e-6) };
    });
    let minimumArea = Infinity, maximumEdge = 0;
    for (const bend of [0, .25, .5, .75, 1]) for (const x of [-.12, 0, .12]) for (const z of [-.08, 0, .08]) {
      rig.resetPose(true); rig.setKneeBend(bend); rig.setRootOffset(x, 0, z); rig.setBodyLean(18, 16); rig.update(10);
      ik.solve(rabbit.model, rig.bones);
      for (const { mesh, triangles } of rest) {
        const vertices = points(mesh);
        for (const triangle of triangles) {
          const [a, b, c] = triangle.indices.map(id => vertices[id]);
          const areaRatio = b.clone().sub(a).cross(c.clone().sub(a)).length() / triangle.area;
          const edges = [a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)].map((edge, index) => edge / triangle.edges[index]);
          minimumArea = Math.min(minimumArea, areaRatio); maximumEdge = Math.max(maximumEdge, ...edges);
          assert.ok(Number.isFinite(areaRatio) && areaRatio >= .03, JSON.stringify({ bend, x, z, areaRatio }));
          assert.ok(edges.every(edge => Number.isFinite(edge) && edge > 0 && edge <= 2.5));
        }
      }
    }
    console.log('V3 IK leg mesh minarea/maxedge over45 mixed poses:', minimumArea, maximumEdge);
  } finally { rabbit.dispose(); }
});
