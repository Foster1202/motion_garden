import type { CalibrationState } from '../calibration/calibrationTypes';

export interface MotionSample {
  bending: boolean;
  standing: boolean;
}

export type MotionInputMode = 'camera' | 'keyboard';
export type CameraTrackingState = 'CAMERA_INITIALIZING' | 'WAITING_FOR_PERSON' | 'PERSON_DETECTED'
  | 'TRACKING_UNSTABLE' | 'TRACKING_LOST' | 'TRACKING_READY';

export interface MotionInputStatus {
  mode: MotionInputMode | null;
  ready: boolean;
  suspended: boolean;
  requestPause: boolean;
  message: string;
  cameraStatus?: 'initializing' | 'running' | 'paused' | 'stopped';
  trackingState?: CameraTrackingState;
  personDetected?: boolean;
  poseFps?: number;
  framesReceived?: number;
  lastFrameTimestampMs?: number;
  calibrationState?: CalibrationState;
  calibrationReady?: boolean;
}

export interface MotionInput {
  sample(): MotionSample;
  reset(): void;
  destroy(): void;
  pause?(): void;
  resume?(): void;
  getStatus?(): MotionInputStatus;
}
