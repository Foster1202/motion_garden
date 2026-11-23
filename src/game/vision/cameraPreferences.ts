export const CAMERA_PROFILE_LABELS = {
  auto: '跟隨遊戲模式',
  browser: '由瀏覽器協商',
  low: '320×240 · 優先 30 FPS',
  vga: '640×480 · 優先 30 FPS',
  wide: '640×360',
} as const;

export type CameraProfile = keyof typeof CAMERA_PROFILE_LABELS;

export interface CameraPreferences {
  profile: CameraProfile;
  deviceId?: string;
}

const STORAGE_KEY = 'motion-garden-camera-preferences-v1';

export function getCameraPreferences(): CameraPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof value?.profile === 'string' && Object.hasOwn(CAMERA_PROFILE_LABELS, value.profile)) {
      return {
        profile: value.profile as CameraProfile,
        deviceId: typeof value.deviceId === 'string' && value.deviceId ? value.deviceId : undefined,
      };
    }
  } catch { /* Continue with browser defaults when local storage is unavailable. */ }
  return { profile: 'auto' };
}

export function saveCameraPreferences(preferences: CameraPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    profile: preferences.profile,
    deviceId: preferences.deviceId || undefined,
  }));
}
