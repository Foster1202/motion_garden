import assert from 'node:assert/strict';
import test from 'node:test';
import { PoseWorkerClient } from '../src/game/vision/PoseWorkerClient';
import type { PoseWorkerRequest, PoseWorkerResponse } from '../src/game/vision/poseWorkerMessages';

test('GPU requests get the shader warmup deadline until the first detected pose', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests: PoseWorkerRequest[] = [];
  let terminations = 0;
  const worker = {
    onmessage: null as ((event: MessageEvent<PoseWorkerResponse>) => void) | null,
    postMessage: (request: PoseWorkerRequest) => { requests.push(request); },
    terminate: () => { terminations++; },
  };
  const client = new PoseWorkerClient(worker as unknown as Worker);
  const emit = (data: PoseWorkerResponse) => worker.onmessage!({ data } as MessageEvent<PoseWorkerResponse>);
  const bitmap = { close() {} } as ImageBitmap;
  const inference = { imageWidth: 320, imageHeight: 240, inferenceMs: 3000 };

  try {
    const startup = client.initialize({ wasmRoot: '/wasm', modelPath: '/model' }, false, 'GPU');
    const initialize = requests[0];
    assert.equal(initialize.kind, 'initialize');
    assert.equal(initialize.delegate, 'GPU');
    emit({ kind: 'ready' });
    await startup;

    const empty = client.detect(bitmap, 10);
    t.mock.timers.tick(3000);
    emit({ kind: 'result', frameId: 1, inference });
    assert.equal((await empty).landmarks, undefined);

    const firstPose = client.detect(bitmap, 20);
    t.mock.timers.tick(3000);
    emit({ kind: 'result', frameId: 2, inference: { ...inference, landmarks: [{ x: 0.5, y: 0.5 }] } });
    assert.equal((await firstPose).landmarks?.length, 1);

    const timedOut = assert.rejects(client.detect(bitmap, 30), /timed out/);
    t.mock.timers.tick(2501);
    await timedOut;
    assert.equal(terminations, 1);
  } finally {
    client.close();
    t.mock.timers.reset();
  }
});
