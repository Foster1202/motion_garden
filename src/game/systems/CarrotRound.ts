import { getGameSettings } from '../settings/gameSettings';
import type { MotionSample } from '../input/MotionInput';
import { ScoreManager } from './ScoreManager';

export type RoundState =
  | 'READY'
  | 'BENDING'
  | 'GRABBED'
  | 'RETURNING'
  | 'SUCCESS'
  | 'NEXT_ROUND'
  | 'COMPLETE';

export const ROUND_TIMINGS = {
  get bendMs() { return getGameSettings().bendHoldMs; },
  get returnMs() { return getGameSettings().standHoldMs; },
} as const;

export class CarrotRound {
  state: RoundState = 'READY';
  progress = 0;
  readonly target = 5;
  private elapsedMs = 0;
  private readonly scores = new ScoreManager(this.target);

  get score(): number {
    return this.scores.score;
  }

  update(deltaMs: number, input: MotionSample): void {
    const elapsed = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;

    if (this.state === 'COMPLETE') return;

    if (this.state === 'SUCCESS') return;

    if (this.state === 'NEXT_ROUND') {
      this.enter('READY');
      return;
    }

    const bending = input.bending && !input.standing;
    const standing = input.standing && !input.bending;

    if (this.state === 'READY') {
      if (!bending) return;
      this.enter('BENDING');
    }

    if (this.state === 'BENDING') {
      if (!bending) {
        this.enter('READY');
        return;
      }
      this.elapsedMs += elapsed;
      this.progress = Math.min(1, this.elapsedMs / ROUND_TIMINGS.bendMs);
      if (this.progress >= 1) this.enter('GRABBED');
      return;
    }

    if (this.state === 'GRABBED') {
      if (!standing) return;
      this.enter('RETURNING');
    }

    if (this.state === 'RETURNING') {
      if (!standing) {
        this.enter('GRABBED');
        return;
      }
      this.elapsedMs += elapsed;
      this.progress = Math.min(1, this.elapsedMs / ROUND_TIMINGS.returnMs);
      if (this.progress >= 1) {
        this.enter('SUCCESS');
      }
    }
  }

  completeCelebration(): boolean {
    if (this.state !== 'SUCCESS') return false;
    this.scores.addSuccess();
    this.enter(this.scores.complete ? 'COMPLETE' : 'NEXT_ROUND');
    return true;
  }

  reset(): void {
    this.scores.reset();
    this.enter('READY');
  }

  private enter(state: RoundState): void {
    this.state = state;
    this.elapsedMs = 0;
    this.progress = state === 'GRABBED' || state === 'SUCCESS' || state === 'COMPLETE' ? 1 : 0;
  }
}
