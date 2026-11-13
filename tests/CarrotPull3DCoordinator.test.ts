import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Rabbit3D } from '../src/game/3d/Rabbit3D';
import { Carrot3D } from '../src/game/3d/Carrot3D';
import { RabbitHandTracker } from '../src/game/3d/interaction/RabbitHandTracker';
import { CarrotAttachmentController } from '../src/game/3d/interaction/CarrotAttachmentController';
import { CarrotPull3DCoordinator } from '../src/game/3d/gameplay/CarrotPull3DCoordinator';
import { CARROT_GAME_CONFIG as CONFIG } from '../src/game/3d/gameplay/carrotGameConfig';
import { CarrotRound, type RoundState } from '../src/game/systems/CarrotRound';
import { neutralRabbitPose, type RabbitPose } from '../src/game/mocap/RabbitPose';
import type { MotionSample } from '../src/game/input/MotionInput';

const standing = { bending: false, standing: true };
const bending = { bending: true, standing: false };
const nothing = { bending: false, standing: false };
const close = (a: Vector3, b: Vector3, tolerance = 1e-6) => assert.ok(a.distanceTo(b) < tolerance, `${a.toArray()} differs from ${b.toArray()}`);

async function load(path: string) {
  const bytes = readFileSync(new URL(`../model/dist/${path}`, import.meta.url));
  return (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
}
async function fixture(completeAutomatically = true, basketTarget = new Vector3(3.8, .5, .7)) {
  const rabbit = new Rabbit3D(await load('rabbit3d/rabbit_realtime_v3.glb'));
  const carrot = new Carrot3D(await load('carrot3d/carrot_realtime.glb'));
  const tracker = new RabbitHandTracker(rabbit);
  const model = new CarrotRound();
  let callbacks = 0, unavailable = 0;
  const game = new CarrotPull3DCoordinator(rabbit, carrot, tracker, {
    basketTarget,
    onHarvestComplete: () => {
      callbacks++;
      if (completeAutomatically && model.completeCelebration()) game.onRoundState(model.state);
    },
    onAssistanceUnavailable: () => { unavailable++; },
  });
  function frame(input: MotionSample, bend: number, source: RabbitPose = neutralRabbitPose(), dt = 1 / 60) {
    if (game.frozen) return;
    const pose = { ...source, bendAmount: bend, trackingConfidence: 1 };
    rabbit.rig.applyPose(pose);
    game.preparePose(dt, bend, pose, model.progress);
    rabbit.rig.update(dt);
    game.afterPose(dt);
    const previous = model.state;
    if (game.canAdvanceRound) model.update(dt * 1000, input);
    if (model.state !== previous) game.onRoundState(model.state);
  }
  function driveUntil(predicate: () => boolean, input: MotionSample, bend: number, maximum = 600, source = neutralRabbitPose()) {
    for (let frameIndex = 0; frameIndex < maximum && !predicate(); frameIndex++) frame(input, bend, source);
    assert.ok(predicate(), JSON.stringify({ state: model.state, game: game.snapshot() }));
  }
  const attach = () => driveUntil(() => game.snapshot().phase === 'ATTACHED', bending, 1);
  const succeed = () => driveUntil(() => model.state === 'SUCCESS', standing, 0);
  const dispose = () => { game.dispose(); tracker.dispose(); carrot.dispose(); rabbit.dispose(); };
  return { rabbit, carrot, tracker, model, game, frame, driveUntil, attach, succeed, dispose,
    get callbacks() { return callbacks; }, get unavailable() { return unavailable; } };
}

test('3D coordinator starts READY with one reusable planted carrot and clipped root', async () => {
  const f = await fixture();
  assert.equal(f.model.state, 'READY');
  assert.equal(f.game.snapshot().phase, 'PLANTED');
  assert.equal(f.game.snapshot().soilOcclusion, true);
  assert.equal(f.carrot.soilClippingHeight, f.game.soilWorldY);
  assert.equal(f.carrot.root.visible, true);
  assert.equal(f.game.canAdvanceRound, true);
  f.dispose();
});

test('Planted point is measured from actual V3 shallow-knee primary palm', async () => {
  const f = await fixture();
  close(f.game.plantedGrip, new Vector3(.271323846, 1.137926870, .502471157));
  close(f.carrot.gripWorld(), f.game.plantedGrip);
  assert.ok(f.game.snapshot().originalTargetDistance > 1);
  assert.ok(f.game.snapshot().maximumArmReach > .7 && f.game.snapshot().maximumArmReach < .8);
  assert.ok(f.game.snapshot().originalShoulderDistance > f.game.snapshot().maximumArmReach);
  assert.ok(f.game.snapshot().plantedShoulderDistance < f.game.snapshot().maximumPalmReach);
  assert.ok(f.game.snapshot().plantedWristDistance <= f.game.snapshot().maximumArmReach + 1e-6);
  assert.ok(Math.abs(f.carrot.root.scale.y - .4) < 1e-6);
  f.dispose();
});

test('Initial reach measurement restores actual neutral rabbit bones before visible play', async () => {
  const f = await fixture();
  assert.ok(f.rabbit.rig.bones.get('root')!.position.x === 0);
  assert.ok(f.tracker.sample().leftGripPosition.x > .75);
  assert.equal(f.rabbit.rig.armInwardEnabled, true);
  f.dispose();
});

test('Standing never enters a grab or harvest', async () => {
  const f = await fixture();
  for (let i = 0; i < 180; i++) f.frame(standing, 0);
  assert.equal(f.model.state, 'READY');
  assert.equal(f.game.snapshot().phase, 'PLANTED');
  assert.equal(f.callbacks, 0);
  f.dispose();
});

test('Original continuous bend hold governs BENDING progress', async () => {
  const f = await fixture();
  for (let i = 0; i < 18; i++) f.frame(bending, .8);
  assert.equal(f.model.state, 'BENDING');
  assert.ok(f.model.progress > .4 && f.model.progress < .6);
  assert.equal(f.game.snapshot().phase, 'PLANTED');
  f.dispose();
});

test('Incomplete shallow bend and early standing restore READY without attachment', async () => {
  const f = await fixture();
  for (let i = 0; i < 15; i++) f.frame(bending, .7);
  f.frame(standing, 0);
  assert.equal(f.model.state, 'READY');
  assert.equal(f.game.snapshot().phase, 'PLANTED');
  close(f.carrot.gripWorld(), f.game.plantedGrip);
  f.dispose();
});

test('Neutral classification does not trigger a grab despite a continuous visual knee bend', async () => {
  const f = await fixture();
  for (let i = 0; i < 100; i++) f.frame(nothing, 1);
  assert.equal(f.model.state, 'READY');
  assert.equal(f.game.snapshot().phase, 'PLANTED');
  f.dispose();
});

test('GRABBED starts finite assisted reach with exclusive primary arm ownership', async () => {
  const f = await fixture();
  f.driveUntil(() => f.model.state === 'GRABBED', bending, 1);
  assert.equal(f.game.snapshot().phase, 'REACHING');
  assert.equal(f.game.canAdvanceRound, false);
  assert.match(f.game.snapshot().owner, /assisted primary arm/);
  f.dispose();
});

test('Early standing waits for actual assisted attachment before RETURNING', async () => {
  const f = await fixture();
  f.driveUntil(() => f.model.state === 'GRABBED', bending, 1);
  for (let i = 0; i < 10; i++) f.frame(standing, 0);
  assert.equal(f.model.state, 'GRABBED');
  assert.equal(f.game.snapshot().phase, 'REACHING');
  f.driveUntil(() => f.model.state === 'RETURNING', standing, 0);
  assert.equal(f.game.attachment.state, 'ATTACHED');
  f.dispose();
});

test('Entering 3D during an existing RETURNING round completes assistance before advancing its hold', async () => {
  const f = await fixture();
  try {
    f.model.update(650, bending);
    f.model.update(100, standing);
    assert.equal(f.model.state, 'RETURNING');
    f.game.onRoundState(f.model.state);
    assert.equal(f.game.snapshot().phase, 'REACHING');
    const progress = f.model.progress;
    for (let frame = 0; frame < 10; frame++) f.frame(standing, 0);
    assert.equal(f.model.state, 'RETURNING');
    assert.equal(f.model.progress, progress);
    assert.equal(f.model.score, 0);
    f.driveUntil(() => f.callbacks === 1, standing, 0);
    assert.equal(f.model.score, 1);
    assert.equal(f.game.snapshot().harvestCallbacks, 1);
  } finally { f.dispose(); }
});

test('Entering 3D during an existing SUCCESS round attaches and harvests exactly once', async () => {
  const f = await fixture();
  try {
    f.model.update(650, bending);
    f.model.update(500, standing);
    assert.equal(f.model.state, 'SUCCESS');
    f.game.onRoundState(f.model.state);
    assert.equal(f.game.snapshot().phase, 'REACHING');
    assert.equal(f.model.score, 0);
    f.driveUntil(() => f.game.snapshot().phase === 'LIFTING', standing, 0);
    assert.equal(f.game.attachment.state, 'ATTACHED');
    assert.equal(f.model.score, 0);
    f.driveUntil(() => f.callbacks === 1, standing, 0);
    for (let frame = 0; frame < 120; frame++) f.frame(standing, 0);
    assert.equal(f.model.score, 1);
    assert.equal(f.callbacks, 1);
  } finally { f.dispose(); }
});

test('Assisted arm motion starts continuously from the current mocap request', async () => {
  const f = await fixture();
  f.driveUntil(() => f.model.state === 'GRABBED', bending, 1);
  const source = { ...neutralRabbitPose(), leftArmElevation: 30, leftArmPlane: 50, leftElbowBend: 15 };
  f.frame(bending, 1, source);
  const target = f.game.snapshot().primaryArmTarget;
  assert.ok(target.raise >= 30 && target.raise < 31);
  assert.ok(target.plane >= 50 && target.plane < 51);
  f.dispose();
});

test('Primary hand grabs automatically within the bounded alignment distance', async () => {
  const f = await fixture(); f.attach();
  const data = f.game.snapshot();
  assert.equal(data.attachment.handMode, 'left');
  assert.equal(data.attachment.distanceBypassAllowed, false);
  assert.equal(data.attachment.distanceLimitEnabled, true);
  assert.ok(data.primaryDistance < CONFIG.maximumAlignmentDistance);
  assert.ok(data.contactDistanceAtGrab! <= CONFIG.maximumAlignmentDistance);
  assert.equal(data.alignmentUsed, true);
  assert.equal(data.attachment.state, 'ATTACHED');
  f.dispose();
});

test('Comfortable shallow bend and small simultaneous body motion retain a reachable automatic grip', async () => {
  for (const sign of [-1, 1]) {
    const f = await fixture();
    try {
      const source = { ...neutralRabbitPose(), torsoLean: sign * 10, torsoForward: 6,
        lateralOffset: sign * .08, rightArmElevation: 80, rightArmPlane: 70 };
      f.driveUntil(() => f.game.snapshot().phase === 'ATTACHED', bending, .65, 300, source);
      assert.equal(f.unavailable, 0);
      assert.ok(f.game.snapshot().primaryDistance < CONFIG.maximumAlignmentDistance);
      assert.ok(f.game.snapshot().maximumAttachStep < .04);
    } finally { f.dispose(); }
  }
});

test('Auxiliary arm remains continuously controlled by mocap during reach and hold', async () => {
  const f = await fixture(); f.attach();
  const before = f.tracker.sample().rightGripPosition;
  const source = { ...neutralRabbitPose(), rightArmElevation: 80, rightArmPlane: 80, rightElbowBend: 10 };
  for (let i = 0; i < 90; i++) f.frame(bending, 1, source);
  assert.ok(f.tracker.sample().rightGripPosition.distanceTo(before) > .4);
  assert.ok(f.game.snapshot().attachmentError < .01);
  f.dispose();
});

test('Primary hold retains bounded input contribution instead of freezing the whole pose', async () => {
  const f = await fixture(); f.attach();
  const first = f.game.snapshot().primaryArmTarget.raise;
  const source = { ...neutralRabbitPose(), leftArmElevation: 120, leftArmPlane: 140 };
  f.frame(bending, 1, source);
  const second = f.game.snapshot().primaryArmTarget.raise;
  assert.ok(second > first);
  assert.ok(second - CONFIG.reach.raise <= CONFIG.sourceRaiseContribution);
  f.dispose();
});

test('Body, head, shallow knees and root keep their independent real-time ownership', async () => {
  const f = await fixture(); f.attach();
  const before = f.rabbit.rig.bones.get('body')!.quaternion.clone();
  const source = { ...neutralRabbitPose(), torsoLean: 10, headYaw: 8, lateralOffset: .08 };
  for (let i = 0; i < 90; i++) f.frame(bending, .7, source);
  assert.ok(f.rabbit.rig.bones.get('body')!.quaternion.angleTo(before) > .1);
  assert.ok(f.rabbit.rig.bones.get('root')!.position.x > .01);
  assert.ok(f.game.snapshot().attachmentError < .01);
  f.dispose();
});

test('Stable crouching preserves the grip without starting pull progress', async () => {
  const f = await fixture(); f.attach();
  for (let i = 0; i < 60; i++) f.frame(bending, 1);
  assert.equal(f.model.state, 'GRABBED');
  assert.equal(f.game.snapshot().pullProgress, 0);
  f.dispose();
});

test('Continuous calibrated return gradually lifts the carrot before scoring', async () => {
  const f = await fixture(); f.attach();
  const first = f.carrot.gripWorld().y;
  for (let i = 0; i < 20; i++) f.frame(nothing, 1 - (i + 1) / 30);
  const data = f.game.snapshot();
  assert.ok(data.pullProgress > .3 && data.pullProgress < 1);
  assert.ok(f.carrot.gripWorld().y > first + .1);
  assert.equal(f.model.score, 0);
  f.dispose();
});

test('RETURNING interruption returns to GRABBED while visual pull remains monotonic', async () => {
  const f = await fixture(); f.attach();
  for (let i = 0; i < 12; i++) f.frame(standing, 0);
  assert.equal(f.model.state, 'RETURNING');
  const progress = f.game.snapshot().pullProgress;
  for (let i = 0; i < 15; i++) f.frame(bending, 1);
  assert.equal(f.model.state, 'GRABBED');
  assert.ok(f.game.snapshot().pullProgress >= progress);
  assert.equal(f.game.snapshot().phase, 'ATTACHED');
  f.dispose();
});

test('Visual extraction alone cannot score without original stable-standing classification', async () => {
  const f = await fixture(); f.attach();
  for (let i = 0; i < 180; i++) f.frame(nothing, 0);
  assert.equal(f.game.snapshot().pullProgress, 1);
  assert.equal(f.model.score, 0);
  assert.equal(f.callbacks, 0);
  f.dispose();
});

test('SUCCESS begins lift completion and basket ownership after stable standing', async () => {
  const f = await fixture(); f.attach(); f.succeed();
  assert.equal(f.model.state, 'SUCCESS');
  assert.equal(f.game.snapshot().phase, 'LIFTING');
  f.driveUntil(() => f.game.snapshot().phase === 'TRANSFERRING', standing, 0);
  assert.equal(f.game.attachment.state, 'RELEASING');
  assert.equal(f.model.score, 0);
  f.dispose();
});

test('Harvest arc is continuous and ends at the supplied Three world basket target', async () => {
  const f = await fixture(false); f.attach(); f.succeed();
  f.driveUntil(() => f.game.snapshot().phase === 'TRANSFERRING', standing, 0);
  const before = f.carrot.gripWorld();
  f.frame(standing, 0);
  assert.ok(f.carrot.gripWorld().distanceTo(before) < .03);
  f.driveUntil(() => f.callbacks === 1, standing, 0);
  close(f.carrot.gripWorld(), new Vector3(3.8, .5, .7));
  assert.equal(f.carrot.root.visible, false);
  assert.equal(f.game.snapshot().soilOcclusion, false);
  f.dispose();
});

test('Basket transfer reports primary return blending until mocap has recovered arm ownership', async () => {
  const f = await fixture(false);
  try {
    f.attach(); f.succeed();
    f.driveUntil(() => f.game.snapshot().phase === 'TRANSFERRING', standing, 0);
    assert.match(f.game.snapshot().owner, /primary return blend/);
    f.driveUntil(() => f.game.snapshot().transferElapsed >= CONFIG.returnArmSeconds, standing, 0);
    assert.equal(f.game.snapshot().owner, 'Mocap');
    assert.equal(f.callbacks, 0);
  } finally { f.dispose(); }
});

test('A harvest notification has no independent score authority', async () => {
  const f = await fixture(false); f.attach(); f.succeed();
  f.driveUntil(() => f.callbacks === 1, standing, 0);
  assert.equal(f.model.state, 'SUCCESS');
  assert.equal(f.model.score, 0);
  assert.equal(f.model.completeCelebration(), true);
  assert.equal(f.model.score, 1);
  f.dispose();
});

test('Duplicate SUCCESS notifications and additional frames deliver one harvest callback', async () => {
  const f = await fixture(false); f.attach(); f.succeed();
  for (let i = 0; i < 5; i++) f.game.onRoundState('SUCCESS');
  f.driveUntil(() => f.callbacks === 1, standing, 0);
  for (let i = 0; i < 200; i++) f.frame(standing, 0);
  assert.equal(f.callbacks, 1);
  assert.equal(f.game.snapshot().harvestCallbacks, 1);
  f.dispose();
});

test('Next round resets attachment, soil and pull while reusing model resources', async () => {
  const f = await fixture();
  const carrotModel = f.carrot.model, rabbitModel = f.rabbit.model;
  f.attach(); f.succeed();
  f.driveUntil(() => f.model.score === 1, standing, 0);
  assert.ok(f.model.state === 'NEXT_ROUND' || f.model.state === 'READY');
  assert.equal(f.game.snapshot().phase, 'PLANTED');
  assert.equal(f.game.snapshot().pullProgress, 0);
  assert.equal(f.carrot.root.visible, true);
  assert.equal(f.carrot.soilClippingHeight, f.game.soilWorldY);
  assert.equal(f.carrot.model, carrotModel);
  assert.equal(f.rabbit.model, rabbitModel);
  close(f.carrot.gripWorld(), f.game.plantedGrip);
  f.dispose();
});

test('Five rounds finish through the original state machine with exactly five callbacks', async () => {
  const f = await fixture();
  for (let score = 1; score <= 5; score++) {
    if (f.model.state === 'NEXT_ROUND') f.frame(standing, 0);
    f.attach(); f.succeed();
    f.driveUntil(() => f.model.score === score, standing, 0);
  }
  assert.equal(f.model.state, 'COMPLETE');
  assert.equal(f.game.snapshot().phase, 'COMPLETE');
  assert.equal(f.callbacks, 5);
  assert.equal(f.game.snapshot().harvestCallbacks, 5);
  assert.equal(f.carrot.root.visible, false);
  f.dispose();
});

test('COMPLETE produces no sixth carrot or late score', async () => {
  const f = await fixture();
  f.game.onRoundState('COMPLETE');
  const before = f.carrot.gripWorld();
  for (let i = 0; i < 200; i++) { f.game.preparePose(1 / 60, 1); f.game.afterPose(1 / 60); }
  assert.equal(f.callbacks, 0);
  assert.equal(f.carrot.root.visible, false);
  close(f.carrot.gripWorld(), before);
  f.dispose();
});

test('COMPLETE ends active attachment writes and clears the soil plane', async () => {
  const f = await fixture();
  try {
    f.attach();
    f.game.onRoundState('COMPLETE');
    const position = f.carrot.gripWorld();
    f.rabbit.rig.setArmRotation('left', 140, 0, 90);
    for (let frame = 0; frame < 60; frame++) {
      f.rabbit.rig.update(1 / 60);
      f.game.afterPose(1 / 60);
    }
    close(f.carrot.gripWorld(), position);
    assert.equal(f.carrot.soilClippingHeight, null);
    assert.equal(f.game.snapshot().soilOcclusion, false);
    assert.equal(f.game.canAdvanceRound, false);
    assert.equal(f.callbacks, 0);
  } finally { f.dispose(); }
});

test('Tracking loss freezes reach clocks, carrot and callback delivery', async () => {
  const f = await fixture();
  f.driveUntil(() => f.model.state === 'GRABBED', bending, 1);
  for (let i = 0; i < 10; i++) f.frame(bending, 1);
  f.game.setTrackingReliable(false);
  const before = f.game.snapshot(), grip = f.carrot.gripWorld();
  for (let i = 0; i < 100; i++) f.frame(standing, 0);
  assert.equal(f.game.snapshot().reachElapsed, before.reachElapsed);
  close(f.carrot.gripWorld(), grip);
  assert.equal(f.callbacks, 0);
  f.dispose();
});

test('Reliable tracking recovery continues the same assisted reach', async () => {
  const f = await fixture();
  f.driveUntil(() => f.model.state === 'GRABBED', bending, 1);
  f.game.setTrackingReliable(false);
  f.game.setTrackingReliable(true);
  f.attach();
  assert.equal(f.game.snapshot().phase, 'ATTACHED');
  f.dispose();
});

test('Pause and resume freeze an in-progress attachment and preserve elapsed time', async () => {
  const f = await fixture();
  f.driveUntil(() => f.game.snapshot().phase === 'ALIGNING', bending, 1);
  f.game.pause();
  const before = f.game.snapshot(), grip = f.carrot.gripWorld();
  for (let i = 0; i < 60; i++) { f.game.preparePose(.05, 0); f.game.afterPose(.05); }
  assert.equal(f.game.snapshot().attachment.transitionElapsed, before.attachment.transitionElapsed);
  close(f.carrot.gripWorld(), grip);
  f.game.resume(); f.attach();
  assert.equal(f.game.snapshot().phase, 'ATTACHED');
  f.dispose();
});

test('Tracking loss during basket transfer blocks both arc motion and score callback', async () => {
  const f = await fixture(); f.attach(); f.succeed();
  f.driveUntil(() => f.game.snapshot().phase === 'TRANSFERRING', standing, 0);
  f.game.setTrackingReliable(false);
  const before = f.game.snapshot(), grip = f.carrot.gripWorld();
  for (let i = 0; i < 100; i++) f.frame(standing, 0);
  assert.equal(f.game.snapshot().transferElapsed, before.transferElapsed);
  close(f.carrot.gripWorld(), grip);
  assert.equal(f.model.score, 0);
  f.game.setTrackingReliable(true);
  f.driveUntil(() => f.model.score === 1, standing, 0);
  f.dispose();
});

test('Unreachable planting gets a finite safe fallback notification without a false grab', async () => {
  const f = await fixture();
  f.rabbit.pivot.position.x += 3;
  f.driveUntil(() => f.unavailable === 1, bending, 1, 600);
  assert.equal(f.game.snapshot().phase, 'UNAVAILABLE');
  assert.equal(f.game.attachment.state, 'IDLE');
  assert.equal(f.model.score, 0);
  for (let i = 0; i < 60; i++) f.frame(bending, 1);
  assert.equal(f.unavailable, 1);
  f.dispose();
});

test('Extreme combined motion follows the real bend hold and reaches one bounded fallback', async () => {
  const f = await fixture();
  try {
    const source = { ...neutralRabbitPose(), torsoLean: 18, torsoForward: 16,
      lateralOffset: -.45, rightArmElevation: 150 };
    f.driveUntil(() => f.unavailable === 1, bending, 1, 600, source);
    assert.equal(f.model.state, 'GRABBED');
    assert.equal(f.game.snapshot().phase, 'UNAVAILABLE');
    assert.equal(f.game.attachment.state, 'IDLE');
    assert.equal(f.model.score, 0);
    for (let frame = 0; frame < 60; frame++) f.frame(standing, 0, source);
    assert.equal(f.unavailable, 1);
  } finally { f.dispose(); }
});

test('Invalid durations and bend values do not advance coordinator state', async () => {
  const f = await fixture(); f.attach();
  const before = f.game.snapshot();
  for (const value of [NaN, Infinity, -1]) { f.game.preparePose(value, 0); f.game.afterPose(value); }
  f.game.preparePose(.05, NaN);
  assert.equal(f.game.snapshot().pullProgress, before.pullProgress);
  assert.equal(f.callbacks, 0);
  f.dispose();
});

test('Destroy during SUCCESS cancels all harvest work and leaves assets to their scene owner', async () => {
  const f = await fixture(); f.attach(); f.succeed();
  let geometryDisposals = 0;
  f.carrot.model.traverse(object => {
    if ('geometry' in object) (object.geometry as { addEventListener: (name: string, callback: () => void) => void })
      .addEventListener('dispose', () => geometryDisposals++);
  });
  f.game.dispose();
  for (let i = 0; i < 120; i++) { f.game.preparePose(.05, 0); f.game.afterPose(.05); }
  assert.equal(f.callbacks, 0);
  assert.equal(geometryDisposals, 0);
  assert.equal(f.game.snapshot().disposed, true);
  f.dispose();
});

test('Primary attachment follows only its selected actual hand while default midpoint behavior remains available', async () => {
  const f = await fixture(); f.attach();
  const source = { ...neutralRabbitPose(), rightArmElevation: 150, rightArmPlane: 0 };
  for (let i = 0; i < 90; i++) f.frame(bending, 1, source);
  const hands = f.tracker.sample();
  close(f.carrot.gripWorld(), hands.leftGripPosition);
  assert.ok(hands.rightGripPosition.distanceTo(f.carrot.gripWorld()) > .3);
  const defaultAttachment = new CarrotAttachmentController(f.carrot, f.tracker);
  assert.equal(defaultAttachment.snapshot().handMode, 'midpoint');
  assert.equal(defaultAttachment.grab().ok, false);
  defaultAttachment.dispose();
  f.dispose();
});

test('Invalid primary grip configuration leaves the existing carrot transform intact', async () => {
  const f = await fixture();
  try {
    const before = f.carrot.gripWorld();
    assert.throws(() => new CarrotAttachmentController(f.carrot, f.tracker, {
      initialGripPosition: new Vector3(5, 6, 7), handMode: 'left', maximumHandDistance: NaN,
    }), /grip distance/);
    close(f.carrot.gripWorld(), before);
  } finally { f.dispose(); }
});

test('Alignment is interpolated and quantified below the maximum allowed visual step', async () => {
  const f = await fixture(); f.attach();
  assert.ok(f.game.snapshot().maximumAttachStep < .04);
  assert.ok(f.game.snapshot().maximumAttachStep >= 0);
  assert.ok(f.game.snapshot().attachmentError < .01);
  f.dispose();
});

test('Basket target validation and source-object copies prevent invalid or drifting transfers', async () => {
  const f = await fixture();
  assert.throws(() => new CarrotPull3DCoordinator(f.rabbit, f.carrot, f.tracker,
    { basketTarget: new Vector3(NaN, 0, 0), onHarvestComplete: () => {} }), /basket/);
  f.dispose();
});

test('Changing the caller basket vector cannot redirect an in-progress harvest', async () => {
  const target = new Vector3(3.8, .5, .7);
  const f = await fixture(false, target);
  try {
    f.attach(); f.succeed();
    target.set(-5, 8, -2);
    f.driveUntil(() => f.callbacks === 1, standing, 0);
    close(f.carrot.gripWorld(), new Vector3(3.8, .5, .7));
  } finally { f.dispose(); }
});
