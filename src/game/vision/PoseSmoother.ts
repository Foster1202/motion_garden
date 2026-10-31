import { POSE_CONFIG } from './poseConfig';
import type { PoseLandmark } from './poseTypes';

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

  updateLandmarks(points: readonly PoseLandmark[]): PoseLandmark[] {
    if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      this.reset();
      throw new Error('Landmark coordinates must be finite.');
    }
    const previous = this.landmarks?.length === points.length ? this.landmarks : undefined;
    this.landmarks = points.map((point, index) => {
      const old = previous?.[index];
      if (!old) return { ...point };
      return {
        ...point,
        x: this.alpha * point.x + (1 - this.alpha) * old.x,
        y: this.alpha * point.y + (1 - this.alpha) * old.y,
        z: point.z !== undefined && old.z !== undefined
          ? this.alpha * point.z + (1 - this.alpha) * old.z : point.z,
      };
    });
    return this.landmarks.map(point => ({ ...point }));
  }

  reset(): void {
    this.value = undefined;
    this.landmarks = undefined;
  }
}
