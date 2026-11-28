export type HomeFoot = 'left' | 'right';
export type HomeLane = -1 | 0 | 1;

export const HOME_END = 120;
export const HOME_STEP_GAP_MS = 200;
export const HOME_LANTERNS = [8, 18, 29, 39] as const;
export const HOME_STAGES = [
  { start: 0, name: '森林小徑' },
  { start: 40, name: '小溪與木橋' },
  { start: 82, name: '星光歸途' },
] as const;

export interface HomeGate {
  at: number;
  lane: -1 | 1;
}

export const HOME_GATES: readonly HomeGate[] = [{ at: 53, lane: -1 }, { at: 71, lane: 1 }];

export interface HomeStep {
  lantern: boolean;
  crossing: boolean;
  newStage: boolean;
  arrived: boolean;
}

export class RabbitHomeRound {
  private progress = 0;
  private path: HomeLane = 0;
  private lightCount = 0;
  private acceptedFoot: HomeFoot | null = null;
  private acceptedAt = -Infinity;
  private acceptedInputAt = -Infinity;
  private elapsed = 0;
  private waitingAtGate = false;

  get distance() { return this.progress; }
  get lane() { return this.path; }
  get lanterns() { return this.lightCount; }
  get lastFoot() { return this.acceptedFoot; }
  get timeMs() { return this.elapsed; }
  get sinceStepMs() { return this.elapsed - this.acceptedAt; }
  get arrived() { return this.progress === HOME_END; }
  get blocked() { return this.waitingAtGate; }
  get stageIndex() { return this.progress >= HOME_STAGES[2].start ? 2 : this.progress >= HOME_STAGES[1].start ? 1 : 0; }
  get nextGate() { return HOME_GATES.find(gate => gate.at > this.progress) ?? null; }

  advanceTime(deltaMs: number): void {
    if (Number.isFinite(deltaMs) && deltaMs > 0) this.elapsed += deltaMs;
  }

  selectLane(lane: HomeLane): void {
    if (this.arrived) return;
    this.path = lane;
    if (lane === this.nextGate?.lane) this.waitingAtGate = false;
  }

  takeStep(foot: HomeFoot, inputTimeMs = this.elapsed): HomeStep | null {
    if (this.arrived || this.acceptedFoot === foot || !Number.isFinite(inputTimeMs)
      || inputTimeMs - this.acceptedInputAt < HOME_STEP_GAP_MS) return null;
    const nextDistance = this.progress + 1;
    const gate = this.nextGate;
    const crossing = nextDistance === gate?.at;
    if (crossing && this.path !== gate.lane) {
      this.waitingAtGate = true;
      return null;
    }
    const oldStage = this.stageIndex;
    this.progress = nextDistance;
    this.acceptedFoot = foot;
    this.acceptedAt = this.elapsed;
    this.acceptedInputAt = inputTimeMs;
    const lantern = HOME_LANTERNS.some(at => at === this.progress);
    if (lantern) this.lightCount++;
    return { lantern, crossing, newStage: this.stageIndex !== oldStage, arrived: this.arrived };
  }
}
