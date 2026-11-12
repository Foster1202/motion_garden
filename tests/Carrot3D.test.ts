import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { BoxGeometry, Euler, Group, Mesh, MeshStandardMaterial, Object3D, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Carrot3D } from '../src/game/3d/Carrot3D';

const file = new URL('../model/dist/carrot3d/carrot_realtime.glb', import.meta.url);
const bytes = () => {
  const data = readFileSync(file);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
};
const fixture = () => {
  const model = new Group();
  model.add(new Mesh(new BoxGeometry(.3, 1, .3), new MeshStandardMaterial()));
  const grip = new Object3D();
  grip.name = 'Carrot_Grip_Point';
  grip.position.set(.07, .4, -.02);
  model.add(grip);
  return new Carrot3D(model);
};
const close = (a: Vector3, b: Vector3) => assert.ok(a.distanceTo(b) < 1e-7, `${a.toArray()} differs from ${b.toArray()}`);

test('Carrot GLB loads actual Task2E geometry with named grip and upright axes', async () => {
  const { scene, animations } = await new GLTFLoader().parseAsync(bytes(), '');
  const carrot = new Carrot3D(scene);
  const names: string[] = [];
  scene.traverse(object => { if (object instanceof Mesh) names.push(object.name); });
  assert.equal(names.length, 8);
  assert.equal(animations.length, 0);
  assert.equal(carrot.grip.parent?.name, 'Carrot_Grip_Root');
  close(carrot.gripWorld(), new Vector3());
  assert.ok(carrot.bounds.min.y < -1 && carrot.bounds.max.y > .6);
  carrot.dispose();
});

test('Carrot requires its explicit grip and nonempty finite geometry', () => {
  assert.throws(() => new Carrot3D(new Group()), /Carrot_Grip_Point/);
  const model = new Group();
  const grip = new Object3D();
  grip.name = 'Carrot_Grip_Point';
  model.add(grip);
  assert.throws(() => new Carrot3D(model), /invalid/);
});

test('Carrot grip placement includes its nonzero local grip, uniform scale and rotation', () => {
  const carrot = fixture();
  carrot.setScale(.6);
  const target = new Vector3(1, 2, .3);
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), .3);
  assert.equal(carrot.setGripWorld(target, rotation), true);
  close(carrot.gripWorld(), target);
  assert.ok(carrot.root.position.distanceTo(target) > .1);
  assert.ok(carrot.root.getWorldQuaternion(new Quaternion()).angleTo(rotation) < 1e-7);
  carrot.dispose();
});

test('Carrot converts world grip into translated rotated and scaled parent coordinates', () => {
  const carrot = fixture();
  const parent = new Group();
  parent.position.set(-.4, 1, .7);
  parent.rotation.set(.2, -.4, .1);
  parent.scale.setScalar(1.8);
  parent.add(carrot.root);
  carrot.setScale(.7);
  const target = new Vector3(1.3, 2.4, .9);
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), .2);
  assert.equal(carrot.setGripWorld(target, rotation), true);
  close(carrot.gripWorld(), target);
  assert.ok(carrot.root.getWorldQuaternion(new Quaternion()).angleTo(rotation) < 1e-7);
  carrot.dispose();
});

test('Carrot grip remains exact with nonuniform parent and root scales', () => {
  const carrot = fixture();
  const parent = new Group();
  parent.scale.set(2, .5, 1.4);
  parent.rotation.set(.1, .2, .3);
  parent.add(carrot.root);
  carrot.root.scale.set(.4, .7, 1.2);
  const target = new Vector3(1, 2, 3);
  const rotation = new Quaternion().setFromEuler(new Euler(.5, .6, .3));
  assert.equal(carrot.setGripWorld(target, rotation), true);
  close(carrot.gripWorld(), target);
  assert.ok(carrot.root.getWorldQuaternion(new Quaternion()).angleTo(rotation) < 1e-7);
  assert.equal(carrot.root.matrixAutoUpdate, false);
  for (let frame = 0; frame < 60; frame++) {
    assert.equal(carrot.setGripWorld(target, rotation), true);
    close(carrot.gripWorld(), target);
    assert.ok(carrot.root.getWorldQuaternion(new Quaternion()).angleTo(rotation) < 1e-7);
  }
  carrot.dispose();
});

test('Carrot rejects illegal transform values and singular parents without modifying pose', () => {
  const carrot = fixture();
  const before = carrot.root.position.clone();
  assert.equal(carrot.setScale(NaN), false);
  assert.equal(carrot.setScale(0), false);
  assert.equal(carrot.setScale(-1), false);
  assert.equal(carrot.setScale(1e300), false);
  assert.equal(carrot.setPosition(new Vector3(Infinity, 0, 0)), false);
  assert.equal(carrot.setRotation(new Quaternion(0, 0, 0, 0)), false);
  assert.equal(carrot.setRotation(new Quaternion(1e300, 0, 0, 1)), false);
  assert.equal(carrot.setPosition(new Vector3(1e300, 0, 0)), false);
  assert.equal(carrot.setGripWorld(new Vector3(NaN, 0, 0), new Quaternion()), false);
  assert.equal(carrot.setGripWorld(new Vector3(), new Quaternion(NaN, 0, 0, 1)), false);
  const parent = new Group();
  parent.scale.x = 0;
  parent.add(carrot.root);
  assert.equal(carrot.setGripWorld(new Vector3(), new Quaternion()), false);
  close(carrot.root.position, before);
  carrot.dispose();
});

test('Carrot GLB fetch checks HTTP failure and abort before parsing', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(Carrot3D.load('/missing.glb', new AbortController().signal), /HTTP 503/);
    const abort = new AbortController();
    abort.abort();
    globalThis.fetch = async () => new Response(bytes());
    await assert.rejects(Carrot3D.load('/carrot.glb', abort.signal), /Aborted/);
  } finally { globalThis.fetch = original; }
});

test('Carrot async load returns reusable independent asset and rejects malformed GLB', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(bytes());
    const carrot = await Carrot3D.load('/carrot.glb', new AbortController().signal);
    assert.equal(carrot.root.children[0], carrot.model);
    carrot.dispose();
    globalThis.fetch = async () => new Response('broken');
    await assert.rejects(Carrot3D.load('/broken.glb', new AbortController().signal));
  } finally { globalThis.fetch = original; }
});

test('Carrot pending GLB completion after abort disposes its parsed resources', async () => {
  const originalFetch = globalThis.fetch;
  const originalParse = GLTFLoader.prototype.parseAsync;
  const abort = new AbortController();
  let disposals = 0;
  try {
    globalThis.fetch = async () => new Response(bytes());
    GLTFLoader.prototype.parseAsync = async function (data, path) {
      const result = await originalParse.call(this, data, path);
      result.scene.traverse(object => {
        if (object instanceof Mesh) object.geometry.addEventListener('dispose', () => disposals++);
      });
      abort.abort();
      return result;
    };
    await assert.rejects(Carrot3D.load('/carrot.glb', abort.signal), /Aborted/);
    assert.equal(disposals, 8);
  } finally {
    globalThis.fetch = originalFetch;
    GLTFLoader.prototype.parseAsync = originalParse;
  }
});

test('Carrot disposal releases shared geometry and material once and detaches the root', () => {
  const carrot = fixture();
  const mesh = carrot.model.children.find(object => object instanceof Mesh) as Mesh;
  carrot.model.add(new Mesh(mesh.geometry, mesh.material));
  let geometryDisposals = 0, materialDisposals = 0;
  mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
  (mesh.material as MeshStandardMaterial).addEventListener('dispose', () => materialDisposals++);
  new Group().add(carrot.root);
  carrot.dispose(); carrot.dispose();
  assert.equal(geometryDisposals, 1);
  assert.equal(materialDisposals, 1);
  assert.equal(carrot.root.parent, null);
  assert.equal(carrot.setScale(1), false);
});
