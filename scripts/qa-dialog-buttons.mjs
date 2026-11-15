import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.QA_URL ?? 'http://127.0.0.1:5179/';
const output = process.env.QA_OUTPUT ?? '/tmp/motion-garden-dialog-buttons';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = { status: 'RUNNING', url, browser: browser.version(),
  input: 'Real scene buttons and Overlay DOM. Completion dialogs use bounded completed-round fixtures. Gameplay scoring is covered separately.',
  checks: [], errors: [], diagnostics: [] };
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => {
  if (message.type() !== 'error') return;
  if (message.text().includes('net::ERR_FAILED')) report.diagnostics.push(message.text());
  else report.errors.push(message.text());
});
const check = name => report.checks.push(name);
const dialog = () => page.locator('dialog[open]');
const home = async () => { await page.locator('[data-action=start]').waitFor(); assert.equal(await dialog().count(), 0); };
const enter = async game => {
  await page.locator('[data-action=start]').click();
  await page.locator(`[data-action=${game}]`).click();
};
const berry = async () => { await enter('berry'); await dialog().locator('[data-action=keyboard]').waitFor(); };
const berryPlay = async () => { await berry(); await dialog().locator('[data-action=keyboard]').click(); };
const carrotPlay = async () => { await enter('carrot'); await page.locator('[data-input-action=keyboard]').click(); };
const complete = async game => {
  await page.evaluate(async game => {
    const scene = (await import('/src/main.ts')).game.scene.getScene(game === 'berry' ? 'BerryKick' : 'CarrotPull');
    if (game === 'berry') {
      scene.round.counts.left = scene.round.counts.right = 3;
      scene.round.state = 'COMPLETE';
      scene.finishElapsed = 2;
    } else {
      for (let index = 0; index < 5; index++) {
        scene.model.state = 'SUCCESS';
        scene.model.completeCelebration();
      }
      scene.complete();
    }
  }, game);
  await dialog().locator('[data-action=home]').waitFor();
};

try {
  await page.goto(url);
  await home();
  assert.match(await page.title(), /動態花園/);
  assert.ok((await page.locator('body').innerText()).includes('開始遊戲'));
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  check('Page identity, meaningful home and framework overlay check');

  await berry();
  await page.screenshot({ path: `${output}/berry-intro.png` });
  await dialog().locator('[data-action=home]').click();
  await home();
  check('Berry intro Home returns to menu with duplicate HUD action present');

  await berryPlay();
  for (let index = 0; index < 3; index++) {
    await page.locator('.berry-hud [data-action=pause]').click();
    assert.match(await dialog().innerText(), /休息一陣/);
    await dialog().locator('[data-action=resume]').click();
    assert.equal(await dialog().count(), 0);
  }
  await page.keyboard.press('Escape');
  await dialog().waitFor();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  assert.equal(await dialog().count(), 0);
  await page.locator('.berry-hud [data-action=pause]').click();
  await page.screenshot({ path: `${output}/berry-pause.png` });
  await dialog().locator('[data-action=restart]').click();
  await dialog().locator('[data-action=keyboard]').waitFor();
  await dialog().locator('[data-action=keyboard]').click();
  await page.locator('.berry-hud [data-action=pause]').click();
  await dialog().locator('[data-action=home]').click();
  await home();
  check('Berry repeated pause, Resume, Escape toggle, Restart and pause Home');

  await berryPlay();
  await page.locator('.berry-hud [data-action=home]').click();
  await home();
  check('Berry HUD Home works after repeated modal lifecycles');

  const modelRoute = '**/assets/rabbit3d/rabbit_realtime.glb';
  await page.route(modelRoute, route => route.abort());
  await enter('berry');
  await dialog().locator('h2').filter({ hasText: '未能載入' }).waitFor();
  await dialog().locator('[data-action=home]').click();
  await home();
  await page.unroute(modelRoute);
  check('Berry model-load failure Home returns to menu');

  await berryPlay();
  await complete('berry');
  assert.match(await dialog().innerText(), /大豐收/);
  await page.screenshot({ path: `${output}/berry-complete.png` });
  await dialog().locator('[data-action=restart]').click();
  await dialog().locator('[data-action=keyboard]').click();
  await complete('berry');
  await dialog().locator('[data-action=home]').click();
  await home();
  check('Berry completion Restart and Home use actual completion dialogs with completed-round fixtures');

  await carrotPlay();
  await page.locator('[data-action=pause]').click();
  await dialog().locator('[data-action=resume]').click();
  assert.equal(await dialog().count(), 0);
  await page.locator('[data-action=pause]').click();
  await dialog().locator('[data-action=restart]').click();
  await page.locator('[data-input-action=keyboard]').click();
  await page.locator('[data-action=pause]').click();
  await dialog().locator('[data-action=home]').click();
  await home();
  check('Carrot pause Resume, Restart and Home');

  await carrotPlay();
  await complete('carrot');
  await dialog().locator('[data-action=again]').click();
  await page.locator('[data-input-action=keyboard]').click();
  await complete('carrot');
  await dialog().locator('[data-action=home]').click();
  await home();
  check('Carrot completion Again and Home use actual completion dialogs with completed-round fixtures');

  await page.evaluate(async () => {
    const { Overlay } = await import('/src/game/ui/Overlay.ts');
    const overlay = new Overlay();
    window.__buttonOverlay = overlay;
    window.__buttonCounts = { obsolete: 0, root: 0, modal: 0, replacement: 0 };
    overlay.render('<button data-action="home">Root Home</button>');
    overlay.on('home', () => window.__buttonCounts.obsolete++);
    overlay.on('home', () => window.__buttonCounts.root++);
    window.__rootHome = overlay.root.querySelector('button');
    window.__rootHome.focus();
    overlay.dialog('<h2 id="dialog-title">Scoped test</h2><button data-action="home">Modal Home</button><button data-action="home">Second Modal Home</button>');
    overlay.on('home', () => window.__buttonCounts.modal++);
    overlay.focus('home');
    if (document.activeElement !== overlay.root.querySelector('dialog button')) throw Error('Focus escaped modal scope');
  });
  await page.keyboard.press('Enter');
  await dialog().locator('button').nth(1).click();
  assert.deepEqual(await page.evaluate(() => window.__buttonCounts), { obsolete: 0, root: 0, modal: 2, replacement: 0 });
  await page.evaluate(() => {
    const overlay = window.__buttonOverlay;
    overlay.on('home', () => window.__buttonCounts.obsolete++);
    overlay.on('home', () => window.__buttonCounts.replacement++);
  });
  await dialog().locator('button').first().click();
  await page.evaluate(() => window.__rootHome.click());
  assert.deepEqual(await page.evaluate(() => window.__buttonCounts), { obsolete: 0, root: 1, modal: 2, replacement: 1 });
  await page.evaluate(() => {
    const overlay = window.__buttonOverlay;
    window.__oldDialog = document.querySelector('dialog');
    overlay.dialog('<h2 id="dialog-title">Replacement</h2><button data-action="done">Done</button>');
    overlay.on('done', () => overlay.closeModal());
  });
  assert.equal(await dialog().count(), 1);
  assert.equal(await page.evaluate(() => window.__oldDialog.isConnected), false);
  await dialog().locator('[data-action=done]').click();
  assert.equal(await page.evaluate(() => document.activeElement === window.__rootHome), true);
  await page.evaluate(() => window.__buttonOverlay.destroy());
  assert.equal(await page.locator('#game-ui').innerHTML(), '');
  check('Overlay duplicate actions, all scoped matches, one replacement handler, keyboard activation, focus, modal replacement and cleanup');
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
