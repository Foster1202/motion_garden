import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.QA_URL ?? 'http://127.0.0.1:5182/';
const output = process.env.QA_OUTPUT ?? '/private/tmp/motion-garden-voices';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = {
  status: 'RUNNING', url, browser: browser.version(),
  browserRoute: 'Browser plugin not available; existing Playwright and installed Chrome',
  flow: 'Persisted voice controls → full Carrot keyboard round → pause/restart → Berry instructions and accepted hits → completion and cleanup',
  checks: [], errors: [], warnings: [], diagnostics: [],
};
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => {
  if (message.type() === 'warning') report.warnings.push(message.text());
  if (message.type() !== 'error') return;
  if (/net::ERR_ABORTED|net::ERR_FAILED/.test(message.text())) report.diagnostics.push(message.text());
  else report.errors.push(message.text());
});

// Observe decoded recordings and real PCM while preserving the playback graph.
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

const voiceIds = ['carrot-ready', 'carrot-grabbed', 'carrot-success', 'carrot-complete', 'berry-ready', 'berry-success', 'berry-complete'];
const isVoice = event => voiceIds.includes(event.id);
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
const range = async value => page.locator('[name=voiceVolume]').evaluate((input, value) => {
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
const waitVoiceEnded = id => poll(audio, value => {
  const event = value.starts.filter(event => event.id === id).at(-1);
  return event?.endedAt && !value.active.some(item => item.id === id);
}, 20000);
const voiceCounts = async () => Object.fromEntries(await Promise.all(voiceIds.map(async id => [id, await count(id)])));
const berryHit = async targetScore => {
  await page.keyboard.down('q');
  await poll(() => sceneSnapshot('BerryKick'), value => value.score === targetScore);
  await page.keyboard.up('q');
  await page.waitForTimeout(550);
};

try {
  await page.goto(url);
  await homeReady();
  assert.equal(new URL(page.url()).origin, new URL(url).origin);
  assert.match(await page.title(), /動態花園/);
  assert.match(await page.locator('#game-ui').innerText(), /開始遊戲/);
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  assert.equal((await audio()).starts.filter(isVoice).length, 0);
  const files = await page.evaluate(async ids => Promise.all(ids.map(async id => {
    const response = await fetch(`/assets/audio/voice/${id}.wav`);
    return { id, status: response.status, bytes: (await response.arrayBuffer()).byteLength };
  })), voiceIds);
  assert.ok(files.every(file => file.status === 200 && file.bytes > 44));
  check('Page identity, meaningful home screen, no overlay or premature narration; seven recording files load', files);

  await page.locator('[data-action=settings]').click();
  assert.equal(await page.getByRole('checkbox', { name: '語音開關', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('slider', { name: '語音音量', exact: true }).inputValue(), '0.8');
  await range(.35);
  assert.equal(await page.locator('output[for=settings-voice-volume]').innerText(), '35%');
  await page.locator('[name=voiceEnabled]').uncheck();
  assert.equal(await page.locator('[name=voiceVolume]').isDisabled(), true);
  await saveSettings();
  assert.equal((await sceneAudio('Menu')).voiceEnabled, false);
  assert.equal((await sceneAudio('Menu')).volumes.voice, .35);
  assert.equal((await sceneAudio('Menu')).sfxEnabled, true);
  assert.equal((await sceneAudio('Menu')).volumes.sfx, .6);
  await page.evaluate(async () => {
    const manager = (await import('/src/main.ts')).game.scene.getScene('Menu').audio;
    await manager.registerVoice('ready', '/assets/audio/voice/carrot-ready.wav');
    manager.playVoice('ready');
  });
  await page.waitForTimeout(120);
  assert.equal(await count('carrot-ready'), 0);
  await page.reload();
  await homeReady();
  await page.locator('[data-action=settings]').click();
  assert.equal(await page.locator('[name=voiceEnabled]').isChecked(), false);
  assert.equal(await page.locator('[name=voiceVolume]').inputValue(), '0.35');
  await page.locator('[name=voiceEnabled]').check();
  await saveSettings();
  await page.locator('[data-action=settings]').click();
  await range(.9);
  await panel().getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('[data-action=settings]').click();
  assert.equal(await page.locator('[name=voiceVolume]').inputValue(), '0.35');
  await panel().getByRole('button', { name: '恢復預設', exact: true }).click();
  assert.equal(await page.locator('[name=voiceEnabled]').isChecked(), true);
  assert.equal(await page.locator('[name=voiceVolume]').inputValue(), '0.8');
  await saveSettings();
  check('Independent voice enable/volume persist and apply immediately; off suppresses playback; cancel/reset semantics hold');

  await page.evaluate(async () => {
    const { DEFAULT_GAME_SETTINGS, SETTINGS_STORAGE_KEY } = await import('/src/game/settings/gameSettings.ts');
    const legacy = { ...DEFAULT_GAME_SETTINGS, sfxEnabled: false, sfxVolume: .25, bendingAngle: 155 };
    delete legacy.voiceEnabled;
    delete legacy.voiceVolume;
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(legacy));
  });
  await page.reload();
  await homeReady();
  await page.locator('[data-action=settings]').click();
  assert.equal(await page.locator('[name=voiceEnabled]').isChecked(), true);
  assert.equal(await page.locator('[name=voiceVolume]').inputValue(), '0.8');
  assert.equal(await page.locator('[name=sfxEnabled]').isChecked(), false);
  assert.equal(await page.locator('[name=sfxVolume]').inputValue(), '0.25');
  assert.equal(await page.locator('[name=bendingAngle]').inputValue(), '155');
  await panel().getByRole('button', { name: '恢復預設', exact: true }).click();
  await page.screenshot({ path: `${output}/voice-settings-desktop.png` });
  await page.setViewportSize({ width: 600, height: 800 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${output}/voice-settings-mobile.png` });
  const layout = await panel().evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
  });
  assert.ok(layout.x >= 0 && layout.right <= 601 && layout.y >= 0 && layout.bottom <= 801);
  assert.ok(layout.scrollWidth <= layout.clientWidth + 1);
  await saveSettings();
  await page.setViewportSize({ width: 1440, height: 900 });
  check('Legacy SFX/motion preferences survive voice defaults; desktop and 600×800 voice controls fit the scrollable settings dialog', layout);

  await enter('CarrotPull');
  await page.waitForTimeout(250);
  assert.equal((await audio()).starts.filter(isVoice).length, 0);
  // Simulate an audio activation that resolves after the first ready input frame.
  await page.evaluate(async () => {
    const manager = (await import('/src/main.ts')).game.scene.getScene('CarrotPull').audio;
    await manager.context.suspend();
    manager.unlocked = false;
    const unlock = manager.unlock.bind(manager);
    manager.unlock = async () => { await new Promise(resolve => setTimeout(resolve, 300)); await unlock(); };
    window.__qaRestoreVoiceUnlock = () => { manager.unlock = unlock; };
  });
  await page.locator('[data-input-action=keyboard]').first().click();
  await page.waitForTimeout(100);
  assert.equal(await count('carrot-ready'), 0);
  await poll(audio, value => value.active.some(event => event.id === 'carrot-ready'));
  await page.evaluate(() => window.__qaRestoreVoiceUnlock());
  await page.waitForTimeout(250);
  const voicePeak = await peakDuring(250);
  assert.ok(voicePeak > .00001);
  await waitVoiceEnded('carrot-ready');
  assert.equal(await count('carrot-ready'), 1);
  assert.equal((await sceneAudio('CarrotPull')).voiceEnabled, true);
  check('Carrot instructions wait for keyboard readiness and delayed audio activation, then produce real nonzero PCM once', { voicePeak });

  for (let carrot = 1; carrot <= 5; carrot++) {
    await page.keyboard.down('ArrowDown');
    await poll(() => sceneSnapshot('CarrotPull'), value => value.state === 'GRABBED');
    await page.keyboard.up('ArrowDown');
    await poll(() => count('carrot-grabbed'), value => value === carrot);
    if (carrot === 1) {
      await page.keyboard.down('ArrowUp');
      await page.waitForTimeout(120);
      await page.keyboard.up('ArrowUp');
      await poll(() => sceneSnapshot('CarrotPull'), value => value.state === 'GRABBED');
      assert.equal(await count('carrot-grabbed'), 1);
    }
    await page.keyboard.down('ArrowUp');
    await poll(() => sceneSnapshot('CarrotPull'), value => value.state === 'SUCCESS');
    await page.keyboard.up('ArrowUp');
    await poll(() => sceneSnapshot('CarrotPull'), value => value.score === carrot);
    assert.equal(await count('carrot-success'), carrot);
  }
  await poll(() => count('carrot-complete'), value => value === 1);
  await dialog().getByRole('heading', { name: '完成啦！', exact: true }).waitFor();
  await page.waitForTimeout(160);
  const duckedSfxGain = await page.evaluate(async () =>
    (await import('/src/main.ts')).game.scene.getScene('CarrotPull').audio.gains.get('sfx').gain.value);
  assert.ok(duckedSfxGain > .205 && duckedSfxGain < .22);
  await page.screenshot({ path: `${output}/carrot-recorded-complete.png` });
  await waitVoiceEnded('carrot-complete');
  const completedVoice = (await audio()).starts.filter(event => event.id === 'carrot-complete').at(-1);
  assert.equal(completedVoice.stopped, false);
  assert.equal(await count('carrot-complete'), 1);
  report.carrotVoices = await voiceCounts();
  check('Normal five-carrot keyboard flow voices ready once, grasp/success five times and completion once; retry avoids duplicates and completion speech finishes', { voices: report.carrotVoices, duckedSfxGain });

  await page.evaluate(async () => { window.__qaOldVoiceAudio = (await import('/src/main.ts')).game.scene.getScene('CarrotPull').audio; });
  await dialog().locator('[data-action=again]').click();
  await page.locator('[data-input-action=keyboard]').first().waitFor();
  assert.equal((await page.evaluate(() => window.__qaOldVoiceAudio.snapshot())).destroyed, true);
  const beforeReplay = await count('carrot-ready');
  await page.waitForTimeout(180);
  assert.equal(await count('carrot-ready'), beforeReplay);
  await page.locator('[data-input-action=keyboard]').first().click();
  await poll(() => count('carrot-ready'), value => value === beforeReplay + 1);
  await page.locator('[data-action=pause]').click();
  await page.waitForTimeout(80);
  assert.equal((await audio()).active.filter(isVoice).length, 0);
  assert.equal((await sceneAudio('CarrotPull')).paused, true);
  await dialog().locator('[data-action=resume]').click();
  await poll(() => count('carrot-ready'), value => value === beforeReplay + 2);
  await page.evaluate(async () => { window.__qaOldVoiceAudio = (await import('/src/main.ts')).game.scene.getScene('CarrotPull').audio; });
  await page.locator('[data-action=pause]').click();
  await dialog().locator('[data-action=home]').click();
  await homeReady();
  assert.equal((await page.evaluate(() => window.__qaOldVoiceAudio.snapshot())).destroyed, true);
  assert.equal((await audio()).active.filter(isVoice).length, 0);
  check('Carrot replay waits for input selection; explicit pause stops voice, resume replays the current instruction, and Home destroys old audio');

  await enter('BerryKick');
  await page.waitForTimeout(180);
  assert.equal(await count('berry-ready'), 0);
  await dialog().locator('[data-action=keyboard]').click();
  await poll(audio, value => value.active.some(event => event.id === 'berry-ready'));
  await page.keyboard.down('a');
  await page.waitForTimeout(1800);
  await page.keyboard.up('a');
  assert.ok((await audio()).active.some(event => event.id === 'berry-ready'));
  await berryHit(3);
  assert.equal(await count('berry-success'), 0);
  await waitVoiceEnded('berry-ready');
  const berryIntro = (await audio()).starts.filter(event => event.id === 'berry-ready').at(-1);
  assert.equal(berryIntro.stopped, false);
  check('Berry ready voice waits for reliable active gameplay and the first accepted +3 hit preserves the full spoken instruction');

  await berryHit(6);
  await poll(() => count('berry-success'), value => value === 1);
  await waitVoiceEnded('berry-success');
  await berryHit(9);
  assert.equal(await count('berry-success'), 1);
  const firstReward = (await audio()).starts.filter(event => event.id === 'berry-success')[0];
  const untilCooldown = await page.evaluate(at => Math.max(0, at + 8150 - performance.now()), firstReward.at);
  if (untilCooldown > 0) await page.waitForTimeout(untilCooldown);
  await berryHit(12);
  await poll(() => count('berry-success'), value => value === 2);
  assert.equal(await count('berry-ready'), 1);
  assert.equal((await sceneSnapshot('BerryKick')).score, 12);
  await page.locator('.berry-hud [data-action=pause]').click();
  await page.waitForTimeout(80);
  assert.equal((await audio()).active.filter(isVoice).length, 0);
  await dialog().locator('[data-action=resume]').click();
  await page.waitForTimeout(120);
  assert.equal(await count('berry-ready'), 1);
  assert.equal(await count('berry-success'), 2);
  check('Berry accepted-hit rewards respect eight-second cooldown, use one voice at a time and stop on pause without replaying on resume');

  // The deadline fixture exercises the existing completion path without waiting two minutes.
  await page.evaluate(async () => {
    const scene = (await import('/src/main.ts')).game.scene.getScene('BerryKick');
    scene.round.clock = scene.round.durationMs - 1;
  });
  await poll(() => count('berry-complete'), value => value === 1);
  await dialog().getByRole('heading', { name: '挑戰完成！', exact: true }).waitFor();
  await page.evaluate(async () => (await import('/src/main.ts')).game.scene.getScene('BerryKick').finish());
  assert.equal(await count('berry-complete'), 1);
  await page.screenshot({ path: `${output}/berry-recorded-complete.png` });
  await waitVoiceEnded('berry-complete');
  assert.equal((await audio()).starts.filter(event => event.id === 'berry-complete').at(-1).stopped, false);
  report.berryVoices = await voiceCounts();
  check('Labeled Berry deadline fixture plays completion speech once alongside applause and retains it until its natural end', report.berryVoices);

  await page.evaluate(async () => { window.__qaOldVoiceAudio = (await import('/src/main.ts')).game.scene.getScene('BerryKick').audio; });
  await dialog().locator('[data-action=restart]').click();
  await dialog().locator('[data-action=keyboard]').waitFor();
  assert.equal((await page.evaluate(() => window.__qaOldVoiceAudio.snapshot())).destroyed, true);
  const beforeBerryReplay = await count('berry-ready');
  await page.waitForTimeout(120);
  assert.equal(await count('berry-ready'), beforeBerryReplay);
  await dialog().locator('[data-action=keyboard]').click();
  await poll(() => count('berry-ready'), value => value === beforeBerryReplay + 1);
  await page.locator('.berry-hud [data-action=home]').click();
  await homeReady();
  assert.equal((await audio()).active.filter(isVoice).length, 0);
  check('Berry restart creates a fresh instruction after selection and Home stops its active recording');

  await page.evaluate(async () => {
    const { getGameSettings, saveGameSettings } = await import('/src/game/settings/gameSettings.ts');
    saveGameSettings({ ...getGameSettings(), voiceEnabled: false });
  });
  const beforeDisabledStart = await count('carrot-ready');
  await enter('CarrotPull');
  await page.locator('[data-input-action=keyboard]').first().click();
  await poll(() => sceneSnapshot('CarrotPull'), value => value.input.ready);
  await page.waitForTimeout(150);
  assert.equal(await count('carrot-ready'), beforeDisabledStart);
  await page.evaluate(async () => {
    const { getGameSettings, saveGameSettings } = await import('/src/game/settings/gameSettings.ts');
    saveGameSettings({ ...getGameSettings(), voiceEnabled: true });
  });
  await page.waitForTimeout(250);
  assert.equal(await count('carrot-ready'), beforeDisabledStart);
  await page.locator('[data-action=pause]').click();
  await dialog().locator('[data-action=home]').click();
  await homeReady();
  check('A voice-disabled ready event is consumed once and enabling voice later does not release a stale instruction');

  let delayedRequested = false;
  const delayedBody = await (await page.request.get(`${url}assets/audio/voice/carrot-ready.wav`)).body();
  await page.route('**/carrot-ready.wav?qa-delayed-voice=1', async route => {
    delayedRequested = true;
    await new Promise(resolve => setTimeout(resolve, 350));
    await route.fulfill({ status: 200, contentType: 'audio/wav', body: delayedBody }).catch(() => undefined);
  });
  const beforeDelayed = await count('carrot-ready');
  await page.evaluate(async () => {
    const { AudioManager } = await import('/src/game/systems/AudioManager.ts');
    const manager = new AudioManager();
    window.__qaDelayedVoiceAudio = manager;
    await manager.unlock();
    manager.registerVoice('ready', '/assets/audio/voice/carrot-ready.wav?qa-delayed-voice=1');
    manager.playVoice('ready');
  });
  await poll(async () => delayedRequested, requested => requested);
  await page.evaluate(() => { window.__qaDelayedVoiceAudio.pause(); window.__qaDelayedVoiceAudio.destroy(); });
  await page.waitForTimeout(500);
  assert.equal(await count('carrot-ready'), beforeDelayed);
  assert.equal((await page.evaluate(() => window.__qaDelayedVoiceAudio.snapshot())).destroyed, true);
  await page.unroute('**/carrot-ready.wav?qa-delayed-voice=1');
  check('Pause/destruction invalidate an observed in-flight voice fetch and prevent late playback');

  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  report.finalAudio = await audio();
  report.finalVoiceCounts = await voiceCounts();
  assert.ok(voiceIds.every(id => report.finalVoiceCounts[id] > 0));
  check('All seven supplied gameplay recordings played through native BufferSources with clean warning/error logs and no old active narration');
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
