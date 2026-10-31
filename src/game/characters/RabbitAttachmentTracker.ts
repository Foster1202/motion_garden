import type { RabbitAction, RabbitAttachment, RabbitAttachmentConfig } from './rabbitAssets';
import { RABBIT_FRAME_SIZE, RABBIT_ORIGIN } from './rabbitAssets';

export interface SpriteTransform {
  x: number; y: number; scaleX: number; scaleY: number;
  originX?: number; originY?: number; rotation?: number; flipX?: boolean; flipY?: boolean;
}

export function attachmentToWorld(point: { x: number; y: number }, sprite: SpriteTransform) {
  const x = ((sprite.flipX ? RABBIT_FRAME_SIZE - point.x : point.x)
    - RABBIT_FRAME_SIZE * (sprite.originX ?? RABBIT_ORIGIN.x)) * sprite.scaleX;
  const y = ((sprite.flipY ? RABBIT_FRAME_SIZE - point.y : point.y)
    - RABBIT_FRAME_SIZE * (sprite.originY ?? RABBIT_ORIGIN.y)) * sprite.scaleY;
  const cos = Math.cos(sprite.rotation ?? 0), sin = Math.sin(sprite.rotation ?? 0);
  return { x: sprite.x + x * cos - y * sin, y: sprite.y + x * sin + y * cos };
}

export class RabbitAttachmentTracker {
  constructor(private readonly data: RabbitAttachmentConfig) {}

  get(action: RabbitAction, frameName: string): RabbitAttachment {
    const point = this.data.actions[action].find(frame => frame.name === frameName);
    if (!point) throw new Error(`Attachment missing: ${action}/${frameName}`);
    return point;
  }

  world(action: RabbitAction, frameName: string, transform: SpriteTransform) {
    return attachmentToWorld(this.get(action, frameName), transform);
  }
}
