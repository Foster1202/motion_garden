import assert from 'node:assert/strict';
import test from 'node:test';
import { resumeTweenClock } from '../src/game/systems/pauseTweenClock';

test('short and long scene pauses preserve elapsed tween time on resume', () => {
  for (const pause of [200, 300, 800, 60000]) {
    const clock = { startTime: 1000, prevTime: 1100 };
    resumeTweenClock(clock, 1100 + pause);
    assert.equal(clock.prevTime - clock.startTime, 100);
    assert.equal((clock.prevTime + 35) - clock.startTime, 135);
  }
});
