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
  checks: [], errors: [] };
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
const enter = async () => {
  await page.locator('[data-action=start]').click();
  await page.locator('[data-action=berry]').click();
  await page.locator('[data-action=camera]').waitFor();
};
try {
  await page.goto(url);
  await page.evaluate(async () => {
    const { PoseEstimator } = await import('/src/game/vision/PoseEstimator.ts');
    window.__berryFixture = { left: 0, right: 0, shift: 0, lost: false, delay: 900 };
    window.__berryStats = { models: 0, closed: 0, requested: 0, inferences: 0, streams: [] };
    const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => {
      const stream = await getMedia(options); window.__berryStats.streams.push(stream); return stream;
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
          detectForVideo() {
            window.__berryStats.inferences++;
            const f = window.__berryFixture;
            if (f.lost) return { landmarks: [] };
            const points = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: .99, presence: .99 }));
            const set = (id, x, y) => { points[id] = { x: x + f.shift, y, z: 0, visibility: .99, presence: .99 }; };
            set(11, .57, .28); set(12, .43, .28);
            set(23, .54, .5); set(24, .46, .5);
            set(25, .54 + f.left * .5, .7); set(26, .46 - f.right * .5, .7);
            set(27, .54 + f.left, .9); set(28, .46 - f.right, .9);
            return { landmarks: [points] };
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
  await page.locator('[data-action=resume]').click();
  await wait(s => s.armed.left && s.armed.right);
  assert.equal(await page.locator('.calibration-panel,[data-calibration-state]').count(), 0);
  check('Camera starts without calibration; pause during delayed initialization retains camera and resumes');

  await fixture({ shift: .13 }); await wait(s => s.rootX < 540);
  assert.equal((await snapshot()).score, 0);
  await fixture({ left: .07 }); const left = await wait(s => s.score === 1);
  assert.ok(left.feet.left.x >= left.zones.left.x && left.feet.left.x <= left.zones.left.x + left.zones.left.width);
  await page.waitForTimeout(1300); assert.equal((await snapshot()).score, 1);
  await page.screenshot({ path: `${output}/camera-left-contact.png` });
  check('Synthetic left extension drives actual left bone and projected contact; held extension cannot repeat');
  await fixture({ left: 0 }); await page.waitForTimeout(650);
  await fixture({ shift: -.13 }); await wait(s => s.rootX > 1060);
  await fixture({ right: .07 }); const right = await wait(s => s.score === 2);
  assert.equal(right.counts.left, 1); assert.equal(right.counts.right, 1);
  assert.ok(right.feet.right.x >= right.zones.right.x && right.feet.right.x <= right.zones.right.x + right.zones.right.width);
  check('Synthetic right extension uses same independent right-foot geometric scoring');

  await fixture({ lost: true }); await page.waitForTimeout(700);
  assert.equal((await snapshot()).score, 2); assert.equal((await snapshot()).armed.right, false);
  assert.match(await page.locator('[data-berry-hint]').innerText(), /睇唔清楚/);
  await fixture({ lost: false, shift: 0, left: 0, right: 0 }); await wait(s => s.armed.left && s.armed.right);
  await fixture({ shift: .13 }); await wait(s => s.rootX < 540);
  await page.locator('[data-action=pause]').click();
  const paused = await snapshot(); const inferenceCount = await page.evaluate(() => window.__berryStats.inferences);
  await fixture({ left: .07 }); await page.waitForTimeout(600);
  assert.equal((await snapshot()).clock, paused.clock); assert.equal((await snapshot()).score, 2);
  assert.equal(await page.evaluate(() => window.__berryStats.inferences), inferenceCount);
  await fixture({ left: 0 }); await page.locator('[data-action=resume]').click();
  await wait(s => s.armed.left); assert.equal((await snapshot()).score, 2);
  check('Tracking loss suppresses scoring; recovery acquires reference; pause freezes inference, rules and time');
  report.performance = { threeFps: (await snapshot()).fps, kind: 'Synthetic landmarks, actual GLB renderer' };
  await page.locator('[data-action=home]').click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.berry-camera').count(), 0);
  assert.equal(await page.evaluate(() => window.__berryStats.streams.every(s => s.getTracks().every(t => t.readyState === 'ended'))), true);
  assert.equal(await page.evaluate(() => window.__berryStats.closed), 1);
  check('Returning home closes webcam, model and preview');

  await fixture({ delay: 1500, shift: 0 }); await enter(); await page.locator('[data-action=camera]').click();
  await page.waitForFunction(() => window.__berryStats.requested === 2);
  await page.locator('[data-action=home]').click(); await page.waitForTimeout(1900);
  assert.equal(await page.evaluate(() => window.__berryStats.models), 2);
  assert.equal(await page.evaluate(() => window.__berryStats.closed), 2);
  assert.equal(await page.locator('.berry-camera').count(), 0);
  check('Leaving during pending initialization closes late model and tracks without stale UI');

  await fixture({ delay: 0 }); await enter(); await page.locator('[data-action=camera]').click();
  await wait(s => s.armed.left);
  await page.evaluate(() => window.__berryStats.streams.at(-1).getVideoTracks()[0].dispatchEvent(new Event('ended')));
  await page.locator('dialog [data-action=keyboard]').waitFor();
  assert.match(await page.locator('dialog').innerText(), /相機暫停/);
  await page.locator('dialog [data-action=keyboard]').click();
  await page.keyboard.down('a'); await page.waitForTimeout(1800); await page.keyboard.up('a');
  await page.keyboard.down('q'); await wait(s => s.score === 1); await page.keyboard.up('q');
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
