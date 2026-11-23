interface RenderSize { width: number; height: number }

const LOW_PERFORMANCE_FRAME_MS = 1000 / 30;

export function getThreeRenderSize({ width, height }: RenderSize, lowPerformance: boolean): RenderSize {
  if (!lowPerformance) return { width, height };
  return { width: Math.round(width / 2), height: Math.round(height / 2) };
}

export class LowPerformanceDrawGate {
  private nextDrawAt = -Infinity;

  isDue(now = performance.now()): boolean {
    if (now < this.nextDrawAt) return false;
    // Keep the cadence across normal frame jitter and start a new window after a stall.
    this.nextDrawAt = now - this.nextDrawAt >= LOW_PERFORMANCE_FRAME_MS
      ? now + LOW_PERFORMANCE_FRAME_MS
      : this.nextDrawAt + LOW_PERFORMANCE_FRAME_MS;
    return true;
  }
}
