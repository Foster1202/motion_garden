import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyboardMotionInput } from '../src/game/input/KeyboardMotionInput';

function key(target: EventTarget, type: 'keydown' | 'keyup', code: string, repeat = false): void {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { code: { value: code }, repeat: { value: repeat } });
  target.dispatchEvent(event);
}

function setup(): { target: EventTarget; input: KeyboardMotionInput } {
  const target = new EventTarget();
  return { target, input: new KeyboardMotionInput(target as unknown as Window) };
}

test('samples Arrow keys and W/S and releases each independently', () => {
  const { target, input } = setup();
  key(target, 'keydown', 'ArrowDown');
  key(target, 'keydown', 'KeyS');
  key(target, 'keyup', 'ArrowDown');
  assert.deepEqual(input.sample(), { bending: true, standing: false });
  key(target, 'keyup', 'KeyS');
  key(target, 'keydown', 'KeyW');
  assert.deepEqual(input.sample(), { bending: false, standing: true });
  key(target, 'keyup', 'KeyW');
  key(target, 'keydown', 'ArrowUp');
  assert.equal(input.sample().standing, true);
  input.destroy();
});

test('reset and focus loss need a fresh press instead of a repeat', () => {
  const { target, input } = setup();
  key(target, 'keydown', 'ArrowDown');
  input.reset();
  key(target, 'keydown', 'ArrowDown', true);
  assert.equal(input.sample().bending, false);
  key(target, 'keyup', 'ArrowDown');
  key(target, 'keydown', 'ArrowDown');
  assert.equal(input.sample().bending, true);
  target.dispatchEvent(new Event('blur'));
  key(target, 'keydown', 'ArrowDown', true);
  assert.equal(input.sample().bending, false);
  input.destroy();
});

test('destroy removes listeners and clears motion', () => {
  const { target, input } = setup();
  key(target, 'keydown', 'ArrowDown');
  input.destroy();
  key(target, 'keydown', 'ArrowUp');
  assert.deepEqual(input.sample(), { bending: false, standing: false });
});
