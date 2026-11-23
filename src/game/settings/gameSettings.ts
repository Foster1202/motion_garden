import { BERRY_CONFIG as C } from '../berry/berryConfig';
import { APPLE_CONFIG } from '../apple/appleConfig';

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
  showBodyKeypoints: boolean;
  backgroundProcessing: boolean;
  backgroundMode: 'blur' | 'gray';
  lowPerformanceMode: boolean;
  showPerformanceMetrics: boolean;
  berryDurationSeconds: (typeof C.durationOptions)[number];
  appleDurationSeconds: (typeof APPLE_CONFIG.durationOptions)[number];
  sfxEnabled: boolean;
  sfxVolume: number;
  voiceEnabled: boolean;
  voiceVolume: number;
}

export type NumericGameSetting = Exclude<keyof GameSettings,
  'showBodyKeypoints' | 'backgroundProcessing' | 'backgroundMode' | 'berryDurationSeconds' | 'appleDurationSeconds'
  | 'lowPerformanceMode' | 'showPerformanceMetrics' | 'sfxEnabled' | 'sfxVolume' | 'voiceEnabled' | 'voiceVolume'>;

export const DEFAULT_GAME_SETTINGS: Readonly<GameSettings> = Object.freeze({
  standingAngle: 160, bendingAngle: 150, bendHoldMs: 650, standHoldMs: 500,
  smoothingAlpha: 0.35, debounceMs: 200, confidenceThreshold: 0.5,
  mocapGain: 1, mocapSmoothingAlpha: 0.35, rabbitScale: 1,
  showBodyKeypoints: false, backgroundProcessing: false, backgroundMode: 'blur',
  lowPerformanceMode: false, showPerformanceMetrics: false,
  berryDurationSeconds: C.defaultDurationSeconds,
  appleDurationSeconds: APPLE_CONFIG.defaultDurationSeconds,
  sfxEnabled: true, sfxVolume: 0.6, voiceEnabled: true, voiceVolume: 0.8,
});

export const SETTINGS_STORAGE_KEY = 'motion-garden-settings-v1';
export const GAME_SETTINGS_CHANGED_EVENT = 'motion-garden-settings-changed';

export const GAME_SETTING_LIMITS: Record<NumericGameSetting, readonly [number, number]> = {
  standingAngle: [140, 180], bendingAngle: [110, 170], bendHoldMs: [200, 2000],
  standHoldMs: [200, 2000], smoothingAlpha: [0.05, 1], debounceMs: [50, 1000],
  confidenceThreshold: [0.3, 0.9], mocapGain: [0.25, 2],
  mocapSmoothingAlpha: [0.05, 1], rabbitScale: [0.5, 1.5],
};

export function validateGameSettings(value: unknown): value is GameSettings {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(GAME_SETTING_LIMITS) as NumericGameSetting[]) {
    const numeric = input[key];
    const [min, max] = GAME_SETTING_LIMITS[key];
    if (typeof numeric !== 'number' || !Number.isFinite(numeric) || numeric < min || numeric > max) return false;
  }
  return (input.standingAngle as number) - (input.bendingAngle as number) >= 3
    && typeof input.showBodyKeypoints === 'boolean'
    && typeof input.backgroundProcessing === 'boolean'
    && (input.backgroundMode === 'blur' || input.backgroundMode === 'gray')
    && typeof input.lowPerformanceMode === 'boolean'
    && typeof input.showPerformanceMetrics === 'boolean'
    && typeof input.sfxEnabled === 'boolean'
    && typeof input.sfxVolume === 'number' && Number.isFinite(input.sfxVolume)
    && input.sfxVolume >= 0 && input.sfxVolume <= 1
    && typeof input.voiceEnabled === 'boolean'
    && typeof input.voiceVolume === 'number' && Number.isFinite(input.voiceVolume)
    && input.voiceVolume >= 0 && input.voiceVolume <= 1
    && C.durationOptions.some(duration => duration === input.berryDurationSeconds)
    && APPLE_CONFIG.durationOptions.some(duration => duration === input.appleDurationSeconds);
}

function supportedSettings(value: GameSettings): GameSettings {
  const numeric = Object.fromEntries(Object.keys(GAME_SETTING_LIMITS).map(key => [key, value[key as NumericGameSetting]])) as Pick<GameSettings, NumericGameSetting>;
  return { ...numeric, showBodyKeypoints: value.showBodyKeypoints,
    backgroundProcessing: value.backgroundProcessing, backgroundMode: value.backgroundMode,
    lowPerformanceMode: value.lowPerformanceMode, showPerformanceMetrics: value.showPerformanceMetrics,
    berryDurationSeconds: value.berryDurationSeconds, appleDurationSeconds: value.appleDurationSeconds,
    sfxEnabled: value.sfxEnabled, sfxVolume: value.sfxVolume,
    voiceEnabled: value.voiceEnabled, voiceVolume: value.voiceVolume };
}

export function getGameSettings(): GameSettings {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? 'null');
    if (stored && typeof stored === 'object') {
      const settings = { showBodyKeypoints: false, backgroundProcessing: false, backgroundMode: 'blur',
        lowPerformanceMode: false, showPerformanceMetrics: false,
        berryDurationSeconds: C.defaultDurationSeconds, appleDurationSeconds: APPLE_CONFIG.defaultDurationSeconds,
        sfxEnabled: true, sfxVolume: 0.6,
        voiceEnabled: true, voiceVolume: 0.8, ...stored };
      if (validateGameSettings(settings)) return supportedSettings(settings);
    }
  } catch { /* Storage may be unavailable. */ }
  return { ...DEFAULT_GAME_SETTINGS };
}

export function saveGameSettings(settings: GameSettings): void {
  if (!validateGameSettings(settings)) throw new Error('請檢查參數範圍、音效及語音音量、遊戲挑戰時間，以及站立角度與屈膝角度是否相差至少 3°。');
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(supportedSettings(settings)));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(GAME_SETTINGS_CHANGED_EVENT));
}

export function resetGameSettings(): GameSettings {
  localStorage.removeItem(SETTINGS_STORAGE_KEY);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(GAME_SETTINGS_CHANGED_EVENT));
  return { ...DEFAULT_GAME_SETTINGS };
}
