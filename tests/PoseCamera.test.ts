import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraError, PoseCamera, PoseCameraError } from '../src/game/vision/PoseCamera';

function setupCamera(getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>) {
  const track = new EventTarget() as EventTarget & { stop(): void; stops: number };
  track.stops = 0;
  track.stop = () => { track.stops++; };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  let plays = 0;
  const video = { srcObject: null, play: async () => { plays++; }, pause: () => undefined } as unknown as HTMLVideoElement;
  const calls: MediaStreamConstraints[] = [];
  let ended = 0;
  const camera = new PoseCamera({
    video, isSecureContext: true, onEnded: () => { ended++; },
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
