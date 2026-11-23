import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.QA_URL ?? 'http://127.0.0.1:5173/';
const output = resolve(process.env.QA_OUTPUT ?? '/tmp/motion-garden-apple-qa');
const suite = process.env.QA_SUITE ?? 'all';
const lowPerformanceMode = process.env.QA_LOW_PERFORMANCE === '1';
assert.ok(['all', 'keyboard', 'camera'].includes(suite), 'QA_SUITE must be all, keyboard, or camera');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const desktop = { width: 1512, height: 982 };
const smallDesktop = { width: 640, height: 360 };
const report = {
  status: 'RUNNING', url, suite, browser: browser.version(), desktop, smallDesktop, lowPerformanceMode,
  browserPlugin: 'Browser plugin not available; installed Chrome through Playwright',
  keyboard: 'Native Playwright key events. A real 90-second round at Phaser timeScale 1.',
  camera: 'Chrome virtual camera with synthetic MediaPipe Landmarker output. Real stream, scheduling, extraction, retargeting and game rules.',
  humanWebcam: 'NOT VERIFIED',
  checks: [], errors: [], warnings: [], screenshots: [],
};
let page;

async function openPage() {
  const context = await browser.newContext({ viewport: desktop });
  page = await context.newPage();
  page.on('pageerror', error => report.errors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push(message.text());
    if (message.type() === 'warning') report.warnings.push(message.text());
  });
  await page.goto(url);
  await action('start').waitFor();
  return context;
}

const action = name => page.locator(`[data-action=${name}]`);
const dialog = () => page.locator('dialog[open]');
const dialogAction = name => dialog().locator(`[data-action=${name}]`);
const hud = name => page.locator(`[data-apple-${name}]`);
const snapshot = () => page.evaluate(async () => (await import('/src/main.ts')).game.scene.getScene('AppleHarvest').snapshot());
const check = (name, detail) => report.checks.push({ name, detail });
const handKey = side => side === 'left' ? 'q' : 'e';
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

async function until(predicate, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await snapshot();
    if (predicate(last)) return last;
    await page.waitForTimeout(65);
  }
  throw new Error(`Timed out waiting for ${predicate.toString()}: ${JSON.stringify(last)}`);
}

async function capture(name) {
  const file = `${name}.png`;
  await page.screenshot({ path: resolve(output, file) });
  report.screenshots.push(file);
}

async function enter() {
  await action('start').click();
  assert.equal(await action('apple').isEnabled(), true);
  await action('apple').click();
  await dialogAction('keyboard').waitFor();
  await until(value => value.ready);
}

async function seedLeft() {
  await page.evaluate(async () => {
    const { AppleHarvestRound } = await import('/src/game/apple/AppleHarvestRound.ts');
    const scene = (await import('/src/main.ts')).game.scene.getScene('AppleHarvest');
    const duration = scene.snapshot().durationMs / 1000;
    window.__appleTargetDraws = 0;
    // Seed before input selection and drive the real round through the scene.
    scene.round = new AppleHarvestRound(duration, () => {
      window.__appleTargetDraws++;
      return .1;
    });
  });
}

async function settings(duration) {
  await action('settings').click();
  const panel = page.locator('.game-settings');
  const select = panel.locator('[name=appleDurationSeconds]');
  if (duration === undefined) {
    assert.equal(await select.inputValue(), '120');
    assert.deepEqual(await select.locator('option').allTextContents(), ['90 秒', '120 秒', '180 秒']);
    await panel.getByRole('button', { name: '取消', exact: true }).click();
  } else {
    await select.selectOption(String(duration));
    await panel.locator('[type=submit]').click();
  }
  await panel.waitFor({ state: 'detached' });
}

async function moveTo(zone) {
  const { playerX } = await snapshot();
  const toward = zone === 'basket' ? (playerX < 0 ? 'd' : 'a') : zone === 'left' ? 'a' : 'd';
  await page.keyboard.down(toward);
  try {
    await until(value => zone === 'basket' ? Math.abs(value.playerX) <= .08 :
      (zone === 'left' ? value.playerX < -.63 : value.playerX > .63));
  } finally {
    await page.keyboard.up(toward);
  }
  await page.waitForTimeout(230);
}

async function holdAndRelease(key, during) {
  await page.keyboard.down(key);
  try {
    if (during) await during();
    else await page.waitForTimeout(350);
  } finally {
    await page.keyboard.up(key);
  }
}

function heldFruit(value) {
  return value.view?.fruit?.phase === 'held';
}

function assertHeld(value) {
  const fruit = value.view.fruit;
  assert.equal(fruit.phase, 'held');
  const separation = distance(fruit, value.view.hands[fruit.hand]);
  assert.ok(separation < 36, `Held fruit is ${separation} logical px from the tracked palm`);
  return separation;
}

function assertPickContact(value, tree, hand) {
  const contact = value.view.pickContact;
  assert.equal(contact.tree, tree);
  assert.equal(contact.hand, hand);
  assert.ok(contact.distance < 72, `Tree apple is ${contact.distance} logical px from the raised palm`);
  return contact;
}

function verifyGlow(value, goal) {
  assert.equal(value.view.target, goal);
  assert.ok(value.view.glow[goal] > .2);
  for (const other of ['left', 'right', 'basket']) {
    if (other !== goal) assert.ok(value.view.glow[other] < .07);
  }
}

async function verifyViewport() {
  const controls = await Promise.all([hud('time'), hud('score'), action('pause'), action('home'), hud('target')]
    .map(element => element.boundingBox()));
  const frame = await page.locator('#game-frame').boundingBox();
  assert.ok(Math.abs(frame.width / frame.height - 16 / 9) < .01);
  for (const box of controls) {
    assert.ok(box?.width > 0 && box?.height > 0);
    assert.ok(box.x >= frame.x - 1 && box.y >= frame.y - 1 && box.x + box.width <= frame.x + frame.width + 1
      && box.y + box.height <= frame.y + frame.height + 1, JSON.stringify(box));
  }
  for (let first = 0; first < controls.length; first++) {
    const a = controls[first];
    for (const b of controls.slice(first + 1)) {
      const overlap = a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1
        && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
      assert.equal(overlap, false, `Overlapping HUD boxes: ${JSON.stringify({ a, b })}`);
    }
  }
}

async function keyboardRun() {
  const context = await openPage();
  assert.equal(new URL(page.url()).origin, new URL(url).origin);
  assert.match(await page.title(), /動態花園/);
  assert.match(await page.locator('#game-ui').innerText(), /開始遊戲/);
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  check('Page identity, home content and no Vite error overlay');

  await settings();
  for (const [duration, label] of [[120, '02:00'], [180, '03:00']]) {
    if (duration === 180) {
      await settings(180);
      await page.reload();
    }
    await enter();
    assert.equal((await snapshot()).durationMs, duration * 1000);
    assert.equal(await hud('time').innerText(), label);
    await dialogAction('keyboard').click();
    await until(value => value.elapsedMs >= 1070);
    assert.notEqual(await hud('time').innerText(), label);
    await action('home').click();
  }
  await settings(90);
  await page.reload();
  await enter();
  assert.equal((await snapshot()).durationMs, 90000);
  assert.equal(await hud('time').innerText(), '01:30');
  check('120-second default and exact 90/120/180 choices; 90/180 persist on reload and 120/180 tick in gameplay');

  await seedLeft();
  const started = Date.now();
  await dialogAction('keyboard').click();
  const initial = await until(value => value.active && value.view?.renderedFrames > 2 && value.view.glow.left > .3);
  assert.equal(initial.mode, 'keyboard');
  assert.equal(initial.target, 'left');
  assert.match(await hud('target').innerText(), /←\s*左/);
  verifyGlow(initial, 'left');
  assert.ok(initial.view.trees.left.visibleApples > 1 && initial.view.trees.right.visibleApples > 1);
  assert.ok(initial.view.trees.left.x < initial.view.basket.x && initial.view.basket.x < initial.view.trees.right.x);
  assert.ok(Math.abs(initial.view.basket.x - initial.view.root.x) < 10);
  assert.equal(initial.view.rig.armControl, 'shoulder');
  await capture('01-keyboard-orchard');
  check('Left target, 3D orchard, rabbit, trees, fruit and central basket', initial.view);

  await moveTo('right');
  await holdAndRelease('e');
  await hud('hint').filter({ hasText: '請去指定嘅蘋果樹！' }).waitFor();
  let sample = await snapshot();
  assert.equal(sample.score, 0);
  assert.equal(Boolean(sample.carrying), false);
  assert.equal(sample.target, 'left');
  assert.equal(sample.view.trees.right.visibleApples, initial.view.trees.right.visibleApples);
  assert.equal(await page.evaluate(() => window.__appleTargetDraws), 1);
  check('Wrong-tree gesture shows the correct-direction reminder and preserves fruit, score and target');

  await page.keyboard.down('q');
  try {
    await page.waitForTimeout(250);
    await moveTo('left');
  } finally {
    await page.keyboard.up('q');
  }
  await page.waitForTimeout(400);
  assert.equal(Boolean((await snapshot()).carrying), false);
  check('A pre-raised arm carried into the target zone cannot pick');

  await holdAndRelease('q', async () => {
    const raised = await until(value => value.state === 'PICKING');
    assert.equal(Boolean(raised.carrying), false);
    assert.equal(raised.score, 0);
    assert.deepEqual(raised.view.rig.forearmRotations, initial.view.rig.forearmRotations);
  });
  sample = await until(value => heldFruit(value) && value.view.glow.basket > .25 && value.view.glow.left < .07);
  const firstFruit = sample.view.fruit;
  const holdingError = assertHeld(sample);
  const contact = assertPickContact(sample, 'left', 'left');
  assert.equal(Boolean(sample.carrying), true);
  assert.equal(sample.score, 0);
  assert.match(await hud('hint').innerText(), /成功摘到蘋果！返去籃子啦！/);
  assert.ok(sample.view.trees.left.visibleApples < initial.view.trees.left.visibleApples);
  verifyGlow(sample, 'basket');
  await capture('02-keyboard-picked');
  await holdAndRelease('q');
  await page.waitForTimeout(240);
  assert.equal((await snapshot()).score, 0);
  assert.equal((await snapshot()).view.fruit.hand, firstFruit.hand);
  await moveTo('basket');
  sample = await snapshot();
  const movingError = assertHeld(sample);
  assert.ok(distance(firstFruit, sample.view.fruit) > 100);
  assert.equal(sample.score, 0);
  assert.equal(sample.state, 'RETURN_TO_BASKET');
  check('Fruit leaves the tree, follows the one-piece-arm palm, and returning to the basket preserves zero score',
    { contact, firstFruit, returnedFruit: sample.view.fruit, holdingError, movingError });

  await holdAndRelease('q', () => until(value => value.state === 'DEPOSITING'));
  const dropping = await until(value => value.view?.fruit?.phase === 'dropping');
  assert.equal(dropping.score, 0);
  assert.equal(dropping.depositing, true);
  await page.keyboard.press('Escape');
  await dialogAction('resume').waitFor();
  const paused = await snapshot();
  assert.equal(paused.paused, true);
  assert.equal(paused.view.fruit?.phase, 'dropping');
  const pausedHud = await hud('time').innerText();
  await page.waitForTimeout(700);
  const frozen = await snapshot();
  assert.equal(frozen.elapsedMs, paused.elapsedMs);
  assert.equal(frozen.score, paused.score);
  assert.deepEqual(frozen.view.fruit, paused.view.fruit);
  assert.deepEqual(frozen.view.glow, paused.view.glow);
  assert.equal(await hud('time').innerText(), pausedHud);
  await dialogAction('resume').click();
  sample = await until(value => value.score === 1 && value.view?.basket.apples === 1);
  assert.equal(sample.target, 'left');
  assert.ok(sample.audio.playedSfx.success || sample.audio.playedSfx.berry);
  assert.ok(await page.getByText(/🍎\s*\+1/).count());
  await page.waitForTimeout(200);
  await capture('03-keyboard-deposited');
  await page.waitForTimeout(1150);
  assert.equal(await page.getByText(/🍎\s*\+1/).count(), 0);
  assert.equal((await snapshot()).score, 1);
  check('Pause freezes a mid-flight apple, glow and clock; resume finishes one drop, scores once and clears the +1 popup');

  for (const score of [2, 3, 4]) {
    const target = (await snapshot()).target;
    assert.equal(target, score === 4 ? 'right' : 'left');
    if (target === 'right') {
      assert.match(await hud('target').innerText(), /右\s*→/);
      const rightGoal = await until(value => value.view.glow.right > .25 && value.view.glow.basket < .07);
      verifyGlow(rightGoal, 'right');
    }
    await moveTo(target);
    await holdAndRelease(handKey(target));
    const picked = await until(heldFruit);
    assertHeld(picked);
    assertPickContact(picked, target, target);
    assert.equal(picked.score, score - 1);
    await moveTo('basket');
    await holdAndRelease(handKey(target));
    sample = await until(value => value.score === score && value.view?.basket.apples === score);
    assert.equal(sample.target, score === 3 ? 'right' : 'left');
  }
  assert.equal((await snapshot()).score, 4);
  check('Continuous picks replenish indefinitely, a constant-left RNG repeats twice then forces right, and both trees score through the same loop');

  await page.getByText(/🍎\s*\+1/).waitFor({ state: 'detached' });
  await page.setViewportSize(smallDesktop);
  await verifyViewport();
  await capture('04-small-desktop-orchard');
  await page.setViewportSize(desktop);
  check('A 640×360 desktop keeps the HUD inside the fitted 16:9 frame with no control collisions');

  await moveTo('left');
  await holdAndRelease('q');
  await until(heldFruit);
  const observed = new Set();
  for (let digit = 10; digit >= 1; digit--) {
    const value = await until(value => value.countdown === digit, digit === 10 ? 110000 : 3500);
    observed.add(digit);
    assert.equal(value.score, 4);
    assert.equal(Boolean(value.carrying), true);
    assert.equal(await page.locator(`[data-apple-countdown="${digit}"]`).innerText(), String(digit));
    if (digit === 10) {
      await page.waitForTimeout(230);
      await capture('05-countdown');
      await page.keyboard.press('Escape');
      await dialogAction('resume').waitFor();
      const digitEffect = page.locator('[data-apple-countdown="10"]');
      const animationTime = () => digitEffect.evaluate(element => element.getAnimations()[0].currentTime);
      const effectAtPause = await animationTime();
      const clockAtPause = (await snapshot()).elapsedMs;
      await page.waitForTimeout(450);
      assert.equal(await animationTime(), effectAtPause);
      assert.equal((await snapshot()).elapsedMs, clockAtPause);
      await dialogAction('resume').click();
    }
  }
  sample = await until(value => value.complete);
  assert.equal(sample.elapsedMs, 90000);
  assert.equal(sample.remainingMs, 0);
  assert.equal(sample.score, 4);
  assert.equal(await hud('time').innerText(), '00:00');
  assert.match(await hud('result-score').innerText(), /\b4\b/);
  assert.match(await hud('result-duration').innerText(), /90\s*秒/);
  assert.match(await dialog().innerText(), /再玩一次[\s\S]*返回主頁/);
  await holdAndRelease('q');
  assert.equal((await snapshot()).score, 4);
  await capture('06-results');
  report.wallElapsedMs = Date.now() - started;
  check('All ten countdown digits appeared in order; real 90-second deadline stops play and excludes the held apple', [...observed]);

  await dialogAction('restart').click();
  await dialogAction('keyboard').waitFor();
  sample = await until(value => value.ready && value.elapsedMs === 0);
  assert.equal(sample.score, 0);
  assert.equal(sample.durationMs, 90000);
  await dialogAction('home').click();
  await action('start').waitFor();
  assert.equal(await hud('time').count(), 0);
  check('Replay resets the challenge and Home clears the Apple HUD');
  await context.close();
}

async function installCameraFixture() {
  await page.evaluate(async lowPerformanceMode => {
    const { PoseEstimator } = await import('/src/game/vision/PoseEstimator.ts');
    if (lowPerformanceMode) {
      const { DEFAULT_GAME_SETTINGS, saveGameSettings } = await import('/src/game/settings/gameSettings.ts');
      saveGameSettings({ ...DEFAULT_GAME_SETTINGS, lowPerformanceMode, backgroundProcessing: true, showPerformanceMetrics: true });
    }
    window.__appleCameraFixture = { shift: 0, left: false, right: false, hideLeft: true, hideRight: true };
    window.__appleCameraStats = { requested: 0, models: 0, closed: 0, inferences: 0, streams: [] };
    const stats = window.__appleCameraStats;
    const fixture = window.__appleCameraFixture;
    const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => {
      const stream = await getMedia(options);
      stats.streams.push(stream);
      return stream;
    };
    const initialize = PoseEstimator.prototype.initialize;
    PoseEstimator.prototype.initialize = function () {
      // Keep real camera and scheduler ownership; replace only the Landmarker.
      this.options.createLandmarker = async () => {
        stats.requested++;
        if (fixture.loadDelay) await new Promise(resolve => setTimeout(resolve, fixture.loadDelay));
        stats.models++;
        return {
          close() { stats.closed++; },
          detectForVideo() {
            stats.inferences++;
            if (fixture.lost) return { landmarks: [] };
            const point = (x, y, visibility = .99) => ({ x: x + fixture.shift, y, z: 0, visibility, presence: visibility });
            const points = Array.from({ length: 33 }, (_, index) => point(.5, index < 11 ? -.15 : .5, .1));
            for (let index = 25; index <= 32; index++) points[index] = point(.5, 1.15);
            points[11] = point(.58, .28, fixture.hideShoulder ? .1 : .99); points[12] = point(.42, .28);
            points[23] = point(.545, .52); points[24] = point(.455, .52);
            points[15] = point(fixture.left ? .70 : .6, fixture.left ? .24 : .51, fixture.hideLeft ? .1 : .99);
            points[16] = point(fixture.right ? .30 : .4, fixture.right ? .24 : .51, fixture.hideRight ? .1 : .99);
            return { landmarks: [points] };
          },
        };
      };
      return initialize.call(this);
    };
  }, lowPerformanceMode);
}

const fixture = patch => page.evaluate(patch => Object.assign(window.__appleCameraFixture, patch), patch);
const cameraResources = () => page.evaluate(() => {
  const { requested, models, closed, inferences, streams } = window.__appleCameraStats;
  return { requested, models, closed, inferences, tracks: streams.map(stream =>
    stream.getTracks().map(track => track.readyState)), videoCount: document.querySelectorAll('.apple-camera-source').length };
});
const cameraMove = async (shift, condition) => {
  await fixture({ shift });
  await until(value => condition(value.playerX));
  await page.waitForTimeout(230);
  return snapshot();
};

async function cameraRun() {
  const context = await openPage();
  await installCameraFixture();
  await enter();
  await seedLeft();
  await dialogAction('camera').click();
  await until(value => value.input.status === 'acquiring-reference');
  await page.waitForTimeout(600);
  assert.equal((await snapshot()).input.hasReference, false);
  assert.equal((await snapshot()).elapsedMs, 0);
  await fixture({ hideLeft: false });
  const neutral = await until(value => value.active && value.input.hasReference && value.input.reliable
    && value.elapsedMs > 250 && Math.abs(value.playerX) < .05);
  assert.equal(neutral.mode, 'camera');
  assert.equal(neutral.input.trackingMode, 'partial');
  assert.equal(neutral.input.leftReliable, true);
  assert.equal(neutral.input.rightReliable, false);
  assert.equal(await hud('tracking').innerText(), 'Partial Tracking');
  if (lowPerformanceMode) {
    assert.deepEqual(await page.locator('.apple-camera-source').evaluate(video => ({
      dimensions: [video.videoWidth, video.videoHeight], opacity: getComputedStyle(video).opacity,
    })), { dimensions: [320, 240], opacity: '1' });
    assert.deepEqual(neutral.view.renderSize, { width: 560, height: 315 });
    assert.ok(neutral.input.poseFps >= 6.5 && neutral.input.poseFps <= 10.5, neutral.input.poseFps);
    const panel = page.locator('.performance-panel');
    await panel.filter({ hasText: /320×240/ }).waitFor();
    await page.waitForTimeout(1100);
    const performanceText = await panel.innerText();
    const threeFps = Number(performanceText.match(/3D (\d+\.\d) FPS/)?.[1]);
    assert.ok(threeFps > 0 && threeFps <= 33, performanceText);
    report.performance = { threeFps, poseFps: neutral.input.poseFps, renderSize: neutral.view.renderSize, panel: performanceText };
    check('Low mode shows the native 320×240 camera and reduced 3D rendering while retaining the single-wrist reference');
  }
  await fixture({ hideRight: false });
  await until(value => value.input.trackingMode === 'full');
  check('Out-of-frame head and legs do not block the Apple camera. A consistent visible lowered wrist starts the game');
  const left = await cameraMove(.18, x => x < -.63);
  const right = await cameraMove(-.18, x => x > .63);
  assert.ok(left.view.root.x < neutral.view.root.x && right.view.root.x > neutral.view.root.x);
  await fixture({ right: true });
  const raisedRight = await until(value => value.state === 'PICKING');
  assert.ok(distance(raisedRight.view.hands.right, right.view.hands.right) > 10);
  assert.ok(distance(raisedRight.view.hands.left, right.view.hands.left) < 10);
  await fixture({ right: false });
  await hud('hint').filter({ hasText: '請去指定嘅蘋果樹！' }).waitFor();
  assert.equal(Boolean((await snapshot()).carrying), false);
  check('Synthetic webcam verifies mirrored movement and a right-wrist wrong-tree attempt with hidden elbows');

  const relaxedLeft = await cameraMove(.18, x => x < -.63);
  await fixture({ left: true, hideRight: true });
  const raised = await until(value => value.state === 'PICKING');
  assert.equal(raised.input.trackingMode, 'partial');
  assert.deepEqual(raised.view.rig.forearmRotations, neutral.view.rig.forearmRotations);
  assert.ok(distance(raised.view.hands.left, relaxedLeft.view.hands.left) > 10);
  assert.ok(distance(raised.view.hands.right, relaxedLeft.view.hands.right) < 10);
  await fixture({ left: false });
  let sample = await until(heldFruit);
  assertHeld(sample);
  assertPickContact(sample, 'left', 'left');
  assert.equal(sample.view.fruit.hand, 'left');
  assert.equal(sample.score, 0);
  await capture('07-simulated-camera-picked');

  await cameraMove(0, x => Math.abs(x) < .095);
  await fixture({ hideRight: false });
  await until(value => value.input.trackingMode === 'full' && value.gestures.right === 'READY');
  await fixture({ right: true });
  await until(value => value.state === 'DEPOSITING');
  await fixture({ hideShoulder: true, right: false });
  await until(value => value.input.trackingMode === 'lost');
  await hud('hint').filter({ hasText: /肩膊同腰部/ }).waitFor();
  await page.waitForTimeout(550);
  assert.equal((await snapshot()).score, 0);
  await fixture({ hideShoulder: false, right: true });
  await page.waitForTimeout(420);
  await fixture({ right: false });
  await page.waitForTimeout(650);
  sample = await snapshot();
  assert.equal(sample.score, 0);
  assert.equal(Boolean(sample.carrying), true);
  assertHeld(sample);
  check('Low-confidence shoulder tracking cancels the pending basket gesture; returning raised and then lowering cannot score');

  await fixture({ right: true });
  await until(value => value.state === 'DEPOSITING');
  await action('pause').click();
  await dialogAction('resume').waitFor();
  const paused = await snapshot();
  const stopped = await cameraResources();
  await fixture({ right: false });
  await page.waitForTimeout(550);
  assert.equal((await snapshot()).elapsedMs, paused.elapsedMs);
  assert.equal((await cameraResources()).inferences, stopped.inferences);
  assert.deepEqual(stopped.tracks, [['live']]);
  await dialogAction('resume').click();
  await page.waitForTimeout(650);
  sample = await snapshot();
  assert.equal(sample.score, 0);
  assert.equal(Boolean(sample.carrying), true);
  check('Pausing a raised wrist freezes inference and the game, keeps the stream live, and discards the interrupted gesture');

  await fixture({ right: true });
  await until(value => value.state === 'DEPOSITING');
  await fixture({ right: false });
  sample = await until(value => value.score === 1 && value.view?.basket.apples === 1);
  assert.equal(Boolean(sample.carrying), false);
  await capture('08-simulated-camera-deposited');

  await action('home').click();
  await action('start').waitFor();
  const afterHome = await cameraResources();
  assert.equal(afterHome.models, 1);
  assert.equal(afterHome.closed, 1);
  assert.deepEqual(afterHome.tracks, [['ended']]);
  assert.equal(afterHome.videoCount, 0);
  await page.waitForTimeout(350);
  assert.equal((await cameraResources()).inferences, afterHome.inferences);
  check('A fresh wrist cycle deposits exactly once; Home closes the stream, Landmarker, inference and video', afterHome);

  await fixture({ loadDelay: 1200 });
  await enter();
  await dialogAction('camera').click();
  await page.waitForFunction(() => window.__appleCameraStats.requested === 2);
  await action('home').click();
  await action('start').waitFor();
  await page.waitForFunction(() => window.__appleCameraStats.closed === 2);
  const cancelled = await cameraResources();
  assert.deepEqual(cancelled.tracks, [['ended'], ['ended']]);
  assert.equal(cancelled.videoCount, 0);
  check('Leaving while Landmarker initialization is pending still releases the late model and second stream', cancelled);

  await fixture({ loadDelay: 0, shift: 0 });
  await enter();
  await dialogAction('camera').click();
  await until(value => value.active && value.input.hasReference);
  await action('pause').click();
  const clockAtSwitch = (await snapshot()).elapsedMs;
  await dialogAction('keyboard').click();
  await until(value => value.active && value.mode === 'keyboard' && value.elapsedMs > clockAtSwitch);
  const switched = await cameraResources();
  assert.equal(switched.models, 3);
  assert.equal(switched.closed, 3);
  assert.deepEqual(switched.tracks, [['ended'], ['ended'], ['ended']]);
  assert.equal(switched.videoCount, 0);
  await moveTo('left');
  check('Closing the camera from Pause releases its resources and resumes keyboard movement on the same clock', switched);

  await action('home').click();
  await enter();
  await dialogAction('camera').click();
  await until(value => value.active && value.input.hasReference);
  await page.evaluate(() => window.__appleCameraStats.streams.at(-1).getVideoTracks()[0].dispatchEvent(new Event('ended')));
  await dialogAction('keyboard').waitFor();
  assert.match(await dialog().innerText(), /鏡頭未能使用/);
  assert.equal((await cameraResources()).videoCount, 0);
  assert.deepEqual((await cameraResources()).tracks.at(-1), ['ended']);
  await dialogAction('keyboard').click();
  await until(value => value.active && value.mode === 'keyboard');
  check('A camera track ending pauses hand input, releases the stream and offers keyboard recovery');
  await context.close();
}

try {
  if (suite !== 'camera') await keyboardRun();
  if (suite !== 'keyboard') await cameraRun();
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  report.status = 'PASS';
  check('Browser console and page have no app errors');
} catch (error) {
  report.status = 'FAIL';
  report.failure = String(error);
  await page?.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await writeFile(resolve(output, 'browser-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, errors: report.errors,
    warnings: report.warnings, failure: report.failure, report: resolve(output, 'browser-report.json') }, null, 2));
}
