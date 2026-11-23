import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.QA_URL ?? 'http://127.0.0.1:5173/';
const output = resolve(process.env.QA_OUTPUT ?? '/tmp/motion-garden-desktop-layout');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const report = { status: 'RUNNING', browser: browser.version(), cases: [], errors: [] };
page.on('pageerror', error => report.errors.push(String(error)));

const action = name => page.locator(`[data-action=${name}]`);
const bounds = async locator => {
  const box = await locator.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, `Missing visible bounds for ${locator}`);
  return box;
};

function inside(box, frame) {
  const epsilon = 2;
  assert.ok(box.x >= frame.x - epsilon && box.y >= frame.y - epsilon
    && box.x + box.width <= frame.x + frame.width + epsilon
    && box.y + box.height <= frame.y + frame.height + epsilon, JSON.stringify({ box, frame }));
}

try {
  for (const size of [{ width: 1512, height: 982 }, { width: 950, height: 500 }, { width: 640, height: 360 }]) {
    await page.setViewportSize(size);
    await page.goto(url);
    await action('start').waitFor();
    assert.equal(await page.locator('.orientation-note').count(), 0);
    const frame = await bounds(page.locator('#game-frame'));
    assert.ok(Math.abs(frame.width / frame.height - 16 / 9) < .005, JSON.stringify(frame));
    inside(frame, { x: 0, y: 0, ...size });
    inside(await bounds(action('start')), frame);
    for (const game of ['carrot', 'berry', 'apple']) {
      await action('start').click();
      await action(game).click();
      const layout = page.locator('.game-intro-layout:visible');
      const media = await bounds(layout.locator('.game-intro-media'));
      const copy = await bounds(layout.locator('.game-intro-copy'));
      assert.ok(Math.abs(media.width / media.height - 9 / 16) < .02, JSON.stringify(media));
      assert.ok(media.x + media.width < copy.x, `Demo and instructions must stay side by side for ${game}`);
      inside(media, frame);
      inside(copy, frame);
      inside(await bounds(layout.locator('.game-intro-actions')), frame);
      for (const control of await layout.locator('.game-intro-copy h2, .game-intro-copy p, .game-intro-copy li, .game-intro-actions button').all()) {
        const hit = await control.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        });
        assert.ok(hit, `Intro text or controls are covered for ${game}`);
      }
      report.cases.push({ game, size, frame, media, copy });
      await page.screenshot({ path: resolve(output, `${game}-${size.width}x${size.height}.png`) });
      const home = game === 'carrot' ? '[data-input-action=home]' : '[data-action=home]';
      await layout.locator(home).click();
      await action('start').waitFor();
    }
  }
  assert.deepEqual(report.errors, []);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.failure = String(error);
  await page.screenshot({ path: resolve(output, 'failure.png') });
  throw error;
} finally {
  await writeFile(resolve(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, errors: report.errors, output }, null, 2));
  await browser.close();
}
