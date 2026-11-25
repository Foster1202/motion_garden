import assert from 'node:assert/strict';
import test from 'node:test';
import { AppleHarvestRound, type AppleHarvestEvent, type AppleHarvestRoundInput } from '../src/game/apple/AppleHarvestRound';
import { APPLE_CONFIG as C } from '../src/game/apple/appleConfig';

const asInput = (x: number, values: Partial<Omit<AppleHarvestRoundInput, 'x'>> = {}): AppleHarvestRoundInput => ({
  x, lateralReliable: true, left: 0, right: 0, ...values,
});
const x = (zone: keyof typeof C.zones) => C.zones[zone].center;
const lost = asInput(0, { lateralReliable: false, left: null, right: null });

function hold(round: AppleHarvestRound, input: AppleHarvestRoundInput, frames = 6): AppleHarvestEvent[] {
  return Array.from({ length: frames }, () => round.update(20, input)).filter(event => event !== undefined);
}

function gesture(round: AppleHarvestRound, zone: keyof typeof C.zones, hand: 'left' | 'right' = 'left') {
  return gestureAt(round, x(zone), hand);
}

function gestureAt(round: AppleHarvestRound, position: number, hand: 'left' | 'right') {
  return [
    ...hold(round, asInput(position)),
    ...hold(round, asInput(position, { [hand]: 1 })),
    ...hold(round, asInput(position)),
  ];
}

test('both tree and basket edges accept gestures beyond the former zones and still reject the gap', () => {
  for (const direction of [-1, 1]) {
    const round = new AppleHarvestRound(120, () => direction === -1 ? 0 : 1);
    const hand = direction === -1 ? 'right' : 'left';
    assert.deepEqual(gestureAt(round, direction * .46, hand), []);
    assert.equal(gestureAt(round, direction * .50, hand)[0]?.kind, 'picked');
    assert.deepEqual(gestureAt(round, direction * .31, hand), []);
    assert.equal(round.score, 0);
    assert.equal(gestureAt(round, direction * .29, hand)[0]?.kind, 'depositing');
    assert.equal(round.score, 0);
    round.update(C.depositMs, lost);
    assert.equal(round.score, 1);
  }
});

test('wrong tree keeps target, correct pick carries exactly one apple, basket arrival is the sole scoring event', () => {
  const draws = [.9, .1];
  let drawsUsed = 0;
  const round = new AppleHarvestRound(120, () => draws[drawsUsed++]);
  assert.equal(round.target, 'right');
  assert.deepEqual(gesture(round, 'basket'), []);
  assert.deepEqual(gesture(round, 'left'), [{ kind: 'wrong-tree', tree: 'left', hand: 'left' }]);
  assert.equal(round.target, 'right');
  assert.equal(round.carrying, undefined);

  assert.deepEqual(gesture(round, 'right', 'right'), [{ kind: 'picked', tree: 'right', hand: 'right' }]);
  assert.deepEqual(round.carrying, { tree: 'right', hand: 'right' });
  assert.equal(round.score, 0);
  assert.equal(drawsUsed, 1);
  assert.deepEqual(gesture(round, 'right'), []);
  assert.deepEqual(gesture(round, 'left'), []);
  assert.deepEqual(round.carrying, { tree: 'right', hand: 'right' });

  assert.deepEqual(gesture(round, 'basket'), [{ kind: 'depositing', tree: 'right', hand: 'right' }]);
  assert.equal(round.depositProgress, 0);
  assert.equal(round.score, 0);
  assert.equal(round.target, 'right');
  assert.equal(round.update(C.depositMs - 1, lost), undefined);
  assert.ok(round.depositProgress > .99);
  assert.equal(round.score, 0);
  assert.deepEqual(round.update(1, lost), { kind: 'deposited', tree: 'right', hand: 'right' });
  assert.equal(round.score, 1);
  assert.equal(round.target, 'left');
  assert.equal(drawsUsed, 2);
  assert.equal(round.carrying, undefined);
  assert.deepEqual(gesture(round, 'basket'), []);
  assert.equal(round.score, 1);
});

test('raises outside the zone, single-frame wobbles, deadband, prolonged holds and leaving before release cannot trigger', () => {
  const round = new AppleHarvestRound(120, () => 0);
  const atTree = (left = 0) => asInput(x('left'), { left });
  hold(round, asInput(0));
  hold(round, asInput(0, { left: 1 }));
  hold(round, atTree(1), 15);
  assert.deepEqual(hold(round, atTree()), []);
  assert.equal(round.snapshot().gestures.left, 'READY');

  hold(round, atTree(1), 1);
  hold(round, atTree(.55), 12);
  assert.deepEqual(hold(round, atTree()), []);
  hold(round, atTree(1), 20);
  assert.equal(round.state, 'PICKING');
  assert.deepEqual(hold(round, atTree(0), 1), []);
  hold(round, atTree(.55), 10);
  assert.equal(round.state, 'PICKING');
  hold(round, asInput(x('left') + C.zones.left.radius + .01, { left: 1 }));
  assert.deepEqual(hold(round, atTree()), []);
  assert.equal(round.carrying, undefined);
  assert.deepEqual(gesture(round, 'left'), [{ kind: 'picked', tree: 'left', hand: 'left' }]);
});

test('both hands can interact and simultaneous gestures cannot pick or score twice', () => {
  const round = new AppleHarvestRound(90, () => .95);
  const double = (zone: 'right' | 'basket') => [
    ...hold(round, asInput(x(zone))),
    ...hold(round, asInput(x(zone), { left: 1, right: 1 })),
    ...hold(round, asInput(x(zone))),
  ];
  assert.deepEqual(double('right'), [{ kind: 'picked', tree: 'right', hand: 'left' }]);
  assert.deepEqual(double('basket'), [{ kind: 'depositing', tree: 'right', hand: 'left' }]);
  assert.deepEqual(round.update(C.depositMs, asInput(x('basket'))), { kind: 'deposited', tree: 'right', hand: 'left' });
  assert.equal(round.score, 1);
});

test('wrist occlusion, full tracking loss, and stale frame gaps all cancel an unfinished reach', () => {
  const round = new AppleHarvestRound(120, () => 0);
  const atTree = (left: number | null = 0) => asInput(x('left'), { left });
  for (const interruption of [atTree(null), lost] as const) {
    hold(round, atTree());
    hold(round, atTree(1));
    assert.equal(round.state, 'PICKING');
    round.update(20, interruption);
    assert.deepEqual(hold(round, atTree()), []);
  }
  hold(round, atTree(1));
  assert.equal(round.state, 'PICKING');
  round.update(C.maximumFrameGapMs, atTree());
  assert.deepEqual(hold(round, atTree()), []);
  assert.equal(round.carrying, undefined);
  assert.deepEqual(gesture(round, 'left', 'right'), [{ kind: 'picked', tree: 'left', hand: 'right' }]);
});

test('duplicate pose samples cannot supply time for any gesture phase', () => {
  const round = new AppleHarvestRound(120, () => .8);
  const frame = (timestampMs: number, right = 0) => asInput(x('right'), { timestampMs, left: null, right });
  hold(round, frame(1000), 12);
  assert.equal(round.snapshot().gestures.right, 'NEUTRAL');
  round.update(15, frame(1040));
  round.update(15, frame(1095));
  assert.equal(round.snapshot().gestures.right, 'READY');
  hold(round, frame(1120, 1), 12);
  assert.equal(round.snapshot().gestures.right, 'READY');
  round.update(15, frame(1160, 1));
  round.update(15, frame(1215, 1));
  assert.equal(round.state, 'PICKING');
  assert.deepEqual(hold(round, frame(1230), 12), []);
  assert.deepEqual(round.update(15, frame(1325)), { kind: 'picked', tree: 'right', hand: 'right' });
});

test('pause preserves clock and basket flight while requiring neutral rearm for incomplete actions', () => {
  const round = new AppleHarvestRound(120, () => 0);
  hold(round, asInput(x('left')));
  hold(round, asInput(x('left'), { left: 1 }));
  assert.equal(round.state, 'PICKING');
  const before = round.elapsedMs;
  round.paused = true;
  assert.deepEqual(hold(round, asInput(x('left')), 100), []);
  assert.equal(round.elapsedMs, before);
  round.paused = false;
  assert.deepEqual(hold(round, asInput(x('left'))), []);
  assert.deepEqual(gesture(round, 'left'), [{ kind: 'picked', tree: 'left', hand: 'left' }]);
  gesture(round, 'basket');
  round.update(C.depositMs / 2, lost);
  round.paused = true;
  round.update(30_000, lost);
  assert.equal(round.depositProgress, .5);
  assert.equal(round.score, 0);
  round.paused = false;
  assert.equal(round.update(C.depositMs / 2, lost)?.kind, 'deposited');
  assert.equal(round.score, 1);
});

test('random target repeats up to three times and scoring remains open beyond an orchard inventory', () => {
  const round = new AppleHarvestRound(180, () => 0);
  const picks = [];
  for (let completed = 0; completed < 20; completed++) {
    picks.push(round.target);
    assert.equal(gesture(round, round.target)[0]?.kind, 'picked');
    assert.equal(gesture(round, 'basket')[0]?.kind, 'depositing');
    assert.equal(round.update(C.depositMs, lost)?.kind, 'deposited');
  }
  assert.deepEqual(picks, Array.from({ length: 20 }, (_, index) => index % 4 === 3 ? 'right' : 'left'));
  assert.equal(round.score, 20);
});

test('90, 120 and 180 second deadlines stop input and leave any held fruit unscored', () => {
  for (const duration of C.durationOptions) {
    const round = new AppleHarvestRound(duration, () => 0);
    gesture(round, 'left');
    round.update(duration * 1000 - round.elapsedMs - 1, lost);
    assert.equal(round.remainingMs, 1);
    round.update(1, asInput(x('basket')));
    assert.equal(round.state, 'COMPLETE');
    assert.equal(round.elapsedMs, duration * 1000);
    assert.deepEqual(gesture(round, 'basket'), []);
    assert.equal(round.score, 0);
    assert.equal(round.carrying, undefined);
  }
  assert.equal(new AppleHarvestRound(60).durationMs, 120_000);
});

test('a deposit that arrives at the deadline is unscored even after a valid release', () => {
  const round = new AppleHarvestRound(90, () => 0);
  gesture(round, 'left');
  // Three six-frame holds take 360 ms. The model then needs the complete basket flight.
  round.update(round.remainingMs - 360 - C.depositMs, lost);
  assert.equal(gesture(round, 'basket')[0]?.kind, 'depositing');
  assert.equal(round.remainingMs, C.depositMs);
  assert.equal(round.update(C.depositMs, lost), undefined);
  assert.equal(round.state, 'COMPLETE');
  assert.equal(round.score, 0);
  assert.equal(round.depositing, false);
  assert.equal(round.carrying, undefined);
});

test('a flight arriving strictly before expiry counts even if one frame crosses both times', () => {
  const round = new AppleHarvestRound(90, () => 0);
  gesture(round, 'left');
  round.update(round.remainingMs - 360 - C.depositMs - 1, lost);
  gesture(round, 'basket');
  assert.equal(round.update(C.depositMs + 1, lost)?.kind, 'deposited');
  assert.equal(round.state, 'COMPLETE');
  assert.equal(round.score, 1);
});
