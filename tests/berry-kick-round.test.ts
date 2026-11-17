import assert from 'node:assert/strict';
import test from 'node:test';
import { BerryKickRound, type BerryRoundInput } from '../src/game/berry/BerryKickRound';
import { BERRY_CONFIG as C, footInTrunk, type BerrySide } from '../src/game/berry/berryConfig';

const zones = { left: { x: 420, y: 640, width: 40, height: 100 }, right: { x: 1140, y: 640, width: 40, height: 100 } };
const sample = (side: BerrySide = 'left', amount = 0): BerryRoundInput => ({
  left: side === 'left' ? amount : 0, right: side === 'right' ? amount : 0,
  feet: { left: { x: 440, y: 700, visible: true }, right: { x: 1160, y: 700, visible: true } },
  reliable: true, rootX: side === 'left' ? 510 : 1090,
});
function advance(round: BerryKickRound, duration: number, input: BerryRoundInput) {
  for (let remaining = duration; remaining > 0; remaining -= 100) round.update(Math.min(100, remaining), input);
}
function hit(round: BerryKickRound, side: BerrySide) {
  round.update(16, sample(side));
  return round.update(16, sample(side, 1));
}

test('trunk collision includes boundaries and rejects hidden, invalid and outside feet', () => {
  const zone = zones.left;
  for (const [x, y] of [[420, 640], [460, 740], [440, 700]]) assert.ok(footInTrunk({ x, y, visible: true }, zone));
  for (const [x, y] of [[419, 700], [461, 700], [440, 639], [440, 741], [NaN, 700], [440, Infinity]]) {
    assert.equal(footInTrunk({ x, y, visible: true }, zone), false);
  }
  assert.equal(footInTrunk({ x: 440, y: 700, visible: false }, zone), false);
});

for (const side of ['left', 'right'] as const) {
  test(`${side} requires its own foot, matching root proximity and sufficient extension`, () => {
    const round = new BerryKickRound(zones);
    round.update(16, sample(side));
    const input = sample(side, 1);
    input.feet[side] = { x: 800, y: 700, visible: true };
    const other = side === 'left' ? 'right' : 'left';
    input.feet[other] = { x: zones[side].x + 10, y: 700, visible: true };
    assert.equal(round.update(16, input), undefined);
    const wrongRoot = sample(side, 1); wrongRoot.rootX = 800;
    assert.equal(round.update(16, wrongRoot), undefined);
    assert.equal(round.update(16, sample(side, C.extensionThreshold / 2)), undefined);
    assert.equal(round.update(16, sample(side, 1)), side);
    assert.equal(round.counts[side], 1);
    assert.equal(round.counts[other], 0);
    assert.equal(round.score, 3);
  });
}

test('held extension scores once even after cooldown; retract and cooldown both required', () => {
  const round = new BerryKickRound(zones);
  assert.equal(hit(round, 'left'), 'left');
  advance(round, 2000, sample('left', 1));
  assert.equal(round.score, 3);
  assert.equal(hit(round, 'left'), 'left');
  round.update(16, sample('left'));
  assert.equal(round.update(16, sample('left', 1)), undefined);
  advance(round, C.cooldownMs, sample('left', 1));
  assert.equal(round.score, 9);
});

test('tracking loss disarms and requires reliable retraction before another hit', () => {
  const round = new BerryKickRound(zones);
  round.update(16, sample());
  round.update(16, { ...sample('left', 1), reliable: false });
  advance(round, 2000, sample('left', 1));
  assert.equal(round.score, 0);
  assert.equal(hit(round, 'left'), 'left');
});

test('pause freezes clock, transitions, cooldown and scoring', () => {
  const round = new BerryKickRound(zones);
  hit(round, 'left');
  round.paused = true;
  const before = round.snapshot();
  advance(round, 5000, sample('right', 1));
  assert.deepEqual(round.snapshot(), before);
  round.paused = false;
  round.update(16, sample('left'));
  assert.equal(round.update(16, sample('left', 1)), undefined);
  assert.equal(round.score, 3);
});

test('both trees allow unlimited harvests with three berries per hit until time expires', () => {
  const round = new BerryKickRound(zones);
  for (const side of ['left', 'right'] as const) {
    for (let index = 0; index < 12; index++) {
      advance(round, C.cooldownMs, sample(side));
      assert.equal(round.update(16, sample(side, 1)), side);
      assert.equal(round.complete, false);
    }
  }
  assert.equal(round.score, 72);
  assert.deepEqual(round.counts, { left: 12, right: 12 });
  round.update(round.remainingMs, sample());
  assert.equal(round.state, 'COMPLETE');
  assert.equal(round.complete, true);
  const final = round.snapshot();
  advance(round, 5000, sample());
  assert.deepEqual(round.snapshot(), final);
});

test('invalid deltas never score or poison the clock and require retraction again', () => {
  for (const delta of [NaN, Infinity, -Infinity, -16, 0]) {
    const round = new BerryKickRound(zones);
    round.update(16, sample());
    const clock = round.elapsedMs;
    assert.equal(round.update(delta, sample('left', 1)), undefined);
    assert.equal(round.score, 0);
    assert.equal(round.elapsedMs, clock);
    assert.equal(round.snapshot().armed.left, false);
    assert.equal(round.update(16, sample('left', 1)), undefined);
    assert.equal(hit(round, 'left'), 'left');
  }
});

test('invalid motion never scores while finite game time keeps advancing', () => {
  for (const [delta, patch] of [
    [16, { left: Infinity }], [16, { right: NaN }],
    [16, { left: -1 }], [16, { right: 2 }], [16, { rootX: NaN }],
  ] as Array<[number, Partial<BerryRoundInput>]>) {
    const round = new BerryKickRound(zones);
    round.update(16, sample());
    const clock = round.snapshot().clock;
    assert.equal(round.update(delta, { ...sample('left', 1), ...patch }), undefined);
    assert.equal(round.score, 0);
    assert.equal(round.snapshot().clock, clock + delta);
    assert.equal(round.snapshot().armed.left, false);
    assert.equal(round.update(16, sample('left', 1)), undefined);
    assert.equal(hit(round, 'left'), 'left');
  }
});

test('duration defaults to 120 seconds and supports only the configured challenges', () => {
  assert.equal(new BerryKickRound(zones).durationMs, 120000);
  for (const duration of C.durationOptions) {
    const round = new BerryKickRound(zones, duration);
    assert.equal(round.durationMs, duration * 1000);
    assert.equal(round.elapsedMs, 0);
    assert.equal(round.remainingMs, duration * 1000);
    assert.equal(round.complete, false);
  }
  for (const duration of [0, -60, 30, 61, 90.5, NaN, Infinity]) {
    assert.equal(new BerryKickRound(zones, duration).durationMs, 120000);
  }
});

test('positive game deltas advance in full and finish zero-score rounds at the deadline', () => {
  for (const duration of C.durationOptions) {
    const round = new BerryKickRound(zones, duration);
    assert.equal(round.update(1250, sample()), undefined);
    assert.equal(round.elapsedMs, 1250);
    round.update(round.remainingMs - 1, sample());
    assert.equal(round.complete, false);
    assert.equal(round.remainingMs, 1);
    round.update(1, sample());
    assert.equal(round.remainingMs, 0);
    assert.equal(round.elapsedMs, duration * 1000);
    assert.equal(round.state, 'COMPLETE');
    assert.equal(round.score, 0);
  }
});

test('deadline blocks collisions at and beyond expiry and completion remains immutable', () => {
  for (const overshoot of [0, 1, 1000, Number.MAX_VALUE]) {
    const round = new BerryKickRound(zones, 60);
    round.update(59999, sample());
    assert.equal(round.snapshot().armed.left, true);
    assert.equal(round.update(1 + overshoot, sample('left', 1)), undefined);
    assert.equal(round.score, 0);
    assert.equal(round.complete, true);
    assert.equal(round.remainingMs, 0);
    const final = round.snapshot();
    round.update(5000, sample());
    round.update(16, sample('left', 1));
    round.paused = true;
    round.paused = false;
    assert.deepEqual(round.snapshot(), final);
  }
});

test('a collision just before expiry counts and the next deadline frame cannot add berries', () => {
  const round = new BerryKickRound(zones, 60);
  round.update(59998, sample());
  assert.equal(round.update(1, sample('left', 1)), 'left');
  assert.equal(round.score, 3);
  assert.equal(round.complete, false);
  assert.equal(round.update(1, sample('left', 1)), undefined);
  assert.equal(round.score, 3);
  assert.equal(round.complete, true);
});

test('unreliable and invalid poses still expire the timed challenge', () => {
  for (const input of [{ ...sample(), reliable: false }, { ...sample(), left: NaN }]) {
    const round = new BerryKickRound(zones, 60);
    round.update(59999, input);
    assert.equal(round.remainingMs, 1);
    assert.equal(round.score, 0);
    round.update(1, input);
    assert.equal(round.complete, true);
    assert.equal(round.state, 'COMPLETE');
  }
});

test('pause near expiry freezes the timer and resumed held legs require fresh retraction', () => {
  const round = new BerryKickRound(zones, 60);
  round.update(59000, sample());
  assert.equal(round.snapshot().armed.left, true);
  round.paused = true;
  const paused = round.snapshot();
  round.update(60000, sample('left', 1));
  assert.deepEqual(round.snapshot(), paused);
  round.paused = false;
  assert.equal(round.update(100, sample('left', 1)), undefined);
  assert.equal(round.score, 0);
  assert.equal(hit(round, 'left'), 'left');
  assert.equal(round.score, 3);
  round.update(round.remainingMs, sample());
  assert.equal(round.complete, true);
});

test('pause preserves a partially consumed cooldown until enough resumed game time passes', () => {
  const round = new BerryKickRound(zones);
  hit(round, 'left');
  round.update(400, sample());
  round.paused = true;
  round.update(10000, sample());
  round.paused = false;
  round.update(16, sample());
  assert.equal(round.update(16, sample('left', 1)), undefined);
  assert.equal(round.score, 3);
  round.update(568, sample('left', 1));
  assert.equal(round.score, 6);
});
