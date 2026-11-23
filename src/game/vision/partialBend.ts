import { landmarkConfidence } from './poseMath';
import { POSE_CONFIG, POSE_LANDMARK as L } from './poseConfig';
import type { PoseLandmark } from './poseTypes';

export const PARTIAL_BEND_CONFIG = {
  minimumRange: .04,
  maximumRange: .8,
  maximumIqr: .02,
  maximumSpread: .04,
  readySpread: .035,
  bendTrigger: .03,
} as const;

/** Dimensionless projection of both visible thighs into the torso's local image axes. */
export function observePartialBend(points: readonly PoseLandmark[], width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  const ids = [L.leftShoulder, L.rightShoulder, L.leftHip, L.rightHip, L.leftKnee, L.rightKnee] as const;
  const confidence = Math.min(...ids.map(id => landmarkConfidence(points[id])));
  if (confidence < POSE_CONFIG.confidenceThreshold) return undefined;
  const [ls, rs, lh, rh, lk, rk] = ids.map(id => ({ x: points[id].x * width, y: points[id].y * height }));
  const torsoX = (lh.x + rh.x - ls.x - rs.x) / 2;
  const torsoY = (lh.y + rh.y - ls.y - rs.y) / 2;
  const torsoLength = Math.hypot(torsoX, torsoY);
  const shoulderWidth = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  if (torsoY <= 0 || shoulderWidth < width * .025 || shoulderWidth < torsoLength * .45
    || shoulderWidth > torsoLength * 2.4 || Math.sign(ls.x - rs.x) !== Math.sign(lh.x - rh.x)
    || Math.abs(torsoX / torsoY) > Math.tan(35 * Math.PI / 180)) return undefined;
  const thighs = [[lh, lk], [rh, rk]].map(([hip, knee]) => {
    const x = (knee.x - hip.x) / shoulderWidth;
    const y = (knee.y - hip.y) / shoulderWidth;
    return { down: (x * torsoX + y * torsoY) / torsoLength,
      side: (x * torsoY - y * torsoX) / torsoLength };
  });
  const [left, right] = thighs;
  if (Math.min(left.down, right.down) < .12 || Math.max(left.down, right.down) > 2
    || Math.abs(left.down - right.down) > .22 || Math.abs(left.side - right.side) > .65) return undefined;
  // Symmetric thigh shortening is primary; outward rotation provides a smaller complementary cue.
  const spread = Math.max(0, Math.sign(ls.x - rs.x) * (left.side - right.side));
  return { signal: -(left.down + right.down) / 2 + .1 * spread, confidence };
}
