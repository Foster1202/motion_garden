export type CalibrationState = 'IDLE' | 'STANDING_INSTRUCTIONS' | 'STANDING_SAMPLING'
  | 'BEND_INSTRUCTIONS' | 'BEND_SAMPLING' | 'VALIDATING' | 'COMPLETE' | 'FAILED';
export type CalibrationSide = 'both' | 'left' | 'right';

export interface CalibrationProfile {
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

export interface CalibrationSnapshot {
  state: CalibrationState;
  progress: number;
  message: string;
  profile?: CalibrationProfile;
  failureReason?: string;
  sampleCount: number;
  activeAngle?: number;
  paused: boolean;
  samplingSide?: CalibrationSide;
  bendStarted: boolean;
}
