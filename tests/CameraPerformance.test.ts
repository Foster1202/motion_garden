import assert from 'node:assert/strict';
import test from 'node:test';
import { MainThreadPerformanceProbe, VideoPerformanceProbe, percentile95 } from '../src/game/performance/framePerformance';

function playbackQuality(totalVideoFrames: number, droppedVideoFrames: number): VideoPlaybackQuality {
  return { creationTime: 0, totalVideoFrames, droppedVideoFrames, corruptedVideoFrames: 0 };
}

test('video counters separate missed callbacks and playback drops from presentation rate', () => {
  const pending = new Map<number, VideoFrameRequestCallback>();
  let nextId = 0;
  let quality = playbackQuality(100, 1);
  const video = {
    getVideoPlaybackQuality: () => quality,
    requestVideoFrameCallback: (callback: VideoFrameRequestCallback) => {
      pending.set(++nextId, callback);
      return nextId;
    },
    cancelVideoFrameCallback: (id: number) => pending.delete(id),
  } as unknown as HTMLVideoElement;
  const probe = new VideoPerformanceProbe(video);
  function fire(frames: number, seconds: number, decode: number): void {
    const callback = pending.get(nextId)!;
    pending.delete(nextId);
    callback(seconds * 1000, {
      presentedFrames: frames, mediaTime: seconds, processingDuration: decode,
      captureTime: seconds * 1000, expectedDisplayTime: 0, presentationTime: 0, width: 640, height: 480,
    });
  }
  fire(100, 1, .001);
  fire(101, 1.05, .002);
  fire(105, 1.25, .005);
  quality = playbackQuality(106, 2);
  assert.deepEqual(probe.read(250), {
    source: 'video-frame', presentedFps: 20, callbackFps: 8,
    skippedCallbacks: 3, droppedFrames: 1, decodeP95Ms: 5, mediaTimelineFps: 20, captureTimelineFps: 20,
  });
  assert.equal(probe.read(250).presentedFps, 0);
  assert.equal(probe.read(250).decodeP95Ms, undefined);
  probe.stop();
  assert.equal(pending.size, 0);
});

test('video counter fallback uses playback quality and reports unavailable browser counters', () => {
  let quality = playbackQuality(0, 0);
  const probe = new VideoPerformanceProbe({ getVideoPlaybackQuality: () => quality } as HTMLVideoElement);
  assert.deepEqual(probe.read(1000), {});
  quality = playbackQuality(30, 5);
  assert.deepEqual(probe.read(1000), { source: 'playback-quality', presentedFps: 25, droppedFrames: 5 });
  quality = playbackQuality(30, 5);
  assert.deepEqual(probe.read(1000), { source: 'playback-quality', presentedFps: 0, droppedFrames: 0 });
  assert.deepEqual(new VideoPerformanceProbe({} as HTMLVideoElement).read(1000), {});
});

test('P95 uses nearest rank and leaves an empty sample unavailable', () => {
  assert.equal(percentile95([]), undefined);
  const durations = Array.from({ length: 20 }, (_, index) => 20 - index);
  assert.equal(percentile95(durations), 19);
  assert.equal(durations[0], 20);
});

test('main-thread probe reports RAF stalls, resets each sample, and cancels on stop', t => {
  let nextId = 0;
  const pending = new Map<number, FrameRequestCallback>();
  const request = (callback: FrameRequestCallback) => {
    pending.set(++nextId, callback);
    return nextId;
  };
  const overrides = {
    requestAnimationFrame: request,
    cancelAnimationFrame: (id: number) => pending.delete(id),
    PerformanceObserver: undefined,
  };
  for (const [key, value] of Object.entries(overrides)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const probe = new MainThreadPerformanceProbe();
  for (const timestamp of [10, 26, 98]) {
    const callback = pending.get(nextId)!;
    pending.delete(nextId);
    callback(timestamp);
  }
  assert.deepEqual(probe.read(), { longTasks: undefined, longestTaskMs: undefined, rafStalls: 1, maxRafGapMs: 72 });
  assert.equal(probe.read().rafStalls, 0);
  probe.stop();
  assert.equal(pending.size, 0);
});
