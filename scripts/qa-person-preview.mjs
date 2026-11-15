import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.QA_URL ?? 'http://127.0.0.1:5175/';
const output = process.env.QA_OUTPUT ?? '/tmp/person-preview-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const report = {
  status: 'RUNNING', browser: browser.version(), url,
  browserPlugin: 'Browser plugin not available. Playwright uses installed Google Chrome',
  input: 'Synthetic canvas video, segmentation masks and landmarks. No human webcam validation.',
  checks: [], errors: [], warnings: [],
};
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => {
  if (message.type() === 'error') report.errors.push(message.text());
  if (message.type() === 'warning') report.warnings.push(message.text());
});
const check = (name, detail) => report.checks.push({ name, result: 'PASS', detail });
const panel = () => page.locator('.game-settings');
const keypoints = () => panel().locator('[name=showBodyKeypoints]');
const background = () => panel().locator('[name=backgroundProcessing]');
const mode = () => panel().locator('[name=backgroundMode]');
const openSettings = async () => {
  await page.locator('[data-action=settings]').click();
  await panel().waitFor();
};
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('motion-garden-settings-v1')));
const assertSettings = async expected => {
  assert.equal(await keypoints().isChecked(), expected.showBodyKeypoints);
  assert.equal(await background().isChecked(), expected.backgroundProcessing);
  assert.equal(await mode().inputValue(), expected.backgroundMode);
  assert.equal(await mode().isDisabled(), !expected.backgroundProcessing);
  assert.equal(await mode().isVisible(), expected.backgroundProcessing);
};

try {
  await page.goto(url);
  await page.locator('[data-action=settings]').waitFor();
  assert.equal(new URL(page.url()).origin, new URL(url).origin);
  assert.match(await page.title(), /動態花園/);
  assert.ok((await page.locator('body').innerText()).includes('開始遊戲'));
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  check('Page identity, meaningful home screen and no framework error overlay');
  await page.evaluate(() => localStorage.removeItem('motion-garden-settings-v1'));
  await openSettings();
  await assertSettings({ showBodyKeypoints: false, backgroundProcessing: false, backgroundMode: 'blur' });
  await page.screenshot({ path: `${output}/settings-default.png` });
  await panel().getByRole('button', { name: '取消', exact: true }).click();
  check('New preview settings default off and the background selector follows its switch');

  const combinations = [
    { showBodyKeypoints: false, backgroundProcessing: false, backgroundMode: 'blur' },
    { showBodyKeypoints: true, backgroundProcessing: false, backgroundMode: 'blur' },
    { showBodyKeypoints: false, backgroundProcessing: true, backgroundMode: 'blur' },
    { showBodyKeypoints: true, backgroundProcessing: true, backgroundMode: 'gray' },
  ];
  for (const settings of combinations) {
    await openSettings();
    await keypoints().setChecked(settings.showBodyKeypoints);
    await background().setChecked(settings.backgroundProcessing);
    if (settings.backgroundProcessing) await mode().selectOption(settings.backgroundMode);
    await panel().getByRole('button', { name: '儲存', exact: true }).click();
    assert.equal(await panel().count(), 0);
    const saved = await stored();
    for (const [key, value] of Object.entries(settings)) assert.equal(saved[key], value);
    await page.reload();
    await openSettings();
    await assertSettings(settings);
    await panel().getByRole('button', { name: '取消', exact: true }).click();
  }
  check('Actual SettingsPanel saves and reloads all four independent combinations', combinations);

  await openSettings();
  await page.screenshot({ path: `${output}/settings-enabled.png` });
  await page.setViewportSize({ width: 600, height: 800 });
  const layout = await panel().evaluate(dialog => {
    const bounds = dialog.getBoundingClientRect();
    const save = dialog.querySelector('[type=submit]').getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, width: innerWidth,
      saveTop: save.top, saveBottom: save.bottom, height: innerHeight,
      overflow: dialog.scrollWidth > dialog.clientWidth };
  });
  assert.ok(layout.left >= 0 && layout.right <= layout.width);
  assert.ok(layout.saveTop >= 0 && layout.saveBottom <= layout.height);
  assert.equal(layout.overflow, false);
  await page.screenshot({ path: `${output}/settings-mobile.png` });
  await keypoints().uncheck();
  await background().uncheck();
  await panel().getByRole('button', { name: '取消', exact: true }).click();
  await openSettings();
  await assertSettings(combinations[3]);
  await panel().getByRole('button', { name: '恢復預設', exact: true }).click();
  await assertSettings(combinations[0]);
  await panel().getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await stored()).showBodyKeypoints, true);
  await openSettings();
  await panel().getByRole('button', { name: '恢復預設', exact: true }).click();
  await panel().getByRole('button', { name: '儲存', exact: true }).click();
  await page.reload();
  await openSettings();
  await assertSettings(combinations[0]);
  await panel().getByRole('button', { name: '取消', exact: true }).click();
  check('Cancel preserves saved state, reset requires Save, and narrow settings retain usable actions', layout);

  await page.evaluate(async () => {
    const { DEFAULT_GAME_SETTINGS, SETTINGS_STORAGE_KEY } = await import('/src/game/settings/gameSettings.ts');
    const { showBodyKeypoints, backgroundProcessing, backgroundMode, ...legacy } = DEFAULT_GAME_SETTINGS;
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...legacy, standingAngle: 170, bendingAngle: 155 }));
  });
  await page.reload();
  await openSettings();
  await assertSettings(combinations[0]);
  assert.equal(await panel().locator('[name=standingAngle]').inputValue(), '170');
  assert.equal(await panel().locator('[name=bendingAngle]').inputValue(), '155');
  await panel().getByRole('button', { name: '取消', exact: true }).click();
  check('Legacy numeric settings retain their values and receive disabled preview defaults');

  await page.setViewportSize({ width: 1440, height: 1000 });
  const rendering = await page.evaluate(async () => {
    const { PersonOnlyRenderer } = await import('/src/game/vision/PersonOnlyRenderer.ts');
    const { PoseDebugOverlay } = await import('/src/game/vision/PoseDebugOverlay.ts');
    const { DEFAULT_GAME_SETTINGS, saveGameSettings } = await import('/src/game/settings/gameSettings.ts');
    const source = document.createElement('canvas');
    source.width = 320;
    source.height = 180;
    const sourceContext = source.getContext('2d');
    sourceContext.fillStyle = '#20b060';
    sourceContext.fillRect(0, 0, 160, 180);
    for (let y = 0; y < 180; y += 4) for (let x = 160; x < 320; x += 4) {
      sourceContext.fillStyle = (x + y) % 8 === 0 ? '#e02020' : '#2020e0';
      sourceContext.fillRect(x, y, 4, 4);
    }
    const stream = source.captureStream(25);
    const video = document.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    video.className = 'berry-camera-source';
    document.body.append(video);
    await video.play();
    await new Promise(resolve => setTimeout(resolve, 150));
    const gallery = document.createElement('section');
    gallery.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#fffdf4;padding:24px;overflow:auto;color:#263822;font:16px system-ui;';
    const title = document.createElement('h1');
    title.textContent = 'Webcam 預覽組合';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,320px);gap:24px;margin-top:20px;';
    gallery.append(title, grid);
    document.body.append(gallery);
    const landmarks = Array.from({ length: 33 }, (_, index) => ({
      x: .08 + (index % 11) * .084, y: .2 + Math.floor(index / 11) * .25,
      visibility: .99, presence: .99,
    }));
    const frame = { landmarks, timestampMs: performance.now(), inferenceMs: 1, poseFps: 25,
      imageWidth: 320, imageHeight: 180,
      personMask: { width: 4, height: 2, alpha: Uint8ClampedArray.of(255, 255, 0, 0, 255, 255, 0, 0) } };
    const pose = { state: 'STANDING', confidence: .99, reliableSides: 2, candidateMs: 0,
      timestampMs: frame.timestampMs, inferenceMs: 1, poseFps: 25, trackingLostMs: 0, autoRestRecommended: false };
    const pixel = (canvas, x, y) => [...canvas.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data];
    const overlays = [];
    const previews = [];
    for (const [label, settings] of [
      ['全部關閉', { showBodyKeypoints: false, backgroundProcessing: false, backgroundMode: 'blur' }],
      ['身體關鍵點', { showBodyKeypoints: true, backgroundProcessing: false, backgroundMode: 'blur' }],
      ['背景模糊', { showBodyKeypoints: false, backgroundProcessing: true, backgroundMode: 'blur' }],
      ['關鍵點 + 灰色背景', { showBodyKeypoints: true, backgroundProcessing: true, backgroundMode: 'gray' }],
      ['背景灰色', { showBodyKeypoints: false, backgroundProcessing: true, backgroundMode: 'gray' }],
      ['關鍵點 + 模糊背景', { showBodyKeypoints: true, backgroundProcessing: true, backgroundMode: 'blur' }],
    ]) {
      saveGameSettings({ ...DEFAULT_GAME_SETTINGS, ...settings });
      const card = document.createElement('article');
      const heading = document.createElement('h2');
      heading.style.cssText = 'font-size:17px;margin-bottom:8px;';
      heading.textContent = label;
      const host = document.createElement('div');
      card.append(heading, host);
      grid.append(card);
      const overlay = new PoseDebugOverlay(host, video, { debug: false, preview: true });
      overlay.root.style.cssText = 'position:relative;inset:auto;width:320px;box-sizing:border-box;';
      overlay.update(frame, pose);
      overlays.push(overlay);
      const canvas = overlay.root.querySelector('canvas');
      previews.push({ ...settings, foreground: pixel(canvas, 20, 160), background: pixel(canvas, 280, 160),
        point: pixel(canvas, landmarks[0].x * canvas.width, landmarks[0].y * canvas.height),
        transform: getComputedStyle(canvas).transform, width: canvas.width, height: canvas.height });
    }
    const canvas = document.createElement('canvas');
    const renderer = new PersonOnlyRenderer(video, canvas);
    renderer.render(frame);
    const legacy = { foreground: pixel(canvas, 20, 160), background: pixel(canvas, 280, 160) };
    renderer.render(frame, { background: 'gray' });
    const firstGray = pixel(canvas, 20, 160);
    renderer.render({ ...frame, personMask: undefined }, { background: 'gray' });
    const missingMask = pixel(canvas, 20, 160);
    renderer.render({ ...frame, landmarks: undefined }, { background: 'gray', showBodyKeypoints: true });
    const lost = pixel(canvas, landmarks[0].x * canvas.width, landmarks[0].y * canvas.height);
    renderer.render({ ...frame, personMask: { width: 3, height: 2, alpha: Uint8ClampedArray.of(255) } }, { background: 'gray' });
    const invalidMask = pixel(canvas, 20, 160);
    renderer.render({ ...frame, personMask: undefined }, { background: 'blur' });
    const missingBlur = { foreground: pixel(canvas, 20, 160), background: pixel(canvas, 280, 160) };
    renderer.clear();
    const cleared = pixel(canvas, 20, 160);

    sourceContext.fillStyle = '#202020';
    sourceContext.fillRect(0, 0, 320, 180);
    await new Promise(resolve => setTimeout(resolve, 120));
    const context = canvas.getContext('2d');
    const originalArc = context.arc;
    let arcs = [];
    context.arc = function (...args) { arcs.push(args.slice(0, 2)); return originalArc.apply(this, args); };
    renderer.render(frame, { background: 'none', showBodyKeypoints: true });
    const allPoints = landmarks.map(point => pixel(canvas, point.x * canvas.width, point.y * canvas.height));
    const blueLink = pixel(canvas, (landmarks[0].x + landmarks[1].x) * canvas.width / 2, landmarks[0].y * canvas.height);
    const arcCount = arcs.length;
    const uncertain = landmarks.map(point => ({ ...point }));
    uncertain[0].visibility = .1;
    uncertain[32].presence = .1;
    delete uncertain[15].presence;
    renderer.render({ ...frame, landmarks: uncertain }, { background: 'none', showBodyKeypoints: true, confidenceThreshold: .5 });
    const lowVisibility = pixel(canvas, uncertain[0].x * canvas.width, uncertain[0].y * canvas.height);
    const lowPresence = pixel(canvas, uncertain[32].x * canvas.width, uncertain[32].y * canvas.height);
    const optionalPresence = pixel(canvas, uncertain[15].x * canvas.width, uncertain[15].y * canvas.height);
    const malformed = landmarks.map(point => ({ ...point }));
    malformed[0].x = NaN;
    malformed[1].y = Infinity;
    malformed[2].x = -10;
    arcs = [];
    renderer.render({ ...frame, landmarks: malformed }, { background: 'none', showBodyKeypoints: true });
    const malformedArcs = arcs;
    context.arc = originalArc;
    renderer.render({ ...frame, landmarks: undefined, personMask: undefined }, { background: 'none', showBodyKeypoints: true });
    const clearedPoints = pixel(canvas, landmarks[15].x * canvas.width, landmarks[15].y * canvas.height);

    const source43 = document.createElement('canvas');
    source43.width = 320;
    source43.height = 240;
    source43.getContext('2d').fillRect(0, 0, 320, 240);
    const stream43 = source43.captureStream(10);
    const video43 = document.createElement('video');
    video43.muted = true;
    video43.srcObject = stream43;
    await video43.play();
    await new Promise(resolve => setTimeout(resolve, 100));
    const canvas43 = document.createElement('canvas');
    const renderer43 = new PersonOnlyRenderer(video43, canvas43);
    renderer43.render({ ...frame, imageWidth: 320, imageHeight: 240 }, { background: 'none', showBodyKeypoints: true });
    const aspect43 = { width: canvas43.width, height: canvas43.height,
      point: pixel(canvas43, landmarks[15].x * canvas43.width, landmarks[15].y * canvas43.height) };
    renderer43.render({ ...frame, imageWidth: 100, imageHeight: 300 }, { background: 'none', showBodyKeypoints: true });
    const tallAspect = { width: canvas43.width, height: canvas43.height,
      point: pixel(canvas43, landmarks[15].x * canvas43.width, landmarks[15].y * canvas43.height) };
    renderer43.clear();
    video43.pause();
    for (const track of stream43.getTracks()) track.stop();
    const performanceMask = new Uint8ClampedArray(256 * 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      performanceMask[y * 256 + x] = Math.round(Math.max(0, Math.min(1, (144 - x) / 32)) * 255);
    }
    const performanceFrame = { ...frame, personMask: { width: 256, height: 256, alpha: performanceMask } };
    const performanceSamples = [];
    for (const options of [
      { background: 'none', showBodyKeypoints: false },
      { background: 'none', showBodyKeypoints: true },
      { background: 'gray', showBodyKeypoints: false },
      { background: 'blur', showBodyKeypoints: true },
    ]) {
      renderer.clear();
      const durations = [];
      for (let index = 0; index < 105; index++) {
        performanceFrame.timestampMs += 40;
        const started = performance.now();
        renderer.render(performanceFrame, options);
        const duration = performance.now() - started;
        if (index >= 5) durations.push(duration);
      }
      context.getImageData(0, 0, 1, 1);
      const sorted = [...durations].sort((a, b) => a - b);
      performanceSamples.push({ ...options, frames: durations.length, mask: [256, 256], output: [canvas.width, canvas.height],
        meanMs: durations.reduce((sum, value) => sum + value, 0) / durations.length,
        p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], maxMs: sorted.at(-1) });
    }
    video.pause();
    video.srcObject = null;
    renderer.render(frame, { background: 'none', showBodyKeypoints: true });
    const stopped = pixel(canvas, 20, 160);
    window.__previewCleanup = () => {
      for (const overlay of overlays) overlay.destroy();
      renderer.clear();
      video.pause();
      for (const track of stream.getTracks()) track.stop();
      video.remove();
      gallery.remove();
    };
    return { previews, legacy, firstGray, missingMask, lost, invalidMask, missingBlur, cleared,
      allPoints, blueLink, arcCount, lowVisibility, lowPresence, optionalPresence, malformedArcs,
      clearedPoints, aspect43, tallAspect, performanceSamples, stopped };
  });
  const green = color => color[1] > color[0] + 70 && color[1] > color[2] + 30;
  const red = color => color[0] > color[1] + 30 && color[0] > color[2] + 30;
  const gray = color => color.slice(0, 3).every(channel => Math.abs(channel - 128) <= 2) && color[3] === 255;
  for (const preview of rendering.previews) {
    assert.ok(green(preview.foreground), JSON.stringify(preview));
    assert.equal(preview.foreground[3], 255);
    assert.deepEqual([preview.width, preview.height], [320, 180]);
    assert.match(preview.transform, /matrix\(-1,/);
    if (preview.backgroundProcessing && preview.backgroundMode === 'gray') assert.ok(gray(preview.background), JSON.stringify(preview));
    else assert.equal(preview.background[3], 255);
    if (preview.showBodyKeypoints) assert.deepEqual(preview.point, [0, 230, 118, 255]);
    else assert.deepEqual(preview.point, preview.foreground);
  }
  const rawBackground = rendering.previews[0].background;
  const blurredBackground = rendering.previews[2].background;
  assert.ok(rawBackground.slice(0, 3).some((channel, index) => Math.abs(channel - blurredBackground[index]) >= 20));
  assert.ok(rendering.legacy.foreground[3] > 250);
  assert.equal(rendering.legacy.background[3], 0);
  assert.ok(green(rendering.firstGray));
  assert.ok(gray(rendering.missingMask));
  assert.ok(gray(rendering.invalidMask));
  assert.ok(gray(rendering.lost));
  assert.equal(rendering.missingBlur.background[3], 255);
  assert.equal(rendering.cleared[3], 0);
  assert.equal(rendering.stopped[3], 0);
  check('Production preview settings render independent combinations, original foreground and blur/gray backgrounds', rendering.previews);
  check('Legacy transparent rendering, missing/invalid mask fallbacks, person loss and clear remove stale pixels', {
    legacy: rendering.legacy, missingMask: rendering.missingMask, lost: rendering.lost,
    invalidMask: rendering.invalidMask, missingBlur: rendering.missingBlur, cleared: rendering.cleared, stopped: rendering.stopped,
  });
  assert.equal(rendering.arcCount, 33);
  assert.ok(rendering.allPoints.every(green));
  assert.ok(rendering.blueLink[2] > rendering.blueLink[1] + 30 && rendering.blueLink[2] > rendering.blueLink[0] + 70);
  assert.ok(red(rendering.lowVisibility));
  assert.ok(red(rendering.lowPresence));
  assert.ok(green(rendering.optionalPresence));
  assert.ok(rendering.malformedArcs.length <= 30);
  assert.ok(rendering.malformedArcs.every(point => point.every(Number.isFinite)));
  assert.ok(!green(rendering.clearedPoints));
  assert.deepEqual([rendering.aspect43.width, rendering.aspect43.height], [320, 240]);
  assert.ok(green(rendering.aspect43.point));
  assert.deepEqual([rendering.tallAspect.width, rendering.tallAspect.height], [213, 640]);
  assert.ok(green(rendering.tallAspect.point));
  check('All 33 points and blue links map to video coordinates, confidence colors include presence, malformed points are skipped and 4:3/tall aspect is retained', {
    pointCount: rendering.arcCount, blueLink: rendering.blueLink, lowVisibility: rendering.lowVisibility,
    lowPresence: rendering.lowPresence, optionalPresence: rendering.optionalPresence,
    aspect43: rendering.aspect43, tallAspect: rendering.tallAspect,
  });
  for (const sample of rendering.performanceSamples) {
    assert.equal(sample.frames, 100);
    assert.ok(Number.isFinite(sample.meanMs) && Number.isFinite(sample.p95Ms));
  }
  check('Measured preview render call timings with 256x256 masks. Synthetic lower bound excludes real inference, device FPS and deferred compositing', rendering.performanceSamples);
  await page.screenshot({ path: `${output}/webcam-combinations.png` });
  await page.evaluate(() => window.__previewCleanup());
  assert.deepEqual(report.errors, []);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.failure = String(error);
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => undefined);
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
