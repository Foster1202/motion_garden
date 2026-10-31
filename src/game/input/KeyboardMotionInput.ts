import type { MotionInput, MotionSample } from './MotionInput';

const MOTION_KEYS = new Set(['ArrowDown', 'KeyS', 'ArrowUp', 'KeyW']);

export class KeyboardMotionInput implements MotionInput {
  private readonly heldKeys = new Set<string>();
  private readonly target: Window;

  constructor(target?: Window) {
    this.target = target ?? window;
    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
    this.target.addEventListener('blur', this.onBlur);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!MOTION_KEYS.has(event.code)) return;
    event.preventDefault();
    // Ignoring repeats also prevents a held key from restarting after reset.
    if (!event.repeat) this.heldKeys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.heldKeys.delete(event.code);
  };

  private readonly onBlur = (): void => this.reset();

  sample(): MotionSample {
    return {
      bending: this.heldKeys.has('ArrowDown') || this.heldKeys.has('KeyS'),
      standing: this.heldKeys.has('ArrowUp') || this.heldKeys.has('KeyW'),
    };
  }

  reset(): void {
    this.heldKeys.clear();
  }

  destroy(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.reset();
  }
}
