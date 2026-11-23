import type { PoseEstimatorAssets } from './poseLandmarker';
import type { PoseInference, PoseWorkerRequest, PoseWorkerResponse } from './poseWorkerMessages';

const STARTUP_TIMEOUT_MS = 20_000;
const INFERENCE_TIMEOUT_MS = 2_500;

export class PoseWorkerClient {
  private ready = false;
  private closed = false;
  private frameId = 0;
  private pending?: {
    frameId?: number;
    settle: (response: PoseWorkerResponse) => void;
    reject: (error: Error) => void;
  };

  constructor(private readonly worker: Worker) {
    worker.onmessage = ({ data }: MessageEvent<PoseWorkerResponse>) => {
      if (data.kind === 'failure') {
        this.close(new Error('Pose Worker failed.'));
      } else if ((data.kind === 'ready' && this.pending?.frameId === undefined)
        || (data.kind === 'result' && this.pending?.frameId === data.frameId)) {
        this.pending?.settle(data);
      }
    };
    worker.onerror = event => {
      event.preventDefault();
      this.close(new Error('Pose Worker error.'));
    };
    worker.onmessageerror = () => this.close(new Error('Pose Worker message could not be read.'));
  }

  async initialize(assets: PoseEstimatorAssets, outputSegmentationMasks: boolean): Promise<void> {
    const result = await this.send({ kind: 'initialize', assets, outputSegmentationMasks });
    if (result.kind !== 'ready') throw new Error('Invalid Pose Worker initialization response.');
    this.ready = true;
  }

  async detect(bitmap: ImageBitmap, timestampMs: number): Promise<PoseInference> {
    const result = await this.send({ kind: 'detect', bitmap, timestampMs, frameId: ++this.frameId });
    if (result.kind !== 'result') throw new Error('Invalid Pose Worker inference response.');
    return result.inference;
  }

  close(reason = new Error('Pose Worker closed.')): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
    this.pending?.reject(reason);
    this.worker.terminate();
  }

  private send(request: PoseWorkerRequest): Promise<PoseWorkerResponse> {
    const bitmap = request.kind === 'detect' ? request.bitmap : undefined;
    if (this.closed || this.pending || (bitmap && !this.ready)) {
      bitmap?.close();
      return Promise.reject(new Error('Pose Worker is unavailable.'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(new Error('Pose Worker timed out.')),
        request.kind === 'initialize' ? STARTUP_TIMEOUT_MS : INFERENCE_TIMEOUT_MS);
      const finish = () => {
        clearTimeout(timer);
        this.pending = undefined;
      };
      this.pending = {
        frameId: request.kind === 'detect' ? request.frameId : undefined,
        settle: data => { finish(); resolve(data); },
        reject: error => { finish(); reject(error); },
      };
      try {
        this.worker.postMessage(request, bitmap ? [bitmap] : []);
      } catch {
        bitmap?.close();
        this.close(new Error('Pose Worker transfer failed.'));
      }
    });
  }
}
