export interface GameSettings {
  standingAngle: number;
  bendingAngle: number;
  bendHoldMs: number;
  standHoldMs: number;
  smoothingAlpha: number;
  debounceMs: number;
  confidenceThreshold: number;
  mocapGain: number;
  mocapSmoothingAlpha: number;
  rabbitScale: number;
}

export const DEFAULT_GAME_SETTINGS: Readonly<GameSettings> = Object.freeze({
  standingAngle: 160, bendingAngle: 150, bendHoldMs: 650, standHoldMs: 500,
  smoothingAlpha: 0.35, debounceMs: 200, confidenceThreshold: 0.5,
  mocapGain: 1, mocapSmoothingAlpha: 0.35, rabbitScale: 1,
});

export const SETTINGS_STORAGE_KEY = 'motion-garden-settings-v1';

export const GAME_SETTING_LIMITS: Record<keyof GameSettings, readonly [number, number]> = {
  standingAngle: [140, 180], bendingAngle: [110, 170], bendHoldMs: [200, 2000],
  standHoldMs: [200, 2000], smoothingAlpha: [0.05, 1], debounceMs: [50, 1000],
  confidenceThreshold: [0.3, 0.9], mocapGain: [0.25, 2],
  mocapSmoothingAlpha: [0.05, 1], rabbitScale: [0.5, 1.5],
};

export function validateGameSettings(value: unknown): value is GameSettings {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(GAME_SETTING_LIMITS) as (keyof GameSettings)[]) {
    const numeric = input[key];
    const [min, max] = GAME_SETTING_LIMITS[key];
    if (typeof numeric !== 'number' || !Number.isFinite(numeric) || numeric < min || numeric > max) return false;
  }
  return (input.standingAngle as number) - (input.bendingAngle as number) >= 3;
}

function numericSettings(value: GameSettings): GameSettings {
  return Object.fromEntries(Object.keys(GAME_SETTING_LIMITS).map(key => [key, value[key as keyof GameSettings]])) as unknown as GameSettings;
}

export function getGameSettings(): GameSettings {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? 'null');
    if (validateGameSettings(stored)) return numericSettings(stored);
  } catch { /* Storage may be unavailable. */ }
  return { ...DEFAULT_GAME_SETTINGS };
}

export function saveGameSettings(settings: GameSettings): void {
  if (!validateGameSettings(settings)) throw new Error('參數超出範圍，或站立角度與屈膝角度相差不足 3°。');
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(numericSettings(settings)));
}

export function resetGameSettings(): GameSettings {
  localStorage.removeItem(SETTINGS_STORAGE_KEY);
  return { ...DEFAULT_GAME_SETTINGS };
}
