export type AppleSide = 'left' | 'right';

export const APPLE_CONFIG = {
  defaultDurationSeconds: 120,
  durationOptions: [90, 120, 180],
  maxTargetStreak: 3,
  zones: {
    left: { center: -.72, radius: .14 },
    right: { center: .72, radius: .14 },
    basket: { center: 0, radius: .16 },
  },
  maxTravel: .84,
  keyboardSpeedPerMs: .00085,
  lowerThreshold: .30,
  raiseThreshold: .72,
  gestureDwellMs: 90,
  maximumFrameGapMs: 250,
  depositMs: 440,
} as const;
