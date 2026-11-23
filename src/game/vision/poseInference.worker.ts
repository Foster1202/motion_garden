import { createPoseLandmarker, personMask } from './poseLandmarker';
import type { PoseInference, PoseWorkerRequest, PoseWorkerResponse } from './poseWorkerMessages';

const worker = self as unknown as {
  onmessage: (event: MessageEvent<PoseWorkerRequest>) => void;
  postMessage: (message: PoseWorkerResponse, transfer?: Transferable[]) => void;
};
let landmarker: Awaited<ReturnType<typeof createPoseLandmarker>> | undefined;
let outputSegmentationMasks = false;

worker.onmessage = async ({ data }) => {
  try {
    if (data.kind === 'initialize') {
      outputSegmentationMasks = data.outputSegmentationMasks;
      landmarker = await createPoseLandmarker(data.assets, outputSegmentationMasks, true);
      worker.postMessage({ kind: 'ready' });
      return;
    }

    const { bitmap, frameId, timestampMs } = data;
    try {
      if (!landmarker) throw new Error('Pose model has not initialized.');
      const started = performance.now();
      const result = landmarker.detectForVideo(bitmap, timestampMs);
      try {
        const inferenceMs = performance.now() - started;
        const mask = outputSegmentationMasks ? result.segmentationMasks?.[0] : undefined;
        const inference: PoseInference = {
          landmarks: result.landmarks[0], personMask: mask ? personMask(mask) : undefined,
          inferenceMs, imageWidth: bitmap.width, imageHeight: bitmap.height,
        };
        const transfer = inference.personMask ? [inference.personMask.alpha.buffer as ArrayBuffer] : [];
        worker.postMessage({ kind: 'result', frameId, inference }, transfer);
      } finally {
        result.close();
      }
    } finally {
      bitmap.close();
    }
  } catch {
    worker.postMessage({ kind: 'failure' });
  }
};
