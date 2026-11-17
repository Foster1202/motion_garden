import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { MathUtils, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Rabbit3D } from '../src/game/3d/Rabbit3D';
import type { RabbitBoneName } from '../src/game/3d/rabbit3dConfig';
import { MocapController } from '../src/game/mocap/MocapController';
import { HumanPoseExtractor } from '../src/game/mocap/HumanPoseExtractor';
import type { CalibrationProfile } from '../src/game/calibration/calibrationTypes';
import type { PoseFrame, PoseLandmark, PoseSnapshot } from '../src/game/vision/poseTypes';

const profile: CalibrationProfile = {
  standingAngle: 170, bendingAngle: 150, range: 20, standingThreshold: 166,
  bendingThreshold: 157, timestamp: 1, reliableSide: 'both',
};
interface Motion {
  left?: number;
  right?: number;
  lean?: number;
  shift?: number;
  knee?: number;
  depth?: number;
  leftDepth?: number;
  rightDepth?: number;
  leftElbow?: number;
  rightElbow?: number;
  jitter?: number;
  hiddenArm?: boolean;
  hiddenTorso?: boolean;
  lost?: boolean;
}
function signal(timestampMs: number, motion: Motion = {}) {
  const width = 640, height = 360;
  const center = width * (.5 + (motion.shift ?? 0));
  const shoulderY = height * .28, hipY = height * .52;
  const lean = Math.tan((motion.lean ?? 0) * Math.PI / 180) * (hipY - shoulderY);
  const point = (x: number, y: number, z = 0): PoseLandmark => ({ x: x / width, y: y / height, z,
    visibility: .99, presence: .99 });
  const points = Array.from({ length: 33 }, () => point(center, height * .5));
  for (const index of [0, 7, 8]) points[index].visibility = .1;
  for (const [shoulder, elbow, wrist, hip, knee, ankle, sign, degrees] of [
    [11, 13, 15, 23, 25, 27, 1, motion.left ?? 8],
    [12, 14, 16, 24, 26, 28, -1, motion.right ?? 8],
  ]) {
    const x = center + sign * height * .12;
    const radians = degrees * Math.PI / 180;
    const kneeRadians = (180 - (motion.knee ?? 170)) * Math.PI / 180;
    const jitter = motion.jitter ?? 0;
    const armDepth = (shoulder === 11 ? motion.leftDepth : motion.rightDepth) ?? motion.depth ?? -.075;
    const lowerRadians = radians + ((shoulder === 11 ? motion.leftElbow : motion.rightElbow) ?? 0) * Math.PI / 180;
    points[shoulder] = point(x + lean, shoulderY);
    points[elbow] = point(x + lean + sign * Math.sin(radians) * height * .13 + jitter,
      shoulderY + Math.cos(radians) * height * .13, armDepth);
    points[wrist] = point(x + lean + sign * (Math.sin(radians) * height * .13 + Math.sin(lowerRadians) * height * .12) + jitter,
      shoulderY + Math.cos(radians) * height * .13 + Math.cos(lowerRadians) * height * .12, armDepth * 2);
    points[hip] = point(x, hipY);
    points[knee] = point(x, height * .69);
    points[ankle] = point(x + Math.sin(kneeRadians) * height * .17,
      height * .69 + Math.cos(kneeRadians) * height * .17);
  }
  if (motion.hiddenArm) points[15].visibility = .2;
  if (motion.hiddenTorso) points[11].visibility = .2;
  const frame: PoseFrame = { landmarks: motion.lost ? undefined : points, timestampMs,
    inferenceMs: 8, poseFps: 25, imageWidth: width, imageHeight: height };
  const pose: PoseSnapshot = { state: motion.lost ? 'TRACKING_LOST' : 'STANDING', timestampMs,
    leftKneeAngle: motion.knee ?? 170, rightKneeAngle: motion.knee ?? 170, activeKneeAngle: motion.knee ?? 170,
    confidence: .99, reliableSides: 2, candidateMs: 200, inferenceMs: 8, poseFps: 25,
    trackingLostMs: 0, autoRestRecommended: false };
  return { frame, pose };
}
async function fixture(mirror = false) {
  const bytes = readFileSync(new URL('../model/dist/rabbit3d/rabbit_realtime_v3.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const rabbit = new Rabbit3D(gltf.scene);
  rabbit.rig.setIKEnabled(true);
  rabbit.rig.setArmInwardEnabled(true);
  let now = 0;
  const controller = new MocapController(rabbit.rig, () => now, true, mirror);
  controller.enable();
  const feed = (motion: Motion = {}, count = 1) => {
    for (let index = 0; index < count; index++) {
      now += 40;
      const input = signal(now, motion);
      controller.acceptFrame(input.frame, input.pose, profile);
      controller.update(.04, now);
      rabbit.rig.update(.04);
      rabbit.model.updateMatrixWorld(true);
    }
    return controller.snapshot();
  };
  const rotation = (name: RabbitBoneName) => rabbit.rig.bones.get(name)!.quaternion.clone();
  const position = (name: RabbitBoneName) => rabbit.rig.bones.get(name)!.getWorldPosition(new Vector3());
  const close = () => { controller.dispose(); rabbit.dispose(); };
  return { controller, rabbit, feed, rotation, position, close };
}

test('monocular depth can reject visibly relaxed arms under the old gate, while projected reference evidence acquires robustly', async context => {
  const f = await fixture();
  try {
    const input = signal(40);
    const human = new HumanPoseExtractor(true).extract(input.frame, input.pose, profile)!;
    assert.ok(human.leftArmElevation! > 40, String(human.leftArmElevation));
    assert.ok(human.rightArmElevation! > 40, String(human.rightArmElevation));
    assert.ok(human.leftArmProjectedElevation! < 10);
    assert.ok(human.rightArmProjectedElevation! < 10);
    assert.equal(human.leftArmElevation! <= 25 && human.rightArmElevation! <= 25, false);
    context.diagnostic(JSON.stringify({ input: 'Synthetic 640x360 relaxed-arm depth bias',
      rawLeftArm: human.leftArmElevation, rawRightArm: human.rightArmElevation,
      projectedLeftArm: human.leftArmProjectedElevation, projectedRightArm: human.rightArmProjectedElevation,
      oldReferenceArmLimit: 25 }));
    for (let index = 0; index < 50; index++) {
      f.feed({ depth: -.075 + Math.sin(index * .7) * .005,
        jitter: Math.sin(index) * .5, hiddenArm: index % 9 === 4, hiddenTorso: index === 10 });
    }
    const snapshot = f.controller.snapshot();
    assert.equal(snapshot.referenceReady, true, JSON.stringify(snapshot));
    assert.equal(snapshot.trackingState, 'tracking');
    assert.ok(snapshot.framesReceived === 50 && snapshot.humanPosesExtracted > 40 && snapshot.mappedPoses > 10);
  } finally { f.close(); }
});

test('sustained raised arms and bent knees keep reference unready, and reliable relaxed standing recovers without recalibration', async () => {
  const f = await fixture();
  try {
    let snapshot = f.feed({ left: 70, right: 70 }, 35);
    assert.equal(snapshot.referenceReady, false);
    assert.equal(snapshot.mappedPoses, 0);
    assert.ok(snapshot.lastRejection, 'A sustained reference rejection must identify its condition');
    f.feed({ left: 45, right: 45 }, 2);
    f.feed({ left: 20, right: 20 }, 2);
    snapshot = f.feed({ knee: 150 }, 30);
    assert.equal(snapshot.referenceReady, false);
    snapshot = f.feed({}, 35);
    assert.equal(snapshot.referenceReady, true, JSON.stringify(snapshot));
    assert.equal(snapshot.trackingState, 'tracking');
    assert.ok(snapshot.mappedPoses > 0);
  } finally { f.close(); }
});

test('noisy relaxed reference drives actual V3 IK final left/right/both arm, torso, knee and root transforms and recovers after loss', async () => {
  const f = await fixture();
  try {
    f.feed({}, 30);
    assert.equal(f.controller.snapshot().referenceReady, true);
    const left = f.rotation('upper_arm.L'), right = f.rotation('upper_arm.R');
    const neutralHand = f.position('hand.L');
    let snapshot = f.feed({ left: 80 }, 30);
    assert.equal(snapshot.trackingState, 'tracking');
    assert.ok(snapshot.mapped!.leftArmElevation > 20);
    assert.ok(MathUtils.radToDeg(left.angleTo(f.rotation('upper_arm.L'))) > 15);
    assert.ok(MathUtils.radToDeg(right.angleTo(f.rotation('upper_arm.R'))) < 1);
    assert.ok(f.position('hand.L').distanceTo(neutralHand) > .1);
    f.feed({}, 30);
    const rightRest = f.rotation('upper_arm.R');
    snapshot = f.feed({ right: 80 }, 30);
    assert.ok(snapshot.mapped!.rightArmElevation > 20);
    assert.ok(MathUtils.radToDeg(rightRest.angleTo(f.rotation('upper_arm.R'))) > 15);
    snapshot = f.feed({ left: 80, right: 80 }, 30);
    assert.ok(snapshot.mapped!.leftArmElevation > 20 && snapshot.mapped!.rightArmElevation > 20);
    assert.ok(MathUtils.radToDeg(left.angleTo(f.rotation('upper_arm.L'))) > 15);
    f.feed({}, 30);
    const body = f.rotation('body');
    snapshot = f.feed({ lean: 8 }, 25);
    assert.ok(Math.abs(snapshot.mapped!.torsoLean) > 5);
    assert.ok(MathUtils.radToDeg(body.angleTo(f.rotation('body'))) > 3);
    snapshot = f.feed({ lean: -8 }, 25);
    assert.ok(snapshot.mapped!.torsoLean < -5);
    f.feed({}, 25);
    const shin = f.rotation('shin.L');
    snapshot = f.feed({ knee: 155 }, 25);
    assert.ok(snapshot.mapped!.bendAmount > .6);
    assert.ok(MathUtils.radToDeg(shin.angleTo(f.rotation('shin.L'))) > 2);
    f.feed({}, 25);
    const root = f.position('root');
    snapshot = f.feed({ shift: .02 }, 25);
    assert.ok(snapshot.mapped!.lateralOffset < -.01);
    assert.ok(f.position('root').distanceTo(root) > .01);
    const reference = snapshot.referenceReady;
    f.feed({ lost: true }, 25);
    assert.equal(f.controller.snapshot().referenceReady, reference);
    snapshot = f.feed({}, 30);
    assert.equal(snapshot.trackingState, 'tracking');
    assert.equal(snapshot.referenceReady, true);
    const stable = f.rotation('upper_arm.L');
    f.feed({}, 30);
    assert.ok(MathUtils.radToDeg(stable.angleTo(f.rotation('upper_arm.L'))) < 1);
    assert.ok([...f.rabbit.rig.bones.values()].every(bone => [...bone.quaternion.toArray(), ...bone.position.toArray()].every(Number.isFinite)));
  } finally { f.close(); }
});

test('diagnostics separate extraction failure and ignored frames, and frozen-game updates perform no pose writes', async () => {
  const f = await fixture();
  try {
    let snapshot = f.feed({}, 30);
    const before = f.rotation('upper_arm.L');
    const writes = snapshot.poseWrites;
    const smoothed = snapshot.smoothed;
    f.controller.update(.04, snapshot.raw!.timestampMs, false);
    snapshot = f.controller.snapshot();
    assert.equal(snapshot.poseWrites, writes);
    assert.deepEqual(snapshot.smoothed, smoothed);
    assert.ok(before.angleTo(f.rotation('upper_arm.L')) < 1e-8);
    snapshot = f.feed({ hiddenTorso: true });
    assert.equal(snapshot.diagnosticStage, 'B-human-pose-rejected');
    assert.ok(snapshot.extractionRejection);
    assert.equal(snapshot.lastRejection, 'unreliable-pose');
    assert.ok(snapshot.lastFrameAgeMs !== undefined && snapshot.lastFrameAgeMs < 1);
    f.controller.stop();
    const frames = snapshot.framesReceived;
    snapshot = f.feed({});
    assert.equal(snapshot.framesReceived, frames + 1);
    assert.equal(snapshot.ignoredFrames, 1);
    assert.equal(snapshot.diagnosticStage, 'controller-inactive');
  } finally { f.close(); }
});

test('alternating extraction failures never earn reference time, then continuous reliable frames recover and drive final bones', async () => {
  const f = await fixture();
  try {
    for (let index = 0; index < 40; index++) {
      const snapshot = f.feed({ hiddenTorso: index % 2 === 1 });
      assert.equal(snapshot.referenceReady, false, `Unexpected reference at alternating frame ${index}`);
      assert.equal(snapshot.referenceProgress, 0, `Rejected extraction interval credited at frame ${index}`);
      assert.equal(snapshot.mappedPoses, 0);
    }
    let snapshot = f.feed({}, 35);
    assert.equal(snapshot.referenceReady, true, JSON.stringify(snapshot));
    assert.equal(snapshot.trackingState, 'tracking');
    const before = f.rotation('upper_arm.L');
    snapshot = f.feed({ left: 80 }, 30);
    assert.ok(snapshot.mapped!.leftArmElevation > 20);
    assert.ok(MathUtils.radToDeg(before.angleTo(f.rotation('upper_arm.L'))) > 15);
  } finally { f.close(); }
});


test('render-loop readiness and pose reads avoid complete diagnostic snapshots', async () => {
  const f = await fixture();
  try {
    f.feed({}, 30);
    const retargeter = Reflect.get(f.controller, 'retargeter');
    Object.defineProperty(retargeter, 'snapshot', { get() { assert.fail('Readiness must use fast status getters'); } });
    for (let index = 0; index < 120; index++) {
      assert.equal(f.controller.gameplayReady, true);
      assert.ok(Number.isFinite(f.controller.pose.leftArmElevation));
    }
    f.controller.pause();
    assert.equal(f.controller.gameplayReady, false);
    f.controller.resume();
    assert.equal(f.controller.gameplayReady, false);
  } finally { f.close(); }
});


test('game camera mirroring swaps complete arm tuples and drives the opposite final bone while preserving occlusion hold', async () => {
  const canonical = await fixture();
  const mirrored = await fixture(true);
  try {
    canonical.feed({}, 30);
    mirrored.feed({}, 30);
    const leftRest = mirrored.rotation('upper_arm.L');
    const rightRest = mirrored.rotation('upper_arm.R');
    let mirror = mirrored.feed({ left: 80 }, 30);
    assert.ok(mirror.mapped!.rightArmElevation > 50);
    assert.ok(mirror.mapped!.leftArmElevation < 1);
    assert.ok(MathUtils.radToDeg(rightRest.angleTo(mirrored.rotation('upper_arm.R'))) > 40);
    assert.ok(MathUtils.radToDeg(leftRest.angleTo(mirrored.rotation('upper_arm.L'))) < 1);
    mirrored.feed({}, 30);
    const motion = { left: 70, right: 40, leftDepth: -.03, rightDepth: -.065, leftElbow: 25, rightElbow: 65 };
    const source = canonical.feed(motion, 30).mapped!;
    mirror = mirrored.feed(motion, 30);
    for (const channel of ['ArmElevation', 'ArmPlane', 'ElbowBend'] as const) {
      assert.ok(Math.abs(mirror.mapped![`left${channel}`] - source[`right${channel}`]) < 1e-8, channel);
      assert.ok(Math.abs(mirror.mapped![`right${channel}`] - source[`left${channel}`]) < 1e-8, channel);
    }
    const held = { ...mirror.mapped! };
    mirror = mirrored.feed({ ...motion, hiddenArm: true }, 5);
    for (const channel of ['ArmElevation', 'ArmPlane', 'ElbowBend'] as const) {
      assert.equal(mirror.mapped![`right${channel}`], held[`right${channel}`]);
      assert.equal(mirror.mapped![`left${channel}`], held[`left${channel}`]);
    }
    mirror = mirrored.feed({ ...motion, hiddenArm: true }, 20);
    assert.equal(mirror.mapped!.rightArmElevation, 0);
    assert.equal(mirror.mapped!.rightArmPlane, 0);
    assert.equal(mirror.mapped!.rightElbowBend, 0);
    assert.ok(mirror.mapped!.leftArmElevation > 20);
  } finally { canonical.close(); mirrored.close(); }
});


test('movement frames mark comfortable bending as non-standing while actual IK bones continue responding', async () => {
  const f = await fixture(true);
  try {
    f.feed({}, 30);
    assert.equal(f.controller.movementFrame?.standing, true);
    const shin = f.rotation('shin.L');
    f.feed({ knee: 165 }, 1);
    assert.equal(f.controller.movementFrame?.standing, false);
    f.feed({ knee: 150 }, 25);
    assert.equal(f.controller.movementFrame?.standing, false);
    assert.ok(MathUtils.radToDeg(shin.angleTo(f.rotation('shin.L'))) > 2);
    assert.equal(f.controller.snapshot().trackingState, 'tracking');
    f.feed({}, 30);
    assert.equal(f.controller.movementFrame?.standing, true);
    f.feed({ lost: true });
    assert.equal(f.controller.movementFrame, undefined);
  } finally { f.close(); }
});
