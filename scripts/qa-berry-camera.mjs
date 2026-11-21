import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.QA_URL ?? 'http://127.0.0.1:5175/';
const output = process.env.QA_OUTPUT ?? '/tmp/berry-camera-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
const report = { status: 'RUNNING', browser: browser.version(),
  input: 'Virtual webcam and synthetic MediaPipe landmarks; real scheduler, extractor, retargeter, rig, projection and round. NOT human webcam validation.',
  checks: [], errors: [], trackingTrace: [] };
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
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
};
try {
  const debugUrl = new URL(url);
  debugUrl.searchParams.set('berryTrackingDebug', '1');
  await page.goto(debugUrl.toString());
  await page.evaluate(async () => {
    const { PoseEstimator } = await import('/src/game/vision/PoseEstimator.ts');
    const { DEFAULT_GAME_SETTINGS, SETTINGS_STORAGE_KEY } = await import('/src/game/settings/gameSettings.ts');
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...DEFAULT_GAME_SETTINGS, berryDurationSeconds: 120 }));
    window.__berryFixture = { left: 0, right: 0, shift: 0, scale: 1, lost: false, delay: 900 };
    window.__berryStats = { models: 0, closed: 0, requested: 0, inferences: 0, spikes: [], streams: [] };
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
            const points = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: .99, presence: .99 }));
            const set = (id, x, y) => {
              const confidence = f.hidden?.includes(id) ? .1 : .99;
              const offset = (x - .5) * scale + shift + (f.jitter ?? 0) * Math.sin(inference * 1.73 + id);
              const anomaly = spike === 'whole-pose' ? .26 : spike === 'one-hip' && id === 23 ? .10 : 0;
              points[id] = { x: .5 + (f.mirrored ? -1 : 1) * (offset + anomaly) * aspectFactor,
                y: .37 + (y - .5) * scale, z: 0, visibility: confidence, presence: confidence };
            };
            set(11, .57, .28); set(12, .43, .28);
            set(23, .54, .5); set(24, .46, .5);
            set(25, .54 + f.left * .5, .7); set(26, .46 - f.right * .5, .7);
            set(27, .54 + f.left, .9); set(28, .46 - f.right, .9);
            return {
              landmarks: [points],
              segmentationMasks: [{ width: 4, height: 2,
                getAsFloat32Array: () => Float32Array.of(1, 1, 0, 0, 1, 1, 0, 0) }],
              close() {},
            };
          },
        };
      };
      return initialize.call(this);
    };
  });
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
  assert.equal(personPreview.sourceOpacity, '0');
  assert.ok(personPreview.keptAlpha > 0);
  assert.equal(personPreview.backgroundAlpha, 255);
  check('Berry camera keeps the original image with both preview enhancements disabled by default');
  check('Camera starts without calibration; pause during delayed initialization retains camera and resumes');
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

  await fixture({ shift: .11, jitter: 0, hidden: [27, 28] });
  const legsHidden = await settled(-1);
  assert.equal(legsHidden.tracking.kickReliable, false);
  assert.equal(legsHidden.armed.left, false);
  assert.equal(legsHidden.score, 0);
  trackingTrace('ankle-only occlusion', legsHidden);
  assert.deepEqual(legsHidden.tracking.reference, reference);
  await fixture({ hidden: [23], shift: -.12 });
  const hipHidden = await wait(s => !s.tracking.reliable);
  await page.waitForTimeout(700);
  const hipStillHidden = await snapshot();
  assert.deepEqual(hipStillHidden.tracking.reference, reference);
  closeTo(hipStillHidden.rootX, hipHidden.rootX, 1, 'Hip obstruction freeze');
  trackingTrace('hip obstruction', hipStillHidden);
  await fixture({ hidden: null, shift: -.10 });
  const hipRecovered = await settled(1);
  assert.deepEqual(hipRecovered.tracking.reference, reference);
  closeTo(hipRecovered.rootX, earlyRight.rootX, 12, 'Recover opposite original center');
  trackingTrace('hip recovered off-center', hipRecovered);
  check('Ankle occlusion blocks kicking while torso moves; hip occlusion freezes the rendered root, then recovers off-center');

  await page.evaluate(async () => {
    const { game } = await import('/src/main.ts');
    const video = game.scene.getScene('BerryKick').inputSource.camera.video;
    const value = video.currentTime;
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => value });
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
    delete game.scene.getScene('BerryKick').inputSource.camera.video.currentTime;
  });
  const droppedRecovered = await settled(-1);
  assert.deepEqual(droppedRecovered.tracking.reference, reference);
  closeTo(droppedRecovered.rootX, earlyLeft.rootX, 12, 'Dropped frames recover original left offset');
  trackingTrace('fresh video recovered off-center', droppedRecovered);
  const hud = page.locator('.berry-tracking-debug');
  await hud.waitFor({ state: 'visible' });
  await page.waitForTimeout(250);
  assert.match(await hud.innerText(), /Tracking tracking · reference tracking[\s\S]*Offset .*rootX[\s\S]*Frame age .*FPS/);
  await page.screenshot({ path: `${output}/camera-tracking-hud.png` });
  check('The existing scheduler stops when video frames stop advancing; stale input freezes movement and fresh frames recover');

  await fixture({ shift: .13 }); await wait(s => s.rootX < 540);
  assert.equal((await snapshot()).score, 0);
  await fixture({ left: .07 }); const left = await wait(s => s.score === 3);
  assert.ok(left.feet.left.x >= left.zones.left.x && left.feet.left.x <= left.zones.left.x + left.zones.left.width);
  await page.waitForTimeout(1300); assert.equal((await snapshot()).score, 3);
  await page.screenshot({ path: `${output}/camera-left-contact.png` });
  check('Synthetic left extension drives actual left bone and projected contact; held extension cannot repeat');
  await fixture({ left: 0 }); await page.waitForTimeout(650);
  await fixture({ shift: -.13 }); await wait(s => s.rootX > 1060);
  await fixture({ right: .07 }); const right = await wait(s => s.score === 6);
  assert.equal(right.counts.left, 1); assert.equal(right.counts.right, 1);
  assert.ok(right.feet.right.x >= right.zones.right.x && right.feet.right.x <= right.zones.right.x + right.zones.right.width);
  check('Synthetic right extension uses same independent right-foot geometric scoring');

  await fixture({ lost: true });
  const lostPose = await wait(s => !s.tracking.reliable);
  await page.waitForTimeout(700);
  const sustainedLoss = await snapshot();
  assert.equal(sustainedLoss.score, 6); assert.equal(sustainedLoss.armed.right, false);
  closeTo(sustainedLoss.rootX, lostPose.rootX, 1, 'Missing person freeze');
  assert.deepEqual(sustainedLoss.tracking.reference, reference);
  trackingTrace('missing person', sustainedLoss);
  assert.match(await page.locator('[data-berry-hint]').innerText(), /睇唔清楚/);
  await fixture({ lost: false, shift: 0, left: 0, right: 0 }); await wait(s => s.armed.left && s.armed.right);
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

  await fixture({ delay: 0, mirrored: true, dimensions: { width: 640, height: 480 } });
  await enter(); await page.locator('[data-action=camera]').click();
  await wait(s => s.armed.left);
  const videoDimensions = await page.locator('.berry-camera-source').evaluate(video => [video.videoWidth, video.videoHeight]);
  assert.deepEqual(videoDimensions, [640, 480]);
  const mirroredNeutral = await settled(0);
  assert.equal(mirroredNeutral.tracking.reference.direction, -reference.direction);
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
  check('Mirrored landmarks at 640×480 retain anatomical direction, travel and bounded position near the frame edge');
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
