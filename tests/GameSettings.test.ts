import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_GAME_SETTINGS, GAME_SETTINGS_CHANGED_EVENT, getGameSettings, resetGameSettings, saveGameSettings, SETTINGS_STORAGE_KEY, validateGameSettings, type GameSettings } from '../src/game/settings/gameSettings';

test('manual defaults allow a shallow bend and form valid separated thresholds', () => {
  assert.equal(validateGameSettings(DEFAULT_GAME_SETTINGS), true);
  assert.equal(DEFAULT_GAME_SETTINGS.bendingAngle, 150);
  assert.equal(DEFAULT_GAME_SETTINGS.standingAngle, 160);
  assert.equal(DEFAULT_GAME_SETTINGS.showBodyKeypoints, false);
  assert.equal(DEFAULT_GAME_SETTINGS.backgroundProcessing, false);
  assert.equal(DEFAULT_GAME_SETTINGS.backgroundMode, 'blur');
  assert.equal(DEFAULT_GAME_SETTINGS.berryDurationSeconds, 120);
  assert.equal(DEFAULT_GAME_SETTINGS.appleDurationSeconds, 120);
  assert.equal(DEFAULT_GAME_SETTINGS.sfxEnabled, true);
  assert.equal(DEFAULT_GAME_SETTINGS.sfxVolume, 0.6);
  assert.equal(DEFAULT_GAME_SETTINGS.voiceEnabled, true);
  assert.equal(DEFAULT_GAME_SETTINGS.voiceVolume, 0.8);
});

test('settings reject nonfinite, missing, excessive and overlapping thresholds', () => {
  for (const change of [
    { standingAngle: NaN }, { bendingAngle: Infinity }, { smoothingAlpha: 0 },
    { mocapGain: 10 }, { rabbitScale: -1 }, { bendHoldMs: 0 },
    { standingAngle: 150, bendingAngle: 150 }, { standingAngle: 150, bendingAngle: 148 },
    { showBodyKeypoints: 'true' }, { backgroundProcessing: 1 }, { backgroundMode: 'transparent' },
    { showBodyKeypoints: undefined }, { backgroundProcessing: null }, { backgroundMode: undefined },
    { berryDurationSeconds: 30 }, { berryDurationSeconds: 61 }, { berryDurationSeconds: 0 },
    { berryDurationSeconds: 121 }, { berryDurationSeconds: '60' }, { berryDurationSeconds: NaN },
    { berryDurationSeconds: Infinity }, { berryDurationSeconds: undefined }, { berryDurationSeconds: null },
    { appleDurationSeconds: 60 }, { appleDurationSeconds: 150 }, { appleDurationSeconds: '180' },
    { appleDurationSeconds: NaN }, { appleDurationSeconds: undefined }, { appleDurationSeconds: null },
    { sfxEnabled: 'true' }, { sfxEnabled: 0 }, { sfxEnabled: null }, { sfxEnabled: undefined },
    { sfxVolume: -0.01 }, { sfxVolume: 1.01 }, { sfxVolume: '0.6' }, { sfxVolume: null },
    { sfxVolume: NaN }, { sfxVolume: Infinity }, { sfxVolume: undefined },
    { voiceEnabled: 'true' }, { voiceEnabled: 0 }, { voiceEnabled: null }, { voiceEnabled: undefined },
    { voiceVolume: -0.01 }, { voiceVolume: 1.01 }, { voiceVolume: '0.8' }, { voiceVolume: null },
    { voiceVolume: NaN }, { voiceVolume: Infinity }, { voiceVolume: undefined },
  ]) assert.equal(validateGameSettings({ ...DEFAULT_GAME_SETTINGS, ...change }), false);
  assert.equal(validateGameSettings({}), false);
  assert.equal(validateGameSettings(null), false);
  assert.equal(validateGameSettings({ ...DEFAULT_GAME_SETTINGS, standingAngle: 153, bendingAngle: 150 }), true);
});

test('persist only supported settings, recover invalid storage, reset defaults', () => {
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

test('legacy numeric settings retain values and add preview, duration and audio defaults', () => {
  const { showBodyKeypoints, backgroundProcessing, backgroundMode, berryDurationSeconds, sfxEnabled, sfxVolume, voiceEnabled, voiceVolume, ...legacy } = DEFAULT_GAME_SETTINGS;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => JSON.stringify({ ...legacy, bendingAngle: 155, mocapGain: 1.25, rawPose: [1, 2, 3] }),
  } });
  try {
    assert.deepEqual(getGameSettings(), { ...DEFAULT_GAME_SETTINGS, bendingAngle: 155, mocapGain: 1.25 });
    assert.equal(showBodyKeypoints, false);
    assert.equal(backgroundProcessing, false);
    assert.equal(backgroundMode, 'blur');
    assert.equal(berryDurationSeconds, 120);
    assert.equal(sfxEnabled, true);
    assert.equal(sfxVolume, 0.6);
    assert.equal(voiceEnabled, true);
    assert.equal(voiceVolume, 0.8);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('legacy preview settings retain values when Berry duration is added', () => {
  const { berryDurationSeconds, ...legacy } = DEFAULT_GAME_SETTINGS;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => JSON.stringify({ ...legacy, rabbitScale: 1.25, showBodyKeypoints: true, backgroundMode: 'gray' }),
  } });
  try {
    assert.deepEqual(getGameSettings(), { ...DEFAULT_GAME_SETTINGS, rabbitScale: 1.25,
      showBodyKeypoints: true, backgroundMode: 'gray' });
    assert.equal(berryDurationSeconds, 120);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('Berry duration choices persist, reject unsupported storage and reset to 120', () => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  try {
    for (const berryDurationSeconds of [60, 90, 120] as const) {
      const settings = { ...DEFAULT_GAME_SETTINGS, berryDurationSeconds, bendingAngle: 155 };
      assert.equal(validateGameSettings(settings), true);
      saveGameSettings(settings);
      assert.deepEqual(getGameSettings(), settings);
    }
    for (const berryDurationSeconds of [0, 30, 60.5, 61, 119, 121, '60', null]) {
      values.set(SETTINGS_STORAGE_KEY, JSON.stringify({ ...DEFAULT_GAME_SETTINGS, berryDurationSeconds }));
      assert.deepEqual(getGameSettings(), DEFAULT_GAME_SETTINGS);
      assert.throws(() => saveGameSettings({ ...DEFAULT_GAME_SETTINGS, berryDurationSeconds } as GameSettings));
    }
    saveGameSettings({ ...DEFAULT_GAME_SETTINGS, berryDurationSeconds: 60 });
    assert.equal(resetGameSettings().berryDurationSeconds, 120);
    assert.equal(values.has(SETTINGS_STORAGE_KEY), false);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('Apple duration migrates independently, persists all choices and resets to 120', () => {
  let stored: string | null = null;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; },
    removeItem: () => { stored = null; },
  } });
  try {
    stored = JSON.stringify({ ...DEFAULT_GAME_SETTINGS, appleDurationSeconds: undefined, berryDurationSeconds: 60 });
    assert.equal(getGameSettings().appleDurationSeconds, 120);
    assert.equal(getGameSettings().berryDurationSeconds, 60);
    for (const appleDurationSeconds of [90, 120, 180] as const) {
      saveGameSettings({ ...getGameSettings(), appleDurationSeconds });
      assert.equal(getGameSettings().appleDurationSeconds, appleDurationSeconds);
      assert.equal(getGameSettings().berryDurationSeconds, 60);
    }
    assert.equal(resetGameSettings().appleDurationSeconds, 120);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('all independent preview combinations and both background modes persist', () => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  try {
    for (const showBodyKeypoints of [false, true]) {
      for (const backgroundProcessing of [false, true]) {
        for (const backgroundMode of ['blur', 'gray'] as const) {
          const settings = { ...DEFAULT_GAME_SETTINGS, showBodyKeypoints, backgroundProcessing, backgroundMode };
          saveGameSettings(settings);
          assert.deepEqual(getGameSettings(), settings);
        }
      }
    }
    for (const invalid of [{ showBodyKeypoints: 'true' }, { backgroundProcessing: 1 }, { backgroundMode: 'green' }]) {
      values.set(SETTINGS_STORAGE_KEY, JSON.stringify({ ...DEFAULT_GAME_SETTINGS, ...invalid }));
      assert.deepEqual(getGameSettings(), DEFAULT_GAME_SETTINGS);
    }
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

test('legacy settings add audio defaults while preserving existing duration and preview choices', () => {
  const { sfxEnabled, sfxVolume, ...legacy } = DEFAULT_GAME_SETTINGS;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => JSON.stringify({ ...legacy, berryDurationSeconds: 60, bendingAngle: 155,
      showBodyKeypoints: true, backgroundProcessing: true, backgroundMode: 'gray' }),
  } });
  try {
    assert.deepEqual(getGameSettings(), { ...DEFAULT_GAME_SETTINGS, berryDurationSeconds: 60,
      bendingAngle: 155, showBodyKeypoints: true, backgroundProcessing: true, backgroundMode: 'gray' });
    assert.equal(sfxEnabled, true);
    assert.equal(sfxVolume, 0.6);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('SFX switch and full volume range persist with strict stored validation and reset', () => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  try {
    for (const sfxEnabled of [false, true]) {
      for (const sfxVolume of [0, 0.05, 0.35, 0.6, 1]) {
        const settings = { ...DEFAULT_GAME_SETTINGS, sfxEnabled, sfxVolume, bendingAngle: 155 };
        assert.equal(validateGameSettings(settings), true);
        saveGameSettings(settings);
        assert.deepEqual(getGameSettings(), settings);
      }
    }
    for (const invalid of [{ sfxEnabled: 'false' }, { sfxVolume: -1 }, { sfxVolume: 2 },
      { sfxVolume: '0.6' }, { sfxVolume: null }]) {
      values.set(SETTINGS_STORAGE_KEY, JSON.stringify({ ...DEFAULT_GAME_SETTINGS, ...invalid }));
      assert.deepEqual(getGameSettings(), DEFAULT_GAME_SETTINGS);
      assert.throws(() => saveGameSettings({ ...DEFAULT_GAME_SETTINGS, ...invalid } as GameSettings));
    }
    saveGameSettings({ ...DEFAULT_GAME_SETTINGS, sfxEnabled: false, sfxVolume: 0 });
    assert.deepEqual(resetGameSettings(), DEFAULT_GAME_SETTINGS);
    assert.equal(values.has(SETTINGS_STORAGE_KEY), false);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('settings dispatch one update after successful persistence and reset', () => {
  const values = new Map<string, string>();
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const browserEvents = new EventTarget();
  let notifications = 0;
  browserEvents.addEventListener(GAME_SETTINGS_CHANGED_EVENT, () => { notifications++; });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browserEvents });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  try {
    saveGameSettings({ ...DEFAULT_GAME_SETTINGS, sfxEnabled: false });
    assert.equal(notifications, 1);
    assert.equal(getGameSettings().sfxEnabled, false);
    assert.throws(() => saveGameSettings({ ...DEFAULT_GAME_SETTINGS, sfxVolume: 2 }));
    assert.equal(notifications, 1);
    resetGameSettings();
    assert.equal(notifications, 2);
    assert.deepEqual(getGameSettings(), DEFAULT_GAME_SETTINGS);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      setItem() { throw new Error('storage blocked'); },
      removeItem() { throw new Error('storage blocked'); },
    } });
    assert.throws(() => saveGameSettings({ ...DEFAULT_GAME_SETTINGS }));
    assert.throws(() => resetGameSettings());
    assert.equal(notifications, 2);
  } finally {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});


test('legacy SFX settings preserve values and add independent voice defaults', () => {
  const { voiceEnabled, voiceVolume, ...legacy } = DEFAULT_GAME_SETTINGS;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => JSON.stringify({ ...legacy, sfxEnabled: false, sfxVolume: 0.25, bendingAngle: 155 }),
  } });
  try {
    assert.deepEqual(getGameSettings(), { ...DEFAULT_GAME_SETTINGS, sfxEnabled: false, sfxVolume: 0.25, bendingAngle: 155 });
    assert.equal(voiceEnabled, true);
    assert.equal(voiceVolume, 0.8);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('voice enable and volume persist independently across the supported range', () => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  try {
    for (const voiceEnabled of [false, true]) {
      for (const voiceVolume of [0, 0.05, 0.35, 0.8, 1]) {
        const settings = { ...DEFAULT_GAME_SETTINGS, voiceEnabled, voiceVolume, sfxEnabled: false, sfxVolume: 0.25 };
        saveGameSettings(settings);
        assert.deepEqual(getGameSettings(), settings);
      }
    }
    for (const invalid of [{ voiceEnabled: 'false' }, { voiceVolume: -1 }, { voiceVolume: 2 },
      { voiceVolume: '0.8' }, { voiceVolume: null }]) {
      values.set(SETTINGS_STORAGE_KEY, JSON.stringify({ ...DEFAULT_GAME_SETTINGS, ...invalid }));
      assert.deepEqual(getGameSettings(), DEFAULT_GAME_SETTINGS);
      assert.throws(() => saveGameSettings({ ...DEFAULT_GAME_SETTINGS, ...invalid } as GameSettings));
    }
    saveGameSettings({ ...DEFAULT_GAME_SETTINGS, voiceEnabled: false, voiceVolume: 0 });
    assert.deepEqual(resetGameSettings(), DEFAULT_GAME_SETTINGS);
    assert.equal(values.has(SETTINGS_STORAGE_KEY), false);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
