import { getGameSettings } from '../settings/gameSettings';
export type RabbitRenderMode = '3d' | 'sprite';
export type RabbitSide = 'L' | 'R' | 'left' | 'right';

export const RABBIT_REQUIRED_BONES = [
  'root', 'body', 'head', 'ear.L', 'ear.R',
  'upper_arm.L', 'forearm.L', 'hand.L', 'thigh.L', 'shin.L', 'foot.L',
  'upper_arm.R', 'forearm.R', 'hand.R', 'thigh.R', 'shin.R', 'foot.R',
  'tail', 'carrot_socket',
] as const;

export type RabbitBoneName = typeof RABBIT_REQUIRED_BONES[number];

export const RABBIT_3D_CONFIG = {
  modelUrl: '/assets/rabbit3d/rabbit_realtime.glb',
  logicalWorld: { width: 1600, height: 900 },
  foot: { x: 894, y: 681 },
  get visibleHeight() { return 342 * getGameSettings().rabbitScale; },
  get smoothingRate() { return 14 * getGameSettings().mocapSmoothingAlpha / 0.35; },
  limits: {
    arm: { min: -12, max: 115 },
    forearm: { min: 0, max: 55 },
    bodySide: 14,
    bodyForward: 14,
    headYaw: 25,
    headPitch: 18,
    headRoll: 14,
    knee: 15,
    legExtension: 32,
    root: { x: 0.45, y: 0.04, z: 0.12 },
  },
} as const;
