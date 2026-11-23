import assert from 'node:assert/strict';
import test from 'node:test';
import { personMask, PoseEstimator, PoseEstimatorError, poseEstimatorAssets, type PoseEstimatorOptions,
  type PoseLandmarkerLike } from '../src/game/vision/PoseEstimator';
import type { PoseFrame } from '../src/game/vision/poseTypes';

function setupEstimator(detect?: PoseLandmarkerLike['detectForVideo'],
  options?: Pick<PoseEstimatorOptions, 'maxFps' | 'outputSegmentationMasks'>) {
  const pendingFrames = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  let createCount = 0;
  let closeCount = 0;
  let clock = 0;
  const timestamps: number[] = [];
  const frames: PoseFrame[] = [];
  const errors: PoseEstimatorError[] = [];
  const maskOptions: boolean[] = [];
  const video = { readyState: 2, videoWidth: 640, videoHeight: 360, currentTime: 0 } as HTMLVideoElement;
  const estimator = new PoseEstimator({
    ...options,
    onFrame: (frame) => frames.push(frame), onError: (error) => errors.push(error),
    baseUrl: '/motion-garden/', now: () => { clock += 4; return clock; },
    createLandmarker: async (assets, outputSegmentationMasks) => {
      assert.equal(assets.modelPath, '/motion-garden/mediapipe/models/pose_landmarker_lite.task');
      maskOptions.push(outputSegmentationMasks);
      createCount++;
      return {
        detectForVideo: detect ?? ((_video, timestampMs) => { timestamps.push(timestampMs); return { landmarks: [[{ x: 0.5, y: 0.5 }]] }; }),
        close: () => { closeCount++; },
      };
    },
    requestFrame: (callback) => { pendingFrames.set(++nextId, callback); return nextId; },
    cancelFrame: (id) => { pendingFrames.delete(id); },
  });
  const tick = (timestamp: number, currentTime: number) => {
    video.currentTime = currentTime;
    const [id, callback] = [...pendingFrames][0] ?? [];
    assert.ok(callback);
    pendingFrames.delete(id);
    callback(timestamp);
  };
  return { estimator, video, frames, errors, timestamps, pendingFrames, maskOptions, tick,
    createCount: () => createCount, closeCount: () => closeCount };
}

test('model is lazy, BASE_URL paths are local, and inference uses distinct frames throttled at 25 FPS', async () => {
  assert.deepEqual(poseEstimatorAssets('/'), { wasmRoot: '/mediapipe/wasm', modelPath: '/mediapipe/models/pose_landmarker_lite.task' });
  const fixture = setupEstimator();
  assert.equal(fixture.createCount(), 0);
  assert.equal(fixture.pendingFrames.size, 0);
  await Promise.all([fixture.estimator.initialize(), fixture.estimator.initialize()]);
  assert.equal(fixture.createCount(), 1);
  await fixture.estimator.start(fixture.video);
  fixture.tick(0, 0);
  fixture.tick(20, 1);
  fixture.tick(40, 1);
  fixture.tick(80, 1);
  fixture.tick(120, 2);
  assert.deepEqual(fixture.timestamps, [0, 40, 120]);
  assert.equal(fixture.frames[1].poseFps, 25);
  assert.equal(fixture.frames[0].inferenceMs, 4);
  assert.equal(fixture.frames[0].imageWidth, 640);
  assert.equal(fixture.frames[0].imageHeight, 360);
  fixture.estimator.pause();
  assert.equal(fixture.pendingFrames.size, 0);
  fixture.estimator.resume();
  fixture.tick(200, 3);
  assert.equal(fixture.frames[3].poseFps, 0);
  fixture.estimator.destroy();
  fixture.estimator.destroy();
  assert.equal(fixture.closeCount(), 1);
  assert.equal(fixture.pendingFrames.size, 0);
});

test('no detected pose still emits a frame and inference failure pauses the loop', async () => {
  let count = 0;
  const fixture = setupEstimator(() => {
    if (++count === 1) return { landmarks: [] };
    throw new Error('mock inference failure');
  });
  await fixture.estimator.start(fixture.video);
  fixture.tick(0, 0);
  assert.equal(fixture.frames[0].landmarks, undefined);
  fixture.tick(40, 1);
  assert.equal(fixture.errors[0].code, 'inference');
  assert.equal(fixture.pendingFrames.size, 0);
  fixture.estimator.destroy();
});

test('person segmentation is copied into a feathered alpha mask and inference results are closed', async () => {
  let resultClosed = 0;
  const fixture = setupEstimator(() => ({
    landmarks: [[{ x: .5, y: .5 }]],
    segmentationMasks: [{ width: 2, height: 2,
      getAsFloat32Array: () => new Float32Array([0, .15, .5, 1]) }],
    close: () => { resultClosed++; },
  }));
  await fixture.estimator.start(fixture.video);
  fixture.tick(0, 0);
  assert.deepEqual(fixture.frames[0].personMask, {
    width: 2, height: 2, alpha: new Uint8ClampedArray([0, 0, 128, 255]),
  });
  assert.equal(resultClosed, 1);
  assert.deepEqual(fixture.maskOptions, [true]);
  fixture.estimator.destroy();
});

test('low cadence keeps fresh frames near 10 FPS and skips disabled mask conversion', async () => {
  const times: number[] = [];
  let closed = 0;
  const fixture = setupEstimator((_video, timestamp) => {
    times.push(timestamp);
    return {
      landmarks: [[{ x: .5, y: .5 }]],
      segmentationMasks: [{ width: 1, height: 1, getAsFloat32Array: () => assert.fail('Unexpected mask conversion') }],
      close: () => { closed++; },
    };
  }, { maxFps: 10, outputSegmentationMasks: false });
  Object.assign(fixture.video, { videoWidth: 424, videoHeight: 240 });
  await fixture.estimator.start(fixture.video);
  fixture.tick(0, 0);
  fixture.tick(50, 1);
  fixture.tick(98.7, 2);
  fixture.tick(99.9, 2);
  fixture.tick(199.8, 2);
  fixture.tick(215, 3);
  assert.deepEqual(fixture.maskOptions, [false]);
  assert.deepEqual(times, [0, 99.9, 215]);
  assert.equal(closed, 3);
  assert.equal(fixture.frames[2].personMask, undefined);
  assert.deepEqual(fixture.frames[2].landmarks, [{ x: .5, y: .5 }]);
  assert.ok(fixture.frames[2].poseFps > 9 && fixture.frames[2].poseFps < 10.1);
  assert.equal(fixture.frames[2].averageInferenceMs, 4);
  assert.equal(fixture.frames[2].imageWidth, 424);
  assert.equal(fixture.frames[2].imageHeight, 240);
  fixture.estimator.destroy();
});

test('invalid segmentation dimensions are rejected without affecting landmark output', () => {
  assert.equal(personMask({ width: 2, height: 2,
    getAsFloat32Array: () => new Float32Array([1]) }), undefined);
});

test('destroy during initialization closes a late model and never schedules frames', async () => {
  let release!: (landmarker: PoseLandmarkerLike) => void;
  let closed = 0;
  const estimator = new PoseEstimator({
    onFrame: () => assert.fail('Unexpected frame'), requestFrame: () => assert.fail('Unexpected RAF'),
    cancelFrame: () => undefined, createLandmarker: () => new Promise((resolve) => { release = resolve; }),
  });
  const initializing = estimator.initialize();
  estimator.destroy();
  release({ detectForVideo: () => ({ landmarks: [] }), close: () => { closed++; } });
  await assert.rejects(initializing, (error: PoseEstimatorError) => error.code === 'cancelled');
  assert.equal(closed, 1);
});

test('pause during pending start cancels automatic activation while keeping the initialized model reusable', async () => {
  let release!: (landmarker: PoseLandmarkerLike) => void;
  let frameRequests = 0;
  const estimator = new PoseEstimator({
    onFrame: () => undefined, requestFrame: () => ++frameRequests, cancelFrame: () => undefined,
    createLandmarker: () => new Promise((resolve) => { release = resolve; }),
  });
  const pending = estimator.start({} as HTMLVideoElement);
  estimator.pause();
  release({ detectForVideo: () => ({ landmarks: [] }), close: () => undefined });
  await assert.rejects(pending, (error: PoseEstimatorError) => error.code === 'cancelled');
  assert.equal(frameRequests, 0);
  await estimator.start({} as HTMLVideoElement);
  assert.equal(frameRequests, 1);
  estimator.destroy();
});

test('failed model initialization yields a typed load error and permits retry', async () => {
  let count = 0;
  const estimator = new PoseEstimator({
    onFrame: () => undefined, requestFrame: () => 1, cancelFrame: () => undefined,
    createLandmarker: async () => {
      if (++count === 1) throw new Error('mock fetch failure');
      return { detectForVideo: () => ({ landmarks: [] }), close: () => undefined };
    },
  });
  await assert.rejects(estimator.initialize(), (error: PoseEstimatorError) => error.code === 'model-load');
  await estimator.initialize();
  assert.equal(count, 2);
  estimator.destroy();
});


test('failed model close still cancels inference and makes destroy idempotent', async () => {
  let closeCount = 0;
  const pendingFrames = new Map<number, FrameRequestCallback>();
  const estimator = new PoseEstimator({
    onFrame: () => assert.fail('Unexpected frame'),
    requestFrame: callback => { pendingFrames.set(1, callback); return 1; },
    cancelFrame: id => { pendingFrames.delete(id); },
    createLandmarker: async () => ({
      detectForVideo: () => ({ landmarks: [] }),
      close: () => { closeCount++; throw new Error('Mock close failure'); },
    }),
  });
  await estimator.start({} as HTMLVideoElement);
  assert.equal(pendingFrames.size, 1);
  assert.doesNotThrow(() => estimator.destroy());
  estimator.destroy();
  estimator.resume();
  assert.equal(pendingFrames.size, 0);
  assert.equal(closeCount, 1);
});
