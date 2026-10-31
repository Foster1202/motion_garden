import { BERRY_CONFIG as C, footInTrunk, type BerrySide, type FootPoint, type TreeTrunkHitZone } from './berryConfig';
export type BerryState = 'READY' | 'MOVING' | 'LEG_EXTENDING' | 'TREE_HIT' | 'BERRIES_FALLING' | 'RECOVERY' | 'COMPLETE';
export interface BerryRoundInput {
  left: number; right: number; feet: Record<BerrySide, FootPoint>; reliable: boolean; rootX: number;
}
export class BerryKickRound {
  readonly counts = { left: 0, right: 0 };
  private readonly armed = { left: false, right: false };
  private readonly nextHit = { left: 0, right: 0 };
  private clock = 0;
  private lastHitAt = -Infinity;
  state: BerryState = 'READY';
  paused = false;
  constructor(readonly zones: Record<BerrySide, TreeTrunkHitZone>) {}
  get score() { return this.counts.left + this.counts.right; }
  get complete() { return this.score === C.targetPerSide * 2; }
  update(deltaMs: number, input: BerryRoundInput): BerrySide | undefined {
    if (this.paused || this.complete) return undefined;
    if (![deltaMs, input.left, input.right, input.rootX].every(Number.isFinite)
      || input.left < 0 || input.left > 1 || input.right < 0 || input.right > 1) {
      this.armed.left = this.armed.right = false; return undefined;
    }
    this.clock += Math.max(0, Math.min(deltaMs, 100));
    if (!input.reliable) { this.armed.left = this.armed.right = false; return undefined; }
    for (const side of ['left', 'right'] as const) {
      if (input[side] <= C.retractThreshold) this.armed[side] = true;
      const correctPosition = side === 'left' ? input.rootX < 720 : input.rootX > 880;
      if (this.armed[side] && this.counts[side] < C.targetPerSide && input[side] >= C.extensionThreshold
        && this.clock >= this.nextHit[side] && correctPosition && footInTrunk(input.feet[side], this.zones[side])) {
        this.counts[side]++; this.armed[side] = false; this.nextHit[side] = this.clock + C.cooldownMs;
        this.lastHitAt = this.clock; this.state = this.complete ? 'COMPLETE' : 'TREE_HIT'; return side;
      }
    }
    const elapsed = this.clock - this.lastHitAt;
    this.state = elapsed < 900 ? 'BERRIES_FALLING' : elapsed < 1100 ? 'RECOVERY'
      : Math.max(input.left, input.right) > C.retractThreshold ? 'LEG_EXTENDING'
        : Math.abs(input.rootX - 800) > 30 ? 'MOVING' : 'READY';
    return undefined;
  }
  snapshot() { return { score: this.score, counts: { ...this.counts }, state: this.state, paused: this.paused,
    armed: { ...this.armed }, clock: this.clock }; }
}
