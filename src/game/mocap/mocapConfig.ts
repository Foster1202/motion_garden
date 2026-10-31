import { RABBIT_3D_CONFIG } from '../3d/rabbit3dConfig';

export const MOCAP_CONFIG = {
  confidenceThreshold: 0.65,
  reference: {
    captureMs: 600,
    maximumSampleGapMs: 250,
    relaxedArmDegrees: 25,
    relaxedElbowDegrees: 35,
    maximumLeanDegrees: 25,
    angularSpreadDegrees: 6,
    centerSpreadShoulderWidths: 0.10,
    scaleSpreadFraction: 0.10,
    resetScaleFraction: 0.35,
    resetCenterShoulderWidths: 1.5,
  },
  lateral: { deadzoneShoulderWidths: 0.06, fullScaleShoulderWidths: 0.65 },
  limits: {
    arm: { min: 0, max: RABBIT_3D_CONFIG.limits.arm.max },
    elbow: { min: 0, max: RABBIT_3D_CONFIG.limits.forearm.max },
    torsoLean: RABBIT_3D_CONFIG.limits.bodySide,
    rootOffset: RABBIT_3D_CONFIG.limits.root.x,
  },
  temporal: { maxDataAgeMs: 250, neutralAfterMs: 600, maxStepSeconds: 0.05, maxLandmarkJump: 0.35 },
  slew: { armDegreesPerSecond: 180, bodyDegreesPerSecond: 60, bendPerSecond: 1.8, rootUnitsPerSecond: 0.6 },
} as const;
