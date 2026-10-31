import { POSE_CONFIG, POSE_LANDMARK } from './poseConfig';
import { imagePoint, calculateAngle, landmarkConfidence, torsoLean } from './poseMath';
import { PoseSmoother } from './PoseSmoother';
import type { PoseCandidateState, PoseFrame, PoseLandmark, PoseSnapshot } from './poseTypes';
import type { CalibrationProfile } from '../calibration/calibrationTypes';
import { validateMotionRange } from '../settings/motionRange';
import { validateCalibration } from '../calibration/calibrationMath';

export class PoseClassifier {
  private readonly leftSmoother = new PoseSmoother();
  private readonly rightSmoother = new PoseSmoother();
  private candidate: PoseCandidateState | undefined;
  private candidateSince = 0;
  private lastValidTimestamp: number | undefined;
  private lostSince: number | undefined;
  private current: PoseSnapshot = this.emptySnapshot();
  private calibration?: CalibrationProfile;

  setCalibration(profile?: CalibrationProfile): void {
    if (profile !== undefined && !validateCalibration(profile)) {
      throw new RangeError('Invalid calibration profile.');
    }
    this.calibration = profile === undefined ? undefined : { ...profile };
    this.reset();
  }

  setMotionRange(profile: CalibrationProfile): void {
    if (!validateMotionRange(profile)) throw new RangeError('Invalid manual motion range.');
    this.calibration = { ...profile };
    this.reset();
  }

  getCalibration(): CalibrationProfile | undefined {
    return this.calibration === undefined ? undefined : { ...this.calibration };
  }

  update(frame: PoseFrame, nowMs = frame.timestampMs): PoseSnapshot {
    if (!Number.isFinite(nowMs) || !Number.isFinite(frame.timestampMs)
      || frame.timestampMs > nowMs || nowMs - frame.timestampMs > POSE_CONFIG.maxDataAgeMs) {
      return this.loseTracking(nowMs, 'stale-frame', frame);
    }
    if (this.lastValidTimestamp !== undefined && frame.timestampMs <= this.lastValidTimestamp) {
      return this.loseTracking(nowMs, 'non-increasing-timestamp', frame);
    }
    if (this.lastValidTimestamp !== undefined
      && frame.timestampMs - this.lastValidTimestamp > POSE_CONFIG.maxFrameGapMs) this.clearSignal();

    const landmarks = frame.landmarks;
    const width = frame.imageWidth ?? 1;
    const height = frame.imageHeight ?? 1;
    if (!landmarks || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return this.loseTracking(nowMs, 'missing-pose', frame);
    }
    const torso = this.torso(landmarks, width, height);
    if (!torso) return this.loseTracking(nowMs, 'unreliable-or-leaning-torso', frame);
    const left = this.leg(landmarks, 'left', width, height);
    const right = this.leg(landmarks, 'right', width, height);
    if (!left && !right) return this.loseTracking(nowMs, 'unreliable-legs', frame);
    const calibratedSide = this.calibration?.reliableSide;
    if ((calibratedSide === 'both' && (!left || !right))
      || (calibratedSide === 'left' && !left) || (calibratedSide === 'right' && !right)) {
      return this.loseTracking(nowMs, 'calibrated-legs-unavailable', frame);
    }

    const leftKneeAngle = left?.angle;
    const rightKneeAngle = right?.angle;
    if (!left) this.leftSmoother.reset();
    if (!right) this.rightSmoother.reset();
    // Keep the calibrated angle cohort even when another leg enters or leaves the frame.
    const selectedLegs = (calibratedSide === 'left' ? [left] : calibratedSide === 'right' ? [right] : [left, right])
      .filter((leg): leg is { angle: number; confidence: number } => leg !== undefined);
    const angles = selectedLegs.map(leg => leg.angle);
    const activeKneeAngle = angles.reduce((sum, angle) => sum + angle, 0) / angles.length;
    const standingThreshold = this.calibration?.standingThreshold ?? POSE_CONFIG.standingAngle;
    const bendingThreshold = this.calibration?.bendingThreshold ?? POSE_CONFIG.bendingAngle;
    const nextCandidate: PoseCandidateState | undefined = activeKneeAngle >= standingThreshold
      ? 'STANDING' : activeKneeAngle <= bendingThreshold ? 'BENDING' : undefined;
    if (nextCandidate !== this.candidate) {
      this.candidate = nextCandidate;
      this.candidateSince = frame.timestampMs;
    }
    const candidateMs = nextCandidate ? frame.timestampMs - this.candidateSince : 0;
    const state = nextCandidate && candidateMs >= POSE_CONFIG.debounceMs ? nextCandidate : 'TRANSITION';
    this.lastValidTimestamp = frame.timestampMs;
    this.lostSince = undefined;
    this.current = {
      state, leftKneeAngle, rightKneeAngle, activeKneeAngle,
      confidence: Math.min(torso.confidence, ...selectedLegs.map(leg => leg.confidence)),
      reliableSides: angles.length,
      candidateState: nextCandidate, candidateMs,
      timestampMs: frame.timestampMs,
      inferenceMs: frame.inferenceMs,
      poseFps: frame.poseFps,
      trackingLostMs: 0,
      autoRestRecommended: false,
    };
    return { ...this.current };
  }

  snapshot(nowMs: number): PoseSnapshot {
    if (this.lastValidTimestamp !== undefined && nowMs - this.lastValidTimestamp > POSE_CONFIG.maxDataAgeMs) {
      return this.loseTracking(nowMs, 'stale-frame', undefined, this.lastValidTimestamp + POSE_CONFIG.maxDataAgeMs);
    }
    if (this.current.state === 'TRACKING_LOST') return this.loseTracking(nowMs, this.current.reason ?? 'missing-pose');
    return { ...this.current };
  }

  reset(): void {
    this.clearSignal();
    this.lostSince = undefined;
    this.current = this.emptySnapshot();
  }

  private leg(points: readonly PoseLandmark[], side: 'left' | 'right', width: number, height: number): { angle: number; confidence: number } | undefined {
    const hip = points[POSE_LANDMARK[`${side}Hip`]];
    const knee = points[POSE_LANDMARK[`${side}Knee`]];
    const ankle = points[POSE_LANDMARK[`${side}Ankle`]];
    const confidence = Math.min(landmarkConfidence(hip), landmarkConfidence(knee), landmarkConfidence(ankle));
    if (confidence < POSE_CONFIG.confidenceThreshold) return undefined;
    if (calculateAngle(imagePoint(hip, width, height), imagePoint(knee, width, height), imagePoint(ankle, width, height)) === undefined) return undefined;
    const smoother = side === 'left' ? this.leftSmoother : this.rightSmoother;
    const [smoothHip, smoothKnee, smoothAnkle] = smoother.updateLandmarks([hip, knee, ankle]);
    const angle = calculateAngle(imagePoint(smoothHip, width, height), imagePoint(smoothKnee, width, height), imagePoint(smoothAnkle, width, height));
    return angle === undefined ? undefined : { angle, confidence };
  }

  private torso(points: readonly PoseLandmark[], width: number, height: number): { confidence: number } | undefined {
    const reliable = (['left', 'right'] as const).flatMap(side => {
      const shoulder = points[POSE_LANDMARK[`${side}Shoulder`]];
      const hip = points[POSE_LANDMARK[`${side}Hip`]];
      const confidence = Math.min(landmarkConfidence(shoulder), landmarkConfidence(hip));
      if (confidence < POSE_CONFIG.confidenceThreshold) return [];
      return [{ shoulder: imagePoint(shoulder, width, height), hip: imagePoint(hip, width, height), confidence }];
    });
    if (!reliable.length) return undefined;
    const mean = (part: 'shoulder' | 'hip') => ({
      x: reliable.reduce((sum, side) => sum + side[part].x, 0) / reliable.length,
      y: reliable.reduce((sum, side) => sum + side[part].y, 0) / reliable.length,
    });
    const lean = torsoLean(mean('shoulder'), mean('hip'));
    if (lean === undefined || lean > POSE_CONFIG.maxTorsoLeanDegrees) return undefined;
    return { confidence: Math.min(...reliable.map(side => side.confidence)) };
  }

  private loseTracking(nowMs: number, reason: string, frame?: PoseFrame, startMs = nowMs): PoseSnapshot {
    this.clearSignal();
    this.lostSince ??= Number.isFinite(startMs) ? startMs : 0;
    const trackingLostMs = Number.isFinite(nowMs) ? Math.max(0, nowMs - this.lostSince) : 0;
    this.current = {
      ...this.emptySnapshot(), state: 'TRACKING_LOST',
      timestampMs: frame?.timestampMs ?? this.current.timestampMs,
      inferenceMs: frame?.inferenceMs ?? this.current.inferenceMs,
      poseFps: frame?.poseFps ?? this.current.poseFps,
      trackingLostMs, autoRestRecommended: trackingLostMs >= POSE_CONFIG.autoRestMs, reason,
    };
    return { ...this.current };
  }

  private clearSignal(): void {
    this.leftSmoother.reset();
    this.rightSmoother.reset();
    this.candidate = undefined;
    this.candidateSince = 0;
    this.lastValidTimestamp = undefined;
  }

  private emptySnapshot(): PoseSnapshot {
    return { state: 'UNKNOWN', confidence: 0, reliableSides: 0, candidateMs: 0, timestampMs: 0,
      inferenceMs: 0, poseFps: 0, trackingLostMs: 0, autoRestRecommended: false };
  }
}
