import { CALIBRATION_CONFIG as CONFIG } from './calibrationConfig';
import type { CalibrationProfile } from './calibrationTypes';

export function quantile(values: readonly number[], fraction: number): number {
  if (!values.length || !Number.isFinite(fraction) || fraction < 0 || fraction > 1
    || values.some(value => !Number.isFinite(value))) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
}

export function median(values: readonly number[]): number { return quantile(values, 0.5); }
export function interquartileRange(values: readonly number[]): number {
  return quantile(values, 0.75) - quantile(values, 0.25);
}
export function isStable(values: readonly number[]): boolean {
  return values.length > 0 && interquartileRange(values) <= CONFIG.maximumIqr
    && quantile(values, 0.9) - quantile(values, 0.1) <= CONFIG.maximumCentralSpread;
}
export function isPlausibleAngle(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value)
    && value >= CONFIG.minimumAngle - CONFIG.numericAngleEpsilon
    && value <= CONFIG.maximumAngle + CONFIG.numericAngleEpsilon;
}
export function calibrationThresholds(standingAngle: number, bendingAngle: number) {
  const range = standingAngle - bendingAngle;
  return {
    range,
    standingThreshold: standingAngle - range * CONFIG.standingThresholdFraction,
    bendingThreshold: standingAngle - range * CONFIG.bendingThresholdFraction,
  };
}

export function validateCalibration(profile: CalibrationProfile): boolean {
  if (!profile || !isPlausibleAngle(profile.standingAngle) || !isPlausibleAngle(profile.bendingAngle)
    || !isPlausibleAngle(profile.standingThreshold) || !isPlausibleAngle(profile.bendingThreshold)
    || !Number.isFinite(profile.range) || profile.range < CONFIG.minimumRange - CONFIG.numericAngleEpsilon
    || profile.range > CONFIG.maximumRange + CONFIG.numericAngleEpsilon
    || !Number.isFinite(profile.timestamp) || profile.timestamp < 0
    || profile.standingThreshold <= profile.bendingThreshold) return false;
  const expected = calibrationThresholds(profile.standingAngle, profile.bendingAngle);
  if (Math.abs(profile.range - expected.range) > 1e-6
    || Math.abs(profile.standingThreshold - expected.standingThreshold) > 1e-6
    || Math.abs(profile.bendingThreshold - expected.bendingThreshold) > 1e-6) return false;
  for (const key of ['standingIqr', 'bendingIqr'] as const) {
    if (profile[key] !== undefined && (!Number.isFinite(profile[key]) || profile[key]! < 0 || profile[key]! > CONFIG.maximumIqr)) return false;
  }
  if (profile.reliableSide !== undefined && !['both', 'left', 'right'].includes(profile.reliableSide)) return false;
  for (const side of ['left', 'right'] as const) {
    const standing = profile[`${side}Standing`];
    const bending = profile[`${side}Bending`];
    const range = profile[`${side}Range`];
    if (standing === undefined && bending === undefined && range === undefined) {
      if (profile.reliableSide === side || profile.reliableSide === 'both') return false;
      continue;
    }
    if (!isPlausibleAngle(standing) || !isPlausibleAngle(bending) || range === undefined || !Number.isFinite(range)
      || range < -CONFIG.sideRangeNoiseTolerance || range > CONFIG.maximumRange + CONFIG.numericAngleEpsilon
      || Math.abs(range - (standing - bending)) > 1e-6) return false;
  }
  if (profile.reliableSide !== undefined) {
    for (const phase of ['Standing', 'Bending'] as const) {
      const cohortBaseline = profile.reliableSide === 'both'
        ? (profile[`left${phase}`]! + profile[`right${phase}`]!) / 2
        : profile[`${profile.reliableSide}${phase}`]!;
      const activeBaseline = phase === 'Standing' ? profile.standingAngle : profile.bendingAngle;
      // Median of a mean can differ slightly from the mean of medians.
      if (Math.abs(cohortBaseline - activeBaseline) > CONFIG.maximumIqr) return false;
    }
  }
  return true;
}
