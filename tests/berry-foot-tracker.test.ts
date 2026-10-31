import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { OrthographicCamera, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Rabbit3D } from '../src/game/3d/Rabbit3D';
import { RabbitFootTracker, projectToLogical } from '../src/game/3d/RabbitFootTracker';

async function fixture() {
  const bytes = readFileSync(new URL('../model/dist/rabbit3d/rabbit_realtime.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
  return new Rabbit3D(gltf.scene);
}
const camera = () => {
  const result = new OrthographicCamera(-3, 3, 3, -1, .1, 30);
  result.position.z = 10;
  result.updateProjectionMatrix();
  return result;
};
const viewport = { x: 0, y: 0, width: 1600, height: 900 };

test('actual GLB left and right legs extend continuously outward, independently, and reset', async () => {
  const rabbit = await fixture();
  const position = (side: 'L' | 'R') => rabbit.rig.bones.get(`foot.${side}`)!.getWorldPosition(new Vector3());
  const restL = position('L'), restR = position('R');
  let previous = restL.x;
  for (const amount of [.25, .5, .75, 1]) {
    rabbit.rig.setLegExtension('L', amount);
    rabbit.rig.update(10);
    assert.ok(position('L').x > previous);
    assert.ok(position('R').distanceTo(restR) < 1e-7);
    previous = position('L').x;
  }
  const extended = position('L');
  rabbit.rig.setLegExtension('R', 1);
  rabbit.rig.update(10);
  assert.ok(position('R').x < restR.x - .15);
  assert.ok(Math.abs(position('R').x + extended.x) < 1e-5);
  console.log('Berry foot model measurements', { rest: restL.toArray(), extended: extended.toArray() });
  rabbit.rig.resetPose(true);
  assert.ok(position('L').distanceTo(restL) < 1e-7);
  rabbit.rig.setKneeBend(.5);
  rabbit.rig.setLegExtension('L', .5);
  rabbit.rig.update(10);
  assert.ok(position('L').x > restL.x);
  rabbit.dispose();
});

test('foot projection follows root translation, uniform scale, mirroring and camera', async () => {
  const rabbit = await fixture();
  const cam = camera();
  const tracker = new RabbitFootTracker(rabbit, cam, viewport);
  const rest = tracker.sample();
  assert.ok(rest.left.visible && rest.right.visible);
  rabbit.pivot.position.x += 1;
  const shifted = tracker.sample();
  assert.ok(Math.abs(shifted.left.x - rest.left.x - 1600 / 6) < 1e-5);
  rabbit.pivot.scale.set(-2, 2, 2);
  const scaled = tracker.sample();
  assert.ok(scaled.left.x < scaled.right.x);
  assert.ok(Math.abs((scaled.right.x - scaled.left.x) / (rest.left.x - rest.right.x) - 2) < 1e-5);
  cam.position.x += .5;
  assert.ok(tracker.sample().left.x < scaled.left.x);
  tracker.viewport = { x: 10, y: 20, width: 800, height: 450 };
  const resized = tracker.sample();
  tracker.viewport = viewport;
  assert.ok(Math.abs(resized.left.x - (10 + tracker.sample().left.x / 2)) < 1e-5);
  rabbit.dispose();
});

test('projection rejects offscreen, behind-camera and invalid positions', () => {
  const cam = camera();
  assert.equal(projectToLogical(new Vector3(100, 0, 0), cam, viewport).visible, false);
  assert.equal(projectToLogical(new Vector3(0, 0, 20), cam, viewport).visible, false);
  assert.equal(projectToLogical(new Vector3(NaN, 0, 0), cam, viewport).visible, false);
  assert.equal(projectToLogical(new Vector3(0, 0, 0), cam, viewport).visible, true);
});
