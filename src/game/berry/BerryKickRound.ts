import { BERRY_CONFIG as C, footInTrunk, type BerrySide, type FootPoint, type TreeTrunkHitZone } from './berryConfig';
export type BerryState = 'READY' | 'MOVING' | 'LEG_EXTENDING' | 'TREE_HIT' | 'BERRIES_FALLING' | 'RECOVERY' | 'COMPLETE';
export interface BerryRoundInput {
  left: number; right: number; feet: Record<BerrySide, FootPoint>; reliable: boolean; rootX: number;
}
export interface BerryContact {
  kind: 'harvest' | 'wrong-tree';
  side: BerrySide;
}
export class BerryKickRound {
  readonly counts = { left: 0, right: 0 };
  private readonly armed = { left: false, right: false };
  private readonly nextHit = { left: 0, right: 0 };
  private clock = 0;
  private lastHitAt = -Infinity;
  private isPaused = false;
  private currentTarget: BerrySide;
  private targetStreak = 1;
  readonly durationMs: number;
  state: BerryState = 'READY';
  constructor(readonly zones: Record<BerrySide, TreeTrunkHitZone>, durationSeconds: number = C.defaultDurationSeconds,
    private readonly random: () => number = Math.random) {
    const duration = C.durationOptions.some(option => option === durationSeconds) ? durationSeconds : C.defaultDurationSeconds;
    this.durationMs = duration * 1000;
    this.currentTarget = this.random() < .5 ? 'left' : 'right';
  }
  get target() { return this.currentTarget; }
  get score() { return (this.counts.left + this.counts.right) * C.berriesPerHit; }
  get elapsedMs() { return this.clock; }
  get remainingMs() { return this.durationMs - this.clock; }
  get complete() { return this.remainingMs === 0; }
  get paused() { return this.isPaused; }
  set paused(value: boolean) {
    if (this.complete || this.isPaused === value) return;
    this.isPaused = value;
    this.armed.left = this.armed.right = false;
  }
  update(deltaMs: number, input: BerryRoundInput): BerryContact | undefined {
    if (this.paused || this.complete) return undefined;
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
      this.armed.left = this.armed.right = false; return undefined;
    }
    this.clock = Math.min(this.durationMs, this.clock + deltaMs);
    if (this.complete) {
      this.state = 'COMPLETE';
      this.armed.left = this.armed.right = false;
      return undefined;
    }
    if (![input.left, input.right, input.rootX].every(Number.isFinite)
      || input.left < 0 || input.left > 1 || input.right < 0 || input.right > 1) {
      this.armed.left = this.armed.right = false; return undefined;
    }
    if (!input.reliable) { this.armed.left = this.armed.right = false; return undefined; }
    for (const side of ['left', 'right'] as const) {
      if (input[side] <= C.retractThreshold) this.armed[side] = true;
      const correctPosition = side === 'left' ? input.rootX < 720 : input.rootX > 880;
      if (this.armed[side] && input[side] >= C.extensionThreshold
        && this.clock >= this.nextHit[side] && correctPosition && footInTrunk(input.feet[side], this.zones[side])) {
        this.armed[side] = false; this.nextHit[side] = this.clock + C.cooldownMs;
        if (side !== this.target) {
          this.state = 'RECOVERY';
          return { kind: 'wrong-tree', side };
        }
        this.counts[side]++;
        this.lastHitAt = this.clock; this.state = 'TREE_HIT';
        this.advanceTarget();
        return { kind: 'harvest', side };
      }
    }
    const elapsed = this.clock - this.lastHitAt;
    this.state = elapsed < 900 ? 'BERRIES_FALLING' : elapsed < 1100 ? 'RECOVERY'
      : Math.max(input.left, input.right) > C.retractThreshold ? 'LEG_EXTENDING'
        : Math.abs(input.rootX - 800) > 30 ? 'MOVING' : 'READY';
    return undefined;
  }
  private advanceTarget() {
    let next: BerrySide;
    if (this.targetStreak >= C.maxTargetStreak) next = this.target === 'left' ? 'right' : 'left';
    else next = this.random() < .5 ? 'left' : 'right';
    this.targetStreak = next === this.target ? this.targetStreak + 1 : 1;
    this.currentTarget = next;
  }
  snapshot() { return { score: this.score, counts: { ...this.counts }, state: this.state, paused: this.paused,
    armed: { ...this.armed }, clock: this.clock, durationMs: this.durationMs, elapsedMs: this.elapsedMs,
    remainingMs: this.remainingMs, complete: this.complete, target: this.target }; }
}
