import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Quaternion, Vector3 } from 'three';
import { Carrot3D } from '../src/game/3d/Carrot3D';
import { CarrotAttachmentController } from '../src/game/3d/interaction/CarrotAttachmentController';
import type { HandGripSample, RabbitHandTracker } from '../src/game/3d/interaction/RabbitHandTracker';

function fixture(allowDistanceBypass = false) {
  const model = new Group();
  model.add(new Mesh(new BoxGeometry(.2, .8, .2), new MeshStandardMaterial()));
  const grip = new Object3D();
  grip.name = 'Carrot_Grip_Point';
  grip.position.set(.03, .3, -.02);
  model.add(grip);
  const carrot = new Carrot3D(model);
  const left = new Vector3(.07, 1, .3), right = new Vector3(-.07, 1, .3);
  const tracking = { valid: true, scale: 1 };
  const tracker = {
    palmRadius: .13,
    sample(reliable = true): HandGripSample {
      return { leftGripPosition: left.clone(), rightGripPosition: right.clone(),
        gripMidpoint: left.clone().add(right).multiplyScalar(.5), leftQuaternion: new Quaternion(),
        rightQuaternion: new Quaternion(), span: left.distanceTo(right), scale: tracking.scale,
        valid: tracking.valid, reliable: tracking.valid && reliable };
    },
  } as RabbitHandTracker;
  const controller = new CarrotAttachmentController(carrot, tracker,
    { initialGripPosition: new Vector3(0, 1, .3), allowDistanceBypass });
  return { carrot, controller, left, right, tracking };
}
const finish = (controller: CarrotAttachmentController) => {
  for (let frame = 0; frame < 4; frame++) controller.update(.05);
  assert.equal(controller.state, 'ATTACHED');
};
const close = (a: Vector3, b: Vector3, tolerance = 1e-7) => assert.ok(a.distanceTo(b) < tolerance);

test('Grab state detects near target and confirms short continuous attachment', () => {
  const { carrot, controller } = fixture();
  assert.equal(controller.state, 'IDLE');
  controller.update(0);
  assert.equal(controller.state, 'NEAR_TARGET');
  assert.equal(controller.snapshot().eligible, true);
  assert.equal(controller.grab().ok, true);
  assert.equal(controller.state, 'GRABBING');
  finish(controller);
  assert.ok(controller.snapshot().attachmentError < .01);
  carrot.dispose();
});

test('Distance rule rejects either distant hand with an explicit reason', () => {
  const { carrot, controller, right } = fixture();
  right.x = -.7;
  controller.update(0);
  assert.equal(controller.state, 'IDLE');
  assert.equal(controller.grab().ok, false);
  assert.match(controller.snapshot().reason, /距離過遠/);
  assert.ok(controller.snapshot().rightDistance > controller.snapshot().maxHandDistance);
  carrot.dispose();
});

test('Distance limits scale in model units and bypass requires explicit developer capability', () => {
  const normal = fixture();
  assert.equal(normal.controller.setDistanceLimitEnabled(false), false);
  normal.left.x = .35; normal.right.x = -.35;
  normal.tracking.scale = 2;
  normal.controller.update(0);
  assert.equal(normal.controller.grab().ok, true);
  normal.carrot.dispose();
  const debug = fixture(true);
  debug.left.x = 2; debug.right.x = -2;
  assert.equal(debug.controller.setDistanceLimitEnabled(false), true);
  assert.equal(debug.controller.grab().ok, true);
  debug.carrot.dispose();
});

test('Attach transition starts at current grip and interpolates without a first-frame teleport', () => {
  const { carrot, controller } = fixture();
  carrot.setGripWorld(new Vector3(0, .9, .3), new Quaternion());
  const before = carrot.gripWorld();
  assert.equal(controller.grab().ok, true);
  close(carrot.gripWorld(), before);
  controller.update(.01);
  const movement = carrot.gripWorld().distanceTo(before);
  assert.ok(movement > 0 && movement < .01);
  finish(controller);
  carrot.dispose();
});

test('Attached carrot tracks both moving hands with exact grip alignment and no extra EMA', () => {
  const { carrot, controller, left, right } = fixture();
  controller.grab(); finish(controller);
  left.add(new Vector3(.2, .5, .15)); right.add(new Vector3(.2, .5, .15));
  controller.update(1 / 60);
  close(carrot.gripWorld(), left.clone().add(right).multiplyScalar(.5));
  assert.ok(controller.snapshot().attachmentError < 1e-7);
  assert.ok(Math.abs(controller.snapshot().leftDistance - .07) < 1e-7);
  assert.equal(controller.snapshot().contactSatisfied, true);
  carrot.dispose();
});

test('Attached transform remains exact inside independently transformed carrot parent', () => {
  const { carrot, controller, left, right } = fixture();
  const parent = new Group();
  parent.rotation.set(.2, .3, -.1);
  parent.position.set(-.5, 1, .6);
  parent.scale.setScalar(1.6);
  parent.add(carrot.root);
  carrot.setGripWorld(new Vector3(0, 1, .3), new Quaternion());
  controller.grab(); finish(controller);
  left.y += .5; right.y += .4;
  controller.update(1 / 60);
  close(carrot.gripWorld(), left.clone().add(right).multiplyScalar(.5));
  carrot.dispose();
});

test('Reset restores the initial affine matrix under a rotated nonuniform parent', () => {
  const { carrot, controller } = fixture();
  const parent = new Group();
  parent.rotation.set(.2, .3, -.1);
  parent.scale.set(2, 1, .5);
  parent.add(carrot.root);
  carrot.setGripWorld(new Vector3(0, 1, .3), new Quaternion());
  const affine = new CarrotAttachmentController(carrot, controller.tracker);
  const beforeMatrix = carrot.root.matrix.clone();
  const before = carrot.gripWorld();
  assert.equal(affine.grab().ok, true);
  finish(affine);
  affine.reset();
  close(carrot.gripWorld(), before);
  assert.deepEqual(carrot.root.matrix.elements, beforeMatrix.elements);
  assert.equal(carrot.root.matrixAutoUpdate, false);
  carrot.dispose();
});

test('Holding orientation has bounded upright tilt and a safe coincident-hand fallback', () => {
  const { carrot, controller, left, right } = fixture();
  controller.grab(); finish(controller);
  for (const position of [new Vector3(-2, 5, 3), new Vector3(0, 0, 0), new Vector3(5, -4, -3)]) {
    left.copy(position); right.copy(position).multiplyScalar(-1);
    controller.update(1 / 60);
    const up = new Vector3(0, 1, 0).applyQuaternion(carrot.root.getWorldQuaternion(new Quaternion()));
    assert.ok(up.y > .9);
    assert.ok(carrot.root.quaternion.toArray().every(Number.isFinite));
  }
  left.copy(right);
  controller.update(1 / 60);
  assert.ok(carrot.root.quaternion.toArray().every(Number.isFinite));
  carrot.dispose();
});

test('Release holds final world grip while rabbit hands continue moving', () => {
  const { carrot, controller, left, right } = fixture();
  controller.grab(); finish(controller);
  const released = carrot.gripWorld();
  const rotation = carrot.root.getWorldQuaternion(new Quaternion());
  assert.equal(controller.release(), true);
  assert.equal(controller.state, 'RELEASING');
  left.y += 1; right.y += 1;
  controller.update(.05);
  assert.equal(controller.state, 'RELEASED');
  controller.update(.05);
  close(carrot.gripWorld(), released);
  assert.ok(carrot.root.getWorldQuaternion(new Quaternion()).angleTo(rotation) < 1e-7);
  carrot.dispose();
});

test('Reset restores initial transform and IDLE with no game score integration', () => {
  const { carrot, controller, left, right } = fixture();
  const initial = carrot.gripWorld();
  controller.grab(); finish(controller);
  left.y += 1; right.y += 1;
  controller.update(.05);
  controller.reset();
  assert.equal(controller.state, 'IDLE');
  assert.equal(controller.snapshot().transitionElapsed, 0);
  close(carrot.gripWorld(), initial);
  carrot.dispose();
});

test('Tracking loss rejects new grabs and keeps existing attachment through neutral recovery', () => {
  const { carrot, controller, left, right } = fixture();
  controller.update(0, false);
  assert.equal(controller.grab().ok, false);
  controller.update(0, true);
  assert.equal(controller.grab().ok, true);
  finish(controller);
  left.y -= .08; right.y -= .08;
  controller.update(.05, false);
  assert.equal(controller.state, 'ATTACHED');
  close(carrot.gripWorld(), left.clone().add(right).multiplyScalar(.5));
  assert.equal(controller.snapshot().reliable, false);
  controller.update(.05, true);
  assert.equal(controller.snapshot().reliable, true);
  carrot.dispose();
});

test('Pause freezes transforms and attach timer, blocks actions and resumes capped timing', () => {
  const { carrot, controller, left, right } = fixture();
  controller.grab(); controller.update(.05);
  const before = carrot.gripWorld();
  const elapsed = controller.snapshot().transitionElapsed;
  controller.pause();
  assert.equal(controller.setDistanceLimitEnabled(true), false);
  left.y += 1; right.y += 1;
  controller.update(10);
  assert.equal(controller.grab().ok, false);
  assert.equal(controller.release(), false);
  controller.reset();
  close(carrot.gripWorld(), before);
  assert.equal(controller.snapshot().transitionElapsed, elapsed);
  controller.resume(); controller.update(10);
  assert.equal(controller.state, 'GRABBING');
  assert.ok(controller.snapshot().transitionElapsed - elapsed <= .05);
  carrot.dispose();
});

test('Invalid hand samples and delta values preserve attachment transform and finite quaternion', () => {
  const { carrot, controller, left, tracking } = fixture();
  controller.grab(); finish(controller);
  const before = carrot.gripWorld();
  tracking.valid = false;
  left.x = NaN;
  controller.update(.05);
  controller.update(NaN); controller.update(Infinity); controller.update(-1);
  close(carrot.gripWorld(), before);
  assert.ok(carrot.root.quaternion.toArray().every(Number.isFinite));
  assert.match(controller.snapshot().reason, /無效/);
  carrot.dispose();
});

test('Invalid carrot transforms suspend attachment math until reset restores valid geometry', () => {
  const { carrot, controller } = fixture();
  controller.grab(); finish(controller);
  const validError = controller.snapshot().attachmentError;
  carrot.root.scale.x = NaN;
  controller.update(.05);
  assert.equal(controller.state, 'ATTACHED');
  assert.equal(controller.snapshot().attachmentError, validError);
  assert.match(controller.snapshot().reason, /握點無效/);
  controller.reset();
  controller.update(0);
  assert.equal(controller.state, 'NEAR_TARGET');
  assert.equal(controller.grab().ok, true);
  carrot.dispose();
});

test('Controller disposal ends all attachment writes and subsequent actions', () => {
  const { carrot, controller, left, right } = fixture();
  controller.grab(); finish(controller);
  const before = carrot.gripWorld();
  controller.dispose(); controller.dispose();
  left.y += 1; right.y += 1;
  controller.update(.05); controller.reset();
  assert.equal(controller.grab().ok, false);
  assert.equal(controller.release(), false);
  close(carrot.gripWorld(), before);
  assert.equal(controller.snapshot().disposed, true);
  assert.equal(controller.setDistanceLimitEnabled(true), false);
  carrot.dispose();
});

test('Bypass attachment explicitly reports far hands while maintaining exact midpoint alignment', () => {
  const { carrot, controller, left, right } = fixture(true);
  left.x = .8; right.x = -.8;
  controller.setDistanceLimitEnabled(false);
  assert.equal(controller.grab().ok, true);
  finish(controller);
  assert.equal(controller.snapshot().contactSatisfied, false);
  assert.match(controller.snapshot().reason, /仍未接觸/);
  assert.ok(controller.snapshot().attachmentError < 1e-7);
  carrot.dispose();
});
