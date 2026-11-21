import assert from 'node:assert/strict';
import test from 'node:test';
import { HumanPoseExtractor } from '../src/game/mocap/HumanPoseExtractor';
import { MotionRetargeter } from '../src/game/mocap/MotionRetargeter';
import type { PoseFrame, PoseLandmark } from '../src/game/vision/poseTypes';

const fixture = (shift = 0, leftUp = false, rightUp = false) => {
  const landmarks: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 0 }));
  const place = (index: number, x: number, y: number) => {
    landmarks[index] = { x: x + shift, y, z: 0, visibility: .98, presence: .97 };
  };
  place(11, .575, .28);
  place(12, .425, .28);
  place(23, .55, .52);
  place(24, .45, .52);
  place(15, .605, leftUp ? .26 : .53);
  place(16, .395, rightUp ? .26 : .53);
  return { landmarks, imageWidth: 640, imageHeight: 360,
    timestampMs: 1460, inferenceMs: 6, poseFps: 25 } satisfies PoseFrame;
};

test('wrist and shoulder height drives each anatomical arm without visible elbows or legs', () => {
  const extractor = new HumanPoseExtractor();
  const reference = extractor.extractArmReach(fixture());
  const left = extractor.extractArmReach(fixture(.16, true));
  const right = extractor.extractArmReach(fixture(-.16, false, true));
  assert.ok(reference && left && right);
  const retargeter = new MotionRetargeter();
  assert.equal(left.leftRaise, 1);
  assert.equal(left.rightRaise, 0);
  assert.equal(right.leftRaise, 0);
  assert.equal(right.rightRaise, 1);
  const leftResult = retargeter.retargetArmReach(left, reference);
  const rightResult = retargeter.retargetArmReach(right, reference);
  assert.ok(leftResult.x < -.8 && rightResult.x > .8, 'raw camera x is mirrored once');
  assert.equal(leftResult.pose.leftArmElevation, 90);
  assert.equal(leftResult.pose.rightArmElevation, 0);
  assert.equal(rightResult.pose.leftArmElevation, 0);
  assert.equal(rightResult.pose.rightArmElevation, 90);
  assert.equal(rightResult.pose.rightElbowBend, 0);
});

test('wrist visibility is independent from lateral tracking and the other wrist', () => {
  const extractor = new HumanPoseExtractor();
  const frame = fixture(-.05, true, true);
  frame.landmarks[15].presence = .1;
  const visible = extractor.extractArmReach(frame);
  assert.ok(visible);
  assert.equal(visible.leftRaise, null);
  assert.equal(visible.rightRaise, 1);
  assert.ok(Math.abs(visible.centerX - .45) < 1e-10);
  frame.landmarks[23].visibility = 0;
  assert.equal(extractor.extractArmReach(frame), undefined);
});
