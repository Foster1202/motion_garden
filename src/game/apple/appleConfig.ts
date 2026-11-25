export type AppleSide = 'left' | 'right';

export const APPLE_CONFIG = {
  defaultDurationSeconds: 120,
  durationOptions: [90, 120, 180],
  maxTargetStreak: 3,
  zones: {
    left: { center: -.72, radius: .38 },
    right: { center: .72, radius: .38 },
    basket: { center: 0, radius: .30 },
  },
  maxTravel: .96,
  keyboardSpeedPerMs: .00085,
  lowerThreshold: .30,
  raiseThreshold: .52,
  raiseDwellMs: 45,
  gestureDwellMs: 65,
  maximumFrameGapMs: 250,
  depositMs: 440,
} as const;

export type AppleZone = keyof typeof APPLE_CONFIG.zones;

export function appleZoneBounds(zone: AppleZone) {
  const { center, radius } = APPLE_CONFIG.zones[zone];
  const travel = APPLE_CONFIG.maxTravel;
  return { minX: Math.max(-travel, center - radius), maxX: Math.min(travel, center + radius) };
}

export function isInAppleZone(x: number, zone: AppleZone) {
  const { minX, maxX } = appleZoneBounds(zone);
  return x >= minX && x <= maxX;
}
