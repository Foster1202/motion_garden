import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PersonOnlyRenderer } from '../src/game/vision/PersonOnlyRenderer';
import { POSE_CONFIG } from '../src/game/vision/poseConfig';
import type { PoseFrame } from '../src/game/vision/poseTypes';

const keypoints = { background: 'none', showBodyKeypoints: true } as const;

function previewFixture(t: TestContext) {
  let now = 1000;
  let drawn = false;
  const classes = new Set<string>();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(performance, 'now', () => now);
  const context = {
    clearRect: () => { drawn = false; },
    fill: () => { drawn = true; },
    arc() {}, beginPath() {}, save() {}, restore() {}, translate() {}, scale() {},
    fillRect() {}, fillText() {}, measureText() { return { width: 70 }; },
  };
  const canvas = { dataset: {}, getContext: () => context } as unknown as HTMLCanvasElement;
  const video = { videoWidth: 640, videoHeight: 480, readyState: 2, classList: {
    toggle(name: string, enabled: boolean) { if (enabled) classes.add(name); else classes.delete(name); },
  } } as unknown as HTMLVideoElement;
  const renderer = new PersonOnlyRenderer(video, canvas, { nativeVideo: true });
  const frame = (age = 0, update?: Partial<PoseFrame>): PoseFrame => ({
    timestampMs: now - age, inferenceMs: age, poseFps: 5,
    landmarks: [{ x: .5, y: .5 }], ...update,
  });
  const advance = (ms: number) => { now += ms; t.mock.timers.tick(ms); };
  return { renderer, canvas, isDrawn: () => drawn, classes, frame, advance };
}

test('preview holds visual landmarks across game staleness, labels the delay, and clears at the visual deadline', t => {
  const { renderer, canvas, isDrawn, classes, frame, advance } = previewFixture(t);
  renderer.renderPreview(frame(), keypoints);
  assert.equal(isDrawn(), true);
  assert.equal(canvas.dataset.posePreview, undefined);

  advance(POSE_CONFIG.maxDataAgeMs);
  assert.equal(isDrawn(), true);
  assert.equal(canvas.dataset.posePreview, 'delayed');

  advance(POSE_CONFIG.maxPreviewAgeMs - POSE_CONFIG.maxDataAgeMs);
  assert.equal(isDrawn(), false);
  assert.equal(canvas.dataset.posePreview, undefined);
  assert.ok(classes.has('camera-preview-active'));
});

test('late detections show as delayed; explicit pose loss and pause clear immediately', t => {
  const { renderer, canvas, isDrawn, classes, frame, advance } = previewFixture(t);
  renderer.renderPreview(frame(350, { previewOnly: true }), keypoints);
  assert.equal(isDrawn(), true);
  assert.equal(canvas.dataset.posePreview, 'delayed');
  renderer.renderPreview(frame(350, { previewOnly: true, landmarks: undefined }), keypoints);
  assert.equal(isDrawn(), false);
  assert.equal(canvas.dataset.posePreview, undefined);

  renderer.renderPreview(frame(350, { previewOnly: true }), keypoints);
  renderer.setPaused(true);
  assert.equal(isDrawn(), false);
  assert.ok(!classes.has('camera-preview-active'));
  advance(1000);
  assert.equal(canvas.dataset.posePreview, undefined);

  renderer.setPaused(false);
  renderer.renderPreview(frame(POSE_CONFIG.maxPreviewAgeMs), keypoints);
  assert.equal(isDrawn(), false);
  renderer.renderPreview(frame(), { background: 'none' });
  assert.equal(isDrawn(), false);
  assert.ok(classes.has('camera-preview-active'));
});
