export class ScoreManager {
  private count = 0;

  constructor(readonly target = 5) {}

  get score(): number {
    return this.count;
  }

  get complete(): boolean {
    return this.count >= this.target;
  }

  addSuccess(): void {
    this.count = Math.min(this.target, this.count + 1);
  }

  reset(): void {
    this.count = 0;
  }
}
