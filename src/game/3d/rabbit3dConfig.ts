import { getGameSettings } from '../settings/gameSettings';
import type { Object3D } from 'three';
export type RabbitRenderMode = '3d' | 'sprite';
export type RabbitSide = 'L' | 'R' | 'left' | 'right';
export type RabbitRigVersion = 'v2' | 'v3';
export const RABBIT_INWARD_ARM_MAX_PLANE = 145;

export const RABBIT_REQUIRED_BONES = [
  'root', 'body', 'head', 'ear.L', 'ear.R',
  'upper_arm.L', 'forearm.L', 'hand.L', 'thigh.L', 'shin.L', 'foot.L',
  'upper_arm.R', 'forearm.R', 'hand.R', 'thigh.R', 'shin.R', 'foot.R',
  'tail', 'carrot_socket',
] as const;

export type RabbitBoneName = typeof RABBIT_REQUIRED_BONES[number];

export const RABBIT_V2_LIMITS = {
  arm: { min: -12, max: 90 },
  forearm: { min: 0, max: 100 },
  bodySide: 18,
  bodyForward: 16,
  headYaw: 25,
  headPitch: 18,
  headRoll: 14,
  headMotionEnvelope: 12,
  knee: 24,
  legExtension: 32,
  root: { x: 0.45, y: 0.04, z: 0.12 },
};

export type RabbitRigLimits = typeof RABBIT_V2_LIMITS;
export type RabbitRaiseLimitCurve = readonly (readonly [number, number])[];

export const RABBIT_V3_LIMITS: RabbitRigLimits = {
  ...RABBIT_V2_LIMITS,
  arm: { min: -12, max: 150 },
  forearm: { min: 0, max: 110 },
  headMotionEnvelope: 40,
};

function copyLimits(limits: RabbitRigLimits): RabbitRigLimits {
  return { ...limits, arm: { ...limits.arm }, forearm: { ...limits.forearm }, root: { ...limits.root } };
}

function modelLimits(value: unknown): RabbitRigLimits {
  const supplied = typeof value === 'string' ? JSON.parse(value) : value === undefined ? {} : value;
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) throw new Error('Invalid Rabbit V3 motion limits');
  const limits = copyLimits(RABBIT_V3_LIMITS);
  const groups = ['arm', 'forearm', 'root'] as const;
  const scalarKeys = ['bodySide', 'bodyForward', 'headYaw', 'headPitch', 'headRoll',
    'headMotionEnvelope', 'knee', 'legExtension'] as const;
  const allowedKeys: readonly string[] = [...groups, ...scalarKeys];
  const valid = (numeric: unknown, minimum: number, maximum: number): numeric is number =>
    typeof numeric === 'number' && Number.isFinite(numeric) && numeric >= minimum && numeric <= maximum;
  for (const key of Object.keys(supplied)) {
    if (!allowedKeys.includes(key)) throw new Error(`Unknown Rabbit V3 limit: ${key}`);
  }
  for (const key of scalarKeys) {
    const numeric = supplied[key] === undefined ? limits[key] : supplied[key];
    if (!valid(numeric, 0, RABBIT_V3_LIMITS[key])) throw new Error(`Invalid Rabbit V3 limit: ${key}`);
    limits[key] = numeric;
  }
  for (const group of groups) {
    const fields = supplied[group] === undefined ? {} : supplied[group];
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error(`Invalid Rabbit V3 limit group: ${group}`);
    const target = limits[group] as Record<string, number>;
    const ceiling = RABBIT_V3_LIMITS[group] as Record<string, number>;
    for (const key of Object.keys(fields)) {
      if (!(key in target)) throw new Error(`Unknown Rabbit V3 limit: ${group}.${key}`);
      const minimum = group === 'arm' && key === 'min' ? RABBIT_V2_LIMITS.arm.min : 0;
      const maximum = key === 'min' ? 0 : ceiling[key];
      if (!valid(fields[key], minimum, maximum)) throw new Error(`Invalid Rabbit V3 limit: ${group}.${key}`);
      target[key] = fields[key];
    }
  }
  if (limits.arm.min > limits.arm.max || limits.forearm.min > limits.forearm.max) throw new Error('Invalid Rabbit V3 joint range');
  return limits;
}

function modelRaiseCurve(value: unknown, maximumRaise: number, maximumLimit: number): RabbitRaiseLimitCurve {
  const supplied = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(supplied) || supplied.length < 2) throw new Error('Missing Rabbit V3 raise-limit curve');
  const curve: (readonly [number, number])[] = [];
  let previousRaise = -1;
  let previousLimit = maximumLimit;
  for (const point of supplied) {
    if (!Array.isArray(point) || point.length !== 2) throw new Error('Invalid Rabbit V3 raise-limit point');
    const [raise, limit] = point;
    if (![raise, limit].every(value => typeof value === 'number' && Number.isFinite(value))
      || raise < 0 || raise > maximumRaise || raise <= previousRaise
      || limit < 0 || limit > previousLimit) throw new Error('Invalid Rabbit V3 raise-limit range');
    curve.push(Object.freeze([raise, limit] as const));
    previousRaise = raise;
    previousLimit = limit;
  }
  if (curve[0][0] !== 0 || curve[curve.length - 1][0] !== maximumRaise) {
    throw new Error('Rabbit V3 raise-limit curve must cover its full shoulder range');
  }
  return Object.freeze(curve);
}

export function rabbitRaiseLimit(curve: RabbitRaiseLimitCurve, elevation: number): number {
  const raise = Number.isFinite(elevation) ? Math.max(0, elevation) : 0;
  for (let index = 1; index < curve.length; index++) {
    const [end, endLimit] = curve[index];
    if (raise <= end) {
      const [start, startLimit] = curve[index - 1];
      const progress = (raise - start) / (end - start);
      return startLimit + (endLimit - startLimit) * progress;
    }
  }
  return curve[curve.length - 1][1];
}

export function rabbitRigProfile(model: Object3D): {
  version: RabbitRigVersion; limits: RabbitRigLimits;
  elbowLimitsByRaise: RabbitRaiseLimitCurve; headLimitsByRaise: RabbitRaiseLimitCurve;
} {
  let metadata: Record<string, unknown> | undefined;
  model.traverse(object => {
    if (!metadata && object.userData.rig_version !== undefined) metadata = object.userData;
  });
  const version = metadata?.rig_version ?? 'v2';
  if (version !== 'v2' && version !== 'v3') throw new Error(`Unsupported Rabbit rig version: ${String(version)}`);
  const limits = version === 'v3' ? modelLimits(metadata?.rig_motion_limits) : copyLimits(RABBIT_V2_LIMITS);
  const elbowLimitsByRaise = version === 'v3'
    ? modelRaiseCurve(metadata?.elbow_limits_by_raise, limits.arm.max, limits.forearm.max)
    : modelRaiseCurve([[0, limits.forearm.max], [limits.arm.max, limits.forearm.max]], limits.arm.max, limits.forearm.max);
  const headLimitsByRaise = version === 'v3'
    ? modelRaiseCurve(metadata?.head_limits_by_raise, limits.arm.max, limits.headMotionEnvelope)
    : modelRaiseCurve([[0, limits.headMotionEnvelope], [60, limits.headMotionEnvelope], [90, 0]], 90, limits.headMotionEnvelope);
  Object.freeze(limits.arm);
  Object.freeze(limits.forearm);
  Object.freeze(limits.root);
  Object.freeze(limits);
  return { version, limits, elbowLimitsByRaise, headLimitsByRaise };
}

export function rabbitPreviewModelUrl(baseUrl: string, search = ''): string {
  const version = new URLSearchParams(search).get('rabbitRig') === 'v2' ? 'v2' : 'v3';
  const file = version === 'v2' ? 'rabbit_realtime.glb' : 'rabbit_realtime_v3.glb';
  return `${baseUrl.replace(/\/?$/, '/')}assets/rabbit3d/${file}`;
}

export const RABBIT_3D_CONFIG = {
  modelUrl: '/assets/rabbit3d/rabbit_realtime.glb',
  logicalWorld: { width: 1600, height: 900 },
  foot: { x: 894, y: 681 },
  socketOffset: 1.5,
  get visibleHeight() { return 342 * getGameSettings().rabbitScale; },
  get smoothingRate() { return 14 * getGameSettings().mocapSmoothingAlpha / 0.35; },
  // The signal ceiling is separate from each imported model's verified physical range.
  limits: RABBIT_V3_LIMITS,
} as const;
