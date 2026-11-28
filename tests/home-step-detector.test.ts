import test from 'node:test';
import assert from 'node:assert/strict';
import { HomeStepDetector, type HomeStepObservation } from '../src/game/home/HomeStepDetector';
import type { PoseFrame, PoseLandmark } from '../src/game/vision/poseTypes';

interface Stance {
  left?: number;
  right?: number;
  shift?: number;
  scale?: number;
  mirrored?: boolean;
  heightOffset?: number;
  stanceAsymmetry?: number;
  hidden?: readonly number[];
  kneeOnly?: boolean;
  hipShift?: number;
  noise?: number;
}

function frame(timestampMs: number, stance: Stance): PoseFrame {
  const { left = 0, right = 0, shift = 0, scale = 1, mirrored = false, heightOffset = 0,
    stanceAsymmetry = 0, hidden = [], kneeOnly = false, hipShift = 0, noise = 0 } = stance;
  const landmarks: PoseLandmark[] = [];
  const point = (index: number, x: number, y: number) => {
    const imageX = .5 + (x - .5) * scale + shift;
    landmarks[index] = { x: mirrored ? 1 - imageX : imageX, y: .5 + (y - .5) * scale + heightOffset,
      presence: 1, visibility: hidden.includes(index) ? .2 : 1 };
  };
  point(11, .573, .26); point(12, .427, .26);
  point(23, .545 + hipShift, .49); point(24, .455 + hipShift, .49);
  point(25, .55, .685 - left - noise); point(26, .45, .685 - right + noise + stanceAsymmetry);
  point(27, .554, .885 - (kneeOnly ? 0 : left) - noise); point(28, .446, .885 - (kneeOnly ? 0 : right) + noise + stanceAsymmetry);
  return { landmarks, imageWidth: 1280, imageHeight: 720, timestampMs, inferenceMs: 8, poseFps: 25 };
}

class Walk {
  readonly detector = new HomeStepDetector();
  private time = 0;
  private results: HomeStepObservation[] = [];

  constructor(private readonly period = 40, private readonly standing: Stance = {}) {}

  hold(ms: number, stance: Stance | ((t: number) => Stance) = {}): HomeStepObservation {
    for (let elapsed = 0; elapsed < ms; elapsed += this.period) {
      const pose = typeof stance === 'function' ? stance(elapsed) : stance;
      this.results.push(this.detector.update(frame(this.time, { ...this.standing, ...pose })));
      this.time += this.period;
    }
    return this.results.at(-1)!;
  }

  lose(ms = 440) {
    this.results.push(this.detector.update({ ...frame(this.time, {}), landmarks: [] }));
    this.time += ms;
  }

  skip(ms: number) { this.time += ms; }

  get steps() { return this.results.flatMap(result => result.step ?? []); }
  get shifts() { return this.results.flatMap(result => result.shift ?? []); }
}

test('small alternating lifts work at both camera distances, with a mild standing asymmetry', () => {
  for (const scale of [.72, 1.12]) {
    const person = new Walk(40, { scale, stanceAsymmetry: .008 });
    assert.equal(person.hold(800).ready, true);
    person.hold(260, { left: .014 });
    person.hold(280);
    person.hold(260, { right: .014 });
    person.hold(280);
    person.hold(260, { left: .014 });
    assert.deepEqual(person.steps, ['left', 'right', 'left']);
  }
});

test('tracked knees keep small alternating lifts available at 10 FPS when both ankles and the head are out of frame', () => {
  const person = new Walk(100, { hidden: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 27, 28], kneeOnly: true });
  const ready = person.hold(900);
  assert.equal(ready.trackingMode, 'partial');
  assert.equal(ready.ready, true);
  person.hold(300, { right: .013 });
  person.hold(200);
  person.hold(300, { left: .013 });
  person.hold(200);
  person.hold(300, { right: .013 });
  assert.deepEqual(person.steps, ['right', 'left', 'right']);
});

test('a tracked ankle pair keeps full detection available with occluded knees', () => {
  const person = new Walk(40, { hidden: [25, 26] });
  assert.equal(person.hold(800).trackingMode, 'full');
  person.hold(280, { left: .017 });
  person.hold(240);
  person.hold(280, { right: .017 });
  assert.deepEqual(person.steps, ['left', 'right']);
});

test('holding a foot up or lifting the same side twice never repeats a step', () => {
  const person = new Walk();
  person.hold(800);
  person.hold(1800, { left: .04 });
  person.hold(320);
  person.hold(640, { left: .04 });
  assert.deepEqual(person.steps, ['left']);
  person.hold(320);
  person.hold(320, { right: .023 });
  assert.deepEqual(person.steps, ['left', 'right']);
});

test('a higher second foot cannot recycle a first lift that never reached the ground', () => {
  const person = new Walk();
  person.hold(800);
  person.hold(320, { left: .014 });
  person.hold(320, { left: .014, right: .041 });
  person.hold(320, { left: .014 });
  assert.deepEqual(person.steps, ['left']);
  person.hold(240);
  person.hold(320, { right: .02 });
  assert.deepEqual(person.steps, ['left', 'right']);
});

test('bilateral lifting, crouching, stance translation and one-frame noise never become steps', () => {
  for (const hidden of [[], [27, 28]]) {
    const person = new Walk(40, { hidden });
    person.hold(800, t => ({ noise: (t % 80 ? -1 : 1) * .002 }));
    person.hold(1200, t => ({ shift: .032 * Math.sin(t / 130), hipShift: .014 * Math.sin(t / 90) }));
    person.hold(320, { left: .035, right: .035 });
    person.hold(320, { left: .026, right: .044 });
    person.hold(320, { heightOffset: -.045 });
    person.hold(40, { left: .04 });
    person.hold(400);
    person.hold(320, { left: .005 });
    assert.deepEqual(person.steps, []);
    person.hold(280);
    person.hold(280, { right: .018 });
    assert.deepEqual(person.steps, ['right']);
  }
});

test('camera shifts are mirrored, require a sustained small move, latch, and re-arm at center', () => {
  for (const mirrored of [false, true]) {
    const person = new Walk(40, { mirrored });
    person.hold(840);
    person.hold(40, { shift: .04 });
    person.hold(280);
    assert.deepEqual(person.shifts, []);
    person.hold(620, { shift: .033 });
    person.hold(620, { shift: .034 });
    assert.deepEqual(person.shifts, [mirrored ? 1 : -1]);
    person.hold(400);
    person.hold(620, { shift: -.033 });
    assert.deepEqual(person.shifts, mirrored ? [1, -1] : [-1, 1]);
    assert.deepEqual(person.steps, []);
  }
});

test('tracking losses and missing stale frames retain the reference, but a raised foot is not counted on return', () => {
  for (const method of ['missing', 'gap', 'pause'] as const) {
    const person = new Walk();
    person.hold(800);
    person.hold(320, { left: .025 });
    if (method === 'missing') person.lose();
    if (method === 'gap') person.skip(520);
    if (method === 'pause') person.detector.interrupt();
    assert.equal(person.detector.hasReference, true);
    const held = person.hold(580, { right: .025, shift: .03 });
    assert.equal(held.trackingMode, 'full');
    assert.equal(held.ready, false);
    assert.deepEqual(person.steps, ['left']);
    assert.deepEqual(person.shifts, []);
    assert.equal(person.hold(360, { shift: .03 }).ready, true);
    person.hold(360, { shift: .03, right: .025 });
    assert.deepEqual(person.steps, ['left', 'right']);
  }
});

test('a tracking-mode handover waits for a neutral stance before scoring a fresh lift', () => {
  const person = new Walk();
  person.hold(800);
  person.hold(300, { left: .025 });
  assert.equal(person.hold(440, { hidden: [27], right: .025 }).trackingMode, 'partial');
  assert.deepEqual(person.steps, ['left']);
  person.hold(360, { hidden: [27] });
  person.hold(300, { hidden: [27], right: .025 });
  assert.deepEqual(person.steps, ['left', 'right']);
  assert.equal(person.hold(440, { right: .025 }).trackingMode, 'partial');
  assert.equal(person.hold(440).trackingMode, 'full');
  person.hold(280, { left: .025 });
  assert.deepEqual(person.steps, ['left', 'right', 'left']);
});

test('sideways jumps in landmark position and poor leg confidence do not fabricate steps', () => {
  const person = new Walk();
  person.hold(800);
  const lost = person.hold(500, { left: .04, hidden: [25, 27] });
  assert.equal(lost.trackingMode, 'lost');
  assert.equal(lost.ready, false);
  person.hold(320);
  person.hold(40, { shift: .175, left: .04 });
  person.hold(440);
  person.hold(240, { mirrored: true, right: .04 });
  assert.deepEqual(person.steps, []);
  assert.deepEqual(person.shifts, []);
});

test('a stable torso without a usable leg pair does not acquire a false standing calibration', () => {
  const person = new Walk();
  assert.equal(person.hold(880, { hidden: [25, 27] }).trackingMode, 'lost');
  assert.equal(person.detector.hasReference, false);
  person.hold(880, t => ({ left: .035 * Number(t % 320 < 160), right: .035 * Number(t % 320 >= 160) }));
  assert.equal(person.detector.hasReference, false);
  assert.equal(person.hold(800).ready, true);
});
