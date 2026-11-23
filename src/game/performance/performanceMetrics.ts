import type { PoseFrame } from '../vision/poseTypes';
import { MainThreadPerformanceProbe, percentile95, VideoPerformanceProbe } from './framePerformance';

type PoseMetrics = Pick<PoseFrame,
  'timestampMs' | 'inferenceMs' | 'averageInferenceMs' | 'poseFps' | 'imageWidth' | 'imageHeight'>;

interface InferenceSample {
  inferenceMs: number;
  completedAtMs: number;
  frameAgeMs: number;
  framePreparationMs?: number;
  late: boolean;
  hasLandmarks: boolean;
  backend: 'worker' | 'main';
  delegate?: 'CPU' | 'GPU';
  fallbackReason?: string;
}

let enabled = false;
let pose: { owner: object; metrics: PoseMetrics } | undefined;
let threeFrames = 0;
let cameraBinding: { video: HTMLVideoElement } | undefined;
let videoProbe: VideoPerformanceProbe | undefined;
let threadProbe: MainThreadPerformanceProbe | undefined;
let warmingGpuOwner: object | undefined;
let inference: { owner: object; latest: InferenceSample; durations: number[]; ages: number[];
  windowCount: number; lateCount: number; landmarksCount: number } | undefined;

export function setPerformanceMonitoring(active: boolean): void {
  videoProbe?.stop();
  threadProbe?.stop();
  enabled = active;
  pose = undefined;
  inference = undefined;
  warmingGpuOwner = undefined;
  threeFrames = 0;
  const video = cameraBinding?.video;
  videoProbe = active && video ? new VideoPerformanceProbe(video) : undefined;
  threadProbe = active ? new MainThreadPerformanceProbe() : undefined;
}

export function attachCameraPerformance(element: HTMLVideoElement): () => void {
  videoProbe?.stop();
  const binding = { video: element };
  cameraBinding = binding;
  videoProbe = enabled ? new VideoPerformanceProbe(element) : undefined;
  return () => {
    if (cameraBinding !== binding) return;
    videoProbe?.stop();
    videoProbe = cameraBinding = undefined;
  };
}

export function recordPosePerformance(owner: object, frame: PoseFrame): void {
  if (!enabled) return;
  const { timestampMs, inferenceMs, averageInferenceMs, poseFps, imageWidth, imageHeight } = frame;
  pose = { owner, metrics: { timestampMs, inferenceMs, averageInferenceMs, poseFps, imageWidth, imageHeight } };
}

export function clearPosePerformance(owner: object): void {
  if (pose?.owner === owner) pose = undefined;
}

export function recordInferencePerformance(owner: object, sample: InferenceSample): void {
  if (!enabled) return;
  if (inference?.owner !== owner) inference = { owner, latest: sample, durations: [], ages: [],
    windowCount: 0, lateCount: 0, landmarksCount: 0 };
  inference.latest = sample;
  inference.windowCount++;
  if (sample.late) inference.lateCount++;
  if (sample.hasLandmarks) inference.landmarksCount++;
  inference.durations.push(sample.inferenceMs);
  inference.ages.push(sample.frameAgeMs);
  if (inference.durations.length > 120) {
    inference.durations.shift();
    inference.ages.shift();
  }
}

export function setGpuWarmup(owner: object, active: boolean): void {
  if (active && enabled) warmingGpuOwner = owner;
  else if (warmingGpuOwner === owner) warmingGpuOwner = undefined;
}

export function clearInferencePerformance(owner: object): void {
  if (inference?.owner === owner) inference = undefined;
  setGpuWarmup(owner, false);
}

export function recordThreeFrame(): void {
  if (enabled) threeFrames++;
}

export function readPerformanceWindow(elapsedMs: number) {
  const video = cameraBinding?.video;
  const track = (video?.srcObject as MediaStream | undefined)?.getVideoTracks?.()[0];
  const settings = track?.getSettings?.();
  const camera = video ? {
    width: video.videoWidth || settings?.width,
    height: video.videoHeight || settings?.height,
    trackFps: settings?.frameRate,
    ...videoProbe?.read(elapsedMs),
  } : undefined;
  const ai = inference ? {
    ...inference.latest,
    p95Ms: percentile95(inference.durations),
    frameAgeP95Ms: percentile95(inference.ages),
    completedFps: inference.windowCount * 1000 / elapsedMs,
    windowCount: inference.windowCount, lateCount: inference.lateCount, landmarksCount: inference.landmarksCount,
  } : undefined;
  const sample = { pose: pose?.metrics, ai, camera, thread: threadProbe?.read(), threeFrames,
    warmingGpu: warmingGpuOwner !== undefined };
  threeFrames = 0;
  if (inference) inference.windowCount = inference.lateCount = inference.landmarksCount = 0;
  return sample;
}
