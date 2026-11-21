import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.QA_URL ?? 'http://127.0.0.1:5175/';
const output = process.env.QA_OUTPUT ?? '/tmp/berry-kick-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const report = {
  status: 'RUNNING', url, browser: browser.version(),
  browserRoute: 'Browser plugin not available; existing Playwright and installed Chrome',
  flow: 'Home settings → random target → wrong tree feedback → accepted target harvests → pause/recovery → countdown → results → replay/home',
  timing: 'The 60-second round uses normal Phaser updates at timeScale 1. A real Round receives a deterministic RNG before input selection; cosmetic overlap fixtures are identified separately.',
  checks: [], errors: [], warnings: [], diagnostics: [], fps: [],
};
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => {
  if (message.type() === 'warning') report.warnings.push(message.text());
  if (message.type() !== 'error') return;
  if (message.text().includes('net::ERR_FAILED')) report.diagnostics.push(message.text());
  else report.errors.push(message.text());
});
const snapshot = () => page.evaluate(async () => (await import('/src/main.ts')).game.scene.getScene('BerryKick').snapshot());
const wait = async (predicate, timeout = 15000) => {
  const attempts = Math.ceil(timeout / 80);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await snapshot();
    if (predicate(value)) return value;
    await page.waitForTimeout(80);
  }
  throw Error(`Snapshot timeout ${JSON.stringify(await snapshot())}`);
};
const check = name => report.checks.push(name);
const dialog = () => page.locator('dialog[open]');
const enter = async () => {
  await page.locator('[data-action=start]').click();
  await page.locator('[data-action=berry]').click();
  await dialog().locator('[data-action=keyboard]').waitFor();
};
const hold = async (key, duration) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(duration);
  await page.keyboard.up(key);
};
const settings = async duration => {
  await page.locator('[data-action=settings]').click();
  const panel = page.locator('.game-settings');
  await panel.locator('[name=berryDurationSeconds]').selectOption(String(duration));
  await panel.locator('[type=submit]').click();
  assert.equal(await panel.count(), 0);
};
const moveTo = async side => {
  const key = side === 'left' ? 'a' : 'd';
  await page.keyboard.down(key);
  await wait(value => side === 'left' ? value.rootX < 505 : value.rootX > 1095);
  await page.keyboard.up(key);
  await page.waitForTimeout(220);
};
const verifyTarget = async side => {
  assert.equal((await snapshot()).target, side);
  assert.equal(await page.locator('[data-berry-target]').getAttribute('data-side'), side);
  assert.match(await page.locator('[data-berry-target-label]').innerText(), side === 'left' ? /左/ : /右/);
  await page.waitForTimeout(350);
  const glows = await page.evaluate(async () => {
    const trees = (await import('/src/main.ts')).game.scene.getScene('BerryKick').trees;
    return { left: trees.left.targetGlow.alpha, right: trees.right.targetGlow.alpha };
  });
  assert.ok(glows[side] > .98, `Target ${side} glow is ${glows[side]}`);
  assert.ok(glows[side === 'left' ? 'right' : 'left'] < .02);
};
const cosmeticState = () => page.evaluate(async () => {
  const scene = (await import('/src/main.ts')).game.scene.getScene('BerryKick');
  return {
    effects: [...document.querySelectorAll('.berry-score-popup,.berry-countdown-digit')].map(element => ({
      text: element.textContent, style: element.getAttribute('style'),
      times: element.getAnimations().map(animation => animation.currentTime),
    })),
    targetAnimations: [...document.querySelector('[data-berry-target]').getAnimations()].map(animation => animation.currentTime),
    target: scene.round.target,
    glows: { left: scene.trees.left.targetGlow.alpha, right: scene.trees.right.targetGlow.alpha },
    fruit: scene.children.list.filter(child => child.texture?.key === 'berry-berry' && !child.parentContainer)
      .map(child => ({ x: child.x, y: child.y, alpha: child.alpha, scaleX: child.scaleX })),
  };
});

try {
  await page.goto(url);
  await page.locator('[data-action=start]').waitFor();
  assert.equal(new URL(page.url()).origin, new URL(url).origin);
  assert.match(await page.title(), /動態花園/);
  assert.ok((await page.locator('#game-ui').innerText()).includes('開始遊戲'));
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  check('Page identity, meaningful first screen and no framework error overlay');

  await page.locator('[data-action=settings]').click();
  assert.equal(await page.locator('[name=berryDurationSeconds]').inputValue(), '120');
  assert.deepEqual(await page.locator('[name=berryDurationSeconds] option').allTextContents(), ['60 秒', '90 秒', '120 秒']);
  await page.locator('.game-settings').getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(async () => {
    const { DEFAULT_GAME_SETTINGS, SETTINGS_STORAGE_KEY } = await import('/src/game/settings/gameSettings.ts');
    const legacy = { ...DEFAULT_GAME_SETTINGS, bendingAngle: 155 };
    delete legacy.berryDurationSeconds;
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(legacy));
  });
  await page.locator('[data-action=settings]').click();
  assert.equal(await page.locator('[name=berryDurationSeconds]').inputValue(), '120');
  assert.equal(await page.locator('[name=bendingAngle]').inputValue(), '155');
  await page.locator('.game-settings').getByRole('button', { name: '取消', exact: true }).click();
  for (const duration of [90, 120]) {
    await settings(duration);
    await page.reload();
    await enter();
    assert.equal((await snapshot()).durationMs, duration * 1000);
    assert.equal(await page.locator('[data-berry-time]').innerText(), duration === 90 ? '01:30' : '02:00');
    await dialog().locator('[data-action=home]').click();
  }
  await page.locator('[data-action=settings]').click();
  await page.locator('[name=berryDurationSeconds]').selectOption('60');
  await page.locator('.game-settings').getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('[data-action=settings]').click();
  assert.equal(await page.locator('[name=berryDurationSeconds]').inputValue(), '120');
  await page.locator('.game-settings').getByRole('button', { name: '恢復預設', exact: true }).click();
  assert.equal(await page.locator('[name=berryDurationSeconds]').inputValue(), '120');
  await page.locator('.game-settings [type=submit]').click();
  await settings(60);
  await page.reload();
  check('Duration defaults, exact 60/90/120 choices, legacy migration, persistence, cancel and reset');

  await enter();
  assert.equal((await snapshot()).durationMs, 60000);
  assert.equal(await page.locator('[data-berry-time]').innerText(), '01:00');
  assert.equal(await page.locator('[data-berry-left],[data-berry-right],.berry-progress').count(), 0);
  assert.match(await page.locator('.berry-score').innerText(), /收集\s+0/);
  assert.ok(!(await page.locator('.berry-score').innerText()).includes('/'));
  await page.evaluate(async () => {
    const { BerryKickRound } = await import('/src/game/berry/BerryKickRound.ts');
    const scene = (await import('/src/main.ts')).game.scene.getScene('BerryKick');
    const draws = [0, 0, 0, 1, 1, 1, 0];
    window.__berryTargetDraws = 0;
    window.__berryContacts = [];
    // A seeded real round makes repeated and forced targets reproducible through actual controls.
    scene.round = new BerryKickRound(scene.round.zones, 60, () => draws[window.__berryTargetDraws++] ?? .25);
    const update = scene.round.update.bind(scene.round);
    scene.round.update = (...args) => {
      const contact = update(...args);
      if (contact) window.__berryContacts.push({ ...contact, target: scene.round.target, draws: window.__berryTargetDraws });
      return contact;
    };
  });
  await dialog().locator('[data-action=keyboard]').click();
  await wait(value => value.active && value.renderMode === '3d');
  await page.evaluate(() => {
    window.__berryCountdownValues = [];
    window.__berryResultDialogs = 0;
    window.__berryMaxDigitOverlap = 0;
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const digits = node.matches('.berry-countdown-digit') ? [node] : [...node.querySelectorAll('.berry-countdown-digit')];
          for (const digit of digits) window.__berryCountdownValues.push(Number(digit.dataset.value ?? digit.textContent));
          if (node.matches('dialog.berry-results')) window.__berryResultDialogs++;
          window.__berryMaxDigitOverlap = Math.max(window.__berryMaxDigitOverlap, document.querySelectorAll('.berry-countdown-digit').length);
        }
      }
    });
    observer.observe(document.getElementById('game-ui'), { childList: true, subtree: true });
    window.__berryObserver = observer;
  });
  await verifyTarget('left');
  await page.screenshot({ path: `${output}/garden-1920.png` });
  await hold('q', 800);
  assert.equal((await snapshot()).score, 0);
  await page.waitForTimeout(450);
  await moveTo('right');
  await hold('q', 600);
  assert.equal((await snapshot()).score, 0);
  await page.waitForTimeout(400);
  check('60-second HUD, removed caps, center extension and wrong-foot rejection');

  await page.keyboard.down('e');
  await page.waitForFunction(() => window.__berryContacts.some(contact => contact.kind === 'wrong-tree'));
  await page.waitForTimeout(100);
  assert.match(await page.locator('[data-berry-hint]').innerText(), /左/);
  assert.ok(await page.locator('[data-berry-target]').evaluate(element => element.getAnimations().length) > 0);
  await page.screenshot({ path: `${output}/wrong-right-tree.png` });
  await page.waitForTimeout(1300);
  assert.equal((await snapshot()).score, 0);
  assert.equal(await page.evaluate(() => window.__berryContacts.length), 1);
  assert.equal(await page.evaluate(() => window.__berryTargetDraws), 1);
  assert.equal((await cosmeticState()).fruit.length, 0);
  assert.equal(await page.locator('.berry-score-popup').count(), 0);
  await verifyTarget('left');
  await page.keyboard.up('e');
  await page.waitForTimeout(350);
  check('Actual wrong-tree collision gives one gentle cue while held, with no berries, RNG draw or target change');

  const targetSequence = ['left', 'left', 'left', 'right', 'right', 'right', 'left', 'right'];
  for (let index = 0; index < targetSequence.length; index++) {
    const side = targetSequence[index];
    assert.equal((await snapshot()).target, side);
    await moveTo(side);
    const key = side === 'left' ? 'q' : 'e';
    await page.keyboard.down(key);
    const value = await wait(state => state.score === (index + 1) * 3);
    report.fps.push(value.fps);
    assert.ok(value.feet[side].x >= value.zones[side].x && value.feet[side].x <= value.zones[side].x + value.zones[side].width);
    await page.locator('.berry-score-popup').waitFor();
    assert.match(await page.locator('.berry-score-popup').last().innerText(), /🍓\s*\+3/);
    if (index === 0) {
      await page.waitForTimeout(100);
      await page.screenshot({ path: `${output}/berries-falling.png` });
      await page.locator('.berry-hud [data-action=pause]').click();
      const paused = await snapshot();
      const frozen = await cosmeticState();
      assert.ok(frozen.effects.length > 0);
      assert.equal(frozen.fruit.length, 3);
      await page.waitForTimeout(1400);
      assert.equal((await snapshot()).clock, paused.clock);
      assert.deepEqual(await cosmeticState(), frozen);
      await dialog().locator('[data-action=resume]').click();
      await page.waitForTimeout(80);
      assert.notDeepEqual(await cosmeticState(), frozen);
      await page.waitForTimeout(1250);
      check('Pause freezes target, halo, game clock, popup and three falling berries; resume continues');
    } else await page.waitForTimeout(1000);
    assert.equal((await snapshot()).score, (index + 1) * 3);
    await page.keyboard.up(key);
    await page.waitForTimeout(400);
    const next = index === targetSequence.length - 1 ? 'left' : targetSequence[index + 1];
    await verifyTarget(next);
    if (index === 2 || index === 5) {
      assert.equal(await page.evaluate(() => window.__berryTargetDraws), index === 2 ? 3 : 5);
      await page.screenshot({ path: `${output}/forced-target-${next}.png` });
    }
  }
  assert.deepEqual((await snapshot()).counts, { left: 4, right: 4 });
  assert.equal((await snapshot()).score, 24);
  assert.equal((await snapshot()).complete, false);
  report.contacts = await page.evaluate(() => window.__berryContacts);
  check('Eight accepted target hits preserve +3 scoring, repeats, max-three target streak, both halo directions and unlimited totals');
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${output}/garden-1512.png` });

  await page.evaluate(async () => {
    const scene = (await import('/src/main.ts')).game.scene.getScene('BerryKick');
    // Cosmetic-only fixture verifies simultaneous popup ownership without awarding points.
    scene.showScorePopup();
    scene.showScorePopup();
  });
  assert.ok(await page.locator('.berry-score-popup').count() >= 2);
  const scoreBeforeOverlap = (await snapshot()).score;
  await page.screenshot({ path: `${output}/popup-overlap.png` });
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('.berry-score-popup').count(), 0);
  assert.equal((await snapshot()).score, scoreBeforeOverlap);
  check('Cosmetic overlap fixture retains two independent +3 popups and removes each after its game-time animation');

  for (const event of ['blur', 'visibilitychange']) {
    await page.evaluate(event => {
      if (event === 'visibilitychange') Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      (event === 'blur' ? window : document).dispatchEvent(new Event(event));
    }, event);
    await dialog().locator('[data-action=resume]').waitFor();
    const paused = await snapshot();
    await page.waitForTimeout(700);
    assert.equal((await snapshot()).clock, paused.clock);
    if (event === 'visibilitychange') await page.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await dialog().locator('[data-action=resume]').click();
    await page.waitForTimeout(100);
  }
  check('Window blur and hidden-page lifecycle events pause until explicit resume and exclude background time');

  await page.setViewportSize({ width: 600, height: 800 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${output}/garden-600.png` });
  await wait(value => value.remainingMs <= 10000 && value.remainingMs > 9000, 60000);
  await page.locator('.berry-countdown-digit[data-value="10"]').waitFor();
  assert.equal(await page.locator('[data-berry-time]').innerText(), '00:10');
  assert.equal(await page.locator('[data-berry-timer]').getAttribute('data-urgent'), 'true');
  const digitLayout = await page.locator('.berry-countdown-digit').last().boundingBox();
  const stageLayout = await page.locator('#game-ui').boundingBox();
  assert.ok(digitLayout.y + digitLayout.height < stageLayout.y + stageLayout.height * .5);
  await page.screenshot({ path: `${output}/countdown-10-mobile.png` });
  await page.locator('.berry-hud [data-action=pause]').click();
  const countdownPaused = await snapshot();
  const frozenCountdown = await cosmeticState();
  await page.waitForTimeout(1200);
  assert.equal((await snapshot()).remainingMs, countdownPaused.remainingMs);
  assert.deepEqual(await cosmeticState(), frozenCountdown);
  await dialog().locator('[data-action=resume]').click();
  await page.waitForTimeout(130);
  assert.ok(await page.locator('.berry-countdown-digit[data-value="10"]').count() > 0);
  check('Top-center last-ten countdown stays above the rabbit and freezes/resumes during long pause');

  await page.setViewportSize({ width: 1512, height: 982 });
  await wait(value => value.remainingMs <= 8500 && value.remainingMs > 8000, 3000);
  await page.screenshot({ path: `${output}/countdown-9.png` });
  const finalTarget = (await snapshot()).target;
  const finalKey = finalTarget === 'left' ? 'q' : 'e';
  await page.keyboard.down(finalKey);
  await wait(value => value.completeShown, 15000);
  await page.keyboard.up(finalKey);
  const complete = await snapshot();
  assert.equal(complete.remainingMs, 0);
  assert.equal(complete.elapsedMs, 60000);
  assert.equal(await page.locator('[data-berry-time]').innerText(), '00:00');
  assert.equal(await page.locator('dialog.berry-results').count(), 1);
  assert.match(await dialog().innerText(), /挑戰完成！/);
  assert.equal(Number(await page.locator('[data-berry-result-score]').innerText()), complete.score);
  assert.match(await page.locator('[data-berry-result-duration]').innerText(), /60|01:00/);
  assert.equal(await page.locator('.berry-score-popup,.berry-countdown-digit').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__berryCountdownValues), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.equal(await page.evaluate(() => window.__berryResultDialogs), 1);
  assert.ok(await page.evaluate(() => window.__berryMaxDigitOverlap) >= 2);
  await page.waitForTimeout(1300);
  await hold('e', 400);
  assert.equal((await snapshot()).score, complete.score);
  assert.equal((await snapshot()).elapsedMs, 60000);
  assert.equal(await page.evaluate(() => window.__berryResultDialogs), 1);
  await page.screenshot({ path: `${output}/complete.png` });
  report.finalRound = complete;
  check('All ten digits appear once in sequence; normal 60-second expiry immediately stops score, clears animations and shows exactly one result');

  await dialog().locator('[data-action=restart]').click();
  await dialog().locator('[data-action=keyboard]').click();
  const restarted = await snapshot();
  assert.equal(restarted.score, 0);
  assert.ok(restarted.remainingMs > 59000);
  assert.equal(await page.locator('.berry-score-popup,.berry-countdown-digit,.berry-results').count(), 0);
  await page.locator('.berry-hud [data-action=home]').click();
  await page.locator('[data-action=start]').waitFor();
  assert.equal(await page.locator('[data-berry-effects],.berry-camera').count(), 0);
  await page.locator('[data-action=start]').click();
  assert.equal(await page.locator('[data-action=carrot]').count(), 1);
  assert.equal(await page.locator('[data-action=apple]').isEnabled(), true);
  assert.equal(await page.locator('.game-card[disabled]').count(), 1);
  check('Replay resets score/timer/effects; Home removes Berry UI and keeps other menu games');

  await page.route('**/rabbit_realtime.glb', route => route.abort());
  await page.locator('[data-action=berry]').click();
  await wait(value => value.failed);
  assert.match(await dialog().innerText(), /計分已停用/);
  await hold('q', 300);
  assert.equal((await snapshot()).score, 0);
  await dialog().locator('[data-action=home]').click();
  check('Model failure disables interaction and retains functional Home action');
  assert.deepEqual(report.errors, []);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.failure = String(error);
  report.snapshot = await snapshot().catch(() => null);
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => undefined);
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
