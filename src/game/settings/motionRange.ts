import type { CalibrationProfile, KneeCalibrationProfile } from '../calibration/calibrationTypes';
import { validatePartialMotionRange } from '../calibration/calibrationMath';
import { getGameSettings } from './gameSettings';

// Compatibility shape for the shared mocap pipeline; no user sampling is involved.
export function manualMotionRange(): KneeCalibrationProfile {
  const settings = getGameSettings();
  return {
    standingAngle: settings.standingAngle, bendingAngle: settings.bendingAngle,
    standingThreshold: settings.standingAngle, bendingThreshold: settings.bendingAngle,
    range: settings.standingAngle - settings.bendingAngle, timestamp: 0,
  };
}

export function validateMotionRange(profile: CalibrationProfile | undefined): boolean {
  if (!profile) return false;
  if (profile.metric === 'partial') return Number.isFinite(profile.timestamp) && profile.timestamp >= 0
    && validatePartialMotionRange(profile.partial);
  return Boolean((!profile.partial || validatePartialMotionRange(profile.partial)) && [profile.standingAngle, profile.bendingAngle, profile.standingThreshold,
    profile.bendingThreshold, profile.range, profile.timestamp].every(Number.isFinite)
    && profile.standingAngle <= 180 && profile.bendingAngle >= 90
    && profile.standingAngle > profile.bendingAngle
    && profile.standingThreshold <= profile.standingAngle && profile.bendingThreshold >= profile.bendingAngle
    && profile.standingThreshold > profile.bendingThreshold && profile.range > 0
    && Math.abs(profile.range - (profile.standingAngle - profile.bendingAngle)) < .001);
}
