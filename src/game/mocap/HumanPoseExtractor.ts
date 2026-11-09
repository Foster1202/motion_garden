import { MathUtils, Vector3 } from 'three';
import { LegExtensionDetector, type BerryMotionSample } from './LegExtensionDetector';
import { validateMotionRange } from '../settings/motionRange';
import type { CalibrationProfile } from '../calibration/calibrationTypes';
import { calculateAngle, imagePoint, landmarkConfidence } from '../vision/poseMath';
import type { PoseFrame, PoseLandmark, PoseSnapshot } from '../vision/poseTypes';
import { MOCAP_CONFIG as CONFIG } from './mocapConfig';

/** Raw camera coordinates before CSS mirroring, with optional qualitative monocular depth. */
export interface HumanPose {
  leftArmElevation?: number;
  rightArmElevation?: number;
  leftArmPlane?: number;
  rightArmPlane?: number;
  leftElbowBend?: number;
  rightElbowBend?: number;
  leftArmConfidence: number;
  rightArmConfidence: number;
  torsoLean: number;
  torsoForward?: number;
  headYaw?: number;
  headPitch?: number;
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
    const depthAvailable = [11, 12, 23, 24].every(index => Number.isFinite(points[index].z));
    const torsoDown = new Vector3((hips.x - shoulders.x) * width, (hips.y - shoulders.y) * height,
      depthAvailable ? ((points[23].z! + points[24].z!) - (points[11].z! + points[12].z!)) * width / 2 : 0);
    const torsoLength = torsoDown.length();
    const down = torsoDown.clone().normalize();
    const sideways = new Vector3(down.y, -down.x, 0).normalize();
    const forward = down.clone().cross(sideways).normalize();
    const shoulderWidth = Math.hypot((points[11].x - points[12].x) * width,
      (points[11].y - points[12].y) * height);
    if (torsoDown.y <= 0 || torsoLength < height * 0.02 || shoulderWidth < width * 0.025) return undefined;
    const arm = (shoulderIndex: number, elbowIndex: number, wristIndex: number) => {
      const armConfidence = confidence([shoulderIndex, elbowIndex, wristIndex]);
      if (armConfidence < CONFIG.confidenceThreshold) return { confidence: 0 };
      const useDepth = depthAvailable && [shoulderIndex, elbowIndex, wristIndex].every(index => Number.isFinite(points[index].z));
      const point = (index: number) => new Vector3(points[index].x * width, points[index].y * height,
        useDepth ? points[index].z! * width : 0);
      const upper = point(elbowIndex).sub(point(shoulderIndex));
      const lower = point(wristIndex).sub(point(elbowIndex));
      if (upper.length() < torsoLength * 0.05 || lower.length() < torsoLength * 0.05) return { confidence: 0 };
      const armDown = useDepth ? down : new Vector3(torsoDown.x, torsoDown.y, 0).normalize();
      const elevation = MathUtils.radToDeg(upper.angleTo(armDown));
      // Normalized landmark z uses image-width scale, and is only a bounded visual cue.
      const forwardReach = useDepth ? Math.max(0, upper.dot(forward)) : 0;
      const plane = forwardReach > torsoLength * 0.03
        ? MathUtils.radToDeg(Math.atan2(forwardReach, Math.abs(upper.dot(sideways)))) : 0;
      return { elevation, plane, bend: MathUtils.radToDeg(upper.angleTo(lower)), confidence: armConfidence };
    };
    // Anatomical IDs remain unchanged by the mirrored webcam element.
    const left = arm(11, 13, 15);
    const right = arm(12, 14, 16);
    const faceReliable = confidence([0, 7, 8]) >= CONFIG.confidenceThreshold;
    const earX = faceReliable ? (points[7].x + points[8].x) / 2 : 0;
    const earY = faceReliable ? (points[7].y + points[8].y) / 2 : 0;
    return {
      leftArmElevation: left.elevation, rightArmElevation: right.elevation,
      leftElbowBend: left.bend, rightElbowBend: right.bend,
      leftArmPlane: left.plane, rightArmPlane: right.plane,
      leftArmConfidence: left.confidence, rightArmConfidence: right.confidence,
      torsoLean: Math.atan2(-torsoDown.x, torsoDown.y) * 180 / Math.PI,
      torsoForward: depthAvailable ? MathUtils.radToDeg(Math.atan2(torsoDown.z, torsoDown.y)) : undefined,
      headYaw: faceReliable ? MathUtils.radToDeg(Math.atan2(-(points[0].x - earX) * width, shoulderWidth / 2)) : undefined,
      headPitch: faceReliable ? MathUtils.radToDeg(Math.atan2((points[0].y - earY) * height, shoulderWidth / 2)) : undefined,
      activeKneeAngle: knee, centerX: hips.x, bodyScale: shoulderWidth / width,
      trackingConfidence: Math.min(torsoConfidence, kneeConfidence, pose.confidence), timestampMs: frame.timestampMs,
    };
  }
}
