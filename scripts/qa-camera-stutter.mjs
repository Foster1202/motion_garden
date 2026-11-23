import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.QA_URL ?? 'http://127.0.0.1:4173/';
const output = process.env.QA_OUTPUT ?? '/tmp/motion-garden-camera-stutter';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const report = { status: 'RUNNING', browser: browser.version(), platform: process.platform, arch: process.arch,
  source: 'Actual MediaPipe Lite WASM and a person-free Chrome virtual camera. No USB or human measurement.',
  checks: [], errors: [], warnings: [] };

async function withPage(callback, { blockWorker = false, expectedModelError = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 } });
  await context.addInitScript(blockWorker => {
    const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.qaStreams = [];
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await getMedia(constraints);
      window.qaStreams.push(stream);
      return stream;
    };
    window.qaWorkerTerminations = 0;
    const terminate = Worker.prototype.terminate;
    Worker.prototype.terminate = function () { window.qaWorkerTerminations++; terminate.call(this); };
    if (blockWorker) {
      window.Worker = class extends Worker {
        constructor() { throw new DOMException('QA disabled Worker construction', 'NotSupportedError'); }
      };
    }
  }, blockWorker);
  const page = await context.newPage();
  page.on('pageerror', error => {
    if (!error.message.includes('QA injected worker crash')) report.errors.push(error.message);
  });
  page.on('console', message => {
    const value = message.text();
    if (message.type() === 'warning') report.warnings.push(value);
    if (message.type() === 'error' && !/XNNPACK|QA injected worker crash/.test(value)
      && !(expectedModelError && message.location().url.includes('pose_landmarker_lite.task'))) report.errors.push(value);
  });
  try { await callback(page); } finally { await context.close(); }
}

function action(page, name) { return page.locator('[data-action=' + name + ']'); }
const settle = page => page.waitForTimeout(2200);

async function waitForBackend(page, backend) {
  await page.locator('.performance-panel[data-pose-backend=' + backend + ']')
    .waitFor({ timeout: 25000 });
}

async function enterGame(page, search = '', showKeypoints = false) {
  await page.goto(new URL(search || './', base).href);
  await action(page, 'settings').click();
  await page.locator('[name=showPerformanceMetrics]').check();
  if (showKeypoints) await page.locator('[name=showBodyKeypoints]').check();
  await page.locator('.game-settings [type=submit]').click();
  await action(page, 'start').click();
  await action(page, 'berry').click();
  await action(page, 'camera').click();
  const video = page.locator('.berry-camera-source');
  await video.waitFor({ state: 'attached' });
  await page.waitForFunction(() => {
    const video = document.querySelector('.berry-camera-source');
    return video?.videoWidth > 0 && getComputedStyle(video).opacity === '1';
  });
}

async function measure(page, selector, milliseconds) {
  return page.locator(selector).evaluate((video, milliseconds) => new Promise(resolve => {
    const start = performance.now();
    let rAF = 0;
    let rVFC = 0;
    let previous = start;
    let maxRafGapMs = 0;
    let firstVideo;
    let lastVideo;
    let callbacks = 0;
    let maxVideoGapMs = 0;
    const longTasks = [];
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    });
    observer.observe({ entryTypes: ['longtask'] });
    const onRender = () => {
      const now = performance.now();
      maxRafGapMs = Math.max(maxRafGapMs, now - previous);
      previous = now;
      rAF = requestAnimationFrame(onRender);
    };
    const onVideo = (now, metadata) => {
      const frame = { now, presented: metadata.presentedFrames };
      if (lastVideo) maxVideoGapMs = Math.max(maxVideoGapMs, now - lastVideo.now);
      firstVideo ??= frame;
      lastVideo = frame;
      callbacks++;
      rVFC = video.requestVideoFrameCallback(onVideo);
    };
    const track = video.srcObject.getVideoTracks()[0];
    const { width, height, frameRate } = track.getSettings();
    rAF = requestAnimationFrame(onRender);
    rVFC = video.requestVideoFrameCallback(onVideo);
    setTimeout(() => {
      for (const entry of observer.takeRecords()) longTasks.push(entry.duration);
      observer.disconnect();
      cancelAnimationFrame(rAF);
      video.cancelVideoFrameCallback(rVFC);
      const elapsed = performance.now() - start;
      const presentedFps = (lastVideo?.presented - firstVideo?.presented) * 1000 / (lastVideo?.now - firstVideo?.now);
      resolve({ elapsedMs: elapsed, width, height, negotiatedFps: frameRate,
        presentedFps, videoCallbackFps: callbacks * 1000 / elapsed, maxVideoGapMs,
        maxRafGapMs, longTasks });
    }, milliseconds);
  }), milliseconds);
}

async function home(page) {
  const pause = action(page, 'pause');
  if (await page.locator('dialog[open] [data-action=home]').count() === 0) await pause.click();
  await page.locator('dialog[open] [data-action=home]').click();
  await action(page, 'start').waitFor();
  assert.equal(await page.evaluate(() => window.qaStreams.every(stream =>
    stream.getTracks().every(track => track.readyState === 'ended'))), true);
}

try {
  await withPage(async page => {
    const requests = [];
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    await page.goto(new URL('camera-diagnostics.html', base).href);
    const video = page.locator('#camera-video');
    const devices = page.locator('#camera-device');
    for (const [profile, expected] of [['low', [320, 240]], ['vga', [640, 480]]]) {
      await page.locator('#camera-profile').selectOption(profile);
      if (profile === 'low') await page.locator('#camera-start').click();
      await page.waitForFunction(([width, height]) => {
        const video = document.querySelector('#camera-video');
        return video?.videoWidth === width && video.videoHeight === height;
      }, expected);
      const sample = await measure(page, '#camera-video', 1500);
      assert.deepEqual([sample.width, sample.height], expected);
      assert.ok(sample.presentedFps > 10, JSON.stringify(sample));
      report.checks.push({ scenario: 'native diagnostics ' + profile, ...sample });
    }
    assert.ok(await page.evaluate(() => window.qaStreams[0].getVideoTracks()[0].readyState === 'ended'));
    const deviceId = await devices.locator('option').nth(1).getAttribute('value');
    assert.ok(deviceId);
    await devices.selectOption(deviceId);
    await page.waitForFunction(() => window.qaStreams.length === 3 && document.querySelector('#camera-video').videoWidth > 0);
    assert.ok(await page.evaluate(deviceId => window.qaStreams.at(-1).getVideoTracks()[0].getSettings().deviceId === deviceId, deviceId));
    await page.locator('#camera-save').click();
    await page.locator('#camera-metrics[data-video-fps]').waitFor();
    await page.screenshot({ path: join(output, 'camera-diagnostics.png') });
    await page.locator('#camera-stop').click();
    assert.equal(await video.evaluate(element => element.srcObject), null);
    assert.equal(await page.evaluate(() => window.qaStreams.every(stream =>
      stream.getTracks().every(track => track.readyState === 'ended'))), true);
    await page.reload();
    assert.equal(await devices.inputValue(), deviceId);
    assert.equal(await page.locator('#camera-profile').inputValue(), 'vga');
    report.checks.push({ scenario: 'native camera controls restart the stream on profile/device change and persist the choice' });
    assert.ok(requests.every(path => !/mediapipe|phaser|\.glb|pose-worker/i.test(path)), requests.join('\n'));
  });

  await withPage(async page => {
    await enterGame(page, '?poseBackend=main');
    await waitForBackend(page, 'main');
    await settle(page);
    report.checks.push({ scenario: 'game, main-thread baseline',
      ...await measure(page, '.berry-camera-source', 2000), panel: await page.locator('.performance-panel').innerText() });
    const measuring = measure(page, '.berry-camera-source', 2300);
    await page.waitForTimeout(250);
    await page.evaluate(() => new Promise(resolve => setTimeout(() => {
      const deadline = performance.now() + 550;
      while (performance.now() < deadline) {}
      resolve();
    }, 0)));
    const blocked = await measuring;
    assert.ok(blocked.maxRafGapMs >= 450, JSON.stringify(blocked));
    report.checks.push({ scenario: 'main-thread positive control, artificial 550 ms task', ...blocked });
    assert.equal(page.workers().length, 0);
    await home(page);
  });

  await withPage(async page => {
    const poseWorker = page.waitForEvent('worker');
    await enterGame(page);
    const worker = await poseWorker;
    await waitForBackend(page, 'worker');
    await settle(page);
    report.checks.push({ scenario: 'game, real Worker',
      ...await measure(page, '.berry-camera-source', 2000), panel: await page.locator('.performance-panel').innerText() });
    await page.screenshot({ path: join(output, 'camera-game-worker.png') });
    const measuring = measure(page, '.berry-camera-source', 2300);
    await page.waitForTimeout(250);
    await worker.evaluate(() => {
      const deadline = performance.now() + 550;
      while (performance.now() < deadline) {}
    });
    const uninterrupted = await measuring;
    assert.ok(uninterrupted.maxRafGapMs < 450 && uninterrupted.presentedFps > 10, JSON.stringify(uninterrupted));
    report.checks.push({ scenario: 'Worker isolation, artificial 550 ms task', ...uninterrupted });

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const resume = page.locator('dialog[open] [data-action=resume]');
    await resume.waitFor();
    assert.equal(await page.locator('.berry-camera-source').evaluate(video => getComputedStyle(video).opacity), '0');
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await resume.click();
    await waitForBackend(page, 'worker');
    report.checks.push({ scenario: 'Page hidden pauses the preview and resumes with new Worker results' });

    await worker.evaluate(() => {
      setTimeout(() => { throw new Error('QA injected worker crash'); }, 0);
    });
    await waitForBackend(page, 'main');
    assert.equal(await page.evaluate(() => window.qaStreams.length), 1);
    assert.ok(await page.evaluate(() => window.qaWorkerTerminations > 0));
    report.checks.push({ scenario: 'Worker execution failure continued on main without reopening USB stream' });
    await home(page);
  });

  await withPage(async page => {
    await enterGame(page);
    await waitForBackend(page, 'main');
    report.checks.push({ scenario: 'Worker unavailable at startup, main fallback' });
    await home(page);
  }, { blockWorker: true });

  await withPage(async page => {
    const poseWorker = page.waitForEvent('worker');
    await enterGame(page, '?poseDelegate=cpu', true);
    await waitForBackend(page, 'worker');
    const worker = await poseWorker;
    await worker.evaluate(() => {
      const original = self.onmessage;
      self.qaShowPose = true;
      self.onmessage = event => {
        const { data } = event;
        if (data.kind !== 'detect') { original?.call(self, event); return; }
        const { bitmap, frameId } = data;
        const { width, height } = bitmap;
        bitmap.close();
        setTimeout(() => self.postMessage({ kind: 'result', frameId, inference: {
          inferenceMs: 320, imageWidth: width, imageHeight: height,
          landmarks: self.qaShowPose ? Array.from({ length: 33 }, (_, index) => ({
            x: .32 + (index % 5) * .09, y: .18 + Math.floor(index / 5) * .09, visibility: .99,
          })) : undefined,
        } }), 320);
      };
    });
    const delayed = page.locator('.berry-camera[data-pose-preview=delayed]');
    await delayed.waitFor();
    await page.waitForFunction(() => /過期 [1-9]\d*\/[1-9]\d*/.test(document.querySelector('.performance-panel').textContent));
    assert.equal(await delayed.isVisible(), true);
    await page.waitForTimeout(700);
    assert.equal(await delayed.isVisible(), true);
    const panel = await page.locator('.performance-panel').innerText();
    assert.match(panel, /Pose — FPS/);
    assert.match(await page.locator('[data-berry-tracking]').innerText(), /Tracking Lost/);
    assert.equal(await page.locator('.berry-camera-source').evaluate(video => getComputedStyle(video).opacity), '1');
    await page.screenshot({ path: join(output, 'camera-delayed-keypoints.png') });
    await worker.evaluate(() => { self.qaShowPose = false; });
    await delayed.waitFor({ state: 'detached' });
    await home(page);
    report.checks.push({ scenario: '320 ms results remain labelled in the preview, never feed gameplay and clear on person loss', panel });
  });

  await withPage(async page => {
    await page.goto(base);
    await action(page, 'settings').click();
    await page.locator('[name=showPerformanceMetrics]').check();
    await page.locator('.game-settings [type=submit]').click();
    await action(page, 'start').click();
    await action(page, 'carrot').click();
    await page.locator('[data-input-action=camera]').click();
    await waitForBackend(page, 'worker');
    await page.locator('.preview-toggle input').uncheck();
    assert.equal(await page.locator('.pose-preview').isVisible(), false);
    await page.waitForTimeout(1500);
    assert.match(await page.locator('.performance-panel').innerText(), /Pose \d+\.\d+ FPS/);
    await home(page);
    report.checks.push({ scenario: 'Turning off Carrot camera preview does not stop pose inference' });
  });

  await withPage(async page => {
    await page.route('**/pose_landmarker_lite.task', async route => {
      await new Promise(resolve => setTimeout(resolve, 1200));
      await route.fulfill({ status: 404, body: '' });
    });
    await enterGame(page);
    const keyboard = page.locator('dialog[open] [data-action=keyboard]');
    await keyboard.waitFor({ timeout: 30000 });
    assert.equal(await page.evaluate(() => window.qaStreams.every(stream =>
      stream.getTracks().every(track => track.readyState === 'ended'))), true);
    await keyboard.click();
    assert.equal(await page.locator('.berry-camera-source').count(), 0);
    report.checks.push({ scenario: 'Model unavailable in Worker and fallback, stream stopped and keyboard starts' });
  }, { expectedModelError: true });
  assert.deepEqual(report.errors, []);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.failure = String(error);
  throw error;
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
