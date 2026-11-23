import type { PoseEstimatorAssets } from './poseLandmarker';
import type { PoseFrame } from './poseTypes';

export type PoseInference = Pick<PoseFrame, 'landmarks' | 'personMask' | 'inferenceMs' | 'imageWidth' | 'imageHeight'>;

export type PoseWorkerRequest =
  | { kind: 'initialize'; assets: PoseEstimatorAssets; outputSegmentationMasks: boolean }
  | { kind: 'detect'; frameId: number; timestampMs: number; bitmap: ImageBitmap };

export type PoseWorkerResponse =
  | { kind: 'ready' }
  | { kind: 'result'; frameId: number; inference: PoseInference }
  | { kind: 'failure' };
