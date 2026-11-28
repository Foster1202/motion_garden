import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOME_END, HOME_GATES, HOME_STEP_GAP_MS, RabbitHomeRound } from '../src/game/home/RabbitHomeRound';

function opposite(round: RabbitHomeRound) {
  return round.lastFoot === 'left' ? 'right' : 'left';
}

function walkTo(round: RabbitHomeRound, distance: number) {
  while (round.distance < distance) {
    round.advanceTime(1000);
    assert.ok(round.takeStep(opposite(round)));
  }
}

test('accepts either starting foot, then requires alternation and a minimum interval', () => {
  const round = new RabbitHomeRound();
  assert.ok(round.takeStep('right'));
  assert.equal(round.takeStep('left'), null);
  round.advanceTime(HOME_STEP_GAP_MS - 1);
  assert.equal(round.takeStep('left'), null);
  round.advanceTime(1);
  assert.equal(round.takeStep('right'), null);
  assert.ok(round.takeStep('left'));
  assert.equal(round.distance, 2);
});

test('uses input timestamps for debouncing when rendering stalls', () => {
  const round = new RabbitHomeRound();
  assert.ok(round.takeStep('left', 1000));
  round.advanceTime(16);
  assert.equal(round.takeStep('right', 1100), null);
  assert.ok(round.takeStep('right', 1280));
  assert.equal(round.distance, 2);
  assert.equal(round.sinceStepMs, 0);
});

test('waiting leaves progress, lane and foot unchanged and does not expire the journey', () => {
  const round = new RabbitHomeRound();
  round.selectLane(-1);
  walkTo(round, 20);
  const previousFoot = round.lastFoot;
  round.advanceTime(15 * 60 * 1000);
  assert.equal(round.distance, 20);
  assert.equal(round.lanterns, 2);
  assert.equal(round.lane, -1);
  assert.equal(round.lastFoot, previousFoot);
  assert.ok(round.takeStep(opposite(round)));
});

test('a wrong bridge stops before water and permits retry with the same attempted foot', () => {
  const round = new RabbitHomeRound();
  for (const gate of HOME_GATES) {
    round.selectLane(0);
    walkTo(round, gate.at - 1);
    round.advanceTime(1250);
    const foot = opposite(round);
    assert.equal(round.takeStep(foot), null);
    assert.equal(round.distance, gate.at - 1);
    assert.equal(round.blocked, true);
    round.selectLane(gate.lane);
    assert.equal(round.blocked, false);
    assert.equal(round.takeStep(foot)?.crossing, true);
    assert.equal(round.distance, gate.at);
  }
});

test('each stage begins once, lanterns activate once, and arrival is terminal', () => {
  const round = new RabbitHomeRound();
  const stageStarts: number[] = [];
  const litAt: number[] = [];
  while (!round.arrived) {
    if (round.nextGate?.at === round.distance + 1) round.selectLane(round.nextGate.lane);
    round.advanceTime(1100);
    const event = round.takeStep(opposite(round));
    assert.ok(event);
    if (event.newStage) stageStarts.push(round.distance);
    if (event.lantern) litAt.push(round.distance);
    assert.equal(event.arrived, round.distance === HOME_END);
  }
  assert.deepEqual(stageStarts, [40, 82]);
  assert.deepEqual(litAt, [8, 18, 29, 39]);
  assert.equal(round.lanterns, 4);
  assert.equal(round.distance, HOME_END);
  assert.equal(round.takeStep(opposite(round)), null);
  round.selectLane(-1);
  assert.equal(round.lane, 1);
  const replay = new RabbitHomeRound();
  assert.equal(replay.distance, 0);
  assert.equal(replay.lastFoot, null);
  assert.equal(replay.lanterns, 0);
});
