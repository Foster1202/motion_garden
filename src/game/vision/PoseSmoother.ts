import { POSE_CONFIG } from './poseConfig';
import type { PoseLandmark } from './poseTypes';

export function poseSmoothingAlpha(alpha: number, elapsedMs?: number): number {
  // Preserve the filter's time constant when pose samples arrive less often.
  return elapsedMs === undefined ? alpha : 1 - (1 - alpha) ** (elapsedMs * POSE_CONFIG.nominalFps / 1000);
}

export class PoseSmoother {
  private value: number | undefined;
  private landmarks: PoseLandmark[] | undefined;

  constructor(private readonly alpha: number = POSE_CONFIG.smoothingAlpha) {
    if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1) throw new Error('EMA alpha must be in (0, 1].');
  }

  update(value: number): number {
    if (!Number.isFinite(value)) {
      this.reset();
      return Number.NaN;
    }
    this.value = this.value === undefined ? value : this.alpha * value + (1 - this.alpha) * this.value;
    return this.value;
  }

  updateLandmarks(points: readonly PoseLandmark[], elapsedMs?: number): PoseLandmark[] {
    if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      this.reset();
      throw new Error('Landmark coordinates must be finite.');
    }
    const previous = this.landmarks?.length === points.length ? this.landmarks : undefined;
    const alpha = poseSmoothingAlpha(this.alpha, elapsedMs);
    this.landmarks = points.map((point, index) => {
      const old = previous?.[index];
      if (!old) return { ...point };
      return {
        ...point,
        x: alpha * point.x + (1 - alpha) * old.x,
        y: alpha * point.y + (1 - alpha) * old.y,
        z: point.z !== undefined && old.z !== undefined
          ? alpha * point.z + (1 - alpha) * old.z : point.z,
      };
    });
    return this.landmarks.map(point => ({ ...point }));
  }

  reset(): void {
    this.value = undefined;
    this.landmarks = undefined;
  }
}
