import { getGameSettings } from '../settings/gameSettings';
export const POSE_CONFIG = {
  get confidenceThreshold() { return getGameSettings().confidenceThreshold; },
  get smoothingAlpha() { return getGameSettings().smoothingAlpha; },
  standingAngle: 165,
  bendingAngle: 145,
  get debounceMs() { return getGameSettings().debounceMs; },
  lossGraceMs: 600,
  autoRestMs: 3000,
  maxDataAgeMs: 250,
  maxFrameGapMs: 250,
  nominalFps: 25,
  maxTorsoLeanDegrees: 35,
} as const;

export const POSE_LANDMARK = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;
