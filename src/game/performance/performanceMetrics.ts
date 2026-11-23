import type { PoseFrame } from '../vision/poseTypes';
import { MainThreadPerformanceProbe, percentile95, VideoPerformanceProbe } from './framePerformance';

type PoseMetrics = Pick<PoseFrame,
  'timestampMs' | 'inferenceMs' | 'averageInferenceMs' | 'poseFps' | 'imageWidth' | 'imageHeight'>;

interface InferenceSample {
  inferenceMs: number;
  completedAtMs: number;
  backend: 'worker' | 'main';
  fallbackReason?: string;
}

let enabled = false;
let pose: { owner: object; metrics: PoseMetrics } | undefined;
let threeFrames = 0;
let cameraBinding: { video: HTMLVideoElement } | undefined;
let videoProbe: VideoPerformanceProbe | undefined;
let threadProbe: MainThreadPerformanceProbe | undefined;
let inference: { owner: object; latest: InferenceSample; durations: number[]; windowCount: number } | undefined;

export function setPerformanceMonitoring(active: boolean): void {
  videoProbe?.stop();
  threadProbe?.stop();
  enabled = active;
  pose = undefined;
  inference = undefined;
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
  if (inference?.owner !== owner) inference = { owner, latest: sample, durations: [], windowCount: 0 };
  inference.latest = sample;
  inference.windowCount++;
  inference.durations.push(sample.inferenceMs);
  if (inference.durations.length > 120) inference.durations.shift();
}

export function clearInferencePerformance(owner: object): void {
  if (inference?.owner === owner) inference = undefined;
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
    completedFps: inference.windowCount * 1000 / elapsedMs,
  } : undefined;
  const sample = { pose: pose?.metrics, ai, camera, thread: threadProbe?.read(), threeFrames };
  threeFrames = 0;
  if (inference) inference.windowCount = 0;
  return sample;
}
