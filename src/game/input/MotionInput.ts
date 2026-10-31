export interface MotionSample {
  bending: boolean;
  standing: boolean;
}

export type MotionInputMode = 'camera' | 'keyboard';

export interface MotionInputStatus {
  mode: MotionInputMode | null;
  ready: boolean;
  suspended: boolean;
  requestPause: boolean;
  message: string;
}

export interface MotionInput {
  sample(): MotionSample;
  reset(): void;
  destroy(): void;
  pause?(): void;
  resume?(): void;
  getStatus?(): MotionInputStatus;
}
