import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.QA_URL ?? 'http://127.0.0.1:5173/';
const output = resolve(process.env.QA_OUTPUT ?? '/tmp/motion-garden-rabbit-home');
const desktop = { width: 1512, height: 982 };
const compact = { width: 640, height: 360 };
const stepGapMs = 310;
const root = '.rabbit-home-ui';
const distanceSelector = `${root} [data-home-distance]`;
const report = {
  status: 'RUNNING', url, desktop, compact,
  humanWebcam: 'NOT RUN', checks: [], screenshots: [], errors: [], warnings: [],
};
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream'] });
report.browser = browser.version();

let page;
let lastStepAt = -Infinity;
const action = name => page.locator(`[data-action="${name}"]`);
const hud = name => page.locator(`${root} [data-home-${name}]`);
const modal = () => page.locator('dialog[open]');
const modalAction = name => modal().locator(`[data-action="${name}"]`);
const check = name => report.checks.push(name);

async function openPage(context) {
  page = await context.newPage();
  page.setDefaultTimeout(12_000);
  page.on('pageerror', error => report.errors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push(message.text());
    if (message.type() === 'warning') report.warnings.push(message.text());
  });
  await page.goto(url);
  await action('start').waitFor();
  lastStepAt = -Infinity;
}

async function capture(name) {
  const file = `${name}.png`;
  await page.screenshot({ path: resolve(output, file) });
  report.screenshots.push(file);
}

async function enterGame() {
  await action('start').click();
  for (const game of ['carrot', 'berry', 'apple', 'home-game']) {
    assert.ok(await action(game).isEnabled(), `${game} must be playable from the menu`);
  }
  await action('home-game').click();
  await modal().getByRole('heading', { name: '阿兔回家', exact: true }).waitFor();
}

async function waitForPhase(phase) {
  await page.locator(`${root}[data-home-phase="${phase}"]`).waitFor();
}

async function waitForDistance(expected) {
  try {
    await page.waitForFunction(({ selector, expected }) =>
      document.querySelector(selector)?.textContent?.trim() === String(expected),
    { selector: distanceSelector, expected });
    lastStepAt = performance.now();
  } catch (error) {
    const actual = await hud('distance').textContent();
    throw new Error(`Expected distance ${expected}, saw ${actual}`, { cause: error });
  }
}

async function assertDistance(expected) {
  assert.equal((await hud('distance').innerText()).trim(), String(expected));
}

async function step(key) {
  const wait = Math.ceil(stepGapMs - (performance.now() - lastStepAt));
  if (wait > 0) await page.waitForTimeout(wait);
  await page.keyboard.press(key);
  lastStepAt = performance.now();
}

const keyForDistance = distance => distance % 2 === 1 ? 'q' : 'e';

async function walk(from, to) {
  for (let distance = from + 1; distance <= to; distance++) {
    await step(keyForDistance(distance));
    await waitForDistance(distance);
  }
}

async function move(key, lane) {
  await page.keyboard.press(key);
  await page.locator(`${root}[data-home-lane="${lane}"]`).waitFor();
}

async function reachBridge(distance, lane, arrow, direction) {
  await step(keyForDistance(distance));
  await page.locator(`${root}[data-home-blocked="true"]`).waitFor();
  assert.match(await hud('hint').innerText(), direction);
  assert.equal(await modal().count(), 0);
  await page.waitForTimeout(500);
  await assertDistance(distance - 1);
  if (lane === -1) await capture('bridge-wait');
  if (lane === 1) await move(arrow, 0);
  await move(arrow, lane);
  await page.waitForTimeout(350);
  await assertDistance(distance - 1);
  await step(keyForDistance(distance));
  await waitForDistance(distance);
  assert.notEqual(await page.locator(root).getAttribute('data-home-blocked'), 'true');
}

async function bounds(locator) {
  const box = await locator.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, `Missing visible bounds for ${locator}`);
  return box;
}

function assertInside(box, frame) {
  const epsilon = 2;
  assert.ok(box.x >= frame.x - epsilon && box.y >= frame.y - epsilon
    && box.x + box.width <= frame.x + frame.width + epsilon
    && box.y + box.height <= frame.y + frame.height + epsilon, JSON.stringify({ box, frame }));
}

async function verifyCompactIntro() {
  const frame = await bounds(page.locator('#game-frame'));
  const media = await bounds(modal().locator('.game-intro-media'));
  const copy = await bounds(modal().locator('.game-intro-copy'));
  assert.ok(Math.abs(frame.width / frame.height - 16 / 9) < .01);
  assert.ok(media.x + media.width < copy.x);
  assertInside(media, frame);
  assertInside(copy, frame);
  for (const name of ['camera', 'keyboard', 'home']) assertInside(await bounds(modalAction(name)), frame);
}

async function keyboardRun() {
  const context = await browser.newContext({ viewport: desktop });
  await openPage(context);
  assert.equal(new URL(page.url()).origin, new URL(url).origin);
  assert.match(await page.title(), /動態花園/);
  assert.match(await action('start').innerText(), /開始遊戲/);
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  check('Page identity, rendered home and no Vite error overlay');

  await enterGame();
  await modal().locator('.home-demo').waitFor();
  assert.match(await modal().innerText(), /踏步/);
  assert.match(await modal().innerText(), /左.*右|左右/s);
  const loopCount = await modal().locator('.home-demo').evaluate(element =>
    element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations === Infinity).length);
  assert.ok(loopCount > 0, 'Intro demo should have looping motion');
  await capture('intro');
  await modalAction('keyboard').click();
  await waitForPhase('playing');
  await assertDistance(0);
  assert.equal(await hud('stage').innerText(), '森林小徑');
  assert.match(await hud('tracking').innerText(), /鍵盤/);
  check('All four tiles are enabled. Home has a looping two-action demo, and keyboard starts stage one');

  await page.keyboard.down('q');
  await waitForDistance(1);
  await page.waitForTimeout(stepGapMs);
  await assertDistance(1);
  await step('e');
  await waitForDistance(2);
  await page.waitForTimeout(stepGapMs);
  await page.keyboard.down('q');
  await page.waitForTimeout(stepGapMs);
  await assertDistance(2);
  await page.keyboard.up('q');
  await step('e');
  await page.waitForTimeout(stepGapMs);
  await assertDistance(2);
  await walk(2, 8);
  assert.equal(await hud('lanterns').innerText(), '1');
  assert.equal(await page.locator(root).getAttribute('data-home-lit'), 'true');
  assert.equal(await page.locator(root).getAttribute('data-home-foot'), 'right');
  assert.match(await hud('hint').innerText(), /點亮咗一盞燈籠/);
  await capture('lantern');
  check('Held and repeated keys add no extra steps. Alternating feet advance and light a lantern');

  await page.waitForTimeout(1700);
  await assertDistance(8);
  assert.equal(await modal().count(), 0);
  await page.keyboard.press('Escape');
  await modalAction('resume').waitFor();
  await step('q');
  await page.waitForTimeout(stepGapMs);
  await assertDistance(8);
  await modalAction('restart').click();
  await modalAction('confirm-restart').waitFor();
  await modalAction('cancel-restart').click();
  await modalAction('resume').click();
  await waitForPhase('playing');
  await assertDistance(8);
  await walk(8, 9);
  check('Rest preserves progress, Escape pauses input, and canceling restart resumes the same journey');

  await action('pause').click();
  await modalAction('restart').click();
  await modalAction('confirm-restart').click();
  await modal().getByRole('heading', { name: '阿兔回家', exact: true }).waitFor();
  await modalAction('keyboard').click();
  await waitForPhase('playing');
  await assertDistance(0);
  assert.equal(await hud('lanterns').innerText(), '0');
  assert.equal(await page.locator(root).getAttribute('data-home-lane'), '0');
  check('Pause button and confirmed restart return to input selection and reset route, progress and lanterns');

  await walk(0, 40);
  await hud('stage').filter({ hasText: '小溪與木橋' }).waitFor();
  assert.equal(await hud('lanterns').innerText(), '4');
  await walk(40, 52);
  await reachBridge(53, -1, 'ArrowLeft', /左/);
  await capture('bridge');
  await walk(53, 70);
  await reachBridge(71, 1, 'ArrowRight', /右/);
  await walk(71, 82);
  await hud('stage').filter({ hasText: '星光歸途' }).waitFor();
  await walk(82, 113);
  await capture('starlight');
  check('All four lanterns light. Both bridges hold progress in the wrong lane and allow a safe-lane retry');

  await walk(113, 120);
  await waitForPhase('arrival');
  await page.waitForTimeout(1250);
  await capture('cottage');
  await modal().getByRole('heading', { name: '返到屋企啦！', exact: true }).waitFor();
  assert.equal(await modal().locator('[data-home-result-steps]').innerText(), '120');
  assert.equal(await modal().locator('[data-home-result-lanterns]').innerText(), '4');
  assert.ok(await modalAction('home').isEnabled());
  await capture('result');
  await modalAction('restart').click();
  await modal().getByRole('heading', { name: '阿兔回家', exact: true }).waitFor();
  await modalAction('keyboard').click();
  await waitForPhase('playing');
  await assertDistance(0);
  await walk(0, 1);
  await action('home').click();
  await action('start').waitFor();
  await page.locator(root).waitFor({ state: 'detached' });
  check('All 120 native-key steps complete the three stages. The result reports 120 steps and four lanterns, and replay and Home work');
  await context.close();
}

async function cameraFallbackRun() {
  const context = await browser.newContext({ viewport: compact, reducedMotion: 'reduce' });
  await openPage(context);
  const client = await context.newCDPSession(page);
  const { targetInfo } = await client.send('Target.getTargetInfo');
  await client.send('Browser.setPermission', {
    origin: new URL(url).origin, permission: { name: 'camera' }, setting: 'denied',
    browserContextId: targetInfo.browserContextId,
  });
  const permission = await page.evaluate(async () => (await navigator.permissions.query({ name: 'camera' })).state);
  assert.equal(permission, 'denied');

  await action('settings').click();
  const settings = page.locator('.game-settings');
  await settings.locator('[name=lowPerformanceMode]').check();
  await settings.locator('[type=submit]').click();
  await settings.waitFor({ state: 'detached' });

  await enterGame();
  await verifyCompactIntro();
  assert.equal(await modal().locator('.home-demo').evaluate(element => element.getAnimations({ subtree: true }).length), 0);
  await capture('intro-640x360');
  await modalAction('camera').click();
  await modalAction('keyboard').waitFor();
  assert.match(await modal().innerText(), /未獲相機權限/);
  await capture('camera-denied');
  await modalAction('keyboard').click();
  await waitForPhase('playing');
  await walk(0, 2);
  assert.match(await hud('tracking').innerText(), /鍵盤/);
  assert.equal(await page.locator('.home-camera, .home-camera-source').count(), 0);
  const frame = await bounds(page.locator('#game-frame'));
  for (const target of [hud('stage'), hud('hint'), hud('tracking'), action('pause'), action('home')]) {
    assertInside(await bounds(target), frame);
  }
  await capture('low-mode-640x360');
  await action('home').click();
  await action('start').waitFor();
  await page.locator(root).waitFor({ state: 'detached' });
  check('At 640×360, the demo honors reduced motion. In Low Performance Mode, Chrome camera permission denial falls back to usable keyboard controls');
  await context.close();
}

try {
  await keyboardRun();
  await cameraFallbackRun();
  assert.deepEqual(report.errors, []);
  check('No browser errors across both sessions');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.failure = String(error);
  if (page) await capture('failure').catch(() => undefined);
  throw error;
} finally {
  await writeFile(resolve(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  console.log(JSON.stringify({ ...report, output }, null, 2));
}
