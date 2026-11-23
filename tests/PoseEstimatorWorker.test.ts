import assert from 'node:assert/strict';
import test from 'node:test';
import { PoseEstimator, type PoseEstimatorOptions } from '../src/game/vision/PoseEstimator';
import type { PoseFrame } from '../src/game/vision/poseTypes';
import type { PoseWorkerRequest, PoseWorkerResponse } from '../src/game/vision/poseWorkerMessages';

const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

class WorkerFixture {
  readonly messages: PoseWorkerRequest[] = [];
  readonly transfers: Transferable[][] = [];
  onmessage: ((event: MessageEvent<PoseWorkerResponse>) => void) | null = null;
  onerror?: ((event: ErrorEvent) => void) | null;
  onmessageerror?: ((event: MessageEvent) => void) | null;
  terminations = 0;
  constructor(private readonly boot: 'ready' | 'failure' | 'hold') {}
  postMessage(message: PoseWorkerRequest, transfer: Transferable[]) {
    this.messages.push(message);
    this.transfers.push(transfer);
    if (message.kind === 'initialize' && this.boot !== 'hold') {
      const kind = this.boot;
      queueMicrotask(() => this.reply({ kind }));
    }
  }
  reply(data: PoseWorkerResponse) {
    this.onmessage?.({ data } as MessageEvent<PoseWorkerResponse>);
  }
  terminate() { this.terminations++; }
  get detectionRequests() {
    return this.messages.filter(message => message.kind === 'detect');
  }
  complete(frameId = this.detectionRequests.at(-1)?.frameId) {
    assert.notEqual(frameId, undefined);
    this.reply({ kind: 'result', frameId: frameId!, inference: {
      inferenceMs: 20, landmarks: [{ x: .4, y: .5 }], imageWidth: 320, imageHeight: 240,
    } });
  }
}

function fixture(boot: 'ready' | 'failure' | 'hold' = 'ready', overrides: Partial<PoseEstimatorOptions> = {}) {
  const frames: PoseFrame[] = [];
  const raf = new Map<number, FrameRequestCallback>();
  const callbacks = new Map<number, VideoFrameRequestCallback>();
  const captured: number[] = [];
  const errors: Error[] = [];
  let handle = 0;
  let clock = 0;
  let presentedFrames = 0;
  let mainModelLoads = 0;
  let mainModelCloses = 0;
  const worker = new WorkerFixture(boot);
  const video = {
    readyState: 2, videoWidth: 320, videoHeight: 240, currentTime: 0,
    requestVideoFrameCallback: (callback: VideoFrameRequestCallback) => { callbacks.set(++handle, callback); return handle; },
    cancelVideoFrameCallback: (id: number) => { callbacks.delete(id); },
  };
  const estimator = new PoseEstimator({
    baseUrl: 'https://test.invalid/nested/', outputSegmentationMasks: false,
    now: () => clock,
    onFrame: frame => frames.push(frame), onError: error => errors.push(error),
    requestFrame: callback => { raf.set(++handle, callback); return handle; },
    cancelFrame: id => { raf.delete(id); },
    createWorker: () => worker as unknown as Worker,
    createLandmarker: async () => {
      mainModelLoads++;
      return { detectForVideo: () => ({ landmarks: [] }), close: () => { mainModelCloses++; } };
    },
    createBitmap: async element => {
      captured.push(element.currentTime);
      return { close: () => undefined } as ImageBitmap;
    },
    ...overrides,
  });
  const present = (timestamp: number, videoTime = timestamp / 1000) => {
    clock = timestamp;
    video.currentTime = videoTime;
    const [id, callback] = Array.from(callbacks.entries())[0];
    callbacks.delete(id);
    callback(timestamp, { mediaTime: videoTime, presentedFrames: ++presentedFrames, presentationTime: timestamp } as VideoFrameCallbackMetadata);
  };
  const tick = (timestamp: number) => {
    clock = timestamp;
    const [id, callback] = Array.from(raf.entries())[0];
    raf.delete(id);
    callback(timestamp);
  };
  return { worker, video, callbacks, frames, estimator, errors, captured, present, tick,
    start: () => estimator.start(video as unknown as HTMLVideoElement), setTime: (value: number) => { clock = value; },
    mainModelLoads: () => mainModelLoads, mainModelCloses: () => mainModelCloses };
}

test('worker transfers one bitmap at a time and samples the latest presented frame after backlog', async () => {
  const f = fixture();
  await f.start();
  try {
    assert.deepEqual(f.worker.messages[0], { kind: 'initialize', assets: {
      wasmRoot: 'https://test.invalid/nested/mediapipe/wasm',
      modelPath: 'https://test.invalid/nested/mediapipe/models/pose_landmarker_lite.task',
    }, outputSegmentationMasks: false });
    f.present(10); f.tick(12);
    await nextTurn();
    const [first] = f.worker.detectionRequests;
    assert.equal(first.timestampMs, 10);
    assert.equal(f.worker.transfers[1][0], first.bitmap);
    f.present(60); f.tick(63);
    f.present(120); f.tick(122);
    await nextTurn();
    assert.deepEqual(f.captured, [.01]);
    f.worker.complete(first.frameId + 100);
    await nextTurn();
    assert.equal(f.frames.length, 0);
    f.worker.complete();
    await nextTurn();
    f.tick(130);
    await nextTurn();
    assert.deepEqual(f.captured, [.01, .12]);
    assert.equal(f.worker.detectionRequests[1].timestampMs, 120);
    f.worker.complete();
    await nextTurn();
    f.video.currentTime = .2; f.tick(200);
    await nextTurn();
    assert.deepEqual(f.captured, [.01, .12], 'video clock alone must not cause duplicate inference');
    assert.deepEqual(f.frames.map(frame => [frame.timestampMs, frame.backend, frame.inferenceMs]), [[10, 'worker', 20], [120, 'worker', 20]]);
  } finally {
    f.estimator.destroy();
  }
  assert.equal(f.worker.terminations, 1);
  assert.equal(f.callbacks.size, 0);
  assert.equal(f.mainModelLoads(), 0);
});

test('sustained CPU delay tries GPU once, and GPU failure returns to CPU Worker without reopening video', async () => {
  const cpu = new WorkerFixture('ready');
  const gpu = new WorkerFixture('ready');
  const recovered = new WorkerFixture('ready');
  const backends = [cpu, gpu, recovered];
  let workersCreated = 0;
  const f = fixture('ready', { delegatePreference: 'auto',
    createWorker: () => backends[workersCreated++] as unknown as Worker });
  await f.start();
  try {
    for (let frame = 0; frame < 6; frame++) {
      const start = 20 + frame * 200;
      f.present(start);
      f.tick(start);
      await nextTurn();
      f.setTime(start + 175);
      cpu.complete();
      await nextTurn();
    }
    assert.equal(cpu.terminations, 1);
    assert.equal(gpu.messages[0].kind, 'initialize');
    assert.equal(gpu.messages[0].delegate, 'GPU');
    f.present(1250);
    f.tick(1250);
    await nextTurn();
    gpu.reply({ kind: 'failure' });
    await nextTurn();
    assert.equal(gpu.terminations, 1);
    assert.equal(recovered.messages[0].kind, 'initialize');
    assert.equal(recovered.messages[0].delegate, undefined);
    f.present(1300);
    f.tick(1300);
    await nextTurn();
    f.setTime(1330);
    recovered.complete();
    await nextTurn();
    assert.equal(f.frames.at(-1)?.fallbackReason, 'gpu-runtime');
    assert.equal(f.frames.at(-1)?.backend, 'worker');
    assert.equal(workersCreated, 3);
    assert.equal(f.mainModelLoads(), 0);
  } finally {
    f.estimator.destroy();
  }
});

test('pause during bitmap creation closes the late bitmap without transferring or starting new work', async () => {
  let release!: (bitmap: ImageBitmap) => void;
  let closed = 0;
  const f = fixture('ready', { createBitmap: () => new Promise(resolve => { release = resolve; }) });
  await f.start();
  try {
    f.present(10); f.tick(12);
    await nextTurn();
    f.estimator.pause();
    assert.equal(f.callbacks.size, 0);
    f.estimator.resume();
    f.present(60); f.tick(70);
    assert.equal(f.worker.detectionRequests.length, 0);
    release({ close: () => { closed++; } } as ImageBitmap);
    await nextTurn();
    assert.equal(closed, 1);
    assert.equal(f.worker.detectionRequests.length, 0);
    assert.equal(f.frames.length, 0);
  } finally {
    f.estimator.destroy();
  }
});

test('pose completions past validity and across pause/resume cannot reach gameplay', async () => {
  const previews: PoseFrame[] = [];
  const f = fixture('ready', { onPreviewFrame: frame => previews.push(frame) });
  await f.start();
  try {
    f.present(10); f.tick(12);
    await nextTurn();
    f.setTime(260);
    f.worker.complete();
    await nextTurn();
    assert.equal(f.frames.length, 0);
    assert.deepEqual(previews.map(frame => [frame.timestampMs, frame.previewOnly]), [[10, true]]);
    f.present(280); f.tick(283);
    await nextTurn();
    f.estimator.pause();
    f.estimator.resume();
    f.present(320); f.tick(323);
    assert.equal(f.worker.detectionRequests.length, 2);
    f.worker.complete();
    await nextTurn();
    assert.equal(f.frames.length, 0);
    assert.equal(previews.length, 1);
    f.tick(340);
    await nextTurn();
    f.worker.complete();
    await nextTurn();
    assert.deepEqual(f.frames.map(frame => [frame.timestampMs, frame.poseFps]), [[320, 0]]);
    assert.deepEqual(previews.map(frame => [frame.timestampMs, frame.previewOnly]), [[10, true], [320, false]]);
    f.present(420); f.tick(425);
    await nextTurn();
    f.setTime(1170);
    f.worker.complete();
    await nextTurn();
    assert.equal(previews.length, 2, 'results beyond the visual budget must not draw a skeleton');
  } finally {
    f.estimator.destroy();
  }
});

test('startup failure and runtime failure transparently switch to a single main CPU backend', async () => {
  const startup = fixture('failure');
  await startup.start();
  startup.present(10); startup.tick(11);
  assert.equal(startup.frames[0]?.backend, 'main');
  assert.equal(startup.frames[0]?.fallbackReason, 'startup');
  assert.equal(startup.worker.terminations, 1);
  startup.estimator.destroy();

  const runtime = fixture();
  await runtime.start();
  try {
    runtime.present(20); runtime.tick(22);
    await nextTurn();
    runtime.worker.reply({ kind: 'failure' });
    await nextTurn();
    assert.equal(runtime.worker.terminations, 1);
    assert.equal(runtime.mainModelLoads(), 1);
    runtime.present(70); runtime.tick(73);
    assert.equal(runtime.frames[0]?.backend, 'main');
    assert.equal(runtime.frames[0]?.fallbackReason, 'runtime');
    assert.deepEqual(runtime.errors, []);
  } finally {
    runtime.estimator.destroy();
  }
  assert.equal(runtime.mainModelCloses(), 1);
});

test('destroy during initialization terminates the suspended worker and aborts without loading fallback', async () => {
  const f = fixture('hold');
  const pending = f.start();
  f.estimator.destroy();
  await assert.rejects(pending, { code: 'cancelled' });
  assert.equal(f.worker.terminations, 1);
  assert.equal(f.mainModelLoads(), 0);
  assert.equal(f.callbacks.size, 0);
});

test('unresponsive worker times out and releases its single submitted task', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  await f.start();
  try {
    f.present(10); f.tick(12);
    await nextTurn();
    context.mock.timers.tick(2501);
    await nextTurn();
    assert.equal(f.worker.terminations, 1);
    f.present(2600); f.tick(2602);
    assert.equal(f.frames[0]?.fallbackReason, 'runtime');
  } finally {
    f.estimator.destroy();
  }
});
