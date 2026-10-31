import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Mesh, OrthographicCamera, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Rabbit3D } from '../src/game/3d/Rabbit3D';
import { RabbitFootTracker, projectToLogical } from '../src/game/3d/RabbitFootTracker';
import { BERRY_CONFIG as C, footInTrunk } from '../src/game/berry/berryConfig';

const viewport = { x: 0, y: 0, width: 1600, height: 900 };
async function fixture(backup = false) {
  const bytes = readFileSync(new URL(`../model/dist/rabbit3d/${backup ? 'backup-v1/' : ''}rabbit_realtime.glb`, import.meta.url));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Rabbit3D((await new GLTFLoader().parseAsync(data, '')).scene);
}
function camera(rabbit: Rabbit3D, x: number, y: number) {
  const p = rabbit.pixelsPerUnit;
  const result = new OrthographicCamera(-x / p, (1600 - x) / p, y / p, (y - 900) / p, .1, 50);
  result.position.set(0, 0, 12);
  result.lookAt(0, 0, 0);
  result.updateProjectionMatrix();
  return result;
}
function meshExtents(rabbit: Rabbit3D) {
  // Match the renderer traversal, including attached skin bind-matrix updates.
  rabbit.pivot.updateMatrixWorld(true);
  let minimum = Infinity, maximum = -Infinity;
  rabbit.model.traverse(object => {
    if (!(object instanceof Mesh)) return;
    if (object instanceof SkinnedMesh) object.skeleton.update();
    for (let index = 0; index < object.geometry.getAttribute('position').count; index++) {
      const y = object.getVertexPosition(index, new Vector3()).applyMatrix4(object.matrixWorld).y;
      minimum = Math.min(minimum, y); maximum = Math.max(maximum, y);
    }
  });
  return { minimum, maximum };
}

test('new GLB remains 342 logical pixels tall with actual soles at both game ground anchors', async () => {
  const rabbit = await fixture();
  try {
    const { minimum, maximum } = meshExtents(rabbit);
    for (const [x, y] of [[894, 681], [800, 730]]) {
      const cam = camera(rabbit, x, y);
      const bottom = projectToLogical(new Vector3(0, minimum, 0), cam, viewport);
      const top = projectToLogical(new Vector3(0, maximum, 0), cam, viewport);
      assert.ok(bottom.visible && top.visible);
      assert.ok(Math.abs(bottom.x - x) < 1e-5);
      assert.ok(Math.abs(bottom.y - y) < .01, `Sole differs from ground ${y}: ${bottom.y}`);
      assert.ok(Math.abs(bottom.y - top.y - 342) < .01);
    }
  } finally { rabbit.dispose(); }
});

test('longer mirrored legs reach unchanged Berry trunks while standing and support feet cannot score', async () => {
  const rabbit = await fixture();
  try {
    rabbit.pivot.scale.x = -1;
    const tracker = new RabbitFootTracker(rabbit, camera(rabbit, 800, C.feetY), viewport);
    const rest = tracker.sample().left.x;
    rabbit.rig.setLegExtension('left', 1); rabbit.rig.update(10);
    const extended = tracker.sample().left.x;
    rabbit.rig.resetPose(true);
    const travel = 800 - (C.tree.left + C.tree.width * .045 + (800 - rest) + (rest - extended) * .5);
    assert.ok(travel > 80 && travel < 800);
    for (const side of ['left', 'right'] as const) {
      rabbit.rig.resetPose(true);
      rabbit.pivot.position.x = (side === 'left' ? -travel : travel) / rabbit.pixelsPerUnit;
      const zone = { x: C.tree[side] - C.tree.width * .045, y: C.tree.y - C.tree.height * .55,
        width: C.tree.width * .09, height: C.tree.height * .52 };
      const support = side === 'left' ? 'right' : 'left';
      const standing = tracker.sample();
      assert.ok(standing.left.visible && standing.right.visible);
      assert.equal(footInTrunk(standing[side], zone), false);
      let contact = false;
      for (const amount of [.25, .4, .5, .75, 1]) {
        rabbit.rig.setLegExtension(side, amount); rabbit.rig.update(10);
        const feet = tracker.sample();
        assert.ok(feet[side].visible && feet[support].visible);
        assert.ok(Math.abs(feet[support].x - standing[support].x) < .001);
        assert.ok(Math.abs(feet[support].y - standing[support].y) < .001);
        assert.equal(footInTrunk(feet[support], zone), false);
        if (amount >= C.extensionThreshold && footInTrunk(feet[side], zone)) contact = true;
      }
      assert.ok(contact, `${side} foot never enters its existing trunk zone`);
    }
  } finally { rabbit.dispose(); }
});

test('new proportions improve hand elevation and lateral foot reach at the same screen height', async () => {
  const measure = async (backup: boolean) => {
    const rabbit = await fixture(backup);
    try {
      const cam = camera(rabbit, 800, 730);
      const point = (name: 'hand.L' | 'foot.L') => {
        rabbit.pivot.updateWorldMatrix(true, true);
        return projectToLogical(rabbit.rig.bones.get(name)!.getWorldPosition(new Vector3()), cam, viewport);
      };
      const hand = point('hand.L'), foot = point('foot.L');
      rabbit.rig.setArmRotation('left', 70); rabbit.rig.update(10);
      const raised = point('hand.L');
      rabbit.rig.setLegExtension('left', 1); rabbit.rig.update(10);
      const extended = point('foot.L');
      assert.ok(raised.visible && extended.visible);
      return { handRisePixels: hand.y - raised.y, legReachPixels: extended.x - foot.x };
    } finally { rabbit.dispose(); }
  };
  const oldModel = await measure(true), newModel = await measure(false);
  assert.ok(newModel.handRisePixels > oldModel.handRisePixels * 1.2, JSON.stringify({ oldModel, newModel }));
  assert.ok(newModel.legReachPixels > oldModel.legReachPixels * 1.2, JSON.stringify({ oldModel, newModel }));
  console.log('Equal-height rabbit movement comparison', { oldModel, newModel });
});
