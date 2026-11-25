import { APPLE_CONFIG as C, isInAppleZone, type AppleSide, type AppleZone } from './appleConfig';

export type { AppleSide } from './appleConfig';

const HANDS = ['left', 'right'] as const;
type GestureStage = 'NEUTRAL' | 'READY' | 'RAISED';

export type AppleHarvestState = 'TARGET_TREE' | 'MOVE_TO_TREE' | 'PICKING' | 'CARRYING'
  | 'RETURN_TO_BASKET' | 'DEPOSITING' | 'SCORE' | 'COMPLETE';

export interface AppleHarvestRoundInput {
  x: number;
  lateralReliable: boolean;
  left: number | null;
  right: number | null;
  timestampMs?: number;
}

export interface CarriedApple {
  tree: AppleSide;
  hand: AppleSide;
}

export type AppleHarvestEvent = CarriedApple & {
  kind: 'picked' | 'wrong-tree' | 'depositing' | 'deposited';
};

class HandGesture {
  stage: GestureStage = 'NEUTRAL';
  private since?: number;

  reset(): void {
    this.stage = 'NEUTRAL';
    this.since = undefined;
  }

  update(amount: number, timestamp: number): boolean {
    const waitingForRaise = this.stage === 'READY';
    const isExpected = waitingForRaise ? amount >= C.raiseThreshold : amount <= C.lowerThreshold;
    if (!isExpected) {
      this.since = undefined;
      return false;
    }
    this.since ??= timestamp;
    const dwellMs = waitingForRaise ? C.raiseDwellMs : C.gestureDwellMs;
    if (timestamp - this.since < dwellMs) return false;

    this.since = undefined;
    switch (this.stage) {
      case 'NEUTRAL': this.stage = 'READY'; return false;
      case 'READY': this.stage = 'RAISED'; return false;
      case 'RAISED': this.reset(); return true;
    }
  }
}

export class AppleHarvestRound {
  readonly durationMs: number;
  private clock = 0;
  private points = 0;
  private isPaused = false;
  private currentState: AppleHarvestState = 'TARGET_TREE';
  private currentTarget: AppleSide;
  private targetStreak = 1;
  private heldApple?: CarriedApple;
  private depositAt?: number;
  private activeZone?: AppleZone;
  private lastObservation?: number;
  private readonly gestures = { left: new HandGesture(), right: new HandGesture() };

  constructor(durationSeconds: number = C.defaultDurationSeconds, private readonly random = Math.random) {
    const duration = C.durationOptions.some(value => value === durationSeconds)
      ? durationSeconds : C.defaultDurationSeconds;
    this.durationMs = duration * 1000;
    this.currentTarget = this.drawTarget();
  }

  get elapsedMs() { return this.clock; }
  get remainingMs() { return this.durationMs - this.clock; }
  get complete() { return this.remainingMs === 0; }
  get state() { return this.currentState; }
  get target() { return this.currentTarget; }
  get score() { return this.points; }
  get carrying(): Readonly<CarriedApple> | undefined { return this.heldApple; }
  get depositing() { return this.depositAt !== undefined; }
  get depositProgress() {
    return this.depositAt === undefined ? 0 : 1 - (this.depositAt - this.clock) / C.depositMs;
  }

  get paused() { return this.isPaused; }
  set paused(value: boolean) {
    if (this.complete || this.isPaused === value) return;
    this.isPaused = value;
    this.resetGestures();
  }

  update(deltaMs: number, input: AppleHarvestRoundInput): AppleHarvestEvent | undefined {
    if (this.paused || this.complete) return;
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      this.resetGestures();
      return;
    }
    if (deltaMs === 0) return;

    this.clock = Math.min(this.durationMs, this.clock + deltaMs);
    if (this.depositAt !== undefined && this.depositAt <= this.clock && this.depositAt < this.durationMs && this.heldApple) {
      return this.completeDeposit(this.heldApple);
    }
    if (this.complete) {
      this.currentState = 'COMPLETE';
      this.depositAt = undefined;
      this.heldApple = undefined;
      this.resetGestures();
      return;
    }
    if (this.depositing) return;

    const zone = input.lateralReliable && Number.isFinite(input.x) ? this.zoneAt(input.x) : undefined;
    if (zone !== this.activeZone) {
      this.resetGestures();
      this.activeZone = zone;
    }
    if (!zone) {
      this.currentState = this.heldApple ? 'RETURN_TO_BASKET' : 'MOVE_TO_TREE';
      return;
    }

    const timestamp = input.timestampMs ?? this.clock;
    const last = this.lastObservation;
    if (!Number.isFinite(timestamp) || timestamp < 0 || (last !== undefined && timestamp < last)) {
      this.resetGestures();
      return;
    }
    if (last !== undefined && timestamp - last >= C.maximumFrameGapMs) this.resetGestures();
    this.lastObservation = timestamp;
    for (const hand of HANDS) {
      const amount = input[hand];
      if (amount === null || !Number.isFinite(amount) || amount < 0 || amount > 1) {
        this.gestures[hand].reset();
        continue;
      }
      if (timestamp !== last && this.gestures[hand].update(amount, timestamp)) return this.completeGesture(zone, hand);
    }
    const raised = HANDS.some(hand => this.gestures[hand].stage === 'RAISED');
    this.currentState = zone === 'basket' ? (raised ? 'DEPOSITING' : 'RETURN_TO_BASKET')
      : (raised ? 'PICKING' : 'MOVE_TO_TREE');
  }

  snapshot() {
    return {
      state: this.state, target: this.target, score: this.score, carrying: this.carrying ?? null,
      depositing: this.depositing, depositProgress: this.depositProgress, paused: this.paused, complete: this.complete,
      durationMs: this.durationMs, elapsedMs: this.elapsedMs, remainingMs: this.remainingMs, zone: this.activeZone ?? null,
      gestures: { left: this.gestures.left.stage, right: this.gestures.right.stage },
    };
  }

  private zoneAt(x: number): AppleZone | undefined {
    if (this.heldApple) return isInAppleZone(x, 'basket') ? 'basket' : undefined;
    return HANDS.find(side => isInAppleZone(x, side));
  }

  private completeGesture(zone: AppleZone, hand: AppleSide): AppleHarvestEvent | undefined {
    this.resetGestures();
    if (zone === 'basket') {
      if (!this.heldApple) return;
      this.depositAt = this.clock + C.depositMs;
      this.currentState = 'DEPOSITING';
      return { kind: 'depositing', ...this.heldApple };
    }
    if (zone !== this.target) {
      this.currentState = 'MOVE_TO_TREE';
      return { kind: 'wrong-tree', tree: zone, hand };
    }
    this.heldApple = { tree: zone, hand };
    this.currentState = 'CARRYING';
    return { kind: 'picked', ...this.heldApple };
  }

  private completeDeposit(apple: CarriedApple): AppleHarvestEvent {
    this.points++;
    this.depositAt = undefined;
    this.heldApple = undefined;
    const next = this.targetStreak >= C.maxTargetStreak
      ? (this.target === 'left' ? 'right' : 'left') : this.drawTarget();
    this.targetStreak = next === this.target ? this.targetStreak + 1 : 1;
    this.currentTarget = next;
    this.currentState = this.complete ? 'COMPLETE' : 'SCORE';
    return { kind: 'deposited', ...apple };
  }

  private resetGestures(): void {
    for (const hand of HANDS) this.gestures[hand].reset();
    this.lastObservation = undefined;
  }

  private drawTarget(): AppleSide {
    return this.random() < .5 ? 'left' : 'right';
  }
}
