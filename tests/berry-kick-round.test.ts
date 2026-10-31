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
  });
}

test('held extension scores once even after cooldown; retract and cooldown both required', () => {
  const round = new BerryKickRound(zones);
  assert.equal(hit(round, 'left'), 'left');
  advance(round, 2000, sample('left', 1));
  assert.equal(round.score, 1);
  assert.equal(hit(round, 'left'), 'left');
  round.update(16, sample('left'));
  assert.equal(round.update(16, sample('left', 1)), undefined);
  advance(round, C.cooldownMs, sample('left', 1));
  assert.equal(round.score, 3);
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
  assert.equal(round.score, 1);
});

test('three harvests per side complete exactly six and completion is immutable', () => {
  const round = new BerryKickRound(zones);
  for (const side of ['left', 'right'] as const) {
    for (let index = 0; index < C.targetPerSide; index++) {
      advance(round, C.cooldownMs, sample(side));
      assert.equal(round.update(16, sample(side, 1)), side);
    }
    if (side === 'left') {
      advance(round, C.cooldownMs, sample(side));
      assert.equal(round.update(16, sample(side, 1)), undefined);
      assert.equal(round.complete, false);
    }
  }
  assert.equal(round.score, 6);
  assert.deepEqual(round.counts, { left: 3, right: 3 });
  assert.equal(round.state, 'COMPLETE');
  assert.equal(round.complete, true);
  const final = round.snapshot();
  advance(round, 5000, sample());
  assert.deepEqual(round.snapshot(), final);
});

test('invalid deltas and motion amounts never score or poison the clock', () => {
  for (const [delta, patch] of [
    [NaN, {}], [Infinity, {}], [16, { left: Infinity }], [16, { right: NaN }],
    [16, { left: -1 }], [16, { right: 2 }], [16, { rootX: NaN }],
  ] as Array<[number, Partial<BerryRoundInput>]>) {
    const round = new BerryKickRound(zones);
    round.update(16, sample());
    const clock = round.snapshot().clock;
    assert.equal(round.update(delta, { ...sample('left', 1), ...patch }), undefined);
    assert.equal(round.score, 0);
    assert.equal(round.snapshot().clock, clock);
    assert.equal(round.snapshot().armed.left, false);
    assert.equal(round.update(16, sample('left', 1)), undefined);
    assert.equal(hit(round, 'left'), 'left');
  }
});
