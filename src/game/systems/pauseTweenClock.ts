interface TweenClock {
  startTime: number;
  prevTime: number;
}

export function resumeTweenClock(clock: TweenClock, now = Date.now()) {
  // Phaser's wall clock must exclude time spent in a paused scene.
  const elapsed = Math.max(0, now - clock.prevTime);
  clock.startTime += elapsed;
  clock.prevTime = now;
}
