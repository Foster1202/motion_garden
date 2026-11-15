import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.QA_URL ?? 'http://127.0.0.1:5175/';
const output = process.env.QA_OUTPUT ?? '/tmp/person-preview-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const report = { status: 'RUNNING', browser: browser.version(), url, checks: [], errors: [] };
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });

try {
  await page.goto(url);
  const result = await page.evaluate(async () => {
    const { PersonOnlyRenderer } = await import('/src/game/vision/PersonOnlyRenderer.ts');
    const source = document.createElement('canvas');
    source.width = 320; source.height = 180;
    const sourceContext = source.getContext('2d');
    sourceContext.fillStyle = '#ff0000'; sourceContext.fillRect(0, 0, 320, 180);
    sourceContext.fillStyle = '#00ff00'; sourceContext.fillRect(0, 0, 160, 180);
    const video = document.createElement('video');
    video.muted = true; video.autoplay = true; video.playsInline = true;
    video.className = 'berry-camera-source';
    video.srcObject = source.captureStream(10);
    document.body.append(video);
    await video.play();
    await new Promise(resolve => setTimeout(resolve, 150));
    const canvas = document.createElement('canvas');
    canvas.className = 'berry-camera';
    document.body.append(canvas);
    const renderer = new PersonOnlyRenderer(video, canvas);
    renderer.render({ timestampMs: performance.now(), inferenceMs: 1, poseFps: 25,
      personMask: { width: 4, height: 2,
        alpha: Uint8ClampedArray.of(255, 255, 0, 0, 255, 255, 0, 0) } });
    const context = canvas.getContext('2d');
    const kept = [...context.getImageData(40, 90, 1, 1).data];
    const removed = [...context.getImageData(280, 90, 1, 1).data];
    return { kept, removed, sourceOpacity: getComputedStyle(video).opacity,
      outputWidth: canvas.width, outputHeight: canvas.height };
  });
  assert.equal(result.sourceOpacity, '0');
  assert.ok(result.kept[1] > 200 && result.kept[3] === 255, JSON.stringify(result));
  assert.equal(result.removed[3], 0, JSON.stringify(result));
  assert.deepEqual([result.outputWidth, result.outputHeight], [320, 180]);
  assert.deepEqual(report.errors, []);
  report.checks.push('Raw video is hidden by default');
  report.checks.push('Person-mask pixels remain visible');
  report.checks.push('Background-mask pixels are transparent');
  report.status = 'PASS';
  report.result = result;
  await page.screenshot({ path: `${output}/person-only-preview.png` });
} catch (error) {
  report.status = 'FAIL'; report.failure = String(error);
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
