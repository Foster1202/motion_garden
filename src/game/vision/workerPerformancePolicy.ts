import type { PoseDelegate } from './poseLandmarker';
export type { PoseDelegate } from './poseLandmarker';
export type PoseDelegatePreference = 'auto' | PoseDelegate;

const SLOW_RESULT_MS = 120;
const COMPARISON_FRAMES = 5;

function median(samples: readonly number[]): number {
  return [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
}

export class WorkerPerformancePolicy {
  private firstResult = true;
  private sawLandmarks = false;
  private evidence: { ageMs: number; hasLandmarks: boolean }[] = [];
  private cpuBaseline?: { medianMs: number; landmarks: number };
  private finished: boolean;

  constructor(preference: PoseDelegatePreference) {
    this.finished = preference !== 'auto';
  }

  finish(): void { this.finished = true; }

  observe(delegate: PoseDelegate, ageMs: number, hasLandmarks: boolean): PoseDelegate | undefined {
    if (this.finished) return;
    const warmingUp = this.firstResult || (hasLandmarks && !this.sawLandmarks);
    this.firstResult = false;
    this.sawLandmarks ||= hasLandmarks;
    if (warmingUp) return;

    this.evidence.push({ ageMs, hasLandmarks });
    if (delegate === 'CPU') {
      if (this.evidence.length > 7) this.evidence.shift();
      if (this.evidence.filter(sample => sample.ageMs >= SLOW_RESULT_MS).length < COMPARISON_FRAMES) return;
    } else if (this.evidence.length < COMPARISON_FRAMES) return;
    const medianMs = median(this.evidence.map(sample => sample.ageMs));
    const landmarks = this.evidence.filter(sample => sample.hasLandmarks).length;
    this.evidence = [];
    if (delegate === 'CPU') {
      this.cpuBaseline = { medianMs, landmarks };
      this.firstResult = true;
      this.sawLandmarks = false;
      return 'GPU';
    }

    this.finish();
    const baseline = this.cpuBaseline;
    if (!baseline) return;
    return medianMs > baseline.medianMs * .85 || (baseline.landmarks >= 3 && landmarks === 0)
      ? 'CPU' : undefined;
  }
}
