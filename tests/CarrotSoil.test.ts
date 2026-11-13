import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type Phaser from 'phaser';
import { Mesh, Plane, Quaternion, Vector3, type Material } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Carrot3D } from '../src/game/3d/Carrot3D';
import { CarrotPull3DEnvironment } from '../src/game/3d/gameplay/CarrotPull3DEnvironment';
import { ThreeOverlay } from '../src/game/3d/ThreeOverlay';

async function fixture() {
  const bytes = readFileSync(new URL('../model/dist/carrot3d/carrot_realtime.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  return new Carrot3D(gltf.scene);
}

function materials(carrot: Carrot3D): Material[] {
  const unique = new Set<Material>();
  carrot.model.traverse(object => {
    if (object instanceof Mesh) {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) unique.add(material);
    }
  });
  return [...unique];
}

test('real Carrot GLB soil clipping starts disabled and applies one shared world plane only to its materials', async () => {
  const carrot = await fixture();
  try {
    const owned = materials(carrot);
    assert.equal(owned.length, 5);
    assert.ok(owned.every(material => material.clippingPlanes === null));
    assert.equal(carrot.soilClippingHeight, null);
    assert.equal(carrot.setSoilClippingHeight(1.1), true);
    const plane = owned[0].clippingPlanes![0];
    assert.ok(owned.every(material => material.clippingPlanes?.length === 1 && material.clippingPlanes[0] === plane));
    assert.deepEqual(plane.normal.toArray(), [0, 1, 0]);
    assert.ok(plane.distanceToPoint(new Vector3(0, 1.2, 0)) > 0);
    assert.ok(plane.distanceToPoint(new Vector3(0, 1, 0)) < 0);
    carrot.setSoilClippingHeight(1.2);
    assert.equal(owned[0].clippingPlanes![0], plane);
    assert.equal(plane.constant, -1.2);
  } finally { carrot.dispose(); }
});

test('true GLB taproot emerges continuously through the fixed soil plane as its final grip rises', async () => {
  const carrot = await fixture();
  try {
    carrot.setScale(.4);
    carrot.setSoilClippingHeight(1.1);
    const taproot = carrot.model.getObjectByProperty('name', 'Carrot_Taproot004') as Mesh;
    assert.ok(taproot instanceof Mesh);
    const plane = materials(carrot)[0].clippingPlanes![0];
    const counts: number[] = [];
    for (const lift of [0, .15, .3, .5]) {
      carrot.setGripWorld(new Vector3(.27, 1.125 + lift, .5), new Quaternion());
      let visible = 0;
      for (let index = 0; index < taproot.geometry.getAttribute('position').count; index++) {
        const world = taproot.getVertexPosition(index, new Vector3()).applyMatrix4(taproot.matrixWorld);
        if (plane.distanceToPoint(world) >= 0) visible++;
      }
      counts.push(visible);
    }
    assert.ok(counts[0] < counts[1] && counts[1] < counts[2] && counts[2] < counts[3]);
    assert.equal(counts[3], taproot.geometry.getAttribute('position').count);
    carrot.setSoilClippingHeight(null);
    assert.equal(carrot.soilClippingHeight, null);
    assert.ok(materials(carrot).every(material => material.clippingPlanes === null));
  } finally { carrot.dispose(); }
});

test('soil clipping restores existing planes, rejects invalid heights and clears ownership on disposal', async () => {
  const carrot = await fixture();
  const owned = materials(carrot);
  const original = [new Plane(new Vector3(1, 0, 0), 2)];
  owned[0].clippingPlanes = original;
  carrot.setSoilClippingHeight(1.1);
  assert.equal(owned[0].clippingPlanes!.length, 2);
  assert.equal(carrot.setSoilClippingHeight(NaN), false);
  assert.equal(carrot.setSoilClippingHeight(Infinity), false);
  assert.equal(carrot.soilClippingHeight, 1.1);
  carrot.setSoilClippingHeight(null);
  assert.equal(owned[0].clippingPlanes, original);
  carrot.setSoilClippingHeight(1.1);
  let disposals = 0;
  owned.forEach(material => material.addEventListener('dispose', () => disposals++));
  carrot.dispose();
  carrot.dispose();
  assert.equal(disposals, 5);
  assert.equal(owned[0].clippingPlanes, original);
  assert.ok(owned.slice(1).every(material => material.clippingPlanes === null));
  assert.equal(carrot.setSoilClippingHeight(1), false);
});

class DisplayObject {
  visible = true;
  depth = 0;
  destroyed = 0;
  crop?: number[];
  setOrigin() { return this; }
  setScale() { return this; }
  setDepth(depth: number) { this.depth = depth; return this; }
  setVisible(visible: boolean) { this.visible = visible; return this; }
  setCrop(...values: number[]) { this.crop = values; return this; }
  fillStyle() { return this; }
  fillRoundedRect() { return this; }
  lineStyle() { return this; }
  lineBetween() { return this; }
  destroy() { this.destroyed++; }
}

function sceneFixture() {
  const objects: DisplayObject[] = [];
  const add = () => { const object = new DisplayObject(); objects.push(object); return object; };
  const scene = { add: { image: add, graphics: add }, textures: { exists: () => true } } as unknown as Phaser.Scene;
  return { scene, objects };
}

test('raised bed derives placement from the supplied world projection and keeps its front soil layer visible', () => {
  const { scene, objects } = sceneFixture();
  const bed = new CarrotPull3DEnvironment(scene, {
    project: point => ({ x: 894 + point.x * 90, y: 681 - point.y * 90 }),
    plantedGrip: new Vector3(.27, 1.125, .5), soilWorldY: 1.1,
  });
  const snapshot = bed.snapshot();
  assert.deepEqual(snapshot.soilScreenPosition, { x: 918.3, y: 582 });
  assert.equal(snapshot.pixelsPerUnit, 90);
  assert.equal(snapshot.soilFrontVisible, true);
  assert.equal(objects.filter(object => object.crop?.[1] === 249).length, 1);
  assert.ok(snapshot.soilBackDepth < 40 && snapshot.soilFrontDepth > 40);
  bed.setVisible(false);
  assert.ok(objects.every(object => !object.visible));
  bed.setVisible(true);
  bed.destroy(); bed.destroy();
  assert.ok(objects.every(object => object.destroyed === 1));
  assert.equal(bed.snapshot().soilFrontVisible, false);
});

test('raised bed rejects invalid layout before allocating display objects', () => {
  const { scene, objects } = sceneFixture();
  assert.throws(() => new CarrotPull3DEnvironment(scene, {
    project: () => ({ x: NaN, y: 0 }), plantedGrip: new Vector3(), soilWorldY: 1,
  }), /finite world projection/);
  assert.equal(objects.length, 0);
});

test('post-pose disposal ends the render frame before accessing its released renderer', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value: { hidden: false }, configurable: true });
  let rigUpdates = 0;
  let renderCalls = 0;
  const overlay = {
    destroyed: false,
    rabbit: { rig: { update() { rigUpdates++; } } },
    renderer: { render() { renderCalls++; } },
    scene: {}, camera: {}, renderedFrames: 0,
  };
  try {
    const rendered = ThreeOverlay.prototype.render.call(overlay as unknown as ThreeOverlay, 1 / 60,
      () => { overlay.destroyed = true; });
    assert.equal(rendered, false);
    assert.equal(rigUpdates, 1);
    assert.equal(renderCalls, 0);
    assert.equal(overlay.renderedFrames, 0);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
