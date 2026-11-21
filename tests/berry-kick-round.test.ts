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
function createRound(durationSeconds: number = C.defaultDurationSeconds, random: () => number = () => 0) {
  return new BerryKickRound(zones, durationSeconds, random);
}
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
    const round = createRound(120, () => side === 'left' ? 0 : 1);
    round.update(16, sample(side));
    const input = sample(side, 1);
    input.feet[side] = { x: 800, y: 700, visible: true };
    const other = side === 'left' ? 'right' : 'left';
    input.feet[other] = { x: zones[side].x + 10, y: 700, visible: true };
    assert.equal(round.update(16, input), undefined);
    const wrongRoot = sample(side, 1); wrongRoot.rootX = 800;
    assert.equal(round.update(16, wrongRoot), undefined);
    assert.equal(round.update(16, sample(side, C.extensionThreshold / 2)), undefined);
    assert.deepEqual(round.update(16, sample(side, 1)), { kind: 'harvest', side });
    assert.equal(round.counts[side], 1);
    assert.equal(round.counts[other], 0);
    assert.equal(round.score, 3);
  });
}

test('held extension scores once even after cooldown; retract and cooldown both required', () => {
  const round = createRound();
  assert.deepEqual(hit(round, 'left'), { kind: 'harvest', side: 'left' });
  advance(round, 2000, sample('left', 1));
  assert.equal(round.score, 3);
  assert.deepEqual(hit(round, 'left'), { kind: 'harvest', side: 'left' });
  round.update(16, sample('left'));
  assert.equal(round.update(16, sample('left', 1)), undefined);
  advance(round, C.cooldownMs, sample('left', 1));
  assert.equal(round.score, 9);
});

test('tracking loss disarms and requires reliable retraction before another hit', () => {
  const round = createRound();
  round.update(16, sample());
  round.update(16, { ...sample('left', 1), reliable: false });
  advance(round, 2000, sample('left', 1));
  assert.equal(round.score, 0);
  assert.deepEqual(hit(round, 'left'), { kind: 'harvest', side: 'left' });
});

test('pause freezes clock, transitions, cooldown and scoring', () => {
  const round = createRound();
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

test('both trees allow unlimited target harvests with three berries per hit until time expires', () => {
  let draw = 1;
  const round = createRound(120, () => { draw = 1 - draw; return draw; });
  for (let index = 0; index < 80; index++) {
    const side = round.target;
    advance(round, C.cooldownMs, sample(side));
    assert.deepEqual(round.update(16, sample(side, 1)), { kind: 'harvest', side });
    assert.equal(round.complete, false);
  }
  assert.equal(round.score, 240);
  assert.deepEqual(round.counts, { left: 40, right: 40 });
  round.update(round.remainingMs, sample());
  assert.equal(round.state, 'COMPLETE');
  assert.equal(round.complete, true);
  const final = round.snapshot();
  advance(round, 5000, sample());
  assert.deepEqual(round.snapshot(), final);
});

test('invalid deltas never score or poison the clock and require retraction again', () => {
  for (const delta of [NaN, Infinity, -Infinity, -16, 0]) {
    const round = createRound();
    round.update(16, sample());
    const clock = round.elapsedMs;
    assert.equal(round.update(delta, sample('left', 1)), undefined);
    assert.equal(round.score, 0);
    assert.equal(round.elapsedMs, clock);
    assert.equal(round.snapshot().armed.left, false);
    assert.equal(round.update(16, sample('left', 1)), undefined);
    assert.deepEqual(hit(round, 'left'), { kind: 'harvest', side: 'left' });
  }
});

test('invalid motion never scores while finite game time keeps advancing', () => {
  for (const [delta, patch] of [
    [16, { left: Infinity }], [16, { right: NaN }],
    [16, { left: -1 }], [16, { right: 2 }], [16, { rootX: NaN }],
  ] as Array<[number, Partial<BerryRoundInput>]>) {
    const round = createRound();
    round.update(16, sample());
    const clock = round.snapshot().clock;
    assert.equal(round.update(delta, { ...sample('left', 1), ...patch }), undefined);
    assert.equal(round.score, 0);
    assert.equal(round.snapshot().clock, clock + delta);
    assert.equal(round.snapshot().armed.left, false);
    assert.equal(round.update(16, sample('left', 1)), undefined);
    assert.deepEqual(hit(round, 'left'), { kind: 'harvest', side: 'left' });
  }
});

test('duration defaults to 120 seconds and supports only the configured challenges', () => {
  assert.equal(createRound().durationMs, 120000);
  for (const duration of C.durationOptions) {
    const round = createRound(duration);
    assert.equal(round.durationMs, duration * 1000);
    assert.equal(round.elapsedMs, 0);
    assert.equal(round.remainingMs, duration * 1000);
    assert.equal(round.complete, false);
  }
  for (const duration of [0, -60, 30, 61, 90.5, NaN, Infinity]) {
    assert.equal(createRound(duration).durationMs, 120000);
  }
});

test('positive game deltas advance in full and finish zero-score rounds at the deadline', () => {
  for (const duration of C.durationOptions) {
    const round = createRound(duration);
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
    const round = createRound(60);
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
  const round = createRound(60);
  round.update(59998, sample());
  assert.deepEqual(round.update(1, sample('left', 1)), { kind: 'harvest', side: 'left' });
  assert.equal(round.score, 3);
  assert.equal(round.complete, false);
  assert.equal(round.update(1, sample('left', 1)), undefined);
  assert.equal(round.score, 3);
  assert.equal(round.complete, true);
});

test('unreliable and invalid poses still expire the timed challenge', () => {
  for (const input of [{ ...sample(), reliable: false }, { ...sample(), left: NaN }]) {
    const round = createRound(60);
    round.update(59999, input);
    assert.equal(round.remainingMs, 1);
    assert.equal(round.score, 0);
    round.update(1, input);
    assert.equal(round.complete, true);
    assert.equal(round.state, 'COMPLETE');
  }
});

test('pause near expiry freezes the timer and resumed held legs require fresh retraction', () => {
  const round = createRound(60);
  round.update(59000, sample());
  assert.equal(round.snapshot().armed.left, true);
  round.paused = true;
  const paused = round.snapshot();
  round.update(60000, sample('left', 1));
  assert.deepEqual(round.snapshot(), paused);
  round.paused = false;
  assert.equal(round.update(100, sample('left', 1)), undefined);
  assert.equal(round.score, 0);
  assert.deepEqual(hit(round, 'left'), { kind: 'harvest', side: 'left' });
  assert.equal(round.score, 3);
  round.update(round.remainingMs, sample());
  assert.equal(round.complete, true);
});

test('pause preserves a partially consumed cooldown until enough resumed game time passes', () => {
  const round = createRound();
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

test('initial target uses the injected equal-probability draw and is present in snapshots', () => {
  for (const [value, expected] of [[0, 'left'], [.499999, 'left'], [.5, 'right'], [.999999, 'right']] as const) {
    let calls = 0;
    const round = createRound(120, () => { calls++; return value; });
    assert.equal(round.target, expected);
    assert.equal(round.snapshot().target, expected);
    assert.equal(calls, 1);
    assert.equal(round.score, 0);
  }
});

for (const side of ['left', 'right'] as const) {
  test(`${side} target may repeat after a correct harvest before switching independently`, () => {
    const same = side === 'left' ? 0 : 1;
    const other = side === 'left' ? 'right' : 'left';
    const draws = [same, same, 1 - same];
    let calls = 0;
    const round = createRound(120, () => draws[calls++]);
    assert.equal(round.target, side);
    assert.deepEqual(hit(round, side), { kind: 'harvest', side });
    assert.equal(round.target, side);
    advance(round, C.cooldownMs, sample(side));
    assert.deepEqual(hit(round, side), { kind: 'harvest', side });
    assert.equal(round.target, other);
    assert.equal(round.score, 6);
    assert.equal(round.counts[side], 2);
    assert.equal(calls, 3);
  });

  test(`${side} streak is capped at three prompts and forced switches do not draw randomness`, () => {
    let calls = 0;
    const round = createRound(120, () => { calls++; return side === 'left' ? 0 : 1; });
    const targets: BerrySide[] = [round.target];
    for (let index = 0; index < 7; index++) {
      const target = round.target;
      round.update(C.cooldownMs, sample(target));
      assert.deepEqual(round.update(1, sample(target, 1)), { kind: 'harvest', side: target });
      targets.push(round.target);
    }
    const other = side === 'left' ? 'right' : 'left';
    assert.deepEqual(targets, [side, side, side, other, side, side, side, other]);
    assert.equal(calls, 6);
    assert.equal(round.score, 21);
  });

  test(`${side} wrong-tree feedback requires a real armed trunk contact and obeys cooldown`, () => {
    const target = side === 'left' ? 'right' : 'left';
    let calls = 0;
    const round = createRound(120, () => { calls++; return target === 'left' ? 0 : 1; });
    round.update(16, sample(side));
    const away = sample(side, 1);
    away.feet[side].x = 800;
    assert.equal(round.update(16, away), undefined);
    const wrongFoot = sample(side, 1);
    wrongFoot.feet[side].x = 800;
    wrongFoot.feet[target] = { x: zones[side].x + 10, y: 700, visible: true };
    assert.equal(round.update(16, wrongFoot), undefined);
    assert.equal(round.update(16, { ...sample(side, 1), rootX: 800 }), undefined);
    assert.equal(round.update(16, sample(side, C.extensionThreshold / 2)), undefined);
    assert.deepEqual(round.update(16, sample(side, 1)), { kind: 'wrong-tree', side });
    assert.equal(round.score, 0);
    assert.deepEqual(round.counts, { left: 0, right: 0 });
    assert.equal(round.target, target);
    assert.equal(round.snapshot().armed[side], false);
    advance(round, C.cooldownMs * 2, sample(side, 1));
    assert.equal(round.update(16, sample(side, 1)), undefined);
    assert.deepEqual(hit(round, side), { kind: 'wrong-tree', side });
    round.update(16, sample(side));
    assert.equal(round.update(16, sample(side, 1)), undefined);
    assert.equal(round.update(C.cooldownMs - 33, sample(side, 1)), undefined);
    assert.deepEqual(round.update(1, sample(side, 1)), { kind: 'wrong-tree', side });
    assert.equal(round.score, 0);
    assert.equal(round.target, target);
    assert.equal(calls, 1);
  });
}

test('target and randomness stay unchanged for invalid, missing, paused, held and finished input', () => {
  let calls = 0;
  const round = createRound(60, () => { calls++; return .75; });
  const initial = round.target;
  round.update(16, sample('right'));
  assert.equal(round.update(0, sample('right', 1)), undefined);
  assert.equal(round.update(NaN, sample('right', 1)), undefined);
  assert.equal(round.update(16, { ...sample('right', 1), left: NaN }), undefined);
  assert.equal(round.update(16, { ...sample('right', 1), reliable: false }), undefined);
  assert.equal(round.update(1000, sample('right', 1)), undefined);
  assert.equal(round.target, initial);
  assert.equal(calls, 1);
  assert.deepEqual(hit(round, 'right'), { kind: 'harvest', side: 'right' });
  assert.equal(calls, 2);
  assert.equal(round.update(C.cooldownMs * 2, sample('right', 1)), undefined);
  assert.equal(round.target, initial);
  assert.equal(calls, 2);
  round.paused = true;
  const paused = round.snapshot();
  assert.equal(round.update(10000, sample('right', 1)), undefined);
  assert.deepEqual(round.snapshot(), paused);
  round.paused = false;
  assert.equal(round.update(16, sample('right', 1)), undefined);
  round.update(round.remainingMs, sample('right', 1));
  assert.equal(round.complete, true);
  const final = round.snapshot();
  assert.equal(round.update(1000, sample('right')), undefined);
  assert.equal(round.update(16, sample('right', 1)), undefined);
  assert.deepEqual(round.snapshot(), final);
  assert.equal(round.target, initial);
  assert.equal(calls, 2);
});

test('wrong-tree cooldown is independent of the target leg and preserves its harvest', () => {
  let calls = 0;
  const round = createRound(120, () => { calls++; return 0; });
  assert.deepEqual(hit(round, 'right'), { kind: 'wrong-tree', side: 'right' });
  assert.deepEqual(hit(round, 'left'), { kind: 'harvest', side: 'left' });
  assert.equal(round.score, 3);
  assert.deepEqual(round.counts, { left: 1, right: 0 });
  assert.equal(calls, 2);
});

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test('fresh rounds restart target history and injected seeded sequences reproduce independently', () => {
  const first = createRound(120, seededRandom(0x12345678));
  const second = createRound(120, seededRandom(0x12345678));
  for (let index = 0; index < 50; index++) {
    assert.equal(first.target, second.target);
    const target = first.target;
    for (const round of [first, second]) {
      round.update(C.cooldownMs, sample(target));
      assert.deepEqual(round.update(1, sample(target, 1)), { kind: 'harvest', side: target });
    }
  }
  const old = createRound(120, () => 0);
  for (let index = 0; index < 3; index++) {
    old.update(C.cooldownMs, sample('left'));
    assert.deepEqual(old.update(1, sample('left', 1)), { kind: 'harvest', side: 'left' });
  }
  assert.equal(old.target, 'right');
  const fresh = createRound(120, () => 0);
  assert.equal(fresh.target, 'left');
  assert.equal(fresh.score, 0);
  assert.equal(fresh.elapsedMs, 0);
  assert.deepEqual(hit(fresh, 'left'), { kind: 'harvest', side: 'left' });
  assert.equal(fresh.target, 'left');
});

test('seeded target samples remain balanced and never exceed three consecutive prompts', () => {
  const random = seededRandom(0xdecafbad);
  const totals = { left: 0, right: 0 };
  let longest = 0;
  for (let session = 0; session < 200; session++) {
    const round = createRound(120, random);
    let previous: BerrySide | undefined;
    let streak = 0;
    for (let index = 0; index < 80; index++) {
      const target = round.target;
      totals[target]++;
      streak = target === previous ? streak + 1 : 1;
      longest = Math.max(longest, streak);
      previous = target;
      round.update(C.cooldownMs, sample(target));
      assert.deepEqual(round.update(1, sample(target, 1)), { kind: 'harvest', side: target });
    }
  }
  assert.equal(longest, 3);
  const leftShare = totals.left / (totals.left + totals.right);
  assert.ok(Math.abs(leftShare - .5) < .02, JSON.stringify(totals));
});

test('complementary random draws produce symmetric mirrored target sequences', () => {
  const leftRandom = seededRandom(9157);
  const rightRandom = seededRandom(9157);
  const left = createRound(120, leftRandom);
  const right = createRound(120, () => 1 - rightRandom());
  for (let index = 0; index < 80; index++) {
    assert.notEqual(left.target, right.target);
    for (const round of [left, right]) {
      const target = round.target;
      round.update(C.cooldownMs, sample(target));
      assert.deepEqual(round.update(1, sample(target, 1)), { kind: 'harvest', side: target });
    }
  }
  assert.equal(left.counts.left, right.counts.right);
  assert.equal(left.counts.right, right.counts.left);
});
