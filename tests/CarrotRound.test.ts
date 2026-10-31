import assert from 'node:assert/strict';
import test from 'node:test';
import { CarrotRound, ROUND_TIMINGS } from '../src/game/systems/CarrotRound';

const bend = { bending: true, standing: false };
const stand = { bending: false, standing: true };
const idle = { bending: false, standing: false };
const conflict = { bending: true, standing: true };

function reachSuccess(round: CarrotRound): void {
  round.update(ROUND_TIMINGS.bendMs, bend);
  round.update(ROUND_TIMINGS.returnMs, stand);
}

test('requires both full holds then celebration completion before awarding a carrot', () => {
  const round = new CarrotRound();
  round.update(649, bend);
  assert.equal(round.state, 'BENDING');
  assert.equal(round.score, 0);
  assert.ok(round.progress < 1);
  round.update(1, bend);
  assert.equal(round.state, 'GRABBED');
  round.update(499, stand);
  assert.equal(round.state, 'RETURNING');
  assert.equal(round.score, 0);
  round.update(1, stand);
  assert.equal(round.state, 'SUCCESS');
  assert.equal(round.score, 0);
  assert.equal(round.completeCelebration(), true);
  assert.equal(round.score, 1);
});

test('a premature release discards the bend hold and permits a fresh retry', () => {
  const round = new CarrotRound();
  round.update(500, bend);
  round.update(100, idle);
  assert.equal(round.state, 'READY');
  assert.equal(round.progress, 0);
  round.update(150, bend);
  assert.equal(round.state, 'BENDING');
  assert.equal(round.score, 0);
  round.update(500, bend);
  assert.equal(round.state, 'GRABBED');
});

test('contradictory input cannot advance either hold or earn points', () => {
  const round = new CarrotRound();
  round.update(10_000, conflict);
  assert.equal(round.state, 'READY');
  round.update(400, bend);
  round.update(1000, conflict);
  assert.equal(round.state, 'READY');
  round.update(650, bend);
  round.update(10_000, conflict);
  assert.equal(round.state, 'GRABBED');
  assert.equal(round.score, 0);
  round.update(400, stand);
  round.update(1000, conflict);
  assert.equal(round.state, 'GRABBED');
  assert.equal(round.score, 0);
});

test('a grabbed carrot persists without a deadline', () => {
  const round = new CarrotRound();
  round.update(650, bend);
  round.update(60_000, idle);
  round.update(60_000, bend);
  assert.equal(round.state, 'GRABBED');
  assert.equal(round.score, 0);
  round.update(500, stand);
  assert.equal(round.state, 'SUCCESS');
  assert.equal(round.score, 0);
  round.completeCelebration();
  assert.equal(round.score, 1);
});

test('interrupted return requires a new full stand hold but preserves the carrot', () => {
  const round = new CarrotRound();
  round.update(650, bend);
  round.update(400, stand);
  round.update(20, idle);
  assert.equal(round.state, 'GRABBED');
  round.update(100, stand);
  assert.equal(round.state, 'RETURNING');
  assert.equal(round.score, 0);
  round.update(400, stand);
  assert.equal(round.state, 'SUCCESS');
  assert.equal(round.score, 0);
  round.completeCelebration();
  assert.equal(round.score, 1);
});

test('success waits for celebration completion regardless of elapsed time or input', () => {
  const round = new CarrotRound();
  reachSuccess(round);
  for (const input of [stand, bend, idle, conflict]) {
    round.update(60_000, input);
    assert.equal(round.state, 'SUCCESS');
    assert.equal(round.score, 0);
  }
  assert.equal(round.state, 'SUCCESS');
  assert.equal(round.completeCelebration(), true);
  assert.equal(round.state, 'NEXT_ROUND');
  assert.equal(round.score, 1);
  assert.equal(round.completeCelebration(), false);
  assert.equal(round.score, 1);
  round.update(16, idle);
  assert.equal(round.state, 'READY');
  assert.equal(round.completeCelebration(), false);
  round.update(5000, stand);
  assert.equal(round.score, 1);
});

test('premature completion callbacks cannot award a carrot or advance input states', () => {
  const round = new CarrotRound();
  for (const [elapsed, input, state] of [
    [0, idle, 'READY'],
    [300, bend, 'BENDING'],
    [350, bend, 'GRABBED'],
    [250, stand, 'RETURNING'],
  ] as const) {
    round.update(elapsed, input);
    assert.equal(round.state, state);
    assert.equal(round.completeCelebration(), false);
    assert.equal(round.state, state);
    assert.equal(round.score, 0);
  }
});

test('exactly five successful rounds complete the session and reset supports replay', () => {
  const round = new CarrotRound();
  for (let count = 1; count <= 5; count += 1) {
    reachSuccess(round);
    assert.equal(round.score, count - 1);
    assert.equal(round.state, 'SUCCESS');
    assert.equal(round.completeCelebration(), true);
    assert.equal(round.score, count);
    assert.equal(round.completeCelebration(), false);
    assert.equal(round.score, count);
    if (count < 5) {
      assert.equal(round.state, 'NEXT_ROUND');
      round.update(16, idle);
    }
  }
  assert.equal(round.state, 'COMPLETE');
  reachSuccess(round);
  assert.equal(round.completeCelebration(), false);
  assert.equal(round.score, 5);
  round.reset();
  assert.equal(round.state, 'READY');
  assert.equal(round.progress, 0);
  assert.equal(round.score, 0);
  reachSuccess(round);
  assert.equal(round.score, 0);
  assert.equal(round.completeCelebration(), true);
  assert.equal(round.score, 1);
});

test('invalid delta values never corrupt hold progress', () => {
  const round = new CarrotRound();
  round.update(-100, bend);
  round.update(Number.NaN, bend);
  round.update(Number.POSITIVE_INFINITY, bend);
  assert.equal(round.progress, 0);
  assert.equal(round.score, 0);
});
