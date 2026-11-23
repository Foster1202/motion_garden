import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.QA_URL ?? 'http://127.0.0.1:5175/';
const output = process.env.QA_OUTPUT ?? '/tmp/berry-camera-qa';
const lowPerformanceMode = process.env.QA_LOW_PERFORMANCE === '1';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
const report = { status: 'RUNNING', url, browser: browser.version(), lowPerformanceMode,
  browserPlugin: 'Browser plugin not available; installed Chrome through Playwright',
  input: 'Virtual webcam and synthetic MediaPipe landmarks; real scheduler, extractor, retargeter, rig, projection and round. NOT human webcam validation.',
  checks: [], errors: [], warnings: [], trackingTrace: [] };
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => {
  if (message.type() === 'error') report.errors.push(message.text());
  if (message.type() === 'warning') report.warnings.push(message.text());
});
const snapshot = () => page.evaluate(async () => (await import('/src/main.ts')).game.scene.getScene('BerryKick').snapshot());
const fixture = values => page.evaluate(values => Object.assign(window.__berryFixture, values), values);
const wait = async predicate => {
  for (let attempt = 0; attempt < 150; attempt++) {
    const value = await snapshot(); if (predicate(value)) return value;
    await page.waitForTimeout(100);
  }
  throw Error(`Snapshot timeout: ${JSON.stringify(await snapshot())}`);
};
const check = name => report.checks.push(name);
const closeTo = (actual, target, tolerance, label) => assert.ok(Math.abs(actual - target) <= tolerance,
  `${label}: expected ${actual} within ${tolerance} of ${target}`);
const trackingTrace = (label, sample) => {
  const { tracking, maxTravel } = sample;
  if (tracking.reliable) {
    closeTo(tracking.targetRootX, 800 + tracking.lateralOffset * maxTravel, 4, `${label} renderer target`);
  } else {
    assert.equal(tracking.targetRootX, null, `${label} should not drive a renderer target`);
  }
  report.trackingTrace.push({ label, ...tracking, maxTravel });
};
const settled = (direction, minimumOffset = .6) => wait(s => s.tracking.reliable
  && (direction ? direction * s.tracking.lateralOffset > minimumOffset : Math.abs(s.tracking.lateralOffset) < .02)
  && Math.abs(s.rootX - (800 + s.tracking.lateralOffset * s.maxTravel)) < 4);
const enter = async () => {
  await page.locator('[data-action=start]').click();
  await page.locator('[data-action=berry]').click();
  await page.locator('[data-action=camera]').waitFor();
  await page.evaluate(async () => {
    const { BerryKickRound } = await import('/src/game/berry/BerryKickRound.ts');
    const scene = (await import('/src/main.ts')).game.scene.getScene('BerryKick');
    const draws = [0, 1, 0];
    window.__cameraTargetDraws = 0;
    window.__cameraContacts = [];
    // Seed the real rule model before input selection, retaining the camera and collision pipeline.
    scene.round = new BerryKickRound(scene.round.zones, scene.round.durationMs / 1000,
      () => draws[window.__cameraTargetDraws++] ?? .75);
    const update = scene.round.update.bind(scene.round);
    scene.round.update = (...args) => {
      const contact = update(...args);
      if (contact) window.__cameraContacts.push(contact);
      return contact;
    };
  });
};
async function installCameraFixture() {
  const debugUrl = new URL(url);
  debugUrl.searchParams.set('berryTrackingDebug', '1');
  await page.goto(debugUrl.toString());
  await page.evaluate(async lowPerformanceMode => {
    const { PoseEstimator } = await import('/src/game/vision/PoseEstimator.ts');
    const { DEFAULT_GAME_SETTINGS, saveGameSettings } = await import('/src/game/settings/gameSettings.ts');
    saveGameSettings({ ...DEFAULT_GAME_SETTINGS, berryDurationSeconds: 120, lowPerformanceMode,
      backgroundProcessing: lowPerformanceMode, showPerformanceMetrics: lowPerformanceMode });
    window.__berryFixture = { left: 0, right: 0, shift: 0, scale: 1, lost: false, delay: 900 };
    window.__berryStats = { models: 0, closed: 0, requested: 0, inferences: 0, maskReads: 0, spikes: [], streams: [] };
    const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => {
      const dimensions = window.__berryFixture.dimensions;
      const stream = await getMedia(dimensions ? { ...options, video: {
        width: { exact: dimensions.width }, height: { exact: dimensions.height },
      } } : options);
      window.__berryStats.streams.push(stream);
      return stream;
    };
    const initialize = PoseEstimator.prototype.initialize;
    PoseEstimator.prototype.initialize = function () {
      // Keep production initialization cancellation and scheduling; substitute only model creation/output.
      this.options.createLandmarker = async () => {
        window.__berryStats.requested++;
        await new Promise(resolve => setTimeout(resolve, window.__berryFixture.delay));
        window.__berryStats.models++;
        return {
          close() { window.__berryStats.closed++; },
          detectForVideo(video, timestamp) {
            const inference = ++window.__berryStats.inferences;
            const f = window.__berryFixture;
            if (f.lost) return { landmarks: [] };
            const elapsed = timestamp - (f.motionStart ?? timestamp);
            const shift = f.sweep ? f.sweep.amplitude * Math.sin(elapsed * 2 * Math.PI / f.sweep.period) : f.shift;
            const scale = f.sweep?.varyScale ? 1.04 + .41 * Math.sin(elapsed * 2 * Math.PI / 11000) : f.scale;
            const aspectFactor = (16 / 9) / (video.videoWidth / video.videoHeight);
            const spike = inference === f.spikeAt ? 'whole-pose' : inference === f.hipSpikeAt ? 'one-hip' : null;
            if (spike) window.__berryStats.spikes.push(spike);
            const points = Array.from({ length: 33 }, (_, id) => ({
              x: .5, y: id < 11 ? -.1 : .5, visibility: .99, presence: .99,
            }));
            const set = (id, x, y) => {
              const confidence = f.hidden?.includes(id) ? .1 : .99;
              const offset = (x - .5) * scale + shift + (f.jitter ?? 0) * Math.sin(inference * 1.73 + id);
              const anomaly = spike === 'whole-pose' ? .26 : spike === 'one-hip' && id === 23 ? .10 : 0;
              points[id] = { x: .5 + (f.mirrored ? -1 : 1) * (offset + anomaly) * aspectFactor,
                y: f.cropAnkles && (id === 27 || id === 28) ? 1.08 : .37 + (y - .5) * scale,
                z: 0, visibility: confidence, presence: confidence };
            };
            set(11, .57, .28); set(12, .43, .28);
            set(23, .54, .5); set(24, .46, .5);
            set(25, .54 + f.left * .5, .7); set(26, .46 - f.right * .5, .7);
            set(27, .54 + f.left, .9); set(28, .46 - f.right, .9);
            return {
              landmarks: [points],
              segmentationMasks: [{ width: 4, height: 2,
                getAsFloat32Array: () => {
                  window.__berryStats.maskReads++;
                  return Float32Array.of(1, 1, 0, 0, 1, 1, 0, 0);
                } }],
              close() {},
            };
          },
        };
      };
      return initialize.call(this);
    };
  }, lowPerformanceMode);
}

async function lowPerformanceRun() {
  await fixture({ delay: 0, cropAnkles: true });
  await enter();
  await page.locator('[data-action=camera]').click();
  const neutral = await wait(s => s.active && s.armed.left && s.armed.right && s.fps > 0);
  assert.ok(neutral.tracking.reference);
  assert.equal(neutral.tracking.mode, 'partial');
  assert.equal(neutral.renderMode, '3d');
  assert.equal(neutral.target, 'left');
  assert.equal(neutral.score, 0);
  assert.deepEqual(await page.locator('.berry-camera-source').evaluate(video => ({
    dimensions: [video.videoWidth, video.videoHeight], opacity: getComputedStyle(video).opacity,
  })), { dimensions: [320, 240], opacity: '1' });
  const renderSize = await page.evaluate(async () => {
    const { renderer } = (await import('/src/main.ts')).game.scene.getScene('BerryKick').view;
    return [renderer.domElement.width, renderer.domElement.height];
  });
  assert.deepEqual(renderSize, [600, 338]);
  assert.equal(await page.evaluate(() => window.__berryStats.maskReads), 0);
  assert.ok(neutral.fps > 0 && neutral.fps <= 33, neutral.fps);
  const panel = page.locator('.performance-panel');
  await panel.filter({ hasText: /320×240/ }).waitFor();
  const sampleCounter = () => page.evaluate(() => ({ frames: window.__berryStats.inferences, time: performance.now() }));
  const before = await sampleCounter();
  await page.waitForTimeout(2200);
  const after = await sampleCounter();
  const observedInferenceFps = (after.frames - before.frames) * 1000 / (after.time - before.time);
  assert.ok(observedInferenceFps >= 6.5 && observedInferenceFps <= 10.7, observedInferenceFps);
  const performanceText = await panel.innerText();
  assert.match(performanceText, /推論 \d+\.\d ms[\s\S]*Pose \d+\.\d FPS[\s\S]*Phaser \d+\.\d FPS · 3D \d+\.\d FPS/);
  report.performance = { threeFps: neutral.fps, observedInferenceFps, renderSize, panel: performanceText };
  check('Low mode acquires the partial standing reference with a 320×240 native preview, no mask conversion and reduced 3D rendering');

  await fixture({ shift: .13 });
  await wait(s => s.rootX < 540 && s.tracking.reliable);
  await fixture({ left: .07 });
  const hit = await wait(s => s.score === 3);
  assert.ok(hit.feet.left.x >= hit.zones.left.x && hit.feet.left.x <= hit.zones.left.x + hit.zones.left.width);
  assert.equal(hit.counts.left, 1);
  assert.equal(hit.target, 'right');
  await page.waitForTimeout(500);
  assert.equal((await snapshot()).score, 3);
  await page.screenshot({ path: `${output}/low-performance-partial-hit.png` });
  check('A sustained cropped-ankle kick projects into the target and scores exactly once');

  await fixture({ lost: true });
  const lost = await wait(s => !s.tracking.reliable);
  assert.equal(lost.armed.left, false);
  assert.deepEqual(lost.tracking.reference, neutral.tracking.reference);
  await fixture({ lost: false, left: 0, shift: 0 });
  await settled(0);
  await page.locator('[data-action=pause]').click();
  const paused = await snapshot();
  const stopped = await page.evaluate(() => window.__berryStats.inferences);
  await page.waitForTimeout(550);
  assert.equal((await snapshot()).clock, paused.clock);
  assert.equal(await page.evaluate(() => window.__berryStats.inferences), stopped);
  await page.locator('dialog [data-action=resume]').click();
  const resumed = await wait(s => s.tracking.reliable && s.clock > paused.clock);
  assert.equal(resumed.score, 3);
  assert.deepEqual(resumed.tracking.reference, neutral.tracking.reference);
  check('Tracking loss and explicit pause preserve score and standing reference, and pause stops inference');

  await page.locator('[data-action=home]').click();
  await page.locator('[data-action=start]').waitFor();
  assert.equal(await page.locator('.berry-camera-source').count(), 0);
  const resources = await page.evaluate(async () => ({
    models: window.__berryStats.models, closed: window.__berryStats.closed,
    tracks: window.__berryStats.streams.flatMap(stream => stream.getTracks().map(track => track.readyState)),
    textures: (await import('/src/main.ts')).game.textures.getTextureKeys().filter(key => key.startsWith('berry-rabbit-')),
  }));
  assert.deepEqual(resources, { models: 1, closed: 1, tracks: ['ended'], textures: [] });
  report.resources = resources;
  check('Home removes the preview and releases the camera, pose model and rabbit texture');
}

async function standardRun() {
  await enter(); await page.locator('[data-action=camera]').click();
  await page.waitForFunction(() => window.__berryStats.streams.length === 1);
  await page.locator('[data-action=pause]').click();
  const pause = await snapshot(); await page.waitForTimeout(1300);
  assert.equal((await snapshot()).clock, pause.clock);
  assert.match(await page.locator('dialog').innerText(), /休息一陣先/);
  assert.equal(await page.evaluate(() => window.__berryStats.closed), 0);
  await fixture({ sweep: { amplitude: .15, period: 700 }, motionStart: await page.evaluate(() => performance.now()) });
  await page.locator('[data-action=resume]').click();
  await page.waitForTimeout(720);
  const unsettled = await snapshot();
  assert.equal(unsettled.tracking.reference, null);
  assert.equal(unsettled.tracking.reliable, false);
  closeTo(unsettled.rootX, 800, 1, 'Movement during reference acquisition');
  trackingTrace('moving before stable reference', unsettled);
  await fixture({ sweep: null });
  await wait(s => s.armed.left && s.armed.right);
  assert.equal(await page.locator('.calibration-panel,[data-calibration-state]').count(), 0);
  const personPreview = await page.evaluate(() => {
    const canvas = document.querySelector('.berry-camera');
    const context = canvas.getContext('2d');
    return {
      sourceOpacity: getComputedStyle(document.querySelector('.berry-camera-source')).opacity,
      keptAlpha: context.getImageData(40, 90, 1, 1).data[3],
      backgroundAlpha: context.getImageData(280, 90, 1, 1).data[3],
    };
  });
  assert.equal(personPreview.sourceOpacity, '1');
  assert.equal(personPreview.keptAlpha, 0);
  assert.equal(personPreview.backgroundAlpha, 0);
  check('Berry displays native video with an empty overlay when both enhancements are disabled');
  assert.equal(await page.locator('[data-berry-tracking]').innerText(), 'Full Tracking');
  check('Out-of-frame head does not block full leg tracking; pause during delayed initialization retains camera and resumes');
  const initial = await settled(0);
  const reference = initial.tracking.reference;
  assert.ok(reference?.scale > 0);
  trackingTrace('settled startup reference', initial);
  check('Moving poses cannot establish the initial reference; stable standing establishes it automatically');

  const responseStart = Date.now();
  await fixture({ shift: .10 });
  await wait(s => s.tracking.reliable && s.rootX < 750);
  report.stepResponseMs = Date.now() - responseStart;
  assert.ok(report.stepResponseMs < 900, `Synthetic movement response took ${report.stepResponseMs}ms`);
  const earlyLeft = await settled(-1);
  await fixture({ shift: -.10 });
  const earlyRight = await settled(1);
  trackingTrace('initial left offset', earlyLeft);
  trackingTrace('initial right offset', earlyRight);
  closeTo(800 - earlyLeft.rootX, earlyRight.rootX - 800, 8, 'Equal initial left and right travel');
  const start = Date.now();
  await fixture({ sweep: { amplitude: .13, period: 4000, varyScale: true },
    motionStart: await page.evaluate(() => performance.now()), jitter: .0015 });
  const intervals = [];
  const stressTimeMs = 48000;
  while (Date.now() - start < stressTimeMs) {
    const sample = await snapshot();
    assert.deepEqual(sample.tracking.reference, reference, 'Reference changed during continuous movement');
    assert.equal(sample.score, 0);
    assert.equal(sample.target, 'left');
    const bucket = Math.min(3, Math.floor((Date.now() - start) / (stressTimeMs / 4)));
    const interval = intervals[bucket] ??= { samples: 0, reliableSamples: 0, minRootX: 800, maxRootX: 800, minLateral: 0, maxLateral: 0 };
    const lateral = sample.tracking.lateralOffset;
    interval.samples++;
    interval.reliableSamples += Number(sample.tracking.reliable);
    interval.minRootX = Math.min(interval.minRootX, sample.rootX);
    interval.maxRootX = Math.max(interval.maxRootX, sample.rootX);
    interval.minLateral = Math.min(interval.minLateral, lateral);
    interval.maxLateral = Math.max(interval.maxLateral, lateral);
    await page.waitForTimeout(90);
  }
  report.stress = { wallTimeMs: Date.now() - start, intervals };
  assert.equal(intervals.length, 4);
  for (const interval of intervals) {
    assert.ok(interval.reliableSamples / interval.samples > .9, JSON.stringify(interval));
    assert.ok(interval.minLateral < -.85 && interval.maxLateral > .85, JSON.stringify(interval));
    assert.ok(interval.minRootX < 550 && interval.maxRootX > 1050, JSON.stringify(interval));
  }
  check('48 real seconds of alternating motion retain reference, bidirectional travel and reliability across scale changes and jitter');

  await fixture({ sweep: null, jitter: 0, shift: .10, scale: 1 });
  const lateLeft = await settled(-1);
  await fixture({ scale: 1.45 });
  await page.waitForTimeout(850);
  const nearLeft = await settled(-1);
  await fixture({ scale: .63 });
  await page.waitForTimeout(850);
  const farLeft = await settled(-1);
  assert.ok(nearLeft.tracking.current.scale > 1.4 * reference.scale);
  assert.ok(farLeft.tracking.current.scale < .7 * reference.scale);
  for (const [label, sample] of [['late left', lateLeft], ['near left', nearLeft], ['far left', farLeft]]) {
    assert.deepEqual(sample.tracking.reference, reference);
    closeTo(sample.tracking.lateralOffset, earlyLeft.tracking.lateralOffset, .035, `${label} command`);
    closeTo(sample.rootX, earlyLeft.rootX, 12, `${label} actual position`);
    trackingTrace(label, sample);
  }
  await fixture({ shift: -.10, scale: 1 });
  const lateRight = await settled(1);
  closeTo(lateRight.rootX, earlyRight.rootX, 12, 'Right travel late in the session');
  trackingTrace('late right', lateRight);
  check('The same hip position produces the same lateral command and root position before and after depth changes');

  await fixture({ shift: 0, jitter: .003 });
  await settled(0);
  await page.evaluate(() => {
    window.__berryFixture.spikeAt = window.__berryStats.inferences + 4;
    window.__berryFixture.hipSpikeAt = window.__berryStats.inferences + 10;
  });
  let largestStationaryDrift = 0;
  let largestStationaryCommand = 0;
  for (let attempt = 0; attempt < 32; attempt++) {
    const sample = await snapshot();
    assert.deepEqual(sample.tracking.reference, reference);
    largestStationaryCommand = Math.max(largestStationaryCommand, Math.abs(sample.tracking.lateralOffset));
    largestStationaryDrift = Math.max(largestStationaryDrift, Math.abs(sample.rootX - 800));
    await page.waitForTimeout(25);
  }
  assert.deepEqual(await page.evaluate(() => window.__berryStats.spikes), ['whole-pose', 'one-hip']);
  assert.ok(largestStationaryCommand <= .03, `Stationary outlier moved command ${largestStationaryCommand}`);
  assert.ok(largestStationaryDrift <= 8, `Stationary jitter/outlier moved root ${largestStationaryDrift}px`);
  report.stress.largestStationaryDrift = largestStationaryDrift;
  report.stress.largestStationaryCommand = largestStationaryCommand;
  check('Stationary jitter and isolated high-confidence whole-pose and one-hip jumps leave the rabbit centered');

  await fixture({ shift: .11, jitter: 0, cropAnkles: true });
  await settled(-1);
  const legsHidden = await wait(s => s.tracking.mode === 'partial' && s.armed.left && s.armed.right);
  assert.equal(legsHidden.tracking.legTracking.left.mode, 'partial');
  assert.equal(legsHidden.tracking.legTracking.right.mode, 'partial');
  assert.deepEqual(legsHidden.tracking.legAmounts, { left: 0, right: 0 });
  assert.equal(legsHidden.score, 0);
  assert.equal(await page.locator('[data-berry-tracking]').innerText(), 'Partial Tracking');
  trackingTrace('both ankles missing, horizontal translation only', legsHidden);
  assert.deepEqual(legsHidden.tracking.reference, reference);
  await fixture({ hidden: [23], cropAnkles: false, shift: -.12 });
  const hipHidden = await wait(s => !s.tracking.reliable);
  await page.waitForTimeout(700);
  const hipStillHidden = await snapshot();
  assert.equal(hipStillHidden.tracking.mode, 'lost');
  assert.equal(await page.locator('[data-berry-tracking]').innerText(), 'Tracking Lost');
  assert.deepEqual(hipStillHidden.tracking.reference, reference);
  closeTo(hipStillHidden.rootX, hipHidden.rootX, 1, 'Hip obstruction freeze');
  trackingTrace('hip obstruction', hipStillHidden);
  await fixture({ hidden: null, shift: -.10 });
  const hipRecovered = await settled(1);
  assert.deepEqual(hipRecovered.tracking.reference, reference);
  closeTo(hipRecovered.rootX, earlyRight.rootX, 12, 'Recover opposite original center');
  trackingTrace('hip recovered off-center', hipRecovered);
  check('Both cropped ankles allow lateral control without creating a kick; losing a hip freezes the rendered root and recovers off-center');

  await page.evaluate(async () => {
    const { game } = await import('/src/main.ts');
    const video = game.scene.getScene('BerryKick').inputSource.camera.video;
    video.pause();
  });
  await fixture({ shift: .10 });
  const stale = await wait(s => !s.tracking.reliable && s.tracking.frameAgeMs >= 300);
  const staleInferenceCount = await page.evaluate(() => window.__berryStats.inferences);
  await page.waitForTimeout(600);
  const staleHeld = await snapshot();
  assert.equal(await page.evaluate(() => window.__berryStats.inferences), staleInferenceCount);
  assert.deepEqual(staleHeld.tracking.reference, reference);
  closeTo(staleHeld.rootX, stale.rootX, 1, 'No-new-video-frame freeze');
  trackingTrace('dropped video frames', staleHeld);
  await page.evaluate(async () => {
    const { game } = await import('/src/main.ts');
    await game.scene.getScene('BerryKick').inputSource.camera.video.play();
  });
  const droppedRecovered = await settled(-1);
  assert.deepEqual(droppedRecovered.tracking.reference, reference);
  closeTo(droppedRecovered.rootX, earlyLeft.rootX, 12, 'Dropped frames recover original left offset');
  trackingTrace('fresh video recovered off-center', droppedRecovered);
  const hud = page.locator('.berry-tracking-debug');
  await hud.waitFor({ state: 'visible' });
  await page.waitForTimeout(250);
  assert.match(await hud.innerText(), /Full Tracking · tracking · tracking[\s\S]*Offset .*rootX[\s\S]*Frame age .*FPS/);
  await page.screenshot({ path: `${output}/camera-tracking-hud.png` });
  check('The existing scheduler stops when video frames stop advancing; stale input freezes movement and fresh frames recover');

  await fixture({ shift: -.13, left: 0 }); await wait(s => s.rootX > 1060);
  await fixture({ right: .07 });
  await page.waitForFunction(() => window.__cameraContacts.some(contact => contact.kind === 'wrong-tree'));
  assert.match(await page.locator('[data-berry-hint]').innerText(), /左/);
  await page.waitForTimeout(1300);
  assert.equal((await snapshot()).score, 0);
  assert.equal((await snapshot()).target, 'left');
  assert.equal(await page.evaluate(() => window.__cameraContacts.length), 1);
  assert.equal(await page.evaluate(() => window.__cameraTargetDraws), 1);
  await page.screenshot({ path: `${output}/camera-wrong-right.png` });
  check('Camera projected contact on the wrong tree retains the target and RNG state and produces one feedback event while held');
  await fixture({ right: 0, shift: .13, cropAnkles: true });
  await wait(s => s.rootX < 540 && s.tracking.mode === 'partial' && s.armed.left && s.armed.right);
  assert.equal((await snapshot()).score, 0);
  await fixture({ left: .07 }); const left = await wait(s => s.score === 3);
  assert.equal(left.tracking.legTracking.left.mode, 'partial');
  assert.equal(left.tracking.legTracking.right.mode, 'partial');
  assert.ok(left.feet.left.x >= left.zones.left.x && left.feet.left.x <= left.zones.left.x + left.zones.left.width);
  assert.equal(await page.locator('[data-berry-tracking]').innerText(), 'Partial Tracking');
  await page.screenshot({ path: `${output}/camera-partial-left-contact.png` });
  await fixture({ cropAnkles: false });
  const handover = await wait(s => s.tracking.mode === 'full');
  assert.equal(handover.tracking.legTracking.left.reliable, false);
  assert.ok(handover.tracking.legAmounts.left >= left.tracking.legAmounts.left - .1);
  await page.waitForTimeout(1300);
  assert.equal((await snapshot()).score, 3);
  assert.equal((await snapshot()).armed.left, false);
  assert.equal((await snapshot()).target, 'right');
  assert.equal(await page.locator('[data-berry-target]').getAttribute('data-side'), 'right');
  await page.screenshot({ path: `${output}/camera-left-contact.png` });
  check('Both ankles cropped: thigh extension drives the actual left bone and virtual contact; restoring full tracking retains the held leg without duplicate scoring');
  await fixture({ left: 0 }); await wait(s => s.armed.left);
  await fixture({ shift: -.13, hidden: [27] });
  await wait(s => s.rootX > 1060 && s.tracking.legTracking.left.mode === 'partial'
    && s.tracking.legTracking.right.mode === 'full' && s.armed.right);
  await fixture({ hidden: [25, 27] });
  const oneKnee = await wait(s => s.tracking.legTracking.left.mode === 'lost');
  assert.equal(oneKnee.tracking.legTracking.right.mode, 'full');
  assert.equal(oneKnee.armed.left, false);
  assert.equal(oneKnee.armed.right, true);
  await fixture({ right: .07 }); const right = await wait(s => s.score === 6);
  assert.equal(right.counts.left, 1); assert.equal(right.counts.right, 1);
  assert.equal(right.target, 'left');
  assert.ok(right.feet.right.x >= right.zones.right.x && right.feet.right.x <= right.zones.right.x + right.zones.right.width);
  check('A hidden left ankle and then left knee leave the right leg usable for full-geometry contact scoring');

  await fixture({ lost: true });
  const lostPose = await wait(s => !s.tracking.reliable);
  await page.waitForTimeout(700);
  const sustainedLoss = await snapshot();
  assert.equal(sustainedLoss.score, 6); assert.equal(sustainedLoss.armed.right, false);
  assert.equal(sustainedLoss.target, right.target);
  assert.equal(await page.locator('[data-berry-target]').getAttribute('data-side'), right.target);
  closeTo(sustainedLoss.rootX, lostPose.rootX, 1, 'Missing person freeze');
  assert.deepEqual(sustainedLoss.tracking.reference, reference);
  trackingTrace('missing person', sustainedLoss);
  assert.match(await page.locator('[data-berry-hint]').innerText(), /睇唔清楚/);
  await fixture({ lost: false, shift: 0, left: 0, right: 0, hidden: null }); await wait(s => s.armed.left && s.armed.right);
  await fixture({ shift: .13 }); await wait(s => s.rootX < 540);
  await page.locator('[data-action=pause]').click();
  const paused = await snapshot(); const inferenceCount = await page.evaluate(() => window.__berryStats.inferences);
  assert.equal(await page.locator('.berry-camera').evaluate(canvas => canvas.getContext('2d').getImageData(40, 90, 1, 1).data[3]), 0);
  await fixture({ left: .07, shift: -.10 }); await page.waitForTimeout(600);
  assert.equal((await snapshot()).clock, paused.clock); assert.equal((await snapshot()).score, 6);
  assert.equal((await snapshot()).rootX, paused.rootX);
  assert.equal(await page.evaluate(() => window.__berryStats.inferences), inferenceCount);
  await fixture({ left: 0 }); await page.locator('[data-action=resume]').click();
  const resumed = await settled(1);
  assert.equal(resumed.score, 6);
  assert.equal(resumed.target, paused.target);
  assert.deepEqual(resumed.tracking.reference, reference);
  trackingTrace('explicit pause resumed off-center', resumed);
  check('Tracking loss suppresses scoring and freezes movement; pause freezes inference and time; both retain the established reference');
  report.performance = { threeFps: resumed.fps, poseFps: resumed.tracking.poseFps, kind: 'Synthetic landmarks, actual GLB renderer' };
  await page.evaluate(async () => {
    // Accelerate the existing game clock while preserving actual scene updates and camera input.
    (await import('/src/main.ts')).game.scene.getScene('BerryKick').time.timeScale = 30;
  });
  await wait(s => s.completeShown);
  const complete = await snapshot();
  assert.equal(complete.remainingMs, 0);
  assert.equal(complete.elapsedMs, complete.durationMs);
  assert.equal(complete.score, 6);
  assert.match(await page.locator('dialog.berry-results').innerText(), /挑戰完成/);
  const completedInferences = await page.evaluate(() => window.__berryStats.inferences);
  await fixture({ left: .07 });
  await page.waitForTimeout(500);
  assert.equal((await snapshot()).score, 6);
  assert.equal(await page.evaluate(() => window.__berryStats.inferences), completedInferences);
  await page.evaluate(() => window.__berryStats.streams.at(-1).getVideoTracks()[0].dispatchEvent(new Event('ended')));
  assert.equal(await page.locator('dialog.berry-results').count(), 1);
  assert.equal(await page.locator('.berry-score-popup,.berry-countdown-digit').count(), 0);
  await page.screenshot({ path: `${output}/camera-complete.png` });
  await page.evaluate(async () => { (await import('/src/main.ts')).game.scene.getScene('BerryKick').time.timeScale = 1; });
  check('Accelerated game-clock fixture expires camera round once, freezes score/inference and keeps results after track interruption');
  await page.locator('dialog [data-action=home]').click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.berry-camera').count(), 0);
  assert.equal(await page.evaluate(() => window.__berryStats.streams.every(s => s.getTracks().every(t => t.readyState === 'ended'))), true);
  assert.equal(await page.evaluate(() => window.__berryStats.closed), 1);
  check('Returning home closes webcam, model and preview');

  await fixture({ delay: 1500, shift: 0, left: 0, right: 0, lost: false }); await enter(); await page.locator('[data-action=camera]').click();
  await page.waitForFunction(() => window.__berryStats.requested === 2);
  await page.locator('[data-action=home]').click(); await page.waitForTimeout(1900);
  assert.equal(await page.evaluate(() => window.__berryStats.models), 2);
  assert.equal(await page.evaluate(() => window.__berryStats.closed), 2);
  assert.equal(await page.locator('.berry-camera').count(), 0);
  check('Leaving during pending initialization closes late model and tracks without stale UI');

  await fixture({ delay: 900 }); await enter(); await page.locator('[data-action=camera]').click();
  await page.waitForFunction(() => window.__berryStats.requested === 3);
  await page.evaluate(async () => {
    const source = (await import('/src/main.ts')).game.scene.getScene('BerryKick').inputSource;
    const onError = source.onError;
    window.__berryEndedErrors = 0;
    source.onError = message => { window.__berryEndedErrors++; onError(message); };
    window.__berryStats.streams.at(-1).getVideoTracks()[0].dispatchEvent(new Event('ended'));
  });
  await page.locator('dialog [data-action=keyboard]').waitFor();
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.__berryEndedErrors), 1);
  assert.equal(await page.evaluate(() => window.__berryStats.closed), 3);
  assert.equal(await page.locator('.berry-camera').count(), 0);
  await page.locator('dialog [data-action=camera-home]').click();
  check('Camera ending during initialization clears the preview and reports failure once after the late model closes');

  await fixture({ delay: 0, mirrored: true, cropAnkles: true, dimensions: { width: 640, height: 480 } });
  await enter(); await page.locator('[data-action=camera]').click();
  await wait(s => s.armed.left);
  const videoDimensions = await page.locator('.berry-camera-source').evaluate(video => [video.videoWidth, video.videoHeight]);
  assert.deepEqual(videoDimensions, [640, 480]);
  const mirroredNeutral = await settled(0);
  assert.equal(mirroredNeutral.tracking.mode, 'partial');
  assert.equal(mirroredNeutral.tracking.reference.direction, -reference.direction);
  assert.equal(mirroredNeutral.target, 'left');
  assert.equal(await page.locator('[data-berry-target]').getAttribute('data-side'), 'left');
  await fixture({ shift: .10 });
  const mirroredLeft = await settled(-1);
  closeTo(mirroredLeft.rootX, earlyLeft.rootX, 12, 'Mirrored 4:3 left position');
  await fixture({ shift: -.10 });
  const mirroredRight = await settled(1);
  closeTo(mirroredRight.rootX, earlyRight.rootX, 12, 'Mirrored 4:3 right position');
  await fixture({ shift: -.28 });
  const edge = await settled(1, .999);
  assert.ok(edge.tracking.current.center > .85);
  assert.deepEqual(edge.tracking.reference, mirroredNeutral.tracking.reference);
  closeTo(edge.rootX, 800 + edge.maxTravel, 4.5, 'Near-edge clamp');
  trackingTrace('mirrored 640x480 left', mirroredLeft);
  trackingTrace('mirrored 640x480 right', mirroredRight);
  trackingTrace('mirrored 640x480 near the frame edge', edge);
  check('A fresh 640×480 mirrored camera session starts with both ankles out of view and retains anatomical direction, travel and edge clamp');
  await page.evaluate(() => window.__berryStats.streams.at(-1).getVideoTracks()[0].dispatchEvent(new Event('ended')));
  await page.locator('dialog [data-action=keyboard]').waitFor();
  assert.match(await page.locator('dialog').innerText(), /相機暫停/);
  await page.locator('dialog [data-action=keyboard]').click();
  await page.keyboard.down('a'); await page.waitForTimeout(1800); await page.keyboard.up('a');
  await page.keyboard.down('q'); await wait(s => s.score === 3); await page.keyboard.up('q');
  assert.equal((await snapshot()).mode, 'keyboard');
  await page.locator('[data-action=home]').click();
  const resources = await page.evaluate(async () => ({
    models: window.__berryStats.models, closed: window.__berryStats.closed,
    tracks: window.__berryStats.streams.flatMap(s => s.getTracks().map(t => t.readyState)),
    textures: (await import('/src/main.ts')).game.textures.getTextureKeys().filter(key => key.startsWith('berry-rabbit-')),
  }));
  assert.equal(resources.models, resources.closed); assert.ok(resources.tracks.every(state => state === 'ended'));
  assert.deepEqual(resources.textures, []); report.resources = resources;
  check('Camera can reopen; ended track offers keyboard fallback; keyboard remains playable; all resources released');
}

try {
  await installCameraFixture();
  if (lowPerformanceMode) await lowPerformanceRun();
  else await standardRun();
  assert.deepEqual(report.errors, []); report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = String(error);
  report.snapshot = await snapshot().catch(() => null);
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  await browser.close(); console.log(JSON.stringify(report, null, 2));
}
