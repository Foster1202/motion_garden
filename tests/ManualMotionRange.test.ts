import test from 'node:test';
import assert from 'node:assert/strict';
import { manualMotionRange, validateMotionRange } from '../src/game/settings/motionRange';
import { PoseClassifier } from '../src/game/vision/PoseClassifier';
import { MotionRetargeter } from '../src/game/mocap/MotionRetargeter';

test('manual defaults enter classifier and existing mocap without sampling or calibration interpolation', () => {
  const range = manualMotionRange();
  assert.equal(range.standingThreshold, 160);
  assert.equal(range.bendingThreshold, 150);
  assert.equal(validateMotionRange(range), true);
  const classifier = new PoseClassifier();
  assert.doesNotThrow(() => classifier.setMotionRange(range));
  assert.deepEqual(classifier.getCalibration(), range);
  const retargeter = new MotionRetargeter();
  const human = { torsoLean: 0, activeKneeAngle: 170, centerX: .5, bodyScale: .2,
    trackingConfidence: 1, timestampMs: 0, leftArmConfidence: 1, rightArmConfidence: 1,
    leftArmElevation: 0, rightArmElevation: 0, leftElbowBend: 0, rightElbowBend: 0 };
  for (let timestampMs = 0; timestampMs <= 800; timestampMs += 40) retargeter.update({ ...human, timestampMs }, range);
  assert.equal(retargeter.snapshot.referenceReady, true);
  assert.equal(retargeter.update({ ...human, activeKneeAngle: 150, timestampMs: 840 }, range)?.bendAmount, 1);
  assert.equal(validateMotionRange({ ...range, range: NaN }), false);
  assert.equal(validateMotionRange({ ...range, standingThreshold: 140 }), false);
});
