import type { PoseFrame, PoseLandmark } from './poseTypes';

export interface PoseSegmentationMaskLike {
  width: number;
  height: number;
  getAsFloat32Array(): Float32Array;
}

export interface PoseLandmarkerResultLike {
  landmarks: readonly (readonly PoseLandmark[])[];
  segmentationMasks?: readonly PoseSegmentationMaskLike[];
  close?(): void;
}

export interface PoseEstimatorAssets {
  wasmRoot: string;
  modelPath: string;
}

export type PoseDelegate = 'CPU' | 'GPU';

export async function createPoseLandmarker(
  assets: PoseEstimatorAssets,
  outputSegmentationMasks: boolean,
  useModule = false,
  delegate: PoseDelegate = 'CPU',
) {
  let canvas: OffscreenCanvas | undefined;
  if (delegate === 'GPU') {
    canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext('webgl2', { antialias: false, failIfMajorPerformanceCaveat: true });
    if (!context) throw new Error('Hardware WebGL2 is unavailable for pose inference.');
    const debug = context.getExtension('WEBGL_debug_renderer_info');
    const renderer = debug && String(context.getParameter(debug.UNMASKED_RENDERER_WEBGL));
    if (renderer && /SwiftShader|llvmpipe|softpipe|Basic Render Driver|Software Rasterizer/i.test(renderer)) {
      context.getExtension('WEBGL_lose_context')?.loseContext();
      throw new Error('Software WebGL2 cannot accelerate pose inference.');
    }
  }
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(assets.wasmRoot, useModule);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: assets.modelPath, delegate },
    canvas,
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.55,
    minPosePresenceConfidence: 0.55,
    minTrackingConfidence: 0.55,
    outputSegmentationMasks,
  });
}

export function personMask(mask: PoseSegmentationMaskLike): PoseFrame['personMask'] {
  const width = Math.floor(mask.width);
  const height = Math.floor(mask.height);
  const probabilities = mask.getAsFloat32Array();
  if (width <= 0 || height <= 0 || probabilities.length !== width * height) return undefined;
  const alpha = new Uint8ClampedArray(probabilities.length);
  for (let index = 0; index < probabilities.length; index++) {
    const probability = probabilities[index];
    if (!Number.isFinite(probability)) continue;
    const normalized = Math.max(0, Math.min(1, (probability - .15) / .7));
    const feathered = normalized * normalized * (3 - 2 * normalized);
    alpha[index] = Math.round(feathered * 255);
  }
  return { width, height, alpha };
}
