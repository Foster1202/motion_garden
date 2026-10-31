import type { CalibrationProfile } from '../calibration/calibrationTypes';
import { getGameSettings } from './gameSettings';

// Compatibility shape for the shared mocap pipeline; no user sampling is involved.
export function manualMotionRange(): CalibrationProfile {
  const settings = getGameSettings();
  return {
    standingAngle: settings.standingAngle, bendingAngle: settings.bendingAngle,
    standingThreshold: settings.standingAngle, bendingThreshold: settings.bendingAngle,
    range: settings.standingAngle - settings.bendingAngle, timestamp: 0,
  };
}

export function validateMotionRange(profile: CalibrationProfile | undefined): boolean {
  return Boolean(profile && [profile.standingAngle, profile.bendingAngle, profile.standingThreshold,
    profile.bendingThreshold, profile.range, profile.timestamp].every(Number.isFinite)
    && profile.standingAngle <= 180 && profile.bendingAngle >= 90
    && profile.standingAngle > profile.bendingAngle
    && profile.standingThreshold <= profile.standingAngle && profile.bendingThreshold >= profile.bendingAngle
    && profile.standingThreshold > profile.bendingThreshold && profile.range > 0
    && Math.abs(profile.range - (profile.standingAngle - profile.bendingAngle)) < .001);
}
