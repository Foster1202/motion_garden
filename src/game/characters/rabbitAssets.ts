import type Phaser from 'phaser';

export const RABBIT_ACTIONS = ['idle', 'bend', 'grab', 'return', 'pull', 'celebrate'] as const;
export type RabbitAction = typeof RABBIT_ACTIONS[number];
export const RABBIT_ORIGIN = { x: 0.5, y: 0.928719 } as const;
export const RABBIT_FRAME_SIZE = 512;
export const RabbitAssetKeys = {
  idle: 'rabbit_idle', bend: 'rabbit_bend', grab: 'rabbit_grab',
  return: 'rabbit_return', pull: 'rabbit_pull', celebrate: 'rabbit_celebrate',
  animations: 'rabbit-animation-config', attachments: 'rabbit-attachment-config',
} as const;

export interface RabbitAnimationSpec {
  key: string;
  texture: string;
  frameRate: number;
  repeat: number;
  frames: { key: string; frame: string }[];
  origin: { x: number; y: number };
}
export type RabbitAnimationConfig = Record<RabbitAction, RabbitAnimationSpec>;
export interface RabbitAttachment {
  index: number;
  name: string;
  sourceFrame: number;
  x: number;
  y: number;
}
export interface RabbitAttachmentConfig {
  coordinateSystem: { frameWidth: number; frameHeight: number };
  actions: Record<RabbitAction, RabbitAttachment[]>;
}

export function preloadRabbitAssets(scene: Phaser.Scene) {
  const base = `${import.meta.env.BASE_URL}assets/rabbit/`;
  for (const action of RABBIT_ACTIONS) {
    const name = RabbitAssetKeys[action];
    scene.load.atlas(name, `${base}${name}.png`, `${base}${name}.json`);
  }
  scene.load.json(RabbitAssetKeys.animations, `${base}rabbit_animations.json`);
  scene.load.json(RabbitAssetKeys.attachments, `${base}rabbit_attachment_points.json`);
  scene.load.on('loaderror', (file: Phaser.Loader.File) => {
    if (file.key.startsWith('rabbit')) console.error(`Rabbit asset could not load: ${file.key}`);
  });
}

export function validateRabbitAssets(
  config: RabbitAnimationConfig | undefined,
  attachments: RabbitAttachmentConfig | undefined,
  hasFrame: (texture: string, frame: string) => boolean,
): asserts config is RabbitAnimationConfig {
  if (!config || !attachments || attachments.coordinateSystem?.frameWidth !== RABBIT_FRAME_SIZE
    || attachments.coordinateSystem.frameHeight !== RABBIT_FRAME_SIZE) throw new Error('Rabbit metadata is missing or incompatible');
  for (const action of RABBIT_ACTIONS) {
    const spec = config[action];
    const points = attachments.actions?.[action];
    if (!spec || spec.key !== RabbitAssetKeys[action] || spec.texture !== RabbitAssetKeys[action]
      || !Array.isArray(spec.frames) || !spec.frames.length || !Number.isFinite(spec.frameRate) || spec.frameRate <= 0
      || spec.repeat !== (action === 'idle' ? -1 : 0)
      || !spec.origin || Math.abs(spec.origin.x - RABBIT_ORIGIN.x) > 1e-6
      || Math.abs(spec.origin.y - RABBIT_ORIGIN.y) > 1e-6
      || !Array.isArray(points) || points.length !== spec.frames.length) throw new Error(`Invalid rabbit config: ${action}`);
    const names = new Set<string>();
    spec.frames.forEach((frame, index) => {
      const point = points[index];
      if (frame.key !== spec.texture || names.has(frame.frame) || !hasFrame(spec.texture, frame.frame)
        || point?.name !== frame.frame || point.index !== index
        || !Number.isFinite(point.x) || !Number.isFinite(point.y)
        || point.x < 0 || point.x > 512 || point.y < 0 || point.y > 512) throw new Error(`Invalid rabbit frame: ${action}/${index}`);
      names.add(frame.frame);
    });
  }
}
