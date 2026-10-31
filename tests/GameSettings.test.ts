import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_GAME_SETTINGS, getGameSettings, resetGameSettings, saveGameSettings, SETTINGS_STORAGE_KEY, validateGameSettings } from '../src/game/settings/gameSettings';

test('manual defaults allow a shallow bend and form valid separated thresholds', () => {
  assert.equal(validateGameSettings(DEFAULT_GAME_SETTINGS), true);
  assert.equal(DEFAULT_GAME_SETTINGS.bendingAngle, 150);
  assert.equal(DEFAULT_GAME_SETTINGS.standingAngle, 160);
});

test('settings reject nonfinite, missing, excessive and overlapping thresholds', () => {
  for (const change of [
    { standingAngle: NaN }, { bendingAngle: Infinity }, { smoothingAlpha: 0 },
    { mocapGain: 10 }, { rabbitScale: -1 }, { bendHoldMs: 0 },
    { standingAngle: 150, bendingAngle: 150 }, { standingAngle: 150, bendingAngle: 148 },
  ]) assert.equal(validateGameSettings({ ...DEFAULT_GAME_SETTINGS, ...change }), false);
  assert.equal(validateGameSettings({}), false);
  assert.equal(validateGameSettings(null), false);
  assert.equal(validateGameSettings({ ...DEFAULT_GAME_SETTINGS, standingAngle: 153, bendingAngle: 150 }), true);
});

test('persist only supported numeric parameters, recover invalid storage, reset defaults', () => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  try {
    assert.deepEqual(getGameSettings(), DEFAULT_GAME_SETTINGS);
    const settings = { ...DEFAULT_GAME_SETTINGS, bendingAngle: 155, rawPose: ['never store'] };
    saveGameSettings(settings);
    assert.equal(getGameSettings().bendingAngle, 155);
    assert.equal(values.get(SETTINGS_STORAGE_KEY)?.includes('rawPose'), false);
    assert.throws(() => saveGameSettings({ ...settings, standingAngle: 155 }));
    values.set(SETTINGS_STORAGE_KEY, '{broken');
    assert.deepEqual(getGameSettings(), DEFAULT_GAME_SETTINGS);
    values.set(SETTINGS_STORAGE_KEY, JSON.stringify({ ...DEFAULT_GAME_SETTINGS, standingAngle: 140 }));
    assert.deepEqual(getGameSettings(), DEFAULT_GAME_SETTINGS);
    assert.deepEqual(resetGameSettings(), DEFAULT_GAME_SETTINGS);
    assert.equal(values.has(SETTINGS_STORAGE_KEY), false);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('unavailable browser storage safely returns defaults', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  try { assert.deepEqual(getGameSettings(), DEFAULT_GAME_SETTINGS); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
