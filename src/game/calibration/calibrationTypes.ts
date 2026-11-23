export type CalibrationState = 'IDLE' | 'STANDING_INSTRUCTIONS' | 'STANDING_SAMPLING'
  | 'BEND_INSTRUCTIONS' | 'BEND_SAMPLING' | 'VALIDATING' | 'COMPLETE' | 'FAILED';
export type CalibrationSide = 'both' | 'left' | 'right';

export interface PartialMotionRange {
  standing: number;
  bending: number;
  standingThreshold: number;
  bendingThreshold: number;
  range: number;
}
export interface KneeCalibrationProfile {
  metric?: 'knee-angle';
  partial?: PartialMotionRange;
  standingAngle: number;
  bendingAngle: number;
  standingThreshold: number;
  bendingThreshold: number;
  range: number;
  timestamp: number;
  leftStanding?: number;
  rightStanding?: number;
  leftBending?: number;
  rightBending?: number;
  leftRange?: number;
  rightRange?: number;
  standingIqr?: number;
  bendingIqr?: number;
  reliableSide?: CalibrationSide;
}

export interface PartialCalibrationProfile {
  metric: 'partial';
  partial: PartialMotionRange;
  timestamp: number;
  standingAngle?: undefined;
  bendingAngle?: undefined;
  standingThreshold?: undefined;
  bendingThreshold?: undefined;
  range?: undefined;
  leftStanding?: undefined;
  rightStanding?: undefined;
  leftBending?: undefined;
  rightBending?: undefined;
  leftRange?: undefined;
  rightRange?: undefined;
  standingIqr?: undefined;
  bendingIqr?: undefined;
  reliableSide?: undefined;
}
export type CalibrationProfile = KneeCalibrationProfile | PartialCalibrationProfile;

export function copyCalibrationProfile(profile: CalibrationProfile): CalibrationProfile {
  if (profile.metric === 'partial') return { ...profile, partial: { ...profile.partial } };
  return profile.partial ? { ...profile, partial: { ...profile.partial } } : { ...profile };
}

export interface CalibrationSnapshot {
  state: CalibrationState;
  progress: number;
  message: string;
  profile?: CalibrationProfile;
  failureReason?: string;
  sampleCount: number;
  activeAngle?: number;
  partialBendSignal?: number;
  metric?: 'knee-angle' | 'partial';
  paused: boolean;
  samplingSide?: CalibrationSide;
  bendStarted: boolean;
}
