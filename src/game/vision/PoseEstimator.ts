import { clearInferencePerformance, recordInferencePerformance, setGpuWarmup } from '../performance/performanceMetrics';
import { POSE_CONFIG } from './poseConfig';
import { createPoseLandmarker, personMask, type PoseEstimatorAssets, type PoseLandmarkerResultLike } from './poseLandmarker';
import type { PoseFrame } from './poseTypes';
import { PoseWorkerClient } from './PoseWorkerClient';
import type { PoseInference } from './poseWorkerMessages';
import { WorkerPerformancePolicy, type PoseDelegate, type PoseDelegatePreference } from './workerPerformancePolicy';

export { personMask } from './poseLandmarker';
export type { PoseEstimatorAssets, PoseLandmarkerResultLike, PoseSegmentationMaskLike } from './poseLandmarker';

export interface PoseLandmarkerLike {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): PoseLandmarkerResultLike;
  close(): void;
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
  onPreviewFrame?: (frame: PoseFrame) => void;
  onError?: (error: PoseEstimatorError) => void;
  maxFps?: number;
  outputSegmentationMasks?: boolean;
  baseUrl?: string;
  createLandmarker?: (assets: PoseEstimatorAssets, outputSegmentationMasks: boolean) => Promise<PoseLandmarkerLike>;
  createWorker?: () => Worker;
  createBitmap?: (video: HTMLVideoElement) => Promise<ImageBitmap>;
  delegatePreference?: PoseDelegatePreference;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
  now?: () => number;
}

export function poseEstimatorAssets(baseUrl: string): PoseEstimatorAssets {
  const root = `${baseUrl.replace(/\/?$/, '/')}mediapipe`;
  return { wasmRoot: `${root}/wasm`, modelPath: `${root}/models/pose_landmarker_lite.task` };
}

function createWorker(): Worker {
  return new Worker(new URL('./poseInference.worker.ts', import.meta.url), { type: 'module' });
}

function captureBitmap(create: (video: HTMLVideoElement) => Promise<ImageBitmap>, video: HTMLVideoElement): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new Error('Camera frame transfer timed out.'));
    }, 2500);
    Promise.resolve().then(() => create(video)).then(bitmap => {
      clearTimeout(timer);
      if (expired) bitmap.close();
      else resolve(bitmap);
    }, error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export class PoseEstimator {
  private readonly options: PoseEstimatorOptions;
  private readonly requestFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (id: number) => void;
  private readonly now: () => number;
  private readonly intervalMs: number;
  private readonly outputSegmentationMasks: boolean;
  private landmarker?: PoseLandmarkerLike;
  private worker?: PoseWorkerClient;
  private workerBusy = false;
  private workerDelegate: PoseDelegate;
  private readonly delegatePolicy: WorkerPerformancePolicy;
  private gpuAwaitingLandmarks = false;
  private mainOnly = false;
  private fallbackReason?: string;
  private initializing?: Promise<void>;
  private video?: HTMLVideoElement;
  private frameId?: number;
  private videoFrameId?: number;
  private latestVideoFrame?: { count: number; timestampMs: number };
  private sampledVideoFrame?: number;
  private running = false;
  private destroyed = false;
  private generation = 0;
  private startGeneration = 0;
  private visibilityGeneration = 0;
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
    const queryDelegate = new URLSearchParams(globalThis.location?.search).get('poseDelegate');
    const preference = options.delegatePreference ?? (queryDelegate === 'gpu' ? 'GPU' : queryDelegate === 'cpu' ? 'CPU' : 'auto');
    this.workerDelegate = preference === 'GPU' ? 'GPU' : 'CPU';
    this.delegatePolicy = new WorkerPerformancePolicy(preference);
    const maxFps = Math.max(1, Math.min(25, options.maxFps ?? 25));
    // Allow a 1 ms margin for refresh timestamps rounded just below the 10 FPS interval.
    this.intervalMs = 1000 / maxFps - (maxFps === 10 ? 1 : 0);
    this.outputSegmentationMasks = options.outputSegmentationMasks ?? true;
  }

  initialize(): Promise<void> {
    if (this.destroyed) return Promise.reject(new PoseEstimatorError('cancelled'));
    if (this.initializing) return this.initializing;
    if (this.landmarker || this.worker) return Promise.resolve();
    const generation = this.generation;
    const assets = poseEstimatorAssets(this.options.baseUrl ?? import.meta.env?.BASE_URL ?? '/');
    const pending = (async () => {
      try {
        if (this.shouldUseWorker()) {
          if (await this.initializeWorker(assets, generation)) return;
          if (this.workerDelegate === 'GPU') {
            this.workerDelegate = 'CPU';
            this.delegatePolicy.finish();
            this.fallbackReason = 'gpu-startup';
            if (await this.initializeWorker(assets, generation)) return;
          }
          this.mainOnly = true;
          this.fallbackReason = 'startup';
        }
        this.requireGeneration(generation);
        const landmarker = await (this.options.createLandmarker ?? createPoseLandmarker)(assets, this.outputSegmentationMasks);
        if (generation !== this.generation) {
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

  private requireGeneration(generation: number): void {
    if (generation !== this.generation) throw new PoseEstimatorError('cancelled');
  }

  private shouldUseWorker(): boolean {
    const forcedMain = new URLSearchParams(globalThis.location?.search).get('poseBackend') === 'main';
    if (forcedMain || this.mainOnly || (this.options.createLandmarker && !this.options.createWorker)) return false;
    if (!this.options.createWorker && (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function'
      || typeof createImageBitmap !== 'function')) {
      this.fallbackReason = 'unsupported';
      return false;
    }
    return true;
  }

  private async initializeWorker(assets: PoseEstimatorAssets, generation: number): Promise<boolean> {
    try {
      this.gpuAwaitingLandmarks = this.workerDelegate === 'GPU';
      setGpuWarmup(this, this.gpuAwaitingLandmarks);
      const worker = new PoseWorkerClient((this.options.createWorker ?? createWorker)());
      this.worker = worker;
      const base = globalThis.document?.baseURI;
      await worker.initialize({
        wasmRoot: new URL(assets.wasmRoot, base).href,
        modelPath: new URL(assets.modelPath, base).href,
      }, this.outputSegmentationMasks, this.workerDelegate);
      this.requireGeneration(generation);
      return true;
    } catch {
      setGpuWarmup(this, false);
      this.worker?.close();
      this.worker = undefined;
      this.requireGeneration(generation);
      return false;
    }
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
    if (this.videoFrameId !== undefined) this.video?.cancelVideoFrameCallback(this.videoFrameId);
    this.frameId = undefined;
    this.videoFrameId = undefined;
    this.latestVideoFrame = undefined;
    this.sampledVideoFrame = undefined;
    globalThis.document?.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.previousFrameMs = undefined;
    this.poseFps = 0;
    clearInferencePerformance(this);
  }

  resume(): void {
    if (this.destroyed || this.running || !this.video) return;
    this.running = true;
    this.lastInferenceMs = -Infinity;
    globalThis.document?.addEventListener('visibilitychange', this.onVisibilityChange);
    this.watchVideoFrames(this.video);
    this.schedule();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    ++this.generation;
    this.pause();
    const landmarker = this.landmarker;
    this.landmarker = undefined;
    this.worker?.close();
    this.worker = undefined;
    this.video = undefined;
    try { landmarker?.close(); } catch {
      // Camera ownership is separate; callers must still be able to release it.
    }
  }

  private schedule(): void {
    if (this.running && this.frameId === undefined) this.frameId = this.requestFrame(this.tick);
  }

  private readonly onVisibilityChange = (): void => {
    if (!globalThis.document?.hidden) return;
    this.visibilityGeneration++;
    this.latestVideoFrame = undefined;
    this.previousFrameMs = undefined;
    this.poseFps = 0;
    clearInferencePerformance(this);
  };

  private watchVideoFrames(video: HTMLVideoElement): void {
    if (typeof video.requestVideoFrameCallback !== 'function' || typeof video.cancelVideoFrameCallback !== 'function') return;
    const generation = this.startGeneration;
    const observe: VideoFrameRequestCallback = (now, frame) => {
      if (!this.running || generation !== this.startGeneration) return;
      if (!globalThis.document?.hidden) {
        const timestampMs = Number.isFinite(frame.presentationTime) ? Math.min(now, frame.presentationTime) : now;
        this.latestVideoFrame = { count: frame.presentedFrames, timestampMs };
        if (this.worker && !this.options.requestFrame) this.tryInfer(now);
      }
      this.videoFrameId = video.requestVideoFrameCallback(observe);
    };
    this.videoFrameId = video.requestVideoFrameCallback(observe);
  }

  private readonly tick: FrameRequestCallback = (timestampMs): void => {
    this.frameId = undefined;
    if (!this.running || this.destroyed) return;
    this.tryInfer(timestampMs);
    this.schedule();
  };

  private tryInfer(timestampMs: number): void {
    if (!this.running || this.destroyed || globalThis.document?.hidden) return;
    const video = this.video;
    const frame = this.latestVideoFrame;
    const freshVideo = this.videoFrameId === undefined
      ? video?.currentTime !== this.lastVideoTime
      : frame && frame.count !== this.sampledVideoFrame && timestampMs - frame.timestampMs < POSE_CONFIG.maxDataAgeMs;
    if (video && (this.landmarker || (this.worker && !this.workerBusy && !this.initializing))
      && video.readyState >= 2 && video.videoWidth > 0
      && freshVideo && timestampMs - this.lastInferenceMs >= this.intervalMs) {
      this.lastVideoTime = video.currentTime;
      this.sampledVideoFrame = frame?.count;
      this.lastInferenceMs = timestampMs;
      const sampledAt = frame?.timestampMs ?? timestampMs;
      if (this.worker) void this.inferWithWorker(this.worker, video, sampledAt);
      else if (this.landmarker) this.inferOnMain(this.landmarker, video, sampledAt);
    }
  }

  private modelTimestamp(timestampMs: number): number {
    this.lastTimestampMs = Math.max(timestampMs, this.lastTimestampMs + 0.001);
    return this.lastTimestampMs;
  }

  private emitFrame(inference: PoseInference, timestampMs: number, backend: 'worker' | 'main',
    completedAtMs: number, framePreparationMs?: number): void {
    const frameAgeMs = Math.max(0, completedAtMs - timestampMs);
    const previewOnly = frameAgeMs >= POSE_CONFIG.maxDataAgeMs;
    setGpuWarmup(this, false);
    recordInferencePerformance(this, {
      backend, completedAtMs, inferenceMs: inference.inferenceMs, frameAgeMs, framePreparationMs,
      delegate: backend === 'worker' ? this.workerDelegate : 'CPU',
      late: previewOnly, hasLandmarks: Boolean(inference.landmarks?.length), fallbackReason: this.fallbackReason,
    });
    if (frameAgeMs >= POSE_CONFIG.maxPreviewAgeMs) return;
    if (!previewOnly) {
      this.totalInferenceMs += inference.inferenceMs;
      this.inferenceCount++;
      if (this.previousFrameMs !== undefined) {
        const instantaneousFps = 1000 / Math.max(1, timestampMs - this.previousFrameMs);
        this.poseFps = this.poseFps === 0 ? instantaneousFps : this.poseFps * 0.8 + instantaneousFps * 0.2;
      }
      this.previousFrameMs = timestampMs;
    }
    const frame: PoseFrame = {
      ...inference, timestampMs, poseFps: this.poseFps,
      averageInferenceMs: this.inferenceCount ? this.totalInferenceMs / this.inferenceCount : undefined,
      backend, fallbackReason: this.fallbackReason, previewOnly,
    };
    this.options.onPreviewFrame?.(frame);
    if (!previewOnly && this.running) this.options.onFrame(frame);
  }

  private failInference(error: unknown): void {
    this.pause();
    this.options.onError?.(new PoseEstimatorError('inference', { cause: error }));
  }

  private inferOnMain(landmarker: PoseLandmarkerLike, video: HTMLVideoElement, timestampMs: number): void {
    try {
      const startedMs = this.now();
      const result = landmarker.detectForVideo(video, this.modelTimestamp(timestampMs));
      try {
        const completedAtMs = this.now();
        const inferenceMs = Math.max(0, completedAtMs - startedMs);
        const mask = this.outputSegmentationMasks ? result.segmentationMasks?.[0] : undefined;
        this.emitFrame({
          landmarks: result.landmarks[0], personMask: mask ? personMask(mask) : undefined, inferenceMs,
          imageWidth: video.videoWidth, imageHeight: video.videoHeight,
        }, timestampMs, 'main', completedAtMs);
      } finally {
        result.close?.();
      }
    } catch (error) {
      this.failInference(error);
    }
  }

  private async inferWithWorker(worker: PoseWorkerClient, video: HTMLVideoElement, timestampMs: number): Promise<void> {
    this.workerBusy = true;
    if (this.gpuAwaitingLandmarks) setGpuWarmup(this, true);
    const generation = this.startGeneration;
    const visibilityGeneration = this.visibilityGeneration;
    const isCurrent = () => this.running && generation === this.startGeneration
      && visibilityGeneration === this.visibilityGeneration && this.worker === worker && !globalThis.document?.hidden;
    const preparingAtMs = this.now();
    let framePreparationMs: number;
    let inference: PoseInference;
    try {
      const bitmap = await captureBitmap(this.options.createBitmap ?? createImageBitmap, video);
      const preparedAtMs = this.now();
      framePreparationMs = Math.max(0, preparedAtMs - preparingAtMs);
      if (!isCurrent() || preparedAtMs - timestampMs >= POSE_CONFIG.maxDataAgeMs) {
        bitmap.close();
        return;
      }
      inference = await worker.detect(bitmap, this.modelTimestamp(timestampMs));
    } catch {
      if (this.worker === worker && !this.destroyed) {
        if (this.workerDelegate === 'GPU') this.replaceWorker(worker, 'CPU', 'gpu-runtime');
        else this.replaceWorker(worker, undefined, 'runtime');
      }
      return;
    } finally {
      this.workerBusy = false;
    }
    if (!isCurrent()) return;
    try {
      const now = this.now();
      if (inference.landmarks?.length) this.gpuAwaitingLandmarks = false;
      this.emitFrame(inference, timestampMs, 'worker', now, framePreparationMs);
      if (!isCurrent()) return;
      const nextDelegate = this.delegatePolicy.observe(this.workerDelegate, now - timestampMs, Boolean(inference.landmarks?.length));
      if (nextDelegate) this.replaceWorker(worker, nextDelegate, nextDelegate === 'CPU' ? 'gpu-trial' : undefined);
      else if (!this.options.requestFrame) this.tryInfer(now);
    } catch (error) {
      this.failInference(error);
    }
  }

  private replaceWorker(worker: PoseWorkerClient, delegate: PoseDelegate | undefined, reason?: string): void {
    worker.close();
    this.worker = undefined;
    if (delegate) this.workerDelegate = delegate;
    else this.mainOnly = true;
    if (delegate !== 'GPU') this.delegatePolicy.finish();
    this.fallbackReason = reason;
    this.previousFrameMs = undefined;
    this.poseFps = this.totalInferenceMs = this.inferenceCount = 0;
    clearInferencePerformance(this);
    void this.initialize().catch(error => {
      if (!this.destroyed) this.failInference(error);
    });
  }
}
