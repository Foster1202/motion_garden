import assert from 'node:assert/strict';
import test from 'node:test';
import { calibrationThresholds, interquartileRange, isStable, median, validateCalibration } from '../src/game/calibration/calibrationMath';
import type { CalibrationProfile } from '../src/game/calibration/calibrationTypes';

function profile(standing = 155, bending = 135): CalibrationProfile {
  return { standingAngle: standing, bendingAngle: bending, ...calibrationThresholds(standing, bending), timestamp: 1000 };
}

test('median and IQR resist isolated outliers without mutating samples', () => {
  const values = [155, 154, 156, 155, 155, 155, 180];
  assert.equal(median(values), 155);
  assert.equal(interquartileRange(values), 0.5);
  assert.deepEqual(values, [155, 154, 156, 155, 155, 155, 180]);
  assert.equal(median([3, 1, 2, 4]), 2.5);
  assert.ok(Number.isNaN(median([])));
  assert.ok(Number.isNaN(median([155, NaN])));
});

test('robust stability tolerates mild sway and rejects sustained jitter', () => {
  assert.equal(isStable([154, 155, 156, 154, 156, 155, 155]), true);
  assert.equal(isStable([140, 170, 140, 170, 140, 170]), false);
  assert.equal(isStable([]), false);
});

test('personal interpolation preserves a transition zone for A B C and small comfortable ranges', () => {
  for (const [standing, bending] of [[176, 145], [165, 140], [155, 135], [155, 145], [155, 143], [155, 140]]) {
    const value = profile(standing, bending);
    assert.equal(validateCalibration(value), true);
    assert.equal(value.standingThreshold, standing - (standing - bending) * 0.2);
    assert.equal(value.bendingThreshold, standing - (standing - bending) * 0.65);
    assert.ok(value.standingThreshold > value.bendingThreshold);
    assert.ok(value.standingThreshold < standing);
    assert.ok(value.bendingThreshold > bending);
  }
});

test('validation rejects impossible inputs, tiny or excessive ranges and inconsistent thresholds', () => {
  const valid = profile();
  for (const change of [
    { standingAngle: NaN }, { bendingAngle: Infinity }, { timestamp: -1 }, { range: 19 },
    { standingThreshold: 181 }, { bendingThreshold: 89 }, { bendingThreshold: 152 },
    { standingThreshold: 150 }, { standingIqr: 7 }, { bendingIqr: -1 },
  ]) assert.equal(validateCalibration({ ...valid, ...change }), false);
  assert.equal(validateCalibration(profile(155, 146)), false);
  assert.equal(validateCalibration(profile(180, 110)), false);
  assert.equal(validateCalibration(profile(155, 85)), false);
});

test('asymmetric side statistics are accepted and malformed side statistics are rejected', () => {
  const asymmetric = { ...profile(165, 140), leftStanding: 180, leftBending: 170, leftRange: 10,
    rightStanding: 150, rightBending: 110, rightRange: 40, reliableSide: 'both' as const };
  assert.equal(validateCalibration(asymmetric), true);
  assert.equal(validateCalibration({ ...asymmetric, leftRange: 11 }), false);
  assert.equal(validateCalibration({ ...asymmetric, leftBending: 181 }), false);
  assert.equal(validateCalibration({ ...asymmetric, rightStanding: 130, rightRange: 20 }), false);
  assert.equal(validateCalibration({ ...profile(), reliableSide: 'left' }), false);
});

test('floating-point tolerance accepts the numerical ten-degree boundary without accepting smaller motion', () => {
  assert.equal(validateCalibration(profile(155, 145.0005)), true);
  assert.equal(validateCalibration(profile(155, 145.1)), false);
  assert.equal(validateCalibration(profile(155, 146)), false);
  assert.equal(validateCalibration(profile(180.0005, 145)), true);
  assert.equal(validateCalibration(profile(180.1, 145)), false);
});

test('a stationary leg may have small baseline noise without becoming a symmetry gate', () => {
  const stationary = { ...profile(165, 155), leftStanding: 165, leftBending: 165.1, leftRange: -0.1,
    rightStanding: 165, rightBending: 144.9, rightRange: 20.1, reliableSide: 'both' as const };
  assert.equal(validateCalibration(stationary), true);
  assert.equal(validateCalibration({ ...stationary, leftBending: 166.1, leftRange: -1.1 }), false);
});
