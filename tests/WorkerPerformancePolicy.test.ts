import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkerPerformancePolicy, type PoseDelegate } from '../src/game/vision/workerPerformancePolicy';

function completeFrames(policy: WorkerPerformancePolicy, delegate: PoseDelegate,
  ages: number[], hasLandmarks = true) {
  return ages.map(age => policy.observe(delegate, age, hasLandmarks));
}

test('a single slow inference and the first cold tracked frame do not trigger a GPU trial', () => {
  const policy = new WorkerPerformancePolicy('auto');
  assert.deepEqual(completeFrames(policy, 'CPU', [500], false), [undefined]);
  assert.deepEqual(completeFrames(policy, 'CPU', [600, 160, 80, 200, 81, 129]), Array(6).fill(undefined));
});

test('five slow CPU frames trigger one GPU trial and keep a materially faster GPU', () => {
  const policy = new WorkerPerformancePolicy('auto');
  assert.deepEqual(completeFrames(policy, 'CPU', [900, 188, 182, 180, 198, 178]),
    [...Array(5).fill(undefined), 'GPU']);
  assert.deepEqual(completeFrames(policy, 'GPU', [6300, 66, 75, 81, 80, 76]), Array(6).fill(undefined));
  assert.deepEqual(completeFrames(policy, 'GPU', [210, 200, 290, 270, 321]), Array(5).fill(undefined));
});

test('a few fast outliers do not mask sustained late CPU results', () => {
  const policy = new WorkerPerformancePolicy('auto');
  assert.equal(completeFrames(policy, 'CPU', [900, 200, 75, 220, 180, 68, 280, 160]).at(-1), 'GPU');
});

test('slow GPU or loss of landmarks on GPU returns to CPU for the session', () => {
  for (const hasLandmarks of [true, false]) {
    const policy = new WorkerPerformancePolicy('auto');
    assert.equal(completeFrames(policy, 'CPU', [900, 170, 170, 175, 177, 175]).at(-1), 'GPU');
    const age = hasLandmarks ? 180 : 60;
    assert.equal(completeFrames(policy, 'GPU', [7800, age, age, age, age, age], hasLandmarks).at(-1), 'CPU');
    assert.deepEqual(completeFrames(policy, 'CPU', [400, 400, 400, 400, 400, 400]), Array(6).fill(undefined));
  }
});

test('explicit delegates and aborted trials disable adaptive switching', () => {
  for (const preference of ['CPU', 'GPU'] as const) {
    const policy = new WorkerPerformancePolicy(preference);
    assert.deepEqual(completeFrames(policy, preference, [800, 400, 400, 400, 400, 400]), Array(6).fill(undefined));
  }
  const aborted = new WorkerPerformancePolicy('auto');
  aborted.finish();
  assert.deepEqual(completeFrames(aborted, 'CPU', [800, 400, 400, 400, 400, 400]), Array(6).fill(undefined));
});
