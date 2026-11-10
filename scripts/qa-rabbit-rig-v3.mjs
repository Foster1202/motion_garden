import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.QA_URL ?? 'http://127.0.0.1:5177/';
const output = process.env.QA_OUTPUT ?? '/private/tmp/motion-garden-rig-v3-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
const report = { status: 'RUNNING', browser: browser.version(), url: base,
  browserPlugin: 'Browser plugin not available, using installed Chrome through Playwright',
  input: 'Manual and scripted FK through the running Three.js preview. Human webcam not tested.',
  checks: [], poses: [], errors: [] };
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
const snapshot = () => page.evaluate(async () =>
  (await import('/src/main.ts')).game.scene.getScene('CarrotPull').getDebugSnapshot());
const enter = async version => {
  await page.goto(`${base}?rabbit3dDebug=1&mocapDebug=1&rabbitRig=${version}&rabbitIK=0`);
  await page.locator('[data-action=start]').click();
  await page.locator('[data-action=carrot]').click();
  await page.locator('[data-input-action=keyboard]').click();
  await page.waitForFunction(async () =>
    (await import('/src/main.ts')).game.scene.getScene('CarrotPull').getDebugSnapshot().rabbit3d.status === 'ready');
};
const check = (name, detail) => report.checks.push({ name, result: 'PASS', detail });
const cases = [
  { name: 'rest' }, { name: 'left90', left: 90 }, { name: 'left120', left: 120 },
  { name: 'left150', left: 150 }, { name: 'right120', right: 120 },
  { name: 'both120', left: 120, right: 120 },
  { name: 'forward120', left: 120, right: 120, plane: 90 },
  { name: 'diagonal120', left: 120, right: 120, plane: 45 },
  { name: 'raisedElbow45', left: 120, right: 120, plane: 45, elbow: 45 },
  { name: 'elbow110', elbow: 110 },
  { name: 'leftLean', side: 18, yaw: 18, roll: -7.2 },
  { name: 'rightLean', side: -18, yaw: -18, roll: 7.2 },
  { name: 'raisedLean', left: 120, right: 120, side: 18, yaw: 5, roll: -5 },
  { name: 'knee50', knee: 0.5 }, { name: 'knee100', knee: 1 },
  { name: 'combined', left: 120, right: 120, plane: 45, elbow: 45, knee: 1, forward: 10 },
  { name: 'restRecovery' },
];

async function pose(value) {
  return page.evaluate(async value => {
    const preview = (await import('/src/main.ts')).game.scene.getScene('CarrotPull').rabbit3d;
    const rig = preview.overlay.rabbit.rig;
    rig.resetPose(true);
    rig.setArmRotation('left', value.left ?? 0, value.elbow ?? 0, value.plane ?? 0);
    rig.setArmRotation('right', value.right ?? 0, value.elbow ?? 0, value.plane ?? 0);
    rig.setBodyLean(value.side ?? 0, value.forward ?? 0);
    rig.setHeadRotation(value.yaw ?? 0, value.pitch ?? 0, value.roll ?? 0);
    rig.setKneeBend(value.knee ?? 0);
    rig.update(10);
    const data = preview.snapshot();
    return { name: value.name, requested: value, rigVersion: data.rigVersion,
      actual: data.mocap.boneDeltasDegrees,
      feet: ['L', 'R'].map(side => {
        const bone = rig.bones.get(`foot.${side}`);
        return bone.getWorldPosition(bone.position.clone()).toArray();
      }),
      maximumElbow: rig.maximumElbowBend(Math.max(value.left ?? 0, value.right ?? 0)) };
  }, value);
}

try {
  await enter('v3');
  assert.match(await page.title(), /動態花園/);
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  let current = await snapshot();
  assert.equal(current.rabbit3d.rigVersion, 'v3');
  assert.equal(current.rabbit3d.bones.length, 19);
  assert.equal(await page.getByRole('slider', { name: '左臂', exact: true }).getAttribute('max'), '150');
  check('V3 loads through the normal development preview with 19 bones and versioned controls');
  const rest = await pose(cases[0]);
  for (const value of cases) {
    const data = await pose(value);
    assert.ok(Math.abs(data.actual['upper_arm.L'] - (value.left ?? 0)) < 0.001);
    assert.ok(Math.abs(data.actual['upper_arm.R'] - (value.right ?? 0)) < 0.001);
    const appliedElbow = Math.min(value.elbow ?? 0, data.maximumElbow);
    assert.ok(Math.abs(data.actual['forearm.L'] - appliedElbow) < 0.001);
    assert.ok(Math.abs(data.actual['forearm.R'] - appliedElbow) < 0.001);
    data.feet.forEach((foot, index) => assert.ok(Math.abs(foot[1] - rest.feet[index][1]) < 0.001));
    report.poses.push(data);
    if (['both120', 'forward120', 'elbow110', 'knee100', 'combined'].includes(value.name)) {
      await page.waitForTimeout(100);
      await page.screenshot({ path: `${output}/${value.name}.png` });
    }
  }
  check('All requested pose categories use actual 90/120/150 shoulder angles, bounded elbow angles and preserved foot anchors');
  const limited = await pose({ name: 'limited150', left: 150, right: 150, elbow: 110, yaw: 25, pitch: 18 });
  assert.ok(limited.actual['forearm.L'] < 0.001 && limited.actual.head < 0.001);
  check('The known unsupported high-raise and deep-elbow request is visibly constrained by the model profile', limited);
  await pose({ name: 'rest' });
  await page.getByRole('slider', { name: '左臂', exact: true }).evaluate(input => {
    input.value = '120'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(40);
  const first = (await snapshot()).rabbit3d.mocap.boneDeltasDegrees['upper_arm.L'];
  await page.waitForTimeout(500);
  const last = (await snapshot()).rabbit3d.mocap.boneDeltasDegrees['upper_arm.L'];
  assert.ok(first > 0 && first < 120 && last > first && last > 119);
  check('Normal slider input interpolates through the game render clock');
  current = await snapshot();
  report.threeFps = current.rabbit3d.fps;
  await page.locator('[data-action=pause]').click();
  const paused = await snapshot();
  await page.waitForTimeout(200);
  assert.equal((await snapshot()).rabbit3d.renderedFrames, paused.rabbit3d.renderedFrames);
  await page.locator('[data-action=home]').click();
  await page.locator('[data-action=start]').waitFor();
  assert.equal(await page.locator('.rabbit-tools').count(), 0);
  check('Pause freezes rendering and returning home releases the V3 tools');
  await enter('v2');
  current = await snapshot();
  assert.equal(current.rabbit3d.rigVersion, 'v2');
  assert.equal(await page.getByRole('slider', { name: '左臂', exact: true }).getAttribute('max'), '90');
  const fallback = await pose({ name: 'preservedV2', left: 150, elbow: 110 });
  assert.ok(Math.abs(fallback.actual['upper_arm.L'] - 90) < 0.001);
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${output}/v2-fallback.png` });
  check('Explicit V2 fallback loads the preserved asset and retains its conservative limits');
  await page.locator('[data-action=pause]').click();
  await page.locator('[data-action=home]').click();
  await page.locator('[data-action=start]').waitFor();
  assert.deepEqual(report.errors, []);
  check('Page content, framework overlay and console checks');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = String(error);
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally {
  await writeFile(`${output}/browser-report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
