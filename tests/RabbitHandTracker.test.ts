import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Group, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Rabbit3D } from '../src/game/3d/Rabbit3D';
import { Carrot3D } from '../src/game/3d/Carrot3D';
import { RabbitHandTracker } from '../src/game/3d/interaction/RabbitHandTracker';
import { CarrotAttachmentController } from '../src/game/3d/interaction/CarrotAttachmentController';

async function fixture() {
  const bytes = readFileSync(new URL('../model/dist/rabbit3d/rabbit_realtime_v3.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
  const rabbit = new Rabbit3D(gltf.scene);
  return { rabbit, tracker: new RabbitHandTracker(rabbit) };
}
const close = (a: Vector3, b: Vector3, tolerance = 1e-6) => assert.ok(a.distanceTo(b) < tolerance,
  `${a.toArray()} differs from ${b.toArray()}`);

test('Rabbit hand grip offsets are measured from the real V3 palm skin', async () => {
  const { rabbit, tracker } = await fixture();
  assert.equal(tracker.measurementSource, 'hand-weighted skin bounds');
  assert.ok(tracker.palmRadius > .12 && tracker.palmRadius < .14);
  assert.ok(tracker.HandGripOffset.L.length() > .05 && tracker.HandGripOffset.L.length() < .15);
  const sample = tracker.sample();
  assert.equal(sample.valid, true);
  assert.ok(sample.leftGripPosition.x > .75 && sample.rightGripPosition.x < -.75);
  assert.ok(sample.span > 1.5, 'Real V3 neutral paws cannot be claimed to touch a central carrot');
  tracker.dispose(); rabbit.dispose();
});

test('Rabbit tracker reads bone-local palm offsets in actual world coordinates', async () => {
  const { rabbit, tracker } = await fixture();
  const parent = new Group();
  parent.position.set(.3, -.2, .4);
  parent.rotation.set(.1, .2, -.3);
  parent.scale.setScalar(1.7);
  parent.add(rabbit.pivot);
  const sample = tracker.sample();
  close(sample.leftGripPosition, rabbit.rig.bones.get('hand.L')!.localToWorld(tracker.HandGripOffset.L.clone()));
  close(sample.rightGripPosition, rabbit.rig.bones.get('hand.R')!.localToWorld(tracker.HandGripOffset.R.clone()));
  assert.ok(Math.abs(sample.scale - 1.7) < 1e-6);
  assert.ok(sample.leftQuaternion.angleTo(rabbit.rig.bones.get('hand.L')!.getWorldQuaternion(new Quaternion())) < 1e-6);
  tracker.dispose(); rabbit.dispose();
});

test('Rabbit grip midpoint is the exact arithmetic mean for different root scales', async () => {
  const { rabbit, tracker } = await fixture();
  for (const scale of [.6, 1, 1.8]) {
    rabbit.pivot.scale.setScalar(scale);
    const sample = tracker.sample();
    close(sample.gripMidpoint, sample.leftGripPosition.clone().add(sample.rightGripPosition).multiplyScalar(.5));
    assert.ok(Math.abs(sample.scale - scale) < 1e-6);
  }
  tracker.dispose(); rabbit.dispose();
});

test('Rabbit root translations move both hand grips without using Bone.position as world', async () => {
  const { rabbit, tracker } = await fixture();
  const before = tracker.sample();
  rabbit.rig.setRootOffset(.1, .02, .04);
  rabbit.rig.update(10);
  const after = tracker.sample();
  close(after.leftGripPosition.clone().sub(before.leftGripPosition), new Vector3(.1, .02, .04));
  close(after.rightGripPosition.clone().sub(before.rightGripPosition), new Vector3(.1, .02, .04));
  assert.ok(after.leftGripPosition.distanceTo(rabbit.rig.bones.get('hand.L')!.position) > .5);
  tracker.dispose(); rabbit.dispose();
});

test('Rabbit tracking uses the final IK hand transform after the rig commit', async () => {
  const { rabbit, tracker } = await fixture();
  rabbit.rig.setIKEnabled(true);
  rabbit.rig.setHandTarget('left', .3, .3, .4);
  const before = tracker.sample().leftGripPosition;
  for (let frame = 0; frame < 120; frame++) rabbit.rig.update(1 / 60);
  const after = tracker.sample();
  assert.ok(after.leftGripPosition.distanceTo(before) > .2);
  close(after.leftGripPosition, rabbit.rig.bones.get('hand.L')!.localToWorld(tracker.HandGripOffset.L.clone()));
  assert.ok(after.leftGripPosition.distanceTo(new Vector3(.3, .3, .4)) > .5);
  tracker.dispose(); rabbit.dispose();
});

test('Rabbit final grip samples follow simultaneous arms, body lean, knees and high raises', async () => {
  const { rabbit, tracker } = await fixture();
  rabbit.rig.setIKEnabled(true);
  for (const [raise, elbow, lean, bend] of [[40, 80, 0, 0], [75, 70, 14, .5], [120, 30, -12, .8], [150, 0, 0, 0]]) {
    rabbit.rig.setArmRotation('left', raise, elbow, 90);
    rabbit.rig.setArmRotation('right', raise, elbow, 90);
    rabbit.rig.setBodyLean(lean, 8);
    rabbit.rig.setKneeBend(bend);
    for (let frame = 0; frame < 90; frame++) rabbit.rig.update(1 / 60);
    const sample = tracker.sample();
    assert.equal(sample.valid, true);
    close(sample.gripMidpoint, sample.leftGripPosition.clone().add(sample.rightGripPosition).multiplyScalar(.5));
    close(sample.leftGripPosition, rabbit.rig.bones.get('hand.L')!.localToWorld(tracker.HandGripOffset.L.clone()));
  }
  tracker.dispose(); rabbit.dispose();
});

test('Rabbit tracker invalidates nonfinite bone data and disposed samples', async () => {
  const { rabbit, tracker } = await fixture();
  assert.equal(tracker.sample(false).reliable, false);
  const bone = rabbit.rig.bones.get('hand.L')!;
  bone.position.x = NaN;
  assert.equal(tracker.sample().valid, false);
  tracker.dispose();
  assert.equal(tracker.sample().valid, false);
  rabbit.dispose();
});

test('Actual Carrot GLB follows final V3 arms, torso, shallow knees and root with quantified accuracy', async context => {
  const { rabbit, tracker } = await fixture();
  const bytes = readFileSync(new URL('../model/dist/carrot3d/carrot_realtime.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
  const carrot = new Carrot3D(gltf.scene);
  carrot.setScale(.6);
  const controller = new CarrotAttachmentController(carrot, tracker, {
    initialGripPosition: tracker.sample().gripMidpoint, allowDistanceBypass: true,
  });
  assert.equal(controller.grab().ok, false, 'The wide original rig must fail its genuine contact requirement');
  controller.setDistanceLimitEnabled(false);
  assert.equal(controller.grab().ok, true);
  for (let frame = 0; frame < 4; frame++) controller.update(.05);
  rabbit.rig.setIKEnabled(true);
  let maximumError = 0;
  for (let frame = 0; frame < 240; frame++) {
    const phase = frame / 240;
    rabbit.rig.setArmRotation('left', phase * 150, 0, 90);
    rabbit.rig.setArmRotation('right', phase * 150, 0, 90);
    rabbit.rig.setBodyLean(12 * Math.sin(phase * Math.PI * 4), 8);
    rabbit.rig.setKneeBend(.7 * Math.sin(phase * Math.PI) ** 2);
    rabbit.rig.setRootOffset(.1 * Math.sin(phase * Math.PI * 4));
    rabbit.rig.update(1 / 60);
    controller.update(1 / 60);
    const target = tracker.sample().gripMidpoint;
    maximumError = Math.max(maximumError, carrot.gripWorld().distanceTo(target));
    assert.equal(controller.state, 'ATTACHED');
    assert.ok(carrot.root.quaternion.toArray().every(Number.isFinite));
  }
  assert.ok(maximumError < 1e-7, `Measured attachment error ${maximumError}`);
  context.diagnostic(`Actual GLB 240-frame midpoint attachment maximum error ${maximumError} model units`);
  const released = carrot.gripWorld();
  controller.release();
  rabbit.rig.resetPose(); rabbit.rig.update(10); controller.update(.05);
  close(carrot.gripWorld(), released);
  controller.dispose(); tracker.dispose(); carrot.dispose(); rabbit.dispose();
});

test('Opt-in inward V3 pose genuinely grabs actual carrot within measured palm distances', async context => {
  const { rabbit, tracker } = await fixture();
  const bytes = readFileSync(new URL('../model/dist/carrot3d/carrot_realtime.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
  const carrot = new Carrot3D(gltf.scene);
  carrot.setScale(.6);
  rabbit.rig.setArmInwardEnabled(true);
  rabbit.rig.setIKEnabled(true);
  rabbit.rig.setArmRotation('left', 90, 10, 145);
  rabbit.rig.setArmRotation('right', 90, 10, 145);
  for (let frame = 0; frame < 120; frame++) rabbit.rig.update(1 / 60);
  const sample = tracker.sample();
  assert.ok(sample.span < .34);
  const controller = new CarrotAttachmentController(carrot, tracker, { initialGripPosition: sample.gripMidpoint });
  controller.update(0);
  assert.equal(controller.snapshot().distanceLimitEnabled, true);
  assert.equal(controller.snapshot().distanceBypassAllowed, false);
  assert.equal(controller.snapshot().contactSatisfied, true);
  assert.equal(controller.grab().ok, true);
  for (let frame = 0; frame < 4; frame++) controller.update(.05);
  let maximumError = 0;
  let maximumHandDistance = 0;
  for (let frame = 0; frame < 180; frame++) {
    const phase = frame / 180;
    rabbit.rig.setArmRotation('left', 85 + 5 * Math.sin(phase * Math.PI * 2), 10, 145);
    rabbit.rig.setArmRotation('right', 85 + 5 * Math.cos(phase * Math.PI * 2), 10, 145);
    rabbit.rig.setBodyLean(10 * Math.sin(phase * Math.PI * 4), 6);
    rabbit.rig.setKneeBend(.6 * Math.sin(phase * Math.PI) ** 2);
    rabbit.rig.setRootOffset(.08 * Math.sin(phase * Math.PI * 4));
    rabbit.rig.update(1 / 60);
    controller.update(1 / 60);
    const data = controller.snapshot();
    maximumError = Math.max(maximumError, data.attachmentError);
    maximumHandDistance = Math.max(maximumHandDistance, data.grabDistance);
    assert.equal(data.state, 'ATTACHED');
    assert.equal(data.contactSatisfied, true);
  }
  assert.ok(maximumError < 1e-7, `Strict attachment error ${maximumError}`);
  assert.ok(maximumHandDistance < controller.maxHandDistance);
  context.diagnostic(`Strict 180-frame attachment maximum error ${maximumError}, maximum hand distance ${maximumHandDistance}, limit ${controller.maxHandDistance} model units`);
  controller.dispose(); tracker.dispose(); carrot.dispose(); rabbit.dispose();
});
