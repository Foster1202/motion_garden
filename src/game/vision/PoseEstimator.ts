import type { PoseFrame, PoseLandmark } from './poseTypes';

export interface PoseLandmarkerLike {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): { landmarks: PoseLandmark[][] };
  close(): void;
}

export interface PoseEstimatorAssets {
  wasmRoot: string;
  modelPath: string;
}

export class PoseEstimatorError extends Error {
  constructor(readonly code: 'model-load' | 'inference' | 'cancelled', options?: ErrorOptions) {
    super(code === 'model-load'
      ? '未能載入動作偵測模型，請重試，或改用鍵盤模式。'
      : code === 'inference'
        ? '動作偵測暫時中斷，請重試，或改用鍵盤模式。'
        : '動作偵測啟動已取消。', options);
    this.name = 'PoseEstimatorError';
  }
}

export interface PoseEstimatorOptions {
  onFrame: (frame: PoseFrame) => void;
  onError?: (error: PoseEstimatorError) => void;
  maxFps?: number;
  baseUrl?: string;
  createLandmarker?: (assets: PoseEstimatorAssets) => Promise<PoseLandmarkerLike>;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
  now?: () => number;
}

export function poseEstimatorAssets(baseUrl: string): PoseEstimatorAssets {
  const root = `${baseUrl.replace(/\/?$/, '/')}mediapipe`;
  return { wasmRoot: `${root}/wasm`, modelPath: `${root}/models/pose_landmarker_lite.task` };
}

async function createLandmarker(assets: PoseEstimatorAssets): Promise<PoseLandmarkerLike> {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(assets.wasmRoot);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: assets.modelPath, delegate: 'CPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.55,
    minPosePresenceConfidence: 0.55,
    minTrackingConfidence: 0.55,
    outputSegmentationMasks: false,
  });
}

export class PoseEstimator {
  private readonly options: PoseEstimatorOptions;
  private readonly requestFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (id: number) => void;
  private readonly now: () => number;
  private readonly intervalMs: number;
  private landmarker?: PoseLandmarkerLike;
  private initializing?: Promise<void>;
  private video?: HTMLVideoElement;
  private frameId?: number;
  private running = false;
  private destroyed = false;
  private generation = 0;
  private startGeneration = 0;
  private lastVideoTime = -1;
  private lastInferenceMs = -Infinity;
  private lastTimestampMs = -Infinity;
  private previousFrameMs?: number;
  private poseFps = 0;
  private totalInferenceMs = 0;
  private inferenceCount = 0;

  constructor(options: PoseEstimatorOptions) {
    this.options = options;
    this.requestFrame = options.requestFrame ?? requestAnimationFrame.bind(globalThis);
    this.cancelFrame = options.cancelFrame ?? cancelAnimationFrame.bind(globalThis);
    this.now = options.now ?? (() => performance.now());
    this.intervalMs = 1000 / Math.max(1, Math.min(25, options.maxFps ?? 25));
  }

  initialize(): Promise<void> {
    if (this.destroyed) return Promise.reject(new PoseEstimatorError('cancelled'));
    if (this.landmarker) return Promise.resolve();
    if (this.initializing) return this.initializing;
    const generation = this.generation;
    const assets = poseEstimatorAssets(this.options.baseUrl ?? import.meta.env?.BASE_URL ?? '/');
    const pending = (async () => {
      try {
        const landmarker = await (this.options.createLandmarker ?? createLandmarker)(assets);
        if (this.destroyed || generation !== this.generation) {
          landmarker.close();
          throw new PoseEstimatorError('cancelled');
        }
        this.landmarker = landmarker;
      } catch (error) {
        if (error instanceof PoseEstimatorError) throw error;
        throw new PoseEstimatorError('model-load', { cause: error });
      }
    })();
    this.initializing = pending;
    void pending.finally(() => {
      if (this.initializing === pending) this.initializing = undefined;
    }).catch(() => undefined);
    return pending;
  }

  async start(video: HTMLVideoElement): Promise<void> {
    const generation = this.generation;
    const startGeneration = ++this.startGeneration;
    await this.initialize();
    if (this.destroyed || generation !== this.generation || startGeneration !== this.startGeneration) {
      throw new PoseEstimatorError('cancelled');
    }
    this.pause();
    this.video = video;
    this.lastVideoTime = -1;
    this.resume();
  }

  pause(): void {
    ++this.startGeneration;
    this.running = false;
    if (this.frameId !== undefined) this.cancelFrame(this.frameId);
    this.frameId = undefined;
    this.previousFrameMs = undefined;
    this.poseFps = 0;
  }

  resume(): void {
    if (this.destroyed || this.running || !this.landmarker || !this.video) return;
    this.running = true;
    this.lastInferenceMs = -Infinity;
    this.schedule();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    ++this.generation;
    this.pause();
    const landmarker = this.landmarker;
    this.landmarker = undefined;
    this.video = undefined;
    try { landmarker?.close(); } catch {
      // Camera ownership is separate; callers must still be able to release it.
    }
  }

  private schedule(): void {
    if (this.running && !this.destroyed) this.frameId = this.requestFrame(this.tick);
  }

  private readonly tick: FrameRequestCallback = (timestampMs): void => {
    this.frameId = undefined;
    if (!this.running || this.destroyed) return;
    const video = this.video;
    if (video && this.landmarker && video.readyState >= 2 && video.videoWidth > 0
      && video.currentTime !== this.lastVideoTime && timestampMs - this.lastInferenceMs >= this.intervalMs) {
      this.lastVideoTime = video.currentTime;
      this.lastInferenceMs = timestampMs;
      const modelTimestamp = Math.max(timestampMs, this.lastTimestampMs + 0.001);
      this.lastTimestampMs = modelTimestamp;
      try {
        const startedMs = this.now();
        const result = this.landmarker.detectForVideo(video, modelTimestamp);
        const inferenceMs = Math.max(0, this.now() - startedMs);
        this.totalInferenceMs += inferenceMs;
        this.inferenceCount++;
        if (this.previousFrameMs !== undefined) {
          const instantaneousFps = 1000 / Math.max(1, timestampMs - this.previousFrameMs);
          this.poseFps = this.poseFps === 0 ? instantaneousFps : this.poseFps * 0.8 + instantaneousFps * 0.2;
        }
        this.previousFrameMs = timestampMs;
        this.options.onFrame({
          landmarks: result.landmarks[0], timestampMs, inferenceMs, poseFps: this.poseFps,
          averageInferenceMs: this.totalInferenceMs / this.inferenceCount,
          imageWidth: video.videoWidth, imageHeight: video.videoHeight,
        });
      } catch (error) {
        this.pause();
        this.options.onError?.(new PoseEstimatorError('inference', { cause: error }));
      }
    }
    this.schedule();
  };
}
