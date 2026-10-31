import type { PoseLandmark } from './poseTypes';

export interface ImagePoint { x: number; y: number }

export function imagePoint(point: PoseLandmark, width = 1, height = 1): ImagePoint {
  return { x: point.x * width, y: point.y * height };
}

export function calculateAngle(hip: ImagePoint, knee: ImagePoint, ankle: ImagePoint): number | undefined {
  const ax = hip.x - knee.x;
  const ay = hip.y - knee.y;
  const bx = ankle.x - knee.x;
  const by = ankle.y - knee.y;
  const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (!Number.isFinite(denominator) || denominator <= 1e-8) return undefined;
  const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / denominator));
  return Math.acos(cosine) * 180 / Math.PI;
}

export function landmarkConfidence(point: PoseLandmark | undefined): number {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return 0;
  const confidence = Math.min(point.visibility ?? 0, point.presence ?? 1);
  return Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
}

export function torsoLean(shoulder: ImagePoint, hip: ImagePoint): number | undefined {
  const vertical = hip.y - shoulder.y;
  if (vertical <= 1e-8) return undefined;
  return Math.atan2(Math.abs(hip.x - shoulder.x), vertical) * 180 / Math.PI;
}
