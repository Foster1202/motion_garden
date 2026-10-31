import assert from 'node:assert/strict';
import test from 'node:test';
import { CalibrationController } from '../src/game/calibration/CalibrationController';
import { CALIBRATION_CONFIG as CONFIG } from '../src/game/calibration/calibrationConfig';
import { validateCalibration } from '../src/game/calibration/calibrationMath';
import type { PoseSnapshot } from '../src/game/vision/poseTypes';

function pose(time: number, left = 155, right: number | undefined = left): PoseSnapshot {
  return { state: 'TRANSITION', leftKneeAngle: left, rightKneeAngle: right,
    activeKneeAngle: right === undefined ? left : (left + right) / 2, reliableSides: right === undefined ? 1 : 2,
    confidence: 0.9, candidateMs: 0, timestampMs: time, inferenceMs: 10, poseFps: 25,
    trackingLostMs: 0, autoRestRecommended: false };
}
function sample(controller: CalibrationController, start: number, end: number, left: number,
  right: number | undefined = left, step = 40): void {
  for (let time = start; time <= end; time += step) controller.update(pose(time, left, right), time);
}
function standing(left = 155, right: number | undefined = left): CalibrationController {
  const controller = new CalibrationController();
  controller.begin(0);
  sample(controller, 0, 2400, left, right);
  assert.equal(controller.getSnapshot().state, 'BEND_INSTRUCTIONS');
  return controller;
}

test('A B C profiles calibrate independently of old absolute standing thresholds', () => {
  for (const [stand, bend] of [[176, 145], [165, 140], [155, 135]]) {
    const controller = standing(stand);
    assert.equal(controller.getSnapshot().bendStarted, false);
    sample(controller, 2440, 2600, bend);
    assert.equal(controller.getSnapshot().state, 'BEND_INSTRUCTIONS');
    assert.equal(controller.getSnapshot().sampleCount, 0);
    controller.startBending(2640);
    controller.startBending(2680);
    sample(controller, 2640, 5040, bend);
    const result = controller.getSnapshot();
    assert.equal(result.state, 'COMPLETE');
    assert.equal(result.progress, 1);
    assert.equal(result.profile!.standingAngle, stand);
    assert.equal(result.profile!.bendingAngle, bend);
    assert.equal(validateCalibration(result.profile!), true);
    result.profile!.standingAngle = 90;
    assert.equal(controller.getSnapshot().profile!.standingAngle, stand);
  }
});

test('standing waits for stable readiness, two seconds and sufficient unique frames', () => {
  const controller = new CalibrationController();
  controller.begin(0);
  sample(controller, 0, 300, 155, 155, 100);
  assert.equal(controller.getSnapshot().state, 'STANDING_INSTRUCTIONS');
  sample(controller, 400, 2400, 155, 155, 100);
  assert.equal(controller.getSnapshot().state, 'STANDING_SAMPLING');
  assert.equal(controller.getSnapshot().sampleCount, 21);
  sample(controller, 2500, 3300, 155, 155, 100);
  assert.equal(controller.getSnapshot().state, 'BEND_INSTRUCTIONS');
});

test('uneven frame times still satisfy readiness instead of waiting for an exact 400ms frame', () => {
  const controller = new CalibrationController();
  controller.begin(0);
  sample(controller, 0, 2508, 155, 155, 57);
  assert.equal(controller.getSnapshot().state, 'BEND_INSTRUCTIONS');
});

test('median baselines tolerate minor noise and isolated sampling outliers', () => {
  const controller = new CalibrationController();
  controller.begin(0);
  for (let time = 0; time <= 2400; time += 40) {
    const angle = time === 1200 ? 175 : 155 + ([0, 1, -1][(time / 40) % 3]);
    controller.update(pose(time, angle), time);
  }
  assert.equal(controller.getSnapshot().state, 'BEND_INSTRUCTIONS');
  controller.startBending(2440);
  for (let time = 2440; time <= 4840; time += 40) {
    const angle = time === 3600 ? 143 : 135 + ([0, 1, -1][(time / 40) % 3]);
    controller.update(pose(time, angle), time);
  }
  const result = controller.getSnapshot();
  assert.equal(result.state, 'COMPLETE');
  assert.equal(result.profile!.standingAngle, 155);
  assert.equal(result.profile!.bendingAngle, 135);
  assert.ok(result.profile!.standingIqr! <= 2);
});

test('sustained sampling jitter restarts the window with a gentle stability prompt', () => {
  const controller = new CalibrationController();
  controller.begin(0);
  sample(controller, 0, 400, 165);
  for (let time = 440; time <= 2400; time += 40) controller.update(pose(time, (time / 40) % 2 ? 158 : 172), time);
  const result = controller.getSnapshot();
  assert.equal(result.state, 'STANDING_INSTRUCTIONS');
  assert.equal(result.sampleCount, 0);
  assert.match(result.message, /企穩/);
});

test('invalid, low confidence, lost, stale and repeated frames never count toward sampling', () => {
  for (const invalid of [
    (value: PoseSnapshot) => ({ ...value, confidence: 0.4 }),
    (value: PoseSnapshot) => ({ ...value, state: 'TRACKING_LOST' as const }),
    (value: PoseSnapshot) => ({ ...value, leftKneeAngle: NaN, rightKneeAngle: NaN }),
    (value: PoseSnapshot) => ({ ...value, activeKneeAngle: undefined }),
    (value: PoseSnapshot) => ({ ...value, timestampMs: 0 }),
  ]) {
    const controller = new CalibrationController();
    controller.begin(0);
    sample(controller, 0, 800, 155);
    assert.ok(controller.getSnapshot().sampleCount > 0);
    controller.update(invalid(pose(840)), 840);
    assert.equal(controller.getSnapshot().sampleCount, 0);
    assert.equal(controller.getSnapshot().state, 'STANDING_INSTRUCTIONS');
  }
  const controller = new CalibrationController();
  controller.begin(0);
  sample(controller, 0, 800, 155);
  controller.update(pose(800), 840);
  assert.equal(controller.getSnapshot().sampleCount, 0);
});

test('tracking loss and missing frames clear incomplete sampling and permit reacquisition', () => {
  const controller = new CalibrationController();
  controller.begin(0);
  sample(controller, 0, 800, 155);
  controller.tick(1100);
  assert.equal(controller.getSnapshot().sampleCount, 0);
  assert.match(controller.getSnapshot().message, /全身/);
  sample(controller, 1120, 3520, 155);
  assert.equal(controller.getSnapshot().state, 'BEND_INSTRUCTIONS');
});

test('returning to standing during bend cancels only the bend window', () => {
  const controller = standing();
  controller.startBending(2440);
  sample(controller, 2440, 3240, 135);
  assert.equal(controller.getSnapshot().state, 'BEND_SAMPLING');
  controller.update(pose(3280, 155), 3280);
  assert.equal(controller.getSnapshot().state, 'BEND_INSTRUCTIONS');
  assert.equal(controller.getSnapshot().sampleCount, 0);
  assert.equal(controller.getSnapshot().bendStarted, true);
  sample(controller, 3320, 5720, 135);
  assert.equal(controller.getSnapshot().state, 'COMPLETE');
});

test('stable comfortable 10 and 12 degree ranges are accepted without demanding 145 degrees', () => {
  for (const bend of [145, 143]) {
    const controller = standing();
    controller.startBending(2440);
    sample(controller, 2440, 4840, bend);
    assert.equal(controller.getSnapshot().state, 'COMPLETE');
    assert.equal(controller.getSnapshot().profile!.range, 155 - bend);
  }
});

test('numerical ten-degree range passes with unchanged thresholds while a materially smaller range fails', () => {
  for (const [bend, expectedState] of [[145.0005, 'COMPLETE'], [145.1, 'FAILED'], [146, 'FAILED']] as const) {
    const controller = standing();
    controller.startBending(2440);
    sample(controller, 2440, 4840, bend);
    assert.equal(controller.getSnapshot().state, expectedState);
    if (expectedState === 'COMPLETE') {
      const profile = controller.getSnapshot().profile!;
      assert.equal(profile.range, 155 - bend);
      assert.equal(profile.standingThreshold, 155 - profile.range * 0.2);
      assert.equal(profile.bendingThreshold, 155 - profile.range * 0.65);
    }
  }
});

test('small median noise in a stationary leg still permits a stable fused personal range', () => {
  const controller = standing(165, 165);
  controller.startBending(2440);
  sample(controller, 2440, 4840, 165.1, 144.9);
  const result = controller.getSnapshot();
  assert.equal(result.state, 'COMPLETE');
  assert.equal(result.profile!.range, 10);
  assert.ok(Math.abs(result.profile!.leftRange! + 0.1) < 1e-9);
  assert.ok(Math.abs(result.profile!.rightRange! - 20.1) < 1e-9);
});

test('insufficient bend range retries step two while retaining standing baseline', () => {
  const controller = standing();
  controller.startBending(2440);
  sample(controller, 2440, 4840, 146);
  assert.equal(controller.getSnapshot().state, 'FAILED');
  assert.equal(controller.getSnapshot().failureReason, 'range-too-small');
  assert.match(controller.getSnapshot().message, /舒服/);
  controller.retry(4880);
  assert.equal(controller.getSnapshot().state, 'BEND_INSTRUCTIONS');
  assert.equal(controller.getSnapshot().bendStarted, false);
  controller.startBending(4920);
  sample(controller, 4920, 7320, 143);
  assert.equal(controller.getSnapshot().profile!.standingAngle, 155);
  assert.equal(controller.getSnapshot().profile!.range, 12);
});

test('D asymmetric legs retain separate medians and ranges without a symmetry gate', () => {
  const controller = standing(180, 150);
  controller.startBending(2440);
  sample(controller, 2440, 4840, 170, 110);
  const result = controller.getSnapshot();
  assert.equal(result.state, 'COMPLETE');
  assert.equal(result.profile!.standingAngle, 165);
  assert.equal(result.profile!.bendingAngle, 140);
  assert.equal(result.profile!.leftRange, 10);
  assert.equal(result.profile!.rightRange, 40);
  assert.equal(result.profile!.reliableSide, 'both');
});

test('single-leg calibration uses a coherent side even if another leg reappears', () => {
  const controller = new CalibrationController();
  controller.begin(0);
  for (let time = 0; time <= 2400; time += 40) {
    const value = pose(time, 160);
    value.rightKneeAngle = undefined; value.activeKneeAngle = 160; value.reliableSides = 1;
    controller.update(value, time);
  }
  controller.startBending(2440);
  sample(controller, 2440, 4840, 148, 175);
  const result = controller.getSnapshot();
  assert.equal(result.state, 'COMPLETE');
  assert.equal(result.profile!.standingAngle, 160);
  assert.equal(result.profile!.bendingAngle, 148);
  assert.equal(result.profile!.reliableSide, 'left');
  assert.equal(result.profile!.rightStanding, undefined);
});

test('a both-leg cohort never changes fusion during bend if one side disappears', () => {
  const controller = standing(180, 150);
  controller.startBending(2440);
  sample(controller, 2440, 3240, 170, 110);
  const missing = pose(3280, 170);
  missing.rightKneeAngle = undefined; missing.activeKneeAngle = 170; missing.reliableSides = 1;
  controller.update(missing, 3280);
  assert.equal(controller.getSnapshot().sampleCount, 0);
  assert.equal(controller.getSnapshot().samplingSide, 'both');
  sample(controller, 3320, 5720, 170, 110);
  assert.equal(controller.getSnapshot().profile!.range, 25);
});

test('timeout is gentle, retry restarts the failed standing step, and restart erases profile', () => {
  const controller = new CalibrationController();
  controller.begin(0);
  controller.tick(CONFIG.stepTimeoutMs);
  assert.equal(controller.getSnapshot().state, 'FAILED');
  assert.equal(controller.getSnapshot().failureReason, 'timeout');
  assert.doesNotMatch(controller.getSnapshot().message, /失敗|錯誤/);
  controller.retry(30040);
  sample(controller, 30040, 32440, 155);
  assert.equal(controller.getSnapshot().state, 'BEND_INSTRUCTIONS');
  controller.startBending(32480);
  sample(controller, 32480, 34880, 135);
  assert.equal(controller.getSnapshot().state, 'COMPLETE');
  controller.restart(34920);
  assert.equal(controller.getSnapshot().profile, undefined);
  assert.equal(controller.getSnapshot().state, 'STANDING_INSTRUCTIONS');
});

test('pause excludes elapsed time and clears partial sampling without losing standing baseline', () => {
  const controller = standing();
  controller.startBending(2440);
  sample(controller, 2440, 3240, 135);
  controller.pause(3280);
  controller.tick(100000);
  assert.equal(controller.getSnapshot().paused, true);
  assert.equal(controller.getSnapshot().sampleCount, 0);
  controller.resume(100040);
  sample(controller, 100040, 102440, 135);
  assert.equal(controller.getSnapshot().state, 'COMPLETE');
  assert.equal(controller.getSnapshot().profile!.standingAngle, 155);
  controller.pause(102480);
  controller.resume(103000);
  assert.equal(controller.getSnapshot().profile!.range, 20);
});

test('destroy clears session profile and prevents further calibration updates', () => {
  const controller = standing();
  controller.startBending(2440);
  sample(controller, 2440, 4840, 135);
  controller.destroy();
  assert.equal(controller.getSnapshot().profile, undefined);
  assert.equal(controller.getSnapshot().sampleCount, 0);
  controller.restart(4880);
  controller.update(pose(4920), 4920);
  assert.equal(controller.getSnapshot().state, 'IDLE');
});
