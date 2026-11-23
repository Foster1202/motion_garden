import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.QA_URL ?? 'http://127.0.0.1:4173/';
const output = resolve(process.env.QA_OUTPUT ?? '/tmp/motion-garden-low-qa');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
const report = { url, browser: browser.version(), status: 'RUNNING',
  input: 'Actual MediaPipe Lite model and WASM, with a person-free Chromium virtual camera.',
  samples: {}, errors: [], warnings: [], diagnostics: [] };
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => {
  if (message.type() === 'warning') report.warnings.push(message.text());
  if (message.type() === 'error') {
    const log = message.text();
    if (log.includes('Created TensorFlow Lite XNNPACK delegate for CPU')) report.diagnostics.push(log);
    else report.errors.push(log);
  }
});
await page.addInitScript(() => {
  const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async constraints => {
    const stream = await getUserMedia(constraints);
    window.cameraRequest = { constraints, stream };
    return stream;
  };
});
const action = id => page.locator('[data-action="' + id + '"]');
const panel = page.locator('.performance-panel');
const settings = page.locator('.game-settings');
const option = name => settings.locator('[name="' + name + '"]');
const save = async () => {
  await settings.locator('[type=submit]').click();
  await settings.waitFor({ state: 'detached' });
};
const video = page.locator('.berry-camera-source');

async function beginCamera() {
  await action('start').click();
  await action('berry').click();
  await action('camera').click();
  await video.waitFor({ state: 'attached' });
}

async function measure(mode, expectedWidth, expectedHeight) {
  await beginCamera();
  await page.waitForFunction(() => {
    const metrics = document.querySelector('.performance-panel').textContent;
    return /Pose \d+\.\d+ FPS/.test(metrics) && /3D \d+\.\d+ FPS/.test(metrics);
  }, undefined, { timeout: 20000 });
  // Exclude model startup and the first, partially populated render window.
  await page.waitForTimeout(3000);
  const measurements = [];
  for (let sample = 0; sample < 3; sample++) {
    const summary = await panel.innerText();
    const inference = summary.match(/推論 ([\d.]+) ms · P95 ([\d.]+) ms/);
    const rates = summary.match(/Pose ([\d.]+) FPS.*\nPhaser ([\d.]+) FPS · 3D ([\d.]+) FPS/);
    assert.ok(inference && rates, summary);
    const [inferenceMs, p95InferenceMs] = inference.slice(1).map(Number);
    const [poseFps, phaserFps, threeFps] = rates.slice(1).map(Number);
    assert.ok(phaserFps > 15 && threeFps > 10, summary);
    assert.match(summary, new RegExp(mode + '模式 · 相機 ' + expectedWidth + '×' + expectedHeight));
    measurements.push({ inferenceMs, p95InferenceMs, poseFps, phaserFps, threeFps });
    await page.waitForTimeout(1100);
  }
  const details = await video.evaluate(video => {
    const { frameRate } = window.cameraRequest.stream.getVideoTracks()[0].getSettings();
    return {
      dimensions: [video.videoWidth, video.videoHeight],
      opacity: getComputedStyle(video).opacity,
      requested: window.cameraRequest.constraints.video,
      cameraFps: frameRate,
    };
  });
  assert.deepEqual(details.dimensions, [expectedWidth, expectedHeight]);
  assert.deepEqual([details.requested.width.ideal, details.requested.height.ideal], details.dimensions);
  assert.equal(details.opacity, '1');
  report.samples[mode] = { ...details, measurements };
}

async function returnHome() {
  await action('pause').click();
  await page.waitForFunction(() => document.querySelector('.performance-panel').textContent.includes('Pose — FPS'));
  await page.locator('dialog[open] [data-action=home]').click();
  await action('start').waitFor();
  assert.deepEqual(await page.evaluate(() => window.cameraRequest.stream.getTracks().map(track => track.readyState)), ['ended']);
}

try {
  await page.goto(url);
  assert.equal(new URL(page.url()).origin, new URL(url).origin);
  assert.match(await page.title(), /動態花園/);
  await action('start').waitFor();
  assert.equal(await panel.isVisible(), false);
  await action('settings').click();
  assert.equal(await option('lowPerformanceMode').isChecked(), false);
  await option('showPerformanceMetrics').check();
  await save();
  await measure('標準', 640, 360);
  await returnHome();

  await action('settings').click();
  await option('backgroundProcessing').check();
  await option('lowPerformanceMode').check();
  assert.equal(await option('backgroundProcessing').isDisabled(), true);
  await save();
  await page.reload();
  await action('settings').click();
  assert.equal(await option('lowPerformanceMode').isChecked(), true);
  assert.equal(await option('showPerformanceMetrics').isChecked(), true);
  assert.equal(await option('backgroundProcessing').isChecked(), true);
  await settings.getByRole('button', { name: '取消', exact: true }).click();

  await measure('低效能', 320, 240);
  assert.ok(report.samples['低效能'].measurements.every(sample =>
    sample.poseFps >= 7.5 && sample.poseFps <= 10.5 && sample.threeFps <= 32), JSON.stringify(report.samples['低效能']));
  assert.ok(report.samples['低效能'].cameraFps > Math.max(...report.samples['低效能'].measurements.map(sample => sample.poseFps)));
  await page.screenshot({ path: join(output, 'low-performance-desktop.png') });
  await page.setViewportSize({ width: 640, height: 360 });
  await page.screenshot({ path: join(output, 'low-performance-compact.png') });
  await returnHome();
  await action('settings').click();
  await option('lowPerformanceMode').uncheck();
  assert.equal(await option('backgroundProcessing').isEnabled(), true);
  assert.equal(await option('backgroundProcessing').isChecked(), true);
  await option('showPerformanceMetrics').uncheck();
  await save();
  assert.equal(await panel.isVisible(), false);
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  assert.deepEqual(report.errors, []);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.failure = String(error);
  throw error;
} finally {
  await writeFile(join(output, 'performance-report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
