import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Box3, DoubleSide, Mesh, Raycaster, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Rabbit3D } from '../src/game/3d/Rabbit3D';
import { neutralRabbitPose } from '../src/game/mocap/RabbitPose';

async function fixture() {
  const bytes = readFileSync(new URL('../model/dist/rabbit3d/rabbit_realtime_v3.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const rabbit = new Rabbit3D(gltf.scene);
  rabbit.rig.setIKEnabled(true);
  return { rabbit, rig: rabbit.rig, model: gltf.scene };
}
function advance(rabbit: Rabbit3D, frames = 120) {
  for (let i = 0; i < frames; i++) rabbit.rig.update(1 / 60);
  rabbit.model.traverse(mesh => { if (mesh instanceof SkinnedMesh) mesh.skeleton.update(); });
}

test('V3 final pose owner preserves exact standing rest, reset and disposal under IK', async () => {
  const { rabbit, rig } = await fixture();
  try {
    const rests = [...rig.bones].map(([name, bone]) => ({ name, position: bone.position.clone(), q: bone.quaternion.clone().normalize() }));
    advance(rabbit);
    for (const rest of rests) {
      const bone = rig.bones.get(rest.name)!;
      assert.ok(bone.position.distanceTo(rest.position) < 1e-6);
      assert.ok(bone.quaternion.clone().normalize().angleTo(rest.q) < 1e-5);
    }
    rig.applyPose({ ...neutralRabbitPose(), leftArmElevation: 120, rightArmElevation: 120,
      leftElbowBend: 110, bendAmount: 1, lateralOffset: .45, torsoLean: 18 });
    advance(rabbit);
    rig.resetPose(true);
    for (const rest of rests) assert.ok(rig.bones.get(rest.name)!.position.distanceTo(rest.position) < 1e-6);
    advance(rabbit);
    assert.ok(rig.ikSnapshot().feet!.maximumContactError < 1e-5);
    rig.dispose();
    rig.setIKEnabled(true); rig.setKneeBend(1); rig.update(1);
    assert.equal(rig.ikSnapshot().enabled, false);
    assert.equal(rig.setHandTarget('left', 1, 1, 1), false);
  } finally { rabbit.dispose(); }
});

test('simultaneous arms, lean, knee and translation retain skin topology and head clearance', async () => {
  const { rabbit, rig, model } = await fixture();
  try {
    const skins: SkinnedMesh[] = [];
    model.traverse(mesh => { if (mesh instanceof SkinnedMesh) skins.push(mesh); });
    const points = (mesh: Mesh) => Array.from({ length: mesh.geometry.getAttribute('position').count },
      (_, i) => mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld));
    advance(rabbit);
    const reference = skins.map(mesh => ({ mesh, vertices: points(mesh), indices: mesh.geometry.index!.array }));
    const head = model.getObjectByName('Rabbit_Head') as Mesh;
    for (const material of Array.isArray(head.material) ? head.material : [head.material]) material.side = DoubleSide;
    const ray = new Raycaster(); const direction = new Vector3(1, .173, .397).normalize();
    let minArea = Infinity, maxStretch = 0, maxContactError = 0;
    for (const [raise, elbow, plane, bend, lateral] of [
      [0, 110, 0, .25, 0], [120, 110, 0, .5, .1], [150, 110, 45, 1, -.1],
      [120, 90, 90, .75, .45], [75, 110, 45, 1, -.45], [150, 0, 90, .5, 0],
    ]) {
      rig.applyPose({ ...neutralRabbitPose(), leftArmElevation: raise, rightArmElevation: raise,
        leftElbowBend: elbow, rightElbowBend: elbow, leftArmPlane: plane, rightArmPlane: plane,
        torsoLean: 18, torsoForward: 16, headYaw: 25, headPitch: 18, bendAmount: bend, lateralOffset: lateral });
      advance(rabbit);
      const snapshot = rig.ikSnapshot();
      maxContactError = Math.max(maxContactError, snapshot.feet!.maximumContactError);
      assert.ok(snapshot.feet!.maximumContactError < 1e-5);
      for (const side of ['left', 'right'] as const) assert.ok(snapshot.feet![side].kneeDegrees <= 48.001);
      const bounds = new Box3().setFromObject(head);
      for (const { mesh, vertices: original, indices } of reference) {
        const current = points(mesh);
        for (let i = 0; i < indices.length; i += 3) {
          const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
          const restArea = original[b].clone().sub(original[a]).cross(original[c].clone().sub(original[a])).length();
          if (restArea < 1e-10) continue;
          const area = current[b].clone().sub(current[a]).cross(current[c].clone().sub(current[a])).length() / restArea;
          minArea = Math.min(minArea, area);
          assert.ok(Number.isFinite(area) && area >= .03, `collapsed ${mesh.name} ${area}`);
          for (const [from, to] of [[a, b], [b, c], [c, a]]) {
            const length = original[from].distanceTo(original[to]);
            if (length < 1e-6) continue;
            const ratio = current[from].distanceTo(current[to]) / length;
            maxStretch = Math.max(maxStretch, ratio);
            assert.ok(ratio <= 2.5 && ratio > 0, `stretched ${mesh.name} ${ratio}`);
          }
        }
        if (mesh.name.startsWith('Rabbit_Arm_')) for (const point of current) {
          if (!bounds.containsPoint(point)) continue;
          ray.set(point, direction);
          const hits = ray.intersectObject(head, false).map(hit => hit.distance)
            .filter((v, i, all) => i === 0 || Math.abs(v - all[i - 1]) > 1e-5);
          assert.equal(hits.length % 2, 0, `IK arm inside head at ${raise}/${elbow}/${plane}`);
        }
      }
    }
    console.log('IK combined actual mesh metrics', { minArea, maxStretch, maxContactError });
  } finally { rabbit.dispose(); }
});

test('IK explicit hand targets are finite, independently constrained and smoothly released to FK', async () => {
  const { rabbit, rig } = await fixture();
  try {
    advance(rabbit);
    const right = rig.bones.get('hand.R')!.quaternion.clone();
    assert.equal(rig.setHandTarget('left', NaN, 1, 0), false);
    assert.equal(rig.setHandTarget('left', 1e300, 1, 0), false);
    assert.equal(rig.setHandTarget('left', 10, 10, 10), true);
    advance(rabbit);
    const result = rig.ikSnapshot();
    assert.ok(result.hands.L.clamped && Number.isFinite(result.hands.L.residual));
    assert.ok(result.hands.L.raise <= 150);
    assert.ok(result.hands.L.elbow <= rig.maximumElbowBend(result.hands.L.raise) + 1e-5);
    assert.ok(rig.bones.get('hand.R')!.quaternion.angleTo(right) < 1e-5);
    rig.setIKEnabled(false);
    let previous = rig.bones.get('upper_arm.L')!.quaternion.clone();
    for (let i = 0; i < 120; i++) {
      rig.update(1 / 60);
      const current = rig.bones.get('upper_arm.L')!.quaternion;
      assert.ok(current.angleTo(previous) < .7);
      previous.copy(current);
    }
    assert.equal(rig.ikSnapshot().weight, 0);
    rig.clearHandTarget('left'); rig.resetPose(); advance(rabbit);
    assert.ok([...rig.bones.values()].every(bone => bone.quaternion.toArray().every(Number.isFinite)));
  } finally { rabbit.dispose(); }
});

test('IK snapshots retain independent applied contact and hand residual measurements', async () => {
  const { rabbit, rig } = await fixture();
  try {
    advance(rabbit);
    rig.setArmRotation('left', 120, 0, 45);
    rig.update(1 / 60);
    const first = rig.ikSnapshot();
    const retained = JSON.stringify(first);
    assert.ok(first.hands.L.residual > first.hands.L.solverResidual + .1);
    rig.setRootOffset(.1); rig.setKneeBend(1); advance(rabbit);
    assert.equal(JSON.stringify(first), retained);
    assert.ok(rig.ikSnapshot().hands.L.residual < .001);
    rig.setIKEnabled(false); advance(rabbit);
    assert.deepEqual(rig.ikSnapshot().hands, {});
    assert.equal(rig.ikSnapshot().constraintClamped, false);
  } finally { rabbit.dispose(); }
});
