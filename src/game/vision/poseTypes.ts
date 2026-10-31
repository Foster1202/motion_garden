export type PoseState = 'UNKNOWN' | 'STANDING' | 'TRANSITION' | 'BENDING' | 'TRACKING_LOST';
export type PoseCandidateState = 'STANDING' | 'BENDING';

export interface PoseLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
}

export interface PoseFrame {
  landmarks?: readonly PoseLandmark[];
  timestampMs: number;
  inferenceMs: number;
  averageInferenceMs?: number;
  poseFps: number;
  imageWidth?: number;
  imageHeight?: number;
}

export interface PoseSnapshot {
  state: PoseState;
  leftKneeAngle?: number;
  rightKneeAngle?: number;
  activeKneeAngle?: number;
  confidence: number;
  reliableSides: number;
  candidateState?: PoseCandidateState;
  candidateMs: number;
  timestampMs: number;
  inferenceMs: number;
  poseFps: number;
  trackingLostMs: number;
  autoRestRecommended: boolean;
  reason?: string;
}
