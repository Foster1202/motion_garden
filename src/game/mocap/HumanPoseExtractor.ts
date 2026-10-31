import { LegExtensionDetector, type BerryMotionSample } from './LegExtensionDetector';
import { validateMotionRange } from '../settings/motionRange';
import type { CalibrationProfile } from '../calibration/calibrationTypes';
import { calculateAngle, imagePoint, landmarkConfidence } from '../vision/poseMath';
import type { PoseFrame, PoseLandmark, PoseSnapshot } from '../vision/poseTypes';
import { MOCAP_CONFIG as CONFIG } from './mocapConfig';

/** Raw camera coordinates, before CSS mirroring; all angles use aspect-correct 2D geometry. */
export interface HumanPose {
  leftArmElevation?: number;
  rightArmElevation?: number;
  leftElbowBend?: number;
  rightElbowBend?: number;
  leftArmConfidence: number;
  rightArmConfidence: number;
  torsoLean: number;
  activeKneeAngle: number;
  centerX: number;
  bodyScale: number;
  trackingConfidence: number;
  timestampMs: number;
}

export class HumanPoseExtractor {
  private readonly legDetector = new LegExtensionDetector();

  extractLegMotion(frame: PoseFrame): BerryMotionSample { return this.legDetector.update(frame); }
  resetLegMotion(): void { this.legDetector.reset(); }

  extract(frame: PoseFrame, pose: PoseSnapshot, profile: CalibrationProfile): HumanPose | undefined {
    if (!validateMotionRange(profile) || !Number.isFinite(frame.timestampMs) || frame.timestampMs < 0
      || pose.timestampMs !== frame.timestampMs || pose.state === 'TRACKING_LOST' || pose.state === 'UNKNOWN'
      || !Number.isFinite(pose.confidence) || pose.confidence < CONFIG.confidenceThreshold) return undefined;
    const points = frame.landmarks;
    const width = frame.imageWidth ?? 1;
    const height = frame.imageHeight ?? 1;
    if (!points || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
    const confidence = (indices: readonly number[]) => Math.min(...indices.map(i => landmarkConfidence(points[i])));
    const torsoConfidence = confidence([11, 12, 23, 24]);
    if (torsoConfidence < CONFIG.confidenceThreshold) return undefined;
    const selected = profile.reliableSide === 'left' ? ['left'] as const
      : profile.reliableSide === 'right' ? ['right'] as const
        : profile.reliableSide === 'both' ? ['left', 'right'] as const
          : (['left', 'right'] as const).filter(side => (side === 'left' ? pose.leftKneeAngle : pose.rightKneeAngle) !== undefined);
    if (!selected.length || pose.reliableSides !== selected.length) return undefined;
    const kneeAngles: number[] = [];
    let kneeConfidence = 1;
    for (const side of selected) {
      const indices = side === 'left' ? [23, 25, 27] : [24, 26, 28];
      const value = side === 'left' ? pose.leftKneeAngle : pose.rightKneeAngle;
      const currentConfidence = confidence(indices);
      if (currentConfidence < CONFIG.confidenceThreshold || value === undefined || !Number.isFinite(value)
        || value < 0 || value > 180) return undefined;
      if (calculateAngle(imagePoint(points[indices[0]], width, height), imagePoint(points[indices[1]], width, height),
        imagePoint(points[indices[2]], width, height)) === undefined) return undefined;
      kneeAngles.push(value);
      kneeConfidence = Math.min(kneeConfidence, currentConfidence);
    }
    const knee = pose.activeKneeAngle;
    const cohortMean = kneeAngles.reduce((sum, angle) => sum + angle, 0) / kneeAngles.length;
    if (knee === undefined || !Number.isFinite(knee) || Math.abs(knee - cohortMean) > 1e-5) return undefined;
    const mean = (a: PoseLandmark, b: PoseLandmark) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const shoulders = mean(points[11], points[12]);
    const hips = mean(points[23], points[24]);
    const torsoDown = { x: (hips.x - shoulders.x) * width, y: (hips.y - shoulders.y) * height };
    const torsoLength = Math.hypot(torsoDown.x, torsoDown.y);
    const shoulderWidth = Math.hypot((points[11].x - points[12].x) * width,
      (points[11].y - points[12].y) * height);
    if (torsoDown.y <= 0 || torsoLength < height * 0.02 || shoulderWidth < width * 0.025) return undefined;
    const arm = (shoulderIndex: number, elbowIndex: number, wristIndex: number) => {
      const armConfidence = confidence([shoulderIndex, elbowIndex, wristIndex]);
      if (armConfidence < CONFIG.confidenceThreshold) return { confidence: 0 };
      const shoulder = imagePoint(points[shoulderIndex], width, height);
      const elbow = imagePoint(points[elbowIndex], width, height);
      const wrist = imagePoint(points[wristIndex], width, height);
      const elevation = calculateAngle({ x: shoulder.x + torsoDown.x, y: shoulder.y + torsoDown.y }, shoulder, elbow);
      const innerElbow = calculateAngle(shoulder, elbow, wrist);
      if (elevation === undefined || innerElbow === undefined
        || Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y) < torsoLength * 0.05
        || Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y) < torsoLength * 0.05) return { confidence: 0 };
      return { elevation, bend: 180 - innerElbow, confidence: armConfidence };
    };
    // Anatomical IDs remain unchanged by the mirrored webcam element.
    const left = arm(11, 13, 15);
    const right = arm(12, 14, 16);
    return {
      leftArmElevation: left.elevation, rightArmElevation: right.elevation,
      leftElbowBend: left.bend, rightElbowBend: right.bend,
      leftArmConfidence: left.confidence, rightArmConfidence: right.confidence,
      torsoLean: Math.atan2(-torsoDown.x, torsoDown.y) * 180 / Math.PI,
      activeKneeAngle: knee, centerX: hips.x, bodyScale: shoulderWidth / width,
      trackingConfidence: Math.min(torsoConfidence, kneeConfidence, pose.confidence), timestampMs: frame.timestampMs,
    };
  }
}
