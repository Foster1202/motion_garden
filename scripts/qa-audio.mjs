import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.QA_URL ?? 'http://127.0.0.1:5179/';
const output = process.env.QA_OUTPUT ?? '/private/tmp/motion-garden-audio';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = {
  status: 'RUNNING', url, browser: browser.version(),
  browserRoute: 'Browser plugin not available; existing Playwright and installed Chrome',
  flow: 'Home settings → unlocked PCM output → voice/BGM fixture → full Carrot keyboard round → Berry hit → pause/replay/home',
  checks: [], errors: [], warnings: [], diagnostics: [],
};
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => {
  if (message.type() === 'warning') report.warnings.push(message.text());
  if (message.type() !== 'error') return;
  if (/net::ERR_ABORTED|net::ERR_FAILED/.test(message.text())) report.diagnostics.push(message.text());
  else report.errors.push(message.text());
});

// Observe real decoded buffers and output without replacing the playback implementation.
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
    source.addEventListener('ended', () => active.delete(event));
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
const panel = () => page.locator('.game-settings');
const saveSettings = () => panel().locator('[type=submit]').click();
const range = async value => page.locator('[name=sfxVolume]').evaluate((input, value) => {
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}, value);
const peakDuring = async milliseconds => {
  let peak = 0;
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    peak = Math.max(peak, await page.evaluate(() => window.__audioQA.peak()));
    await page.waitForTimeout(20);
  }
  return peak;
};
const enter = async name => {
  await page.locator('[data-action=start]').click();
  await page.locator(`[data-action=${name === 'CarrotPull' ? 'carrot' : 'berry'}]`).click();
  if (name === 'CarrotPull') await page.locator('[data-input-action=keyboard]').first().click();
  else await dialog().locator('[data-action=keyboard]').click();
};

try {
  await page.goto(url);
  // Observe startup without granting browser user activation.
  const startupCdp = await page.context().newCDPSession(page);
  await poll(async () => {
    const state = await startupCdp.send('Runtime.evaluate', {
      expression: "Boolean(document.querySelector('[data-action=start]'))",
      returnByValue: true, userGesture: false,
    });
    return state.result.value;
  }, ready => ready);
  await startupCdp.detach();
  assert.equal(new URL(page.url()).origin, new URL(url).origin);
  assert.match(await page.title(), /動態花園/);
  assert.match(await page.locator('#game-ui').innerText(), /開始遊戲/);
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  await page.evaluate(async () => {
    const scene = (await import('/src/main.ts')).game.scene.getScene('Menu');
    await scene.audio.preload();
    scene.audio.playSfx('success');
  });
  await page.waitForTimeout(180);
  assert.equal((await audio()).starts.length, 0);
  const initialSfxGain = await page.evaluate(async () =>
    (await import('/src/main.ts')).game.scene.getScene('Menu').audio.gains.get('sfx').gain.value);
  assert.ok(Math.abs(initialSfxGain - .6) < .00001);
  assert.equal((await sceneAudio('Menu')).unlocked, false);
  check('Meaningful page identity and no overlay; pre-gesture SFX stays silent without queued playback');

  await page.locator('[data-action=settings]').click();
  await poll(audio, value => value.contexts.some(context => context.state === 'running'));
  assert.equal(await page.locator('[name=sfxEnabled]').isChecked(), true);
  assert.equal(await page.locator('[name=sfxVolume]').inputValue(), '0.6');
  await range(.35);
  await page.locator('[name=sfxEnabled]').uncheck();
  assert.equal(await page.locator('[name=sfxVolume]').isDisabled(), true);
  await saveSettings();
  assert.equal((await sceneAudio('Menu')).sfxEnabled, false);
  assert.equal((await sceneAudio('Menu')).volumes.sfx, .35);
  const mutedCount = await count('success');
  await page.evaluate(async () => (await import('/src/main.ts')).game.scene.getScene('Menu').audio.playSfx('success'));
  await page.waitForTimeout(220);
  assert.equal(await count('success'), mutedCount);
  await page.reload();
  await page.locator('[data-action=settings]').click();
  assert.equal(await page.locator('[name=sfxEnabled]').isChecked(), false);
  assert.equal(await page.locator('[name=sfxVolume]').inputValue(), '0.35');
  await page.locator('[name=sfxEnabled]').check();
  await saveSettings();
  await page.locator('[data-action=settings]').click();
  await range(.9);
  await panel().getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('[data-action=settings]').click();
  assert.equal(await page.locator('[name=sfxVolume]').inputValue(), '0.35');
  await panel().getByRole('button', { name: '恢復預設', exact: true }).click();
  assert.equal(await page.locator('[name=sfxVolume]').inputValue(), '0.6');
  await saveSettings();
  check('SFX switch/volume disable, persistence, cancel and restore-default save semantics');
  await page.evaluate(async () => {
    const { DEFAULT_GAME_SETTINGS, SETTINGS_STORAGE_KEY } = await import('/src/game/settings/gameSettings.ts');
    const legacy = { ...DEFAULT_GAME_SETTINGS, bendingAngle: 155 };
    delete legacy.sfxEnabled;
    delete legacy.sfxVolume;
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(legacy));
  });
  await page.reload();
  await page.locator('[data-action=settings]').click();
  assert.equal(await page.locator('[name=sfxEnabled]').isChecked(), true);
  assert.equal(await page.locator('[name=sfxVolume]').inputValue(), '0.6');
  assert.equal(await page.locator('[name=bendingAngle]').inputValue(), '155');
  await panel().getByRole('button', { name: '恢復預設', exact: true }).click();
  await saveSettings();
  check('Legacy stored motion settings retain their values while absent audio fields migrate to defaults');

  await page.locator('[data-action=settings]').click();
  await page.screenshot({ path: `${output}/settings-desktop.png` });
  await page.setViewportSize({ width: 600, height: 800 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${output}/settings-mobile.png` });
  const layout = await page.locator('.game-settings').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
  });
  assert.ok(layout.x >= 0 && layout.right <= 601 && layout.y >= 0 && layout.bottom <= 801);
  assert.ok(layout.scrollWidth <= layout.clientWidth + 1);
  await panel().getByRole('button', { name: '取消', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  check('Desktop and 600×800 audio controls render inside a scrollable settings dialog', layout);

  await page.evaluate(async () => {
    const manager = (await import('/src/main.ts')).game.scene.getScene('Menu').audio;
    await manager.preload();
    manager.stopAll();
    manager.playSfx('complete');
  });
  const audiblePeak = await peakDuring(350);
  assert.ok(audiblePeak > .00001, `Expected nonzero PCM, received ${audiblePeak}`);
  await page.evaluate(async () => {
    const manager = (await import('/src/main.ts')).game.scene.getScene('Menu').audio;
    manager.stopAll(); manager.setMuted(true); manager.playSfx('complete');
  });
  await page.waitForTimeout(150);
  const mutedPeak = await peakDuring(160);
  assert.ok(mutedPeak < .00001, `Expected muted output, received ${mutedPeak}`);
  await page.evaluate(async () => {
    const manager = (await import('/src/main.ts')).game.scene.getScene('Menu').audio;
    manager.stopAll(); manager.setMuted(false);
  });
  check('Real browser PCM is nonzero through the output graph and master mute silences it', { audiblePeak, mutedPeak });

  const overlapStart = await count('berry');
  for (let index = 0; index < 3; index++) {
    await page.evaluate(async () => (await import('/src/main.ts')).game.scene.getScene('Menu').audio.playSfx('berry'));
    await page.waitForTimeout(90);
  }
  const overlapping = await audio();
  assert.equal(await count('berry'), overlapStart + 3);
  assert.ok(overlapping.active.filter(event => event.id === 'berry').length >= 2);
  await page.evaluate(async () => (await import('/src/main.ts')).game.scene.getScene('Menu').audio.stopAll());
  check('Consecutive collection sounds overlap through independent real BufferSource nodes');
  const duplicateStart = await count('berry');
  await page.evaluate(async () => {
    const manager = (await import('/src/main.ts')).game.scene.getScene('Menu').audio;
    for (let index = 0; index < 20; index++) manager.playSfx('berry');
  });
  assert.equal(await count('berry'), duplicateStart + 1);
  await page.evaluate(async () => (await import('/src/main.ts')).game.scene.getScene('Menu').audio.stopAll());
  for (let wave = 0; wave < 3; wave++) {
    await page.evaluate(async () => {
      const manager = (await import('/src/main.ts')).game.scene.getScene('Menu').audio;
      for (const id of ['click', 'grab', 'success', 'berry', 'complete']) manager.playSfx(id);
    });
    assert.ok((await audio()).active.length <= 6);
    await page.waitForTimeout(65);
  }
  assert.equal((await sceneAudio('Menu')).active.sfx, 6);
  await page.evaluate(async () => (await import('/src/main.ts')).game.scene.getScene('Menu').audio.stopAll());
  check('Identical same-frame events deduplicate and SFX polyphony stays capped at six');

  await page.evaluate(async () => {
    const manager = (await import('/src/main.ts')).game.scene.getScene('Menu').audio;
    window.__qaInterfaceManager = manager;
    manager.registerVoice('ready', '/assets/audio/success.wav');
    manager.registerVoice('complete', '/assets/audio/complete.wav');
    manager.registerBgm('qa-bundled-fixture', '/assets/audio/complete.wav');
    manager.setVolume('voice', .65); manager.setVolume('bgm', .3);
    manager.playBgm('qa-bundled-fixture');
  });
  await poll(audio, value => value.active.some(event => event.loop));
  await page.waitForTimeout(220);
  await page.evaluate(() => window.__qaInterfaceManager.pause());
  assert.equal((await audio()).active.length, 0);
  await page.waitForTimeout(100);
  await page.evaluate(() => window.__qaInterfaceManager.resume());
  await poll(audio, value => value.active.some(event => event.loop));
  const resumedBgm = (await audio()).starts.filter(event => event.loop).at(-1);
  assert.ok(resumedBgm.offset > .1);
  await page.evaluate(() => window.__qaInterfaceManager.playVoice('ready'));
  await poll(audio, value => value.active.some(event => event.id === 'success' && !event.loop));
  await page.waitForTimeout(150);
  const duckedGain = await page.evaluate(() => window.__qaInterfaceManager.gains.get('bgm').gain.value);
  assert.ok(duckedGain > .085 && duckedGain < .1);
  report.voiceBgmSnapshot = { ...await sceneAudio('Menu'), duckedGain };
  await page.evaluate(() => window.__qaInterfaceManager.playVoice('retry'));
  await page.waitForTimeout(160);
  const restoredGain = await page.evaluate(() => window.__qaInterfaceManager.gains.get('bgm').gain.value);
  assert.ok(restoredGain > .295 && restoredGain <= .301);
  assert.equal((await audio()).active.filter(event => !event.loop).length, 0);
  check('An unregistered next prompt releases the previous voice and restores BGM gain', { restoredGain });
  await page.evaluate(() => window.__qaInterfaceManager.playVoice('complete'));
  await poll(audio, value => value.active.some(event => event.id === 'complete' && !event.loop));
  assert.equal((await audio()).active.filter(event => !event.loop).length, 1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal((await audio()).active.length, 0);
  assert.equal((await sceneAudio('Menu')).hidden, true);
  await page.waitForTimeout(120);
  const beforeVisibilityResume = (await audio()).starts.length;
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await poll(audio, value => value.active.some(event => event.loop));
  assert.equal((await audio()).starts.length, beforeVisibilityResume + 1);
  assert.equal((await audio()).active.filter(event => !event.loop).length, 0);
  check('Hidden-page lifecycle stops every source and restores only selected BGM on visibility recovery');
  await page.evaluate(() => window.__qaInterfaceManager.stopAll());
  assert.equal((await audio()).active.length, 0);
  check('Bundled WAV fixtures exercise registered narration replacement and looping BGM pause/resume at its saved offset', { resumedOffset: resumedBgm.offset });

  let delayedRequested = false;
  const delayedBody = await (await page.request.get(`${url}assets/audio/success.wav`)).body();
  await page.route('**/success.wav?qa-delayed=1', async route => {
    delayedRequested = true;
    await new Promise(resolve => setTimeout(resolve, 350));
    await route.fulfill({ status: 200, contentType: 'audio/wav', body: delayedBody }).catch(() => undefined);
  });
  const delayedStart = (await audio()).starts.length;
  await page.evaluate(async () => {
    const { AudioManager } = await import('/src/game/systems/AudioManager.ts');
    const manager = new AudioManager();
    window.__qaDelayedManager = manager;
    await manager.unlock();
    manager.registerVoice('ready', '/assets/audio/success.wav?qa-delayed=1');
    manager.playVoice('ready');
  });
  await poll(async () => delayedRequested, requested => requested);
  await page.evaluate(() => window.__qaDelayedManager.destroy());
  await page.waitForTimeout(500);
  assert.equal((await audio()).starts.length, delayedStart);
  assert.equal((await page.evaluate(() => window.__qaDelayedManager.snapshot())).destroyed, true);
  await page.unroute('**/success.wav?qa-delayed=1');
  check('Destroy invalidates pending narration work and late loading cannot start a source');

  await page.evaluate(async () => { window.__qaOldAudio = (await import('/src/main.ts')).game.scene.getScene('Menu').audio; });
  await enter('CarrotPull');
  await poll(() => sceneSnapshot('CarrotPull'), value => value.input.mode === 'keyboard');
  assert.equal((await page.evaluate(() => window.__qaOldAudio.snapshot())).destroyed, true);
  const beforeCarrot = { grab: await count('grab'), success: await count('success'), complete: await count('complete') };
  for (let carrot = 1; carrot <= 5; carrot++) {
    await page.keyboard.down('ArrowDown');
    await poll(() => sceneSnapshot('CarrotPull'), value => value.state === 'GRABBED');
    await page.keyboard.up('ArrowDown');
    await page.waitForTimeout(100);
    assert.equal(await count('grab'), beforeCarrot.grab + carrot);
    if (carrot === 1) {
      await page.keyboard.down('ArrowUp');
      await page.waitForTimeout(120);
      await page.keyboard.up('ArrowUp');
      await poll(() => sceneSnapshot('CarrotPull'), value => value.state === 'GRABBED');
      assert.equal(await count('grab'), beforeCarrot.grab + 1);
      await page.locator('[data-action=pause]').click();
      await page.waitForTimeout(90);
      assert.equal((await audio()).active.length, 0);
      assert.equal((await sceneAudio('CarrotPull')).paused, true);
      await dialog().locator('[data-action=resume]').click();
    }
    await page.keyboard.down('ArrowUp');
    await poll(() => sceneSnapshot('CarrotPull'), value => value.state === 'SUCCESS');
    await page.keyboard.up('ArrowUp');
    await poll(() => sceneSnapshot('CarrotPull'), value => value.score === carrot);
    assert.equal(await count('success'), beforeCarrot.success + carrot);
  }
  await dialog().getByRole('heading', { name: '完成啦！', exact: true }).waitFor();
  assert.equal(await count('complete'), beforeCarrot.complete + 1);
  await page.waitForTimeout(250);
  assert.equal(await count('complete'), beforeCarrot.complete + 1);
  await page.screenshot({ path: `${output}/carrot-complete.png` });
  await page.evaluate(async () => { window.__qaOldAudio = (await import('/src/main.ts')).game.scene.getScene('CarrotPull').audio; });
  await dialog().locator('[data-action=again]').click();
  await page.locator('[data-input-action=keyboard]').first().click();
  assert.equal((await page.evaluate(() => window.__qaOldAudio.snapshot())).destroyed, true);
  await page.locator('[data-action=pause]').click();
  await dialog().locator('[data-action=home]').click();
  await page.locator('[data-action=start]').waitFor();
  check('Normal full five-carrot keyboard game has five grabs/pulls and one completion; return retry, pause and restart avoid duplicate/stale audio');

  await enter('BerryKick');
  await poll(() => sceneSnapshot('BerryKick'), value => value.active && value.renderMode === '3d');
  const beforeBerry = await count('berry');
  await page.keyboard.down('a');
  await page.waitForTimeout(1800);
  await page.keyboard.up('a');
  await page.waitForTimeout(300);
  await page.keyboard.down('q');
  await poll(() => sceneSnapshot('BerryKick'), value => value.score === 3);
  await page.waitForTimeout(300);
  assert.equal(await count('berry'), beforeBerry + 1);
  await page.keyboard.up('q');
  await page.locator('.berry-hud [data-action=pause]').click();
  await page.waitForTimeout(90);
  assert.equal((await audio()).active.length, 0);
  assert.equal((await sceneAudio('BerryKick')).paused, true);
  const pausedClock = (await sceneSnapshot('BerryKick')).clock;
  await page.waitForTimeout(200);
  assert.equal((await sceneSnapshot('BerryKick')).clock, pausedClock);
  await dialog().locator('[data-action=resume]').click();
  await page.waitForTimeout(100);
  const beforeCompletion = await count('complete');
  // This deadline fixture tests the ordinary expiry/finish path without waiting a full round.
  await page.evaluate(async () => {
    const scene = (await import('/src/main.ts')).game.scene.getScene('BerryKick');
    scene.round.clock = scene.round.durationMs - 1;
  });
  await poll(() => sceneSnapshot('BerryKick'), value => value.completeShown);
  await page.waitForTimeout(150);
  assert.equal(await count('complete'), beforeCompletion + 1);
  await page.evaluate(async () => (await import('/src/main.ts')).game.scene.getScene('BerryKick').finish());
  assert.equal(await count('complete'), beforeCompletion + 1);
  await page.screenshot({ path: `${output}/berry-complete.png` });
  await page.evaluate(async () => { window.__qaOldAudio = (await import('/src/main.ts')).game.scene.getScene('BerryKick').audio; });
  await dialog().locator('[data-action=restart]').click();
  await dialog().locator('[data-action=keyboard]').click();
  assert.equal((await page.evaluate(() => window.__qaOldAudio.snapshot())).destroyed, true);
  await page.locator('.berry-hud [data-action=home]').click();
  await page.locator('[data-action=start]').waitFor();
  check('Actual projected-foot Berry hit emits one sound for +3; pause freezes clock/stops audio; labeled expiry fixture emits one completion and replay disposes audio');

  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  assert.deepEqual(report.errors, []);
  report.finalAudio = await audio();
  check('No application console errors, framework overlay, or late old-scene sources; console warnings captured for review', { warnings: report.warnings });
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
