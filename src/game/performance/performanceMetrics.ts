import type { PoseFrame } from '../vision/poseTypes';

type PoseMetrics = Pick<PoseFrame,
  'timestampMs' | 'inferenceMs' | 'averageInferenceMs' | 'poseFps' | 'imageWidth' | 'imageHeight'>;

let enabled = false;
let pose: { owner: object; metrics: PoseMetrics } | undefined;
let threeFrames = 0;

export function setPerformanceMonitoring(active: boolean): void {
  enabled = active;
  pose = undefined;
  threeFrames = 0;
}

export function recordPosePerformance(owner: object, frame: PoseFrame): void {
  if (!enabled) return;
  const { timestampMs, inferenceMs, averageInferenceMs, poseFps, imageWidth, imageHeight } = frame;
  pose = { owner, metrics: { timestampMs, inferenceMs, averageInferenceMs, poseFps, imageWidth, imageHeight } };
}

export function clearPosePerformance(owner: object): void {
  if (pose?.owner === owner) pose = undefined;
}

export function recordThreeFrame(): void {
  if (enabled) threeFrames++;
}

export function readPerformanceWindow(): { pose?: PoseMetrics; threeFrames: number } {
  const sample = { pose: pose?.metrics, threeFrames };
  threeFrames = 0;
  return sample;
}
