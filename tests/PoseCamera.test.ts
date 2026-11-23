import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraError, PoseCamera, PoseCameraError } from '../src/game/vision/PoseCamera';
import { getCameraPreferences, saveCameraPreferences, type CameraPreferences } from '../src/game/vision/cameraPreferences';

function setupCamera(getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
  lowPerformanceMode = false, preferences?: CameraPreferences) {
  const track = new EventTarget() as EventTarget & { stop(): void; stops: number };
  track.stops = 0;
  track.stop = () => { track.stops++; };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  let plays = 0;
  const video = { srcObject: null, play: async () => { plays++; }, pause: () => undefined } as unknown as HTMLVideoElement;
  const calls: MediaStreamConstraints[] = [];
  let ended = 0;
  const camera = new PoseCamera({
    video, isSecureContext: true, lowPerformanceMode, preferences, onEnded: () => { ended++; },
    mediaDevices: { getUserMedia: getUserMedia ?? (async (constraints = {}) => { calls.push(constraints); return stream; }) },
  });
  return { camera, track, stream, video, calls, plays: () => plays, ended: () => ended };
}

test('camera activates only on start, requests no audio, reuses startup, and stops every track', async () => {
  const fixture = setupCamera();
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.plays(), 0);
  const first = fixture.camera.start();
  assert.equal(first, fixture.camera.start());
  assert.equal(await first, fixture.video);
  assert.deepEqual(fixture.calls, [{ audio: false, video: {
    facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 360 },
  } }]);
  fixture.camera.stop();
  assert.equal(fixture.track.stops, 1);
  assert.equal(fixture.video.srcObject, null);
  fixture.camera.destroy();
  await assert.rejects(fixture.camera.start(), (error: PoseCameraError) => error.code === 'cancelled');
});

test('low mode requests small ideal frames and leaves capture independent of pose cadence', async () => {
  const fixture = setupCamera(undefined, true);
  await fixture.camera.start();
  assert.deepEqual(fixture.calls, [{ audio: false, video: {
    facingMode: { ideal: 'user' }, width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 30 },
  } }]);
  fixture.camera.destroy();
});

test('a cancelled pending permission request stops the late stream without attaching or playing it', async () => {
  let release!: (stream: MediaStream) => void;
  const fixture = setupCamera(() => new Promise((resolve) => { release = resolve; }));
  const pending = fixture.camera.start();
  fixture.camera.stop();
  release(fixture.stream);
  await assert.rejects(pending, (error: PoseCameraError) => error.code === 'cancelled');
  assert.equal(fixture.track.stops, 1);
  assert.equal(fixture.video.srcObject, null);
  assert.equal(fixture.plays(), 0);
});

test('a second start waits for pending playback and playback failure releases the acquired stream', async () => {
  const fixture = setupCamera();
  let rejectPlay!: (error: Error) => void;
  fixture.video.play = () => new Promise((_, reject) => { rejectPlay = reject; });
  const pending = fixture.camera.start();
  await Promise.resolve();
  assert.equal(fixture.camera.start(), pending);
  rejectPlay(new Error('mock playback failure'));
  await assert.rejects(pending, (error: PoseCameraError) => error.code === 'camera-error');
  assert.equal(fixture.track.stops, 1);
  assert.equal(fixture.video.srcObject, null);
});

test('permission, missing camera, busy camera and unsupported context have readable errors', async () => {
  for (const [name, code] of [
    ['NotAllowedError', 'permission-denied'], ['NotFoundError', 'no-camera'],
    ['NotReadableError', 'camera-busy'], ['OverconstrainedError', 'no-camera'],
  ]) {
    const fixture = setupCamera(async () => { throw new DOMException('', name); });
    await assert.rejects(fixture.camera.start(), (error: PoseCameraError) => error.code === code && error.message.length > 10);
  }
  const video = setupCamera().video;
  const camera = new PoseCamera({ video, isSecureContext: false });
  await assert.rejects(camera.start(), (error: PoseCameraError) => error.code === 'insecure-context');
  const unsupported = new PoseCamera({ video, isSecureContext: true });
  await assert.rejects(unsupported.start(), (error: PoseCameraError) => error.code === 'unsupported');
  assert.equal(cameraError(new Error()).code, 'camera-error');
});

test('external camera disconnect cleans up and reports once; intentional stop removes ended listener', async () => {
  const fixture = setupCamera();
  await fixture.camera.start();
  fixture.track.dispatchEvent(new Event('ended'));
  assert.equal(fixture.track.stops, 1);
  assert.equal(fixture.ended(), 1);
  fixture.track.dispatchEvent(new Event('ended'));
  assert.equal(fixture.ended(), 1);
});

test('an unsupported capture profile retries with browser defaults on the same explicitly selected device', async () => {
  const calls: MediaStreamConstraints[] = [];
  const fixture = setupCamera(async constraints => {
    calls.push(constraints);
    if (calls.length === 1) throw Object.assign(new DOMException('', 'OverconstrainedError'), { constraint: 'frameRate' });
    return fixture.stream;
  }, false, { profile: 'vga', deviceId: 'external' });
  await fixture.camera.start();
  assert.deepEqual(calls, [
    { audio: false, video: { deviceId: { exact: 'external' },
      width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } },
    { audio: false, video: { deviceId: { exact: 'external' } } },
  ]);
  assert.equal(fixture.camera.resolvedProfile, 'browser');
  fixture.camera.destroy();
});

test('an unavailable selected device reports the exact failure without starting a different camera', async () => {
  for (const error of [
    Object.assign(new DOMException('', 'OverconstrainedError'), { constraint: 'deviceId' }),
    new DOMException('', 'NotFoundError'),
  ]) {
    let calls = 0;
    const fixture = setupCamera(async () => { calls++; throw error; }, true, { profile: 'auto', deviceId: 'unplugged' });
    await assert.rejects(fixture.camera.start(), (failure: PoseCameraError) => failure.code === 'selected-camera-unavailable');
    assert.equal(calls, 1);
    assert.equal(fixture.video.srcObject, null);
  }
});

test('switching source stops the previous stream and exposes each negotiated track setting', async () => {
  const requestedDevices: unknown[] = [];
  const low = setupCamera(async constraints => {
    requestedDevices.push((constraints.video as MediaTrackConstraints).deviceId);
    return low.stream;
  }, true, { profile: 'low', deviceId: 'external' });
  const alternate = setupCamera(async constraints => {
    requestedDevices.push((constraints.video as MediaTrackConstraints).deviceId);
    return alternate.stream;
  }, true, { profile: 'browser', deviceId: 'other' });
  Object.assign(low.track, {
    getSettings: () => ({ width: 320, height: 240, frameRate: 8 }),
    getCapabilities: () => ({ frameRate: { min: 8, max: 30 } }),
  });
  Object.assign(alternate.track, { getSettings: () => ({ width: 640, height: 480, frameRate: 30 }) });
  await low.camera.start();
  assert.deepEqual(low.camera.settings, { width: 320, height: 240, frameRate: 8 });
  assert.deepEqual(low.camera.capabilities?.frameRate, { min: 8, max: 30 });
  low.camera.destroy();
  assert.equal(low.track.stops, 1);
  assert.equal(low.camera.settings, undefined);
  await alternate.camera.start();
  assert.deepEqual(alternate.camera.settings, { width: 640, height: 480, frameRate: 30 });
  assert.deepEqual(requestedDevices, [{ exact: 'external' }, { exact: 'other' }]);
  alternate.camera.destroy();
});

test('stopping during negotiation cancels the less constrained retry', async () => {
  let rejectRequest!: (error: Error) => void;
  let calls = 0;
  const fixture = setupCamera(() => {
    calls++;
    return new Promise((_resolve, reject) => { rejectRequest = reject; });
  });
  const pending = fixture.camera.start();
  fixture.camera.stop();
  rejectRequest(new DOMException('', 'OverconstrainedError'));
  await assert.rejects(pending, (error: PoseCameraError) => error.code === 'cancelled');
  assert.equal(calls, 1);
  assert.equal(fixture.video.srcObject, null);
});

test('camera preferences store only a profile and the locally selected device', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let stored: string | undefined;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    setItem(_key: string, value: string) { stored = value; },
    getItem() { return stored; },
  } });
  try {
    assert.deepEqual(getCameraPreferences(), { profile: 'auto' });
    saveCameraPreferences({ profile: 'vga', deviceId: 'usb' });
    assert.deepEqual(getCameraPreferences(), { profile: 'vga', deviceId: 'usb' });
    saveCameraPreferences({ profile: 'browser', deviceId: '' });
    assert.deepEqual(JSON.parse(stored!), { profile: 'browser' });
    stored = JSON.stringify({ profile: ['low'], deviceId: 'usb' });
    assert.deepEqual(getCameraPreferences(), { profile: 'auto' });
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
