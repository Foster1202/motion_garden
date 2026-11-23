import { POSE_CONFIG, POSE_LANDMARK } from './poseConfig';
import { imagePoint, calculateAngle, landmarkConfidence, torsoLean } from './poseMath';
import { PoseSmoother, poseSmoothingAlpha } from './PoseSmoother';
import type { PoseCandidateState, PoseFrame, PoseLandmark, PoseSnapshot } from './poseTypes';
import { copyCalibrationProfile, type CalibrationProfile } from '../calibration/calibrationTypes';
import { observePartialBend } from './partialBend';
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
  private metric?: 'knee-angle' | 'partial';
  private requireStanding = false;
  private fullStandingSince?: number;
  private partialSignal?: number;

  constructor(private readonly requireTorsoPair = false, private readonly lowPerformanceMode = false) {}

  setCalibration(profile?: CalibrationProfile): void {
    if (profile !== undefined && !validateCalibration(profile)) {
      throw new RangeError('Invalid calibration profile.');
    }
    this.calibration = profile === undefined ? undefined : copyCalibrationProfile(profile);
    this.reset();
  }

  setMotionRange(profile: CalibrationProfile): void {
    if (!validateMotionRange(profile)) throw new RangeError('Invalid manual motion range.');
    this.calibration = copyCalibrationProfile(profile);
    this.reset();
  }

  getCalibration(): CalibrationProfile | undefined {
    return this.calibration === undefined ? undefined : copyCalibrationProfile(this.calibration);
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
    const elapsedMs = this.lowPerformanceMode && this.lastValidTimestamp !== undefined
      ? frame.timestampMs - this.lastValidTimestamp : undefined;

    const landmarks = frame.landmarks;
    const width = frame.imageWidth ?? 1;
    const height = frame.imageHeight ?? 1;
    if (!landmarks || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return this.loseTracking(nowMs, 'missing-pose', frame);
    }
    const torso = this.torso(landmarks, width, height);
    if (!torso) return this.loseTracking(nowMs, 'unreliable-or-leaning-torso', frame);
    const left = this.leg(landmarks, 'left', width, height, elapsedMs);
    const right = this.leg(landmarks, 'right', width, height, elapsedMs);
    if (!left) this.leftSmoother.reset();
    if (!right) this.rightSmoother.reset();
    const calibratedSide = this.calibration?.reliableSide;
    // Keep the precise angle cohort fixed across partial visibility.
    const legs = calibratedSide === 'left' ? [left] : calibratedSide === 'right' ? [right] : [left, right];
    const selectedLegs = legs.filter((leg): leg is { angle: number; confidence: number } => leg !== undefined);
    const fullAvailable = selectedLegs.length > 0 && (calibratedSide === undefined || selectedLegs.length === legs.length);
    const angle = fullAvailable
      ? selectedLegs.reduce((sum, leg) => sum + leg.angle, 0) / selectedLegs.length : undefined;
    const partial = observePartialBend(landmarks, width, height);
    const partialRange = this.calibration?.partial;
    const standingThreshold = this.calibration?.standingThreshold ?? POSE_CONFIG.standingAngle;
    const bendingThreshold = this.calibration?.bendingThreshold ?? POSE_CONFIG.bendingAngle;
    let metric = fullAvailable && this.calibration?.metric !== 'partial' ? 'knee-angle' as const : 'partial' as const;
    if (!partial) {
      this.partialSignal = undefined;
      if (metric === 'partial') return this.loseTracking(nowMs, calibratedSide
        ? 'calibrated-legs-unavailable' : 'unreliable-legs', frame);
    } else {
      const signal = this.partialSignal ?? partial.signal;
      this.partialSignal = signal + (partial.signal - signal) * poseSmoothingAlpha(POSE_CONFIG.smoothingAlpha, elapsedMs);
    }

    // Return to exact angles only at a stable standing pose in both calibrated metrics.
    if (metric === 'knee-angle' && this.metric === 'partial' && partial && partialRange) {
      const standing = angle! >= standingThreshold && partial.signal <= partialRange.standingThreshold;
      if (standing) this.fullStandingSince ??= frame.timestampMs;
      else this.fullStandingSince = undefined;
      if (!standing || frame.timestampMs - this.fullStandingSince! < POSE_CONFIG.debounceMs) metric = 'partial';
    } else this.fullStandingSince = undefined;
    if (this.metric !== metric) {
      this.requireStanding = this.metric !== undefined && Boolean(partialRange);
      this.metric = metric;
      this.candidate = undefined;
      this.candidateSince = frame.timestampMs;
    }

    const estimatedBendAmount = metric === 'partial' && partialRange && this.partialSignal !== undefined
      ? Math.max(0, Math.min(1, (this.partialSignal - partialRange.standing) / partialRange.range)) : undefined;
    const nextCandidate: PoseCandidateState | undefined = metric === 'knee-angle'
      ? angle! >= standingThreshold ? 'STANDING' : angle! <= bendingThreshold ? 'BENDING' : undefined
      : !partialRange || this.partialSignal === undefined ? undefined
        : this.partialSignal <= partialRange.standingThreshold ? 'STANDING'
          : this.partialSignal >= partialRange.bendingThreshold ? 'BENDING' : undefined;
    if (nextCandidate !== this.candidate) {
      this.candidate = nextCandidate;
      this.candidateSince = frame.timestampMs;
    }
    const candidateMs = nextCandidate ? frame.timestampMs - this.candidateSince : 0;
    const confirmed = candidateMs >= POSE_CONFIG.debounceMs;
    if (this.requireStanding && confirmed && nextCandidate === 'STANDING') this.requireStanding = false;
    const lacksCalibratedMetric = metric === 'partial' && !partialRange && this.calibration?.timestamp !== 0
      && Boolean(this.calibration);
    const trackingTransition = this.requireStanding || lacksCalibratedMetric;
    const state = nextCandidate && confirmed && !trackingTransition ? nextCandidate : 'TRANSITION';
    this.lastValidTimestamp = frame.timestampMs;
    this.lostSince = undefined;
    this.current = {
      state, trackingMode: metric === 'knee-angle' ? 'full' : 'partial', trackingTransition,
      leftKneeAngle: left?.angle, rightKneeAngle: right?.angle,
      activeKneeAngle: metric === 'knee-angle' ? angle : undefined,
      partialBendSignal: partial?.signal, estimatedBendAmount,
      confidence: metric === 'partial' ? partial!.confidence
        : Math.min(torso.confidence, ...selectedLegs.map(leg => leg.confidence)),
      reliableSides: metric === 'partial' ? 2 : selectedLegs.length,
      reason: lacksCalibratedMetric ? 'partial-calibration-required' : undefined,
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
    this.metric = undefined;
    this.requireStanding = false;
    this.lostSince = undefined;
    this.current = this.emptySnapshot();
  }

  private leg(points: readonly PoseLandmark[], side: 'left' | 'right', width: number, height: number,
    elapsedMs?: number): { angle: number; confidence: number } | undefined {
    const hip = points[POSE_LANDMARK[`${side}Hip`]];
    const knee = points[POSE_LANDMARK[`${side}Knee`]];
    const ankle = points[POSE_LANDMARK[`${side}Ankle`]];
    const confidence = Math.min(landmarkConfidence(hip), landmarkConfidence(knee), landmarkConfidence(ankle));
    if (confidence < POSE_CONFIG.confidenceThreshold) return undefined;
    if (calculateAngle(imagePoint(hip, width, height), imagePoint(knee, width, height), imagePoint(ankle, width, height)) === undefined) return undefined;
    const smoother = side === 'left' ? this.leftSmoother : this.rightSmoother;
    const [smoothHip, smoothKnee, smoothAnkle] = smoother.updateLandmarks([hip, knee, ankle], elapsedMs);
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
    if (reliable.length < (this.requireTorsoPair ? 2 : 1)) return undefined;
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
      ...this.emptySnapshot(), state: 'TRACKING_LOST', trackingMode: 'lost',
      timestampMs: frame?.timestampMs ?? this.current.timestampMs,
      inferenceMs: frame?.inferenceMs ?? this.current.inferenceMs,
      poseFps: frame?.poseFps ?? this.current.poseFps,
      trackingLostMs, autoRestRecommended: false, reason,
    };
    return { ...this.current };
  }

  private clearSignal(): void {
    this.leftSmoother.reset();
    this.rightSmoother.reset();
    this.candidate = undefined;
    this.candidateSince = 0;
    this.lastValidTimestamp = undefined;
    this.fullStandingSince = undefined;
    this.partialSignal = undefined;
  }

  private emptySnapshot(): PoseSnapshot {
    return { state: 'UNKNOWN', trackingMode: 'lost', confidence: 0, reliableSides: 0, candidateMs: 0, timestampMs: 0,
      inferenceMs: 0, poseFps: 0, trackingLostMs: 0, autoRestRecommended: false };
  }
}
