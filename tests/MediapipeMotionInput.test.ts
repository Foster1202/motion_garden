import assert from 'node:assert/strict';
import test from 'node:test';
import { MediapipeMotionInput } from '../src/game/input/MediapipeMotionInput';
import { PoseCameraError } from '../src/game/vision/PoseCamera';
import type { PoseEstimatorOptions } from '../src/game/vision/PoseEstimator';
import type { PoseLandmark } from '../src/game/vision/poseTypes';
import { CarrotRound } from '../src/game/systems/CarrotRound';
import type { CalibrationProfile } from '../src/game/calibration/calibrationTypes';

const profileC: CalibrationProfile = {
  standingAngle: 155, bendingAngle: 135, range: 20,
  standingThreshold: 151, bendingThreshold: 142, timestamp: 1000,
};

function fixture(failure?: Error) {
  let clock = 0;
  let callbacks!: PoseEstimatorOptions;
  const calls = { camera: 0, cameraDestroyed: 0, init: 0, start: 0, pause: 0, resume: 0, estimatorDestroyed: 0 };
  const input = new MediapipeMotionInput({
    now: () => clock,
    createCamera: () => ({ start: async () => { calls.camera++; if (failure) throw failure; return {} as HTMLVideoElement; }, destroy: () => { calls.cameraDestroyed++; } }),
    createEstimator: options => {
      callbacks = options;
      return { initialize: async () => { calls.init++; }, start: async () => { calls.start++; },
        pause: () => { calls.pause++; }, resume: () => { calls.resume++; }, destroy: () => { calls.estimatorDestroyed++; } };
    },
  });
  const emit = (timestampMs: number, angle?: number) => {
    clock = timestampMs;
    let landmarks: PoseLandmark[] | undefined;
    if (angle !== undefined) {
      landmarks = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 0 }));
      for (const [shoulder, hip, knee, ankle, x] of [[11,23,25,27,.35],[12,24,26,28,.65]]) {
        const radians = angle * Math.PI / 180;
        landmarks[shoulder] = { x, y: .1, visibility: 1 };
        landmarks[hip] = { x, y: .4, visibility: 1 };
        landmarks[knee] = { x, y: .65, visibility: 1 };
        landmarks[ankle] = { x: x + .25 * Math.sin(radians), y: .65 - .25 * Math.cos(radians), visibility: 1 };
      }
    }
    callbacks.onFrame({ landmarks, timestampMs, inferenceMs: 8, poseFps: 25, imageWidth: 1000, imageHeight: 1000 });
  };
  return { input, calls, emit, setClock: (time: number) => { clock = time; } };
}

test('pose input is inactive until explicit start and maps only stable fresh poses', async () => {
  const f = fixture();
  assert.equal(f.calls.camera, 0);
  assert.deepEqual(f.input.sample(), { bending: false, standing: false });
  await f.input.start();
  for (let time = 0; time <= 160; time += 40) f.emit(time, 180);
  assert.deepEqual(f.input.sample(), { bending: false, standing: false });
  f.emit(200, 180);
  assert.deepEqual(f.input.sample(), { bending: false, standing: true });
  f.setClock(451);
  assert.deepEqual(f.input.sample(), { bending: false, standing: false });
  assert.equal(f.input.getStatus().suspended, true);
  f.input.destroy();
});

test('camera mapping preserves hold durations and freezes progress during loss and reacquisition', async () => {
  const f = fixture();
  const round = new CarrotRound();
  await f.input.start();
  for (let time = 0; time <= 480; time += 40) {
    f.emit(time, 140);
    if (!f.input.getStatus().suspended) round.update(40, f.input.sample());
  }
  assert.equal(round.state, 'BENDING');
  assert.ok(round.progress > 0 && round.progress < 1);
  const progress = round.progress;
  f.emit(520);
  assert.equal(f.input.getStatus().suspended, true);
  assert.deepEqual(f.input.sample(), { bending: false, standing: false });
  f.setClock(1120);
  assert.match(f.input.getStatus().message, /未偵測到人物/);
  assert.equal(round.progress, progress);
  for (let time = 1160; time < 1360; time += 40) {
    f.emit(time, 140);
    assert.equal(f.input.getStatus().suspended, true);
  }
  f.emit(1360, 140);
  assert.equal(f.input.getStatus().suspended, false);
  round.update(40, f.input.sample());
  assert.ok(round.progress > progress);
  for (let time = 1400; time <= 1800; time += 40) {
    f.emit(time, 140);round.update(40, f.input.sample());
  }
  assert.equal(round.state, 'GRABBED');
  assert.equal(round.score, 0);
  f.input.destroy();
});

test('camera waits indefinitely without a person, actions or an automatic rest request', async () => {
  const f = fixture();
  await f.input.start();
  f.emit(0);
  for (const time of [2999, 3000, 60000, 3600000]) {
    f.setClock(time);
    const status = f.input.getStatus();
    assert.equal(status.requestPause, false);
    assert.equal(status.suspended, true);
    assert.equal(status.personDetected, false);
    assert.equal(status.trackingState, 'WAITING_FOR_PERSON');
    assert.deepEqual(f.input.sample(), { bending: false, standing: false });
  }
  assert.equal(f.calls.pause, 0);
  assert.equal(f.calls.cameraDestroyed, 0);
  f.input.destroy();
});

test('a person entering the frame is identified and reliable neutral poses recover without an action', async () => {
  const f = fixture();
  await f.input.start();
  f.emit(0);
  f.setClock(60000);
  assert.equal(f.input.getStatus().trackingState, 'WAITING_FOR_PERSON');
  for (let time = 60040; time <= 60200; time += 40) {
    f.emit(time, 155);
    assert.equal(f.input.getStatus().personDetected, true);
    assert.equal(f.input.getStatus().suspended, true);
  }
  f.emit(60240, 155);
  assert.equal(f.input.getStatus().suspended, false);
  assert.equal(f.input.getPoseSnapshot().state, 'TRANSITION');
  assert.deepEqual(f.input.sample(), { bending: false, standing: false });
  for (let time = 60280; time <= 60440; time += 40) f.emit(time, 155);
  const status = f.input.getStatus();
  assert.equal(status.trackingState, 'TRACKING_READY');
  assert.equal(status.cameraStatus, 'running');
  assert.equal(status.framesReceived, 12);
  assert.equal(status.lastFrameTimestampMs, 60440);
  assert.equal(status.poseFps, 25);
  f.input.destroy();
});

test('transient missing detections suppress input immediately while status changes are debounced', async () => {
  const f = fixture();
  await f.input.start();
  for (let time = 0; time <= 400; time += 40) f.emit(time, 180);
  assert.equal(f.input.getStatus().trackingState, 'TRACKING_READY');
  f.emit(440);
  assert.equal(f.input.getStatus().personDetected, false);
  assert.equal(f.input.getStatus().trackingState, 'TRACKING_READY');
  assert.equal(f.input.getStatus().suspended, true);
  assert.deepEqual(f.input.sample(), { bending: false, standing: false });
  f.emit(480, 155);
  assert.equal(f.input.getStatus().trackingState, 'TRACKING_READY');
  assert.equal(f.input.getStatus().suspended, true);
  for (let time = 520; time <= 680; time += 40) f.emit(time, 155);
  assert.equal(f.input.getStatus().suspended, false);
  assert.deepEqual(f.input.sample(), { bending: false, standing: false });
  f.emit(720);
  f.setClock(920);
  assert.equal(f.input.getStatus().trackingState, 'TRACKING_LOST');
  assert.equal(f.input.getStatus().requestPause, false);
  f.input.destroy();
});

test('lost tracking cannot finish a return hold or award a carrot while the action clock is frozen', async () => {
  const f = fixture();
  const round = new CarrotRound();
  await f.input.start();
  for (let time = 0; time <= 960; time += 40) {
    f.emit(time, 140);
    if (!f.input.getStatus().suspended) round.update(40, f.input.sample());
  }
  assert.equal(round.state, 'GRABBED');
  for (let time = 1000; time <= 1440; time += 40) {
    f.emit(time, 180);
    if (!f.input.getStatus().suspended) round.update(40, f.input.sample());
  }
  assert.equal(round.state, 'RETURNING');
  const progress = round.progress;
  f.emit(1480);
  for (const time of [1520, 4480, 61480]) {
    f.setClock(time);
    assert.equal(f.input.getStatus().suspended, true);
    if (!f.input.getStatus().suspended) round.update(60000, f.input.sample());
    assert.equal(round.state, 'RETURNING');
    assert.equal(round.progress, progress);
    assert.equal(round.score, 0);
    assert.equal(round.completeCelebration(), false);
  }
  f.input.destroy();
});

test('pause stops inference and output; resume requires new stable frames', async () => {
  const f = fixture();await f.input.start();
  for (let time = 0; time <= 200; time += 40) f.emit(time, 140);
  assert.equal(f.input.sample().bending, true);
  f.input.pause();f.emit(240, 140);
  assert.equal(f.input.sample().bending, false);
  assert.equal(f.calls.pause, 1);
  f.input.resume();assert.equal(f.calls.resume, 1);
  assert.equal(f.input.sample().bending, false);
  for (let time = 280; time <= 480; time += 40) f.emit(time, 140);
  assert.equal(f.input.sample().bending, true);
  f.input.destroy();f.input.destroy();
  assert.equal(f.calls.cameraDestroyed, 1);
  assert.equal(f.calls.estimatorDestroyed, 1);
});

test('permission failure releases resources and leaves neutral output for keyboard fallback', async () => {
  const f = fixture(new PoseCameraError('permission-denied'));
  await assert.rejects(f.input.start(), /相機權限/);
  assert.equal(f.calls.cameraDestroyed, 1);
  assert.equal(f.calls.estimatorDestroyed, 1);
  assert.equal(f.calls.init, 0);
  assert.deepEqual(f.input.sample(), { bending: false, standing: false });
});

test('destroy during pending camera start prevents late model initialization', async () => {
  let resolve!: (video: HTMLVideoElement) => void;
  let init = 0, stops = 0;
  const input = new MediapipeMotionInput({
    createCamera: () => ({ start: () => new Promise(done => { resolve = done; }), destroy: () => { stops++; } }),
    createEstimator: () => ({ initialize: async () => { init++; }, start: async () => undefined,
      pause: () => undefined, resume: () => undefined, destroy: () => undefined }),
  });
  const pending = input.start();input.destroy();resolve({} as HTMLVideoElement);
  await assert.rejects(pending, /取消/);
  assert.equal(init, 0);assert.equal(stops, 1);
});

test('a failed model teardown cannot block camera release or repeat destruction', async () => {
  let stops = 0;
  const input = new MediapipeMotionInput({
    createCamera: () => ({ start: async () => ({} as HTMLVideoElement), destroy: () => { stops++; } }),
    createEstimator: () => ({ initialize: async () => undefined, start: async () => undefined,
      pause: () => undefined, resume: () => undefined, destroy: () => { throw new Error('mock WASM close failure'); } }),
  });
  await input.start();input.setCalibration(profileC);
  assert.doesNotThrow(() => input.destroy());input.destroy();assert.equal(stops, 1);
  assert.equal(input.getCalibration(), undefined);
});

test('personal profile maps comfortable standing and bending while fallback defaults remain available', async () => {
  const f = fixture();await f.input.start();
  for (let time = 0; time <= 200; time += 40) f.emit(time, 155);
  assert.equal(f.input.sample().standing, false);
  f.input.setCalibration(profileC);
  assert.equal(f.input.getStatus().suspended, true);
  for (let time = 240; time <= 400; time += 40) f.emit(time, 155);
  assert.equal(f.input.sample().standing, false);
  f.emit(440, 155);
  assert.deepEqual(f.input.sample(), { bending: false, standing: true });
  f.input.reset();
  for (let time = 480; time <= 680; time += 40) f.emit(time, 135);
  assert.deepEqual(f.input.sample(), { bending: true, standing: false });
  f.input.setCalibration(undefined);
  for (let time = 720; time <= 920; time += 40) f.emit(time, 155);
  assert.deepEqual(f.input.sample(), { bending: false, standing: false });
  f.input.reset();
  for (let time = 960; time <= 1160; time += 40) f.emit(time, 180);
  assert.equal(f.input.sample().standing, true);
  f.input.destroy();
});

test('session profile survives pause, resume and round resets but is cleared by destroy and a new camera', async () => {
  const f = fixture();await f.input.start();
  f.input.setCalibration(profileC);
  const copy = f.input.getCalibration()!;copy.standingThreshold = 179;
  assert.deepEqual(f.input.getCalibration(), profileC);
  f.input.reset();assert.deepEqual(f.input.getCalibration(), profileC);
  f.input.pause();assert.deepEqual(f.input.getCalibration(), profileC);
  f.input.resume();assert.deepEqual(f.input.getCalibration(), profileC);
  for (let time = 0; time <= 200; time += 40) f.emit(time, 155);
  assert.equal(f.input.sample().standing, true);
  f.input.destroy();
  assert.equal(f.input.getCalibration(), undefined);
  assert.throws(() => f.input.setCalibration(profileC), /destroyed/);
  const replacement = fixture();assert.equal(replacement.input.getCalibration(), undefined);
  replacement.input.destroy();
});

test('long tracking loss retains personal calibration and recovers through the neutral band', async () => {
  const f = fixture();
  await f.input.start();
  f.input.setCalibration(profileC);
  for (let time = 0; time <= 200; time += 40) f.emit(time, 155);
  assert.equal(f.input.sample().standing, true);
  f.emit(240);
  f.setClock(60240);
  assert.equal(f.input.getStatus().requestPause, false);
  assert.equal(f.input.getStatus().suspended, true);
  assert.deepEqual(f.input.getCalibration(), profileC);
  for (let time = 60280; time <= 60440; time += 40) {
    f.emit(time, 146);
    assert.equal(f.input.getStatus().suspended, true);
  }
  f.emit(60480, 146);
  assert.equal(f.input.getStatus().suspended, false);
  assert.deepEqual(f.input.sample(), { bending: false, standing: false });
  assert.deepEqual(f.input.getCalibration(), profileC);
  f.input.destroy();
});

test('adapter rejects invalid profiles without removing the current valid calibration', async () => {
  const f = fixture();await f.input.start();
  f.input.setCalibration(profileC);
  assert.throws(() => f.input.setCalibration({ ...profileC, bendingThreshold: Infinity }), RangeError);
  assert.deepEqual(f.input.getCalibration(), profileC);
  f.input.destroy();
});
