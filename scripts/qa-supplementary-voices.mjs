import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.QA_URL ?? 'http://127.0.0.1:5183/';
const output = process.env.QA_OUTPUT ?? '/private/tmp/motion-garden-supplementary-voices';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = {
  status: 'RUNNING', url, browser: browser.version(),
  browserRoute: 'Browser plugin not available; existing Playwright and installed Chrome',
  flow: 'Safety intro → real keyboard retry and next carrot → explicit/automatic pause → labeled calibration and camera-tracking fixtures → voice controls and cleanup',
  fixtureBoundary: 'Calibration/tracking status fixtures exercise scene narration with real Web Audio. They do not validate a camera, human motion, calibration accuracy or model inference.',
  checks: [], errors: [], warnings: [], diagnostics: [],
};
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => {
  if (message.type() === 'warning') report.warnings.push(message.text());
  if (message.type() !== 'error') return;
  if (/net::ERR_ABORTED|net::ERR_FAILED/.test(message.text())) report.diagnostics.push(message.text());
  else report.errors.push(message.text());
});

// Observe decoded recordings and native output without replacing playback.
await page.addInitScript(() => {
  const nativeArrayBuffer = Response.prototype.arrayBuffer;
  const nativeDecode = BaseAudioContext.prototype.decodeAudioData;
  const nativeConnect = AudioNode.prototype.connect;
  const nativeSource = BaseAudioContext.prototype.createBufferSource;
  const NativeAudioContext = window.AudioContext;
  const urls = new WeakMap();
  const buffers = new WeakMap();
  const analysers = new Map();
  const contexts = [];
  const starts = [];
  const active = new Set();
  Response.prototype.arrayBuffer = async function () {
    const bytes = await nativeArrayBuffer.call(this);
    urls.set(bytes, this.url);
    return bytes;
  };
  BaseAudioContext.prototype.decodeAudioData = function (bytes, success, failure) {
    const decoded = nativeDecode.call(this, bytes);
    const observed = decoded.then(buffer => {
      buffers.set(buffer, urls.get(bytes) ?? 'buffer');
      success?.(buffer);
      return buffer;
    }, error => { failure?.(error); throw error; });
    return observed;
  };
  AudioNode.prototype.connect = function (destination, ...args) {
    const result = nativeConnect.call(this, destination, ...args);
    if (destination === this.context.destination && analysers.has(this.context)) {
      nativeConnect.call(this, analysers.get(this.context));
    }
    return result;
  };
  BaseAudioContext.prototype.createBufferSource = function () {
    const source = nativeSource.call(this);
    const nativeStart = source.start.bind(source);
    const nativeStop = source.stop.bind(source);
    const event = { context: contexts.indexOf(this), id: '', loop: false, offset: 0, at: 0, stopped: false };
    source.start = function (when = 0, offset = 0, duration) {
      const sourceUrl = buffers.get(source.buffer) ?? 'buffer';
      event.id = sourceUrl.split('/').at(-1).split('?')[0].replace('.wav', '');
      event.loop = source.loop;
      event.offset = offset;
      event.at = performance.now();
      event.duration = source.buffer?.duration;
      starts.push(event);
      active.add(event);
      return duration === undefined ? nativeStart(when, offset) : nativeStart(when, offset, duration);
    };
    source.stop = function (...args) {
      event.stopped = true;
      active.delete(event);
      return nativeStop(...args);
    };
    source.addEventListener('ended', () => { event.endedAt = performance.now(); active.delete(event); });
    return source;
  };
  window.AudioContext = class extends NativeAudioContext {
    constructor(...args) {
      super(...args);
      contexts.push(this);
      const analyser = this.createAnalyser();
      analyser.fftSize = 2048;
      analysers.set(this, analyser);
    }
  };
  window.__audioQA = {
    starts, contexts,
    snapshot: () => ({ starts: starts.map(event => ({ ...event })), active: [...active].map(event => ({ ...event })),
      contexts: contexts.map(context => ({ state: context.state, currentTime: context.currentTime })) }),
    peak: () => {
      let peak = 0;
      for (const analyser of analysers.values()) {
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      }
      return peak;
    },
  };
});

const supplementaryIds = ['safety', 'calibration-standing', 'calibration-bend', 'tracking-lost', 'rest', 'retry', 'next-carrot'];
const mainIds = ['carrot-ready', 'carrot-grabbed', 'carrot-success', 'carrot-complete', 'berry-ready', 'berry-success', 'berry-complete'];
const isVoice = event => supplementaryIds.includes(event.id) || mainIds.includes(event.id);
const check = (name, detail) => report.checks.push({ name, result: 'PASS', detail });
const poll = async (read, predicate, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await page.waitForTimeout(50);
  }
  throw new Error(`Condition timed out ${JSON.stringify(await read())}`);
};
const audio = () => page.evaluate(() => window.__audioQA.snapshot());
const count = async id => (await audio()).starts.filter(event => event.id === id).length;
const sceneSnapshot = name => page.evaluate(async name => {
  const scene = (await import('/src/main.ts')).game.scene.getScene(name);
  return name === 'CarrotPull' ? scene.getDebugSnapshot() : scene.snapshot();
}, name);
const sceneAudio = name => page.evaluate(async name => (await import('/src/main.ts')).game.scene.getScene(name).audio.snapshot(), name);
const dialog = () => page.locator('dialog[open]');
const latest = async id => (await audio()).starts.filter(event => event.id === id).at(-1);
const waitEnded = id => poll(audio, value => {
  const event = value.starts.filter(event => event.id === id).at(-1);
  return event?.endedAt && !value.active.some(item => item.id === id);
}, 20000);
const voiceCount = async () => (await audio()).starts.filter(isVoice).length;
const peakDuring = async milliseconds => {
  let peak = 0;
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    peak = Math.max(peak, await page.evaluate(() => window.__audioQA.peak()));
    await page.waitForTimeout(20);
  }
  return peak;
};
const homeReady = async () => {
  const cdp = await page.context().newCDPSession(page);
  await poll(async () => {
    const state = await cdp.send('Runtime.evaluate', {
      expression: "Boolean(document.querySelector('[data-action=start]'))",
      returnByValue: true, userGesture: false,
    });
    return state.result.value;
  }, ready => ready);
  await cdp.detach();
};
const enter = async name => {
  await page.locator('[data-action=start]').click();
  await page.locator(`[data-action=${name === 'CarrotPull' ? 'carrot' : 'berry'}]`).click();
  if (name === 'CarrotPull') await page.locator('[data-input-action=keyboard]').first().waitFor();
  else await dialog().locator('[data-action=keyboard]').waitFor();
};
const selectKeyboard = name => name === 'CarrotPull'
  ? page.locator('[data-input-action=keyboard]').first().click()
  : dialog().locator('[data-action=keyboard]').click();
const pauseButton = name => page.locator(name === 'CarrotPull' ? '[data-action=pause]' : '.berry-hud [data-action=pause]');
const failedBend = async () => {
  await page.keyboard.down('ArrowDown');
  await poll(() => sceneSnapshot('CarrotPull'), value => value.state === 'BENDING');
  await page.keyboard.up('ArrowDown');
  await poll(() => sceneSnapshot('CarrotPull'), value => value.state === 'READY');
};
const harvestCarrot = async score => {
  await page.keyboard.down('ArrowDown');
  await poll(() => sceneSnapshot('CarrotPull'), value => value.state === 'GRABBED');
  await page.keyboard.up('ArrowDown');
  await page.keyboard.down('ArrowUp');
  await poll(() => sceneSnapshot('CarrotPull'), value => value.state === 'SUCCESS');
  await page.keyboard.up('ArrowUp');
  return poll(() => sceneSnapshot('CarrotPull'), value => value.score === score);
};

const installCarrotStatusFixture = async status => page.evaluate(async status => {
  const scene = (await import('/src/main.ts')).game.scene.getScene('CarrotPull');
  window.__supplementaryCarrotStatus = status;
  const getStatus = scene.motion.getStatus.bind(scene.motion);
  scene.motion.getStatus = () => {
    const current = { ...window.__supplementaryCarrotStatus, lastFrameTimestampMs: performance.now() };
    scene.motion.capture.onStatus?.(current);
    return current;
  };
  window.__restoreSupplementaryCarrotStatus = () => { scene.motion.getStatus = getStatus; getStatus(); };
}, status);
const patchCarrotStatus = patch => page.evaluate(patch => {
  Object.assign(window.__supplementaryCarrotStatus, patch);
  return performance.now();
}, patch);

try {
  await page.goto(url);
  await homeReady();
  assert.equal(new URL(page.url()).origin, new URL(url).origin);
  assert.match(await page.title(), /動態花園/);
  assert.match(await page.locator('#game-ui').innerText(), /開始遊戲/);
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  const files = await page.evaluate(async ids => Promise.all(ids.map(async id => {
    const response = await fetch(`/assets/audio/voice/${id}.wav`);
    return { id, status: response.status, bytes: (await response.arrayBuffer()).byteLength };
  })), supplementaryIds);
  assert.ok(files.every(file => file.status === 200 && file.bytes > 44));
  check('Home identity, meaningful content, no error overlay and seven supplementary WAV files', files);

  await enter('CarrotPull');
  await poll(() => count('safety'), value => value === 1);
  await page.waitForTimeout(150);
  const safetyPeak = await peakDuring(200);
  assert.ok(safetyPeak > .00001);
  assert.equal(await page.locator('[data-input-action=keyboard]').first().isVisible(), true);
  await page.screenshot({ path: `${output}/carrot-safety-intro.png` });
  await page.waitForTimeout(200);
  assert.equal(await count('safety'), 1);
  await selectKeyboard('CarrotPull');
  await poll(() => count('carrot-ready'), value => value === 1);
  assert.equal((await audio()).active.some(event => event.id === 'safety'), false);
  await waitEnded('carrot-ready');
  check('Safety plays once during the actionable Carrot intro, produces real PCM and yields to the game instruction', { safetyPeak });

  await failedBend();
  await poll(() => count('retry'), value => value === 1);
  await failedBend();
  await page.waitForTimeout(150);
  assert.equal(await count('retry'), 1);
  assert.equal((await sceneSnapshot('CarrotPull')).score, 0);
  check('An actual interrupted keyboard bend triggers retry while a second quick failure respects cooldown');

  await harvestCarrot(1);
  await poll(() => count('next-carrot'), value => value === 1);
  assert.equal((await sceneSnapshot('CarrotPull')).score, 1);
  assert.ok((await audio()).active.some(event => event.id === 'next-carrot'));
  await page.screenshot({ path: `${output}/carrot-next-round.png` });
  await page.keyboard.down('ArrowDown');
  await poll(() => sceneSnapshot('CarrotPull'), value => value.state === 'BENDING');
  assert.equal((await audio()).active.some(event => event.id === 'next-carrot'), false);
  await page.keyboard.up('ArrowDown');
  await poll(() => sceneSnapshot('CarrotPull'), value => value.state === 'READY');
  await page.waitForTimeout(200);
  assert.equal(await count('next-carrot'), 1);
  assert.equal(await count('carrot-grabbed'), 1);
  assert.equal(await count('carrot-success'), 1);
  check('The first normal harvest credits score while next-carrot speech plays, and a new bend cancels that speech without replay');

  await pauseButton('CarrotPull').click();
  await poll(() => count('rest'), value => value === 1);
  assert.equal((await sceneAudio('CarrotPull')).paused, true);
  assert.deepEqual((await audio()).active.filter(isVoice).map(event => event.id), ['rest']);
  const frozen = await sceneSnapshot('CarrotPull');
  await page.waitForTimeout(200);
  assert.equal((await sceneSnapshot('CarrotPull')).score, frozen.score);
  await page.screenshot({ path: `${output}/carrot-explicit-rest.png` });
  await dialog().locator('[data-action=resume]').click();
  await page.waitForTimeout(120);
  assert.equal((await audio()).active.some(event => event.id === 'rest'), false);
  const beforeAutoPause = await count('rest');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await dialog().locator('[data-action=resume]').waitFor();
  await page.waitForTimeout(120);
  assert.equal(await count('rest'), beforeAutoPause);
  assert.equal((await audio()).active.filter(isVoice).length, 0);
  await dialog().locator('[data-action=resume]').click();
  await page.keyboard.press('Escape');
  await poll(() => count('rest'), value => value === beforeAutoPause + 1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(100);
  assert.equal((await audio()).active.filter(isVoice).length, 0);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(120);
  assert.equal((await audio()).active.filter(isVoice).length, 0);
  await dialog().locator('[data-action=resume]').click();
  check('Explicit Pause/Escape can narrate rest while paused; Resume cancels it, and labeled blur/hidden events keep automatic pauses silent');

  // Status fixtures use the existing MotionInputController-to-scene callback.
  const calibrationBase = {
    mode: 'camera', ready: false, suspended: true, requestPause: false,
    message: 'Supplementary voice calibration status fixture', cameraStatus: 'running',
    trackingState: 'PERSON_DETECTED', personDetected: true,
    calibrationReady: false, calibrationState: 'STANDING_INSTRUCTIONS',
  };
  const standingBefore = await count('calibration-standing');
  const bendBefore = await count('calibration-bend');
  await installCarrotStatusFixture(calibrationBase);
  await poll(() => count('calibration-standing'), value => value === standingBefore + 1);
  assert.equal((await sceneAudio('CarrotPull')).paused, true);
  for (const calibrationState of ['STANDING_SAMPLING', 'STANDING_INSTRUCTIONS', 'STANDING_SAMPLING', 'STANDING_INSTRUCTIONS']) {
    await patchCarrotStatus({ calibrationState });
    await page.waitForTimeout(100);
  }
  assert.equal(await count('calibration-standing'), standingBefore + 1);
  await waitEnded('calibration-standing');
  await patchCarrotStatus({ calibrationState: 'BEND_INSTRUCTIONS' });
  await poll(() => count('calibration-bend'), value => value === bendBefore + 1);
  for (const calibrationState of ['BEND_SAMPLING', 'BEND_INSTRUCTIONS', 'BEND_SAMPLING', 'BEND_INSTRUCTIONS']) {
    await patchCarrotStatus({ calibrationState });
    await page.waitForTimeout(100);
  }
  assert.equal(await count('calibration-bend'), bendBefore + 1);
  await waitEnded('calibration-bend');
  const retryBeforeFailure = await count('retry');
  await patchCarrotStatus({ calibrationState: 'FAILED' });
  await poll(() => count('retry'), value => value === retryBeforeFailure + 1);
  await page.waitForTimeout(350);
  assert.equal(await count('retry'), retryBeforeFailure + 1);
  await patchCarrotStatus({ calibrationState: 'STANDING_INSTRUCTIONS' });
  await page.waitForTimeout(100);
  await patchCarrotStatus({ calibrationState: 'FAILED' });
  await page.waitForTimeout(200);
  assert.equal(await count('retry'), retryBeforeFailure + 1);
  check('Labeled calibration states play standing/bend once per phase despite sampling resets; FAILED triggers one cooldown-protected retry');

  await patchCarrotStatus({ calibrationState: 'COMPLETE', calibrationReady: true,
    ready: true, suspended: false, trackingState: 'TRACKING_READY', personDetected: true });
  await page.waitForTimeout(120);
  const trackingBefore = await count('tracking-lost');
  const retriesAfterCalibration = await count('retry');
  const firstLossAt = await patchCarrotStatus({ ready: false, suspended: true, trackingState: 'TRACKING_LOST', personDetected: false });
  await page.waitForTimeout(1100);
  assert.equal(await count('tracking-lost'), trackingBefore);
  await poll(() => count('tracking-lost'), value => value === trackingBefore + 1, 3000);
  const firstLoss = await latest('tracking-lost');
  const firstLossDelayMs = firstLoss.at - firstLossAt;
  assert.ok(firstLossDelayMs >= 1450 && firstLossDelayMs < 2500);
  await page.waitForTimeout(150);
  await patchCarrotStatus({ ready: true, suspended: false, trackingState: 'TRACKING_READY', personDetected: true });
  await page.waitForTimeout(120);
  assert.equal((await audio()).active.some(event => event.id === 'tracking-lost'), false);
  await patchCarrotStatus({ ready: false, suspended: true, trackingState: 'TRACKING_LOST', personDetected: false });
  await page.waitForTimeout(1800);
  assert.equal(await count('tracking-lost'), trackingBefore + 1);
  await patchCarrotStatus({ ready: true, suspended: false, trackingState: 'TRACKING_READY', personDetected: true });
  const cooldownWait = await page.evaluate(at => Math.max(0, at + 15100 - performance.now()), firstLoss.at);
  if (cooldownWait > 0) await page.waitForTimeout(cooldownWait);
  await patchCarrotStatus({ ready: false, suspended: true, trackingState: 'WAITING_FOR_PERSON', personDetected: false });
  await poll(() => count('tracking-lost'), value => value === trackingBefore + 2, 4000);
  const secondLoss = await latest('tracking-lost');
  assert.ok(secondLoss.at - firstLoss.at >= 15000);
  await page.evaluate(() => window.__restoreSupplementaryCarrotStatus());
  await page.waitForTimeout(150);
  assert.equal((await audio()).active.some(event => event.id === 'tracking-lost'), false);
  assert.equal((await sceneSnapshot('CarrotPull')).score, 1);
  assert.equal(await count('retry'), retriesAfterCalibration);
  check('Labeled camera loss waits for sustained absence, cancels on recovery, obeys the real 15-second cooldown and releases no stale gameplay retry', { firstLossDelayMs, repeatedLossIntervalMs: secondLoss.at - firstLoss.at });

  await pauseButton('CarrotPull').click();
  await poll(audio, value => value.active.some(event => event.id === 'rest'));
  await page.evaluate(async () => { window.__oldSupplementaryAudio = (await import('/src/main.ts')).game.scene.getScene('CarrotPull').audio; });
  await dialog().locator('[data-action=restart]').click();
  await page.locator('[data-input-action=keyboard]').first().waitFor();
  assert.equal((await page.evaluate(() => window.__oldSupplementaryAudio.snapshot())).destroyed, true);
  assert.equal((await audio()).active.some(event => event.id === 'rest'), false);
  await pauseButton('CarrotPull').click();
  await dialog().locator('[data-action=home]').click();
  await homeReady();
  assert.equal((await audio()).active.filter(isVoice).length, 0);
  check('Restart and Home dispose supplementary narration and cancel the previous scene sources');

  const beforeBerrySafety = await count('safety');
  await enter('BerryKick');
  await poll(() => count('safety'), value => value === beforeBerrySafety + 1);
  const berrySafety = await count('safety');
  await poll(audio, value => value.active.some(event => event.id === 'safety'));
  await page.waitForTimeout(150);
  assert.equal(await count('safety'), berrySafety);
  const beforeObsoleteReady = await count('berry-ready');
  await selectKeyboard('BerryKick');
  await page.waitForTimeout(250);
  assert.equal(await count('berry-ready'), beforeObsoleteReady);
  // Audio-only playback verifies that explicit rest still cancels an active legacy recording.
  await page.evaluate(async () => (await import('/src/main.ts')).game.scene.getScene('BerryKick').audio.playVoice('ready'));
  await poll(audio, value => value.active.some(event => event.id === 'berry-ready'));
  const berryRest = await count('rest');
  await pauseButton('BerryKick').click();
  await poll(() => count('rest'), value => value === berryRest + 1);
  assert.equal((await sceneAudio('BerryKick')).paused, true);
  assert.equal((await audio()).active.some(event => event.id === 'berry-ready'), false);
  await page.screenshot({ path: `${output}/berry-explicit-rest.png` });
  await dialog().locator('[data-action=resume]').click();
  await page.waitForTimeout(120);
  assert.equal((await audio()).active.some(event => event.id === 'rest'), false);
  check('Berry intro shares safety once and keeps obsolete ready speech silent; explicit rest cancels an audio-only legacy fixture and Resume cancels rest');

  // The Berry fixture supplies reliability states through its normal update method.
  await page.evaluate(async () => {
    const scene = (await import('/src/main.ts')).game.scene.getScene('BerryKick');
    const update = scene.inputSource.update.bind(scene.inputSource);
    const mode = scene.inputSource.mode;
    window.__supplementaryBerryReliable = false;
    scene.inputSource.mode = 'keyboard';
    scene.inputSource.update = () => ({ leftLegExtensionAmount: 0, rightLegExtensionAmount: 0,
      lateralOffset: 0, lateralReliable: window.__supplementaryBerryReliable,
      reliable: window.__supplementaryBerryReliable, timestampMs: performance.now() });
    window.__restoreSupplementaryBerryInput = () => { scene.inputSource.mode = mode; scene.inputSource.update = update; };
  });
  const berryTracking = await count('tracking-lost');
  await page.waitForTimeout(1800);
  assert.equal(await count('tracking-lost'), berryTracking);
  await page.evaluate(async () => {
    const scene = (await import('/src/main.ts')).game.scene.getScene('BerryKick');
    scene.inputSource.mode = 'camera'; window.__supplementaryBerryReliable = true;
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => { window.__supplementaryBerryReliable = false; });
  await poll(() => count('tracking-lost'), value => value === berryTracking + 1, 4000);
  await page.evaluate(() => window.__restoreSupplementaryBerryInput());
  await page.waitForTimeout(150);
  assert.equal((await audio()).active.some(event => event.id === 'tracking-lost'), false);
  assert.equal((await sceneSnapshot('BerryKick')).score, 0);
  await page.locator('.berry-hud [data-action=home]').click();
  await homeReady();
  assert.equal((await audio()).active.filter(isVoice).length, 0);
  check('Labeled Berry reliability fixture ignores keyboard loss, voices sustained camera loss, recovers and preserves score');

  await page.locator('[data-action=settings]').click();
  await page.locator('[name=voiceEnabled]').uncheck();
  await page.locator('.game-settings [type=submit]').click();
  const disabledCount = await voiceCount();
  await enter('CarrotPull');
  await page.waitForTimeout(200);
  await selectKeyboard('CarrotPull');
  await page.waitForTimeout(250);
  await pauseButton('CarrotPull').click();
  await page.waitForTimeout(150);
  assert.equal(await voiceCount(), disabledCount);
  await dialog().locator('[data-action=home]').click();
  await homeReady();
  await page.locator('[data-action=settings]').click();
  await page.locator('[name=voiceEnabled]').check();
  await page.locator('[name=voiceVolume]').evaluate(input => {
    input.value = '0'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('.game-settings [type=submit]').click();
  const zeroVolumeCount = await voiceCount();
  await enter('BerryKick');
  await selectKeyboard('BerryKick');
  await page.waitForTimeout(150);
  await pauseButton('BerryKick').click();
  await page.waitForTimeout(150);
  assert.equal(await voiceCount(), zeroVolumeCount);
  await dialog().locator('[data-action=home]').click();
  await homeReady();
  await page.locator('[data-action=settings]').click();
  await page.locator('.game-settings').getByRole('button', { name: '恢復預設', exact: true }).click();
  await page.locator('.game-settings [type=submit]').click();
  check('Existing voice-off and zero-volume settings suppress supplementary safety/rest as well as primary narration');

  let delayedRequested = false;
  const delayedBody = await (await page.request.get(`${url}assets/audio/voice/rest.wav`)).body();
  await page.route('**/rest.wav?qa-supplementary-delayed=1', async route => {
    delayedRequested = true;
    await new Promise(resolve => setTimeout(resolve, 350));
    await route.fulfill({ status: 200, contentType: 'audio/wav', body: delayedBody }).catch(() => undefined);
  });
  const beforeDelayed = await count('rest');
  await page.evaluate(async () => {
    const { AudioManager } = await import('/src/game/systems/AudioManager.ts');
    const manager = new AudioManager();
    window.__supplementaryDelayedAudio = manager;
    await manager.unlock();
    manager.registerVoice('rest', '/assets/audio/voice/rest.wav?qa-supplementary-delayed=1');
    manager.pause();
    manager.playVoice('rest', { allowWhilePaused: true });
  });
  await poll(async () => delayedRequested, requested => requested);
  await page.evaluate(() => {
    window.__supplementaryDelayedAudio.stopVoice('rest');
    window.__supplementaryDelayedAudio.destroy();
  });
  await page.waitForTimeout(500);
  assert.equal(await count('rest'), beforeDelayed);
  await page.unroute('**/rest.wav?qa-supplementary-delayed=1');
  check('An observed pending paused-rest fetch is canceled by matching stop/destroy and cannot speak later');

  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  report.finalAudio = await audio();
  report.supplementaryCounts = Object.fromEntries(await Promise.all(supplementaryIds.map(async id => [id, await count(id)])));
  assert.ok(Object.values(report.supplementaryCounts).every(value => value > 0));
  assert.equal(report.finalAudio.active.filter(isVoice).length, 0);
  check('Every supplementary recording reached native playback with clean console health and no final active narration');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.failure = String(error);
  report.audio = await audio().catch(() => null);
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => undefined);
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, errors: report.errors, warnings: report.warnings, failure: report.failure, report: `${output}/results.json` }, null, 2));
}
