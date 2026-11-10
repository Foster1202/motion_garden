import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.QA_URL ?? 'http://127.0.0.1:5173/';
const output = process.env.QA_OUTPUT ?? '/private/tmp/motion-garden-4b-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
const report = {
  status: 'RUNNING', browser: browser.version(), url: base,
  browserPlugin: 'Browser plugin not available; Playwright with installed Google Chrome',
  input: 'Virtual webcam and simulated Landmarker output through the production PoseEstimator scheduler. No human webcam validation.',
  checks: [], errors: [], warnings: [],
};
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => {
  if (message.type() === 'error') report.errors.push(message.text());
  if (message.type() === 'warning') report.warnings.push(message.text());
});
const check = (name, detail) => report.checks.push({ name, result: 'PASS', detail });
const snapshot = () => page.evaluate(async () =>
  (await import('/src/main.ts')).game.scene.getScene('CarrotPull').getDebugSnapshot());
const wait = async (predicate, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await snapshot();
    if (predicate(value)) return value;
    await page.waitForTimeout(50);
  }
  throw new Error(`Snapshot timeout: ${JSON.stringify(await snapshot())}`);
};
const fixture = values => page.evaluate(values => Object.assign(window.__mocapFixture, values), values);
const assertNoModal = async () => {
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal((await snapshot()).paused, false);
};
const calibrationProfile = () => page.evaluate(async () =>
  (await import('/src/main.ts')).game.scene.getScene('CarrotPull').motion.active.getCalibration());

const installFixture = () => page.evaluate(async () => {
  const { PoseEstimator } = await import('/src/game/vision/PoseEstimator.ts');
  window.__mocapFixture = { left: 0, right: 0, knee: 170, lean: 0, shift: 0, lost: true, leftHidden: false, forward: false };
  window.__mocapStats = { models: 0, inferences: 0, closed: 0, timestamps: [] };
  const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async options => {
    const stream = await getMedia(options);
    window.__qaStream = stream;
    return stream;
  };
  const initialize = PoseEstimator.prototype.initialize;
  PoseEstimator.prototype.initialize = function () {
    // Substitute model output while retaining production initialization and cancellation.
    this.options.createLandmarker = async () => {
      window.__mocapStats.models++;
      return {
        close() { window.__mocapStats.closed++; },
        detectForVideo(video, timestamp) {
          const f = window.__mocapFixture;
          const stats = window.__mocapStats;
          stats.inferences++;
          stats.timestamps.push(timestamp);
          if (f.lost) return { landmarks: [] };
          const width = video.videoWidth;
          const height = video.videoHeight;
          const center = width * (.5 + f.shift);
          const shoulderY = height * .28;
          const hipY = height * .52;
          const offset = Math.tan(f.lean * Math.PI / 180) * (hipY - shoulderY);
          const point = (x, y, visibility = .99) =>
            ({ x: x / width, y: y / height, z: 0, visibility, presence: .99 });
          const points = Array.from({ length: 33 }, () => point(center, height * .5));
          for (const [shoulder, elbow, wrist, hip, knee, ankle, sign, angle] of [
            [11, 13, 15, 23, 25, 27, 1, f.left],
            [12, 14, 16, 24, 26, 28, -1, f.right],
          ]) {
            const x = center + sign * height * .12;
            const armRadians = angle * Math.PI / 180;
            const kneeRadians = (180 - f.knee) * Math.PI / 180;
            points[shoulder] = point(x + offset, shoulderY);
            points[elbow] = point(x + offset + sign * Math.sin(armRadians) * height * .13,
              shoulderY + Math.cos(armRadians) * height * .13);
            points[wrist] = point(x + offset + sign * Math.sin(armRadians) * height * .25,
              shoulderY + Math.cos(armRadians) * height * .25);
            points[hip] = point(x, hipY);
            points[knee] = point(x, height * .69);
            points[ankle] = point(x + Math.sin(kneeRadians) * height * .17,
              height * .69 + Math.cos(kneeRadians) * height * .17);
          }
          if (f.forward) {
            for (const [shoulder, elbow, wrist] of [[11, 13, 15], [12, 14, 16]]) {
              points[elbow] = { ...points[shoulder], z: -.10 };
              points[wrist] = { ...points[shoulder], z: -.20 };
            }
          }
          if (f.leftHidden) for (const index of [13, 15]) points[index].visibility = .1;
          return { landmarks: [points] };
        },
      };
    };
    return initialize.call(this);
  };
});

try {
  await page.goto(`${base}?rabbit3dDebug=1&mocapDebug=1`);
  await page.locator('[data-action=start]').click();
  await page.locator('[data-action=carrot]').click();
  await page.waitForSelector('.mocap-debug');
  assert.match(await page.title(), /動態花園/);
  assert.ok((await page.locator('body').innerText()).includes('拔蘿蔔'));
  assert.equal((await snapshot()).rabbit3d.mode, '3d');
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  check('Page identity, meaningful screen and no framework error overlay');

  await installFixture();

  await page.locator('[data-input-action=camera]').click();
  await page.waitForFunction(() => window.__mocapStats.inferences > 8);
  await page.waitForTimeout(3800);
  let value = await snapshot();
  assert.equal(value.input.suspended, true);
  assert.equal(value.input.requestPause, false);
  assert.equal(value.score, 0);
  assert.equal(value.progress, 0);
  assert.equal(value.rabbit3d.mocap.referenceReady, false);
  assert.equal(await page.locator('.calibration-panel').count(), 0);
  await assertNoModal();
  assert.match(await page.locator('.person-status').innerText(), /未偵測到人物/);
  await page.screenshot({ path: `${output}/waiting-for-person.png` });
  check('Camera waits beyond the former automatic-rest timeout with no person, calibration or modal');

  await fixture({ lost: false, knee: 140 });
  await page.waitForTimeout(1200);
  value = await snapshot();
  assert.equal(value.input.suspended, true);
  assert.equal(value.rabbit3d.mocap.referenceReady, false);
  assert.equal(value.score, 0);
  check('Bent arrival cannot establish a natural standing reference or start gameplay');

  await fixture({ knee: 170 });
  await wait(s => s.input.calibrationState === 'STANDING_SAMPLING');
  await page.screenshot({ path: `${output}/calibration.png` });
  await page.evaluate(async () => (await import('/src/main.ts')).game.scene.getScene('CarrotPull').motion.active.estimator.pause());
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(async () => (await import('/src/main.ts')).game.scene.getScene('CarrotPull').motion.calibration.getSnapshot().paused), true);
  await page.evaluate(async () => (await import('/src/main.ts')).game.scene.getScene('CarrotPull').motion.active.estimator.resume());
  check('An inference stall pauses calibration sampling and its timeout until reliable frames resume');
  await wait(s => s.input.calibrationState === 'BEND_INSTRUCTIONS' || s.input.calibrationState === 'BEND_SAMPLING');
  await fixture({ knee: 150 });
  await wait(s => s.input.calibrationReady === true);
  value = await snapshot();
  assert.equal(value.rabbit3d.mocap.referenceReady, false);
  const profile = await calibrationProfile();
  assert.ok(profile.timestamp > 0);
  assert.ok(Math.abs(profile.standingAngle - 170) < 1);
  assert.ok(Math.abs(profile.bendingAngle - 150) < 1);
  await fixture({ knee: 170 });
  await wait(s => s.rabbit3d.mocap.trackingState === 'tracking');
  assert.equal((await snapshot()).rabbit3d.controlSource, 'mocap');
  assert.equal(await page.locator('.rabbit-3d-debug').count(), 0);
  check('Person entry starts calibration, completed calibration automatically enables mocap, standing establishes reference', profile);
  assert.match(await page.locator('.person-status').innerText(), /已偵測到人物/);
  await page.screenshot({ path: `${output}/standing.png` });
  const rest = await snapshot();

  for (const angle of [20, 40, 60, 80, 100, 120, 140]) {
    await fixture({ left: angle });
    await page.waitForTimeout(150);
  }
  await wait(s => s.rabbit3d.mocap.smoothed.leftArmElevation > 80);
  value = await snapshot();
  assert.ok(value.rabbit3d.mocap.boneDeltasDegrees['upper_arm.L'] > 80);
  assert.ok(value.rabbit3d.mocap.boneDeltasDegrees['upper_arm.R'] < .05);
  assert.ok(value.rabbit3d.mocap.raw.leftArmElevation > 130);
  check('Continuous anatomical left arm reaches the bounded high-raise pose through actual GLB bones independently');
  for (const angle of [20, 40, 60, 80, 100, 120, 140]) {
    await fixture({ right: angle });
    await page.waitForTimeout(150);
  }
  await wait(s => s.rabbit3d.mocap.smoothed.rightArmElevation > 80);
  check('Continuous anatomical right arm reaches the bounded high-raise pose independently');
  await fixture({ lean: 8, knee: 160, shift: .035 });
  await page.waitForTimeout(800);
  value = await snapshot();
  assert.ok(value.rabbit3d.mocap.smoothed.leftArmElevation > 80);
  assert.ok(value.rabbit3d.mocap.smoothed.rightArmElevation > 80);
  assert.ok(value.rabbit3d.mocap.smoothed.torsoLean > 6);
  assert.ok(value.rabbit3d.mocap.smoothed.bendAmount > .3);
  assert.ok(value.rabbit3d.mocap.smoothed.bendAmount < .9);
  assert.ok(value.rabbit3d.mocap.smoothed.lateralOffset < 0);
  assert.notDeepEqual(value.rabbit3d.quaternions['shin.L'], rest.rabbit3d.quaternions['shin.L']);
  report.performance = { mediaPipeFps: value.rabbit3d.mocap.mediaPipeFps,
    threeFps: value.rabbit3d.fps, kind: 'Simulated landmarks, real shared scheduler and render loop' };
  check('Combined arms, signed torso lean, shallow continuous knee and relative lateral movement drive actual rig');
  await page.screenshot({ path: `${output}/continuous-pose.png` });

  await fixture({ leftHidden: true });
  await page.waitForTimeout(900);
  value = await snapshot();
  assert.equal(value.rabbit3d.mocap.mapped.leftArmElevation, 0);
  assert.ok(value.rabbit3d.mocap.smoothed.rightArmElevation > 80);
  check('Partial arm occlusion returns that arm towards neutral while the reliable arm continues');
  await fixture({ leftHidden: false, lean: -8, shift: -.035, knee: 170 });
  await page.waitForTimeout(800);
  value = await snapshot();
  assert.ok(value.rabbit3d.mocap.smoothed.torsoLean < -6);
  assert.ok(value.rabbit3d.mocap.smoothed.lateralOffset > 0);
  check('Opposite torso and lateral directions remain correct during combined recovery');
  for (const angle of [120, 100, 80, 60, 40, 20, 0]) {
    await fixture({ left: angle, right: angle, lean: 0, shift: 0 });
    await page.waitForTimeout(120);
  }
  await wait(s => s.rabbit3d.mocap.smoothed.leftArmElevation < 1 && s.rabbit3d.mocap.smoothed.rightArmElevation < 1);
  check('Lowering both hands continuously returns both arms to relaxed standing');
  await fixture({ forward: true });
  await wait(s => s.rabbit3d.mocap.smoothed.leftArmPlane > 70 && s.rabbit3d.mocap.smoothed.rightArmPlane > 70
    && s.rabbit3d.mocap.boneDeltasDegrees['upper_arm.L'] > 50);
  value = await snapshot();
  assert.ok(value.rabbit3d.mocap.smoothed.leftArmElevation > 70);
  assert.ok(value.rabbit3d.mocap.boneDeltasDegrees['upper_arm.L'] > 50);
  await page.screenshot({ path: `${output}/forward-arms.png` });
  check('Landmark depth drives forward arm raises through multi-axis shoulder quaternions');
  await fixture({ forward: false, left: 90, right: 90 });
  await page.waitForTimeout(800);

  await fixture({ lost: true });
  await page.waitForTimeout(320);
  const holding = await snapshot();
  assert.equal(holding.rabbit3d.mocap.trackingState, 'holding');
  await page.waitForTimeout(500);
  value = await snapshot();
  assert.equal(value.rabbit3d.mocap.trackingState, 'returning-neutral');
  assert.ok(value.rabbit3d.mocap.smoothed.rightArmElevation < holding.rabbit3d.mocap.smoothed.rightArmElevation);
  await page.waitForTimeout(3200);
  await assertNoModal();
  assert.deepEqual(await calibrationProfile(), profile);
  assert.equal((await snapshot()).rabbit3d.mocap.referenceReady, true);
  await page.screenshot({ path: `${output}/tracking-lost.png` });
  await fixture({ lost: false });
  await wait(s => s.rabbit3d.mocap.trackingState === 'tracking');
  assert.deepEqual(await calibrationProfile(), profile);
  check('Short loss holds, longer loss eases to standing and waits without modal, stable recovery retains calibration and reference');

  await page.locator('[data-action=pause]').click();
  const paused = await snapshot();
  const pausedInferenceCount = await page.evaluate(() => window.__mocapStats.inferences);
  await page.waitForTimeout(350);
  assert.equal((await snapshot()).rabbit3d.renderedFrames, paused.rabbit3d.renderedFrames);
  assert.equal(await page.evaluate(() => window.__mocapStats.inferences), pausedInferenceCount);
  assert.match(await page.locator('dialog[open]').innerText(), /休息一下/);
  await page.locator('[data-action=resume]').click();
  await wait(s => s.rabbit3d.mocap.trackingState === 'tracking');
  assert.equal((await snapshot()).animationPaused, true);
  check('Explicit Pause and Resume freeze inference and Three rendering, preserving the motion reference');

  await page.locator('[data-mocap-action=toggle]').click();
  assert.equal((await snapshot()).rabbit3d.controlSource, 'manual');
  assert.equal(await page.locator('.rabbit-3d-debug').count(), 1);
  await page.getByRole('slider', { name: '左臂', exact: true }).evaluate(input => {
    input.value = '50';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await fixture({ left: 0, right: 0, lean: 0, shift: 0 });
  await page.waitForTimeout(1400);
  const manual = (await snapshot()).rabbit3d.quaternions['upper_arm.L'];
  await page.waitForTimeout(400);
  assert.deepEqual((await snapshot()).rabbit3d.quaternions['upper_arm.L'], manual);
  await page.locator('[data-mocap-action=toggle]').click();
  assert.equal(await page.locator('.rabbit-3d-debug').count(), 0);
  await wait(s => s.rabbit3d.mocap.referenceReady);
  await page.locator('[data-mocap-action=reference]').click();
  assert.equal((await snapshot()).rabbit3d.mocap.referenceReady, false);
  await wait(s => s.rabbit3d.mocap.referenceReady);
  check('Manual sliders own bones exclusively until mocap is restored, with developer reference reset retained');

  for (const viewport of [{ width: 1440, height: 900 }, { width: 900, height: 700 }, { width: 600, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(250);
    assert.equal((await snapshot()).rabbit3d.status, 'ready');
    const overlap = await page.evaluate(() => {
      const a = document.querySelector('.rabbit-tools').getBoundingClientRect();
      const b = document.querySelector('.pose-preview').getBoundingClientRect();
      return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
        * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    });
    assert.equal(overlap, 0);
    await page.screenshot({ path: `${output}/resize-${viewport.width}.png` });
  }
  check('Desktop and narrow layouts keep preview and scrollable developer panel separate');

  await page.setViewportSize({ width: 1512, height: 982 });
  await page.evaluate(async () => {
    const preview = (await import('/src/main.ts')).game.scene.getScene('CarrotPull').rabbit3d;
    window.__mocapOverlay = preview.overlay;
    preview.overlay.renderer.forceContextLoss();
  });
  await wait(s => s.rabbit3d.mode === 'sprite');
  assert.equal(await page.locator('.mocap-debug').count(), 0);
  assert.equal((await snapshot()).rabbit3d.spriteVisible, true);
  check('WebGL context loss cleanly returns to the complete Sprite game');

  await fixture({ knee: 150 });
  await wait(s => s.state === 'BENDING' && s.progress > .1);
  await fixture({ lost: true });
  await wait(s => s.input.suspended);
  const bendFrozen = await snapshot();
  await page.waitForTimeout(3600);
  value = await snapshot();
  assert.equal(value.state, bendFrozen.state);
  assert.equal(value.progress, bendFrozen.progress);
  assert.equal(value.score, 0);
  await assertNoModal();
  await fixture({ lost: false });
  await wait(s => s.state === 'GRABBED');
  await fixture({ knee: 170 });
  await wait(s => s.state === 'RETURNING' && s.progress > .1);
  await fixture({ lost: true });
  await wait(s => s.input.suspended);
  const returnFrozen = await snapshot();
  await page.waitForTimeout(1000);
  value = await snapshot();
  assert.equal(value.state, returnFrozen.state);
  assert.equal(value.progress, returnFrozen.progress);
  assert.equal(value.score, 0);
  await fixture({ lost: false });
  await wait(s => s.state === 'SUCCESS');
  await fixture({ lost: true });
  await wait(s => s.input.suspended);
  const successFrozen = await snapshot();
  await page.waitForTimeout(2400);
  value = await snapshot();
  assert.equal(value.score, 0);
  assert.equal(value.frame, successFrozen.frame);
  await assertNoModal();
  await fixture({ lost: false });
  await wait(s => s.score === 1);
  check('Sprite bend/return holds and success animation freeze through loss, then resume without false scoring');
  await page.screenshot({ path: `${output}/sprite-recovered.png` });

  await page.locator('[data-action=pause]').click();
  await page.locator('[data-action=home]').click();
  await page.locator('[data-action=start]').waitFor();
  const resources = await page.evaluate(async () => {
    const overlay = window.__mocapOverlay;
    return {
      tracks: window.__qaStream.getTracks().map(track => track.readyState),
      stats: window.__mocapStats,
      textures: (await import('/src/main.ts')).game.textures.getTextureKeys().filter(key => key.startsWith('rabbit-three-')),
      renderer: { geometries: overlay.renderer.info.memory.geometries, programs: overlay.renderer.info.programs?.length,
        children: overlay.scene.children.length, contextLost: overlay.renderer.getContext().isContextLost() },
    };
  });
  assert.ok(resources.tracks.every(state => state === 'ended'));
  assert.equal(resources.stats.models, 1);
  assert.equal(resources.stats.closed, 1);
  assert.equal(resources.textures.length, 0);
  assert.deepEqual(resources.renderer, { geometries: 0, programs: 0, children: 0, contextLost: true });
  assert.equal(await page.locator('.mocap-debug,.rabbit-tools,.pose-preview,.calibration-panel').count(), 0);
  assert.ok(resources.stats.timestamps.every((value, index, values) => index === 0 || value > values[index - 1]));
  report.resources = { tracks: resources.tracks, models: resources.stats.models, inferences: resources.stats.inferences,
    closed: resources.stats.closed, textures: resources.textures, renderer: resources.renderer };
  check('Single model, ordered inference, stopped webcam and disposed Three/debug resources', report.resources);

  await page.goto(`${base}?rabbit3dDebug=1`);
  await page.locator('[data-action=start]').click();
  await page.locator('[data-action=carrot]').click();
  await wait(s => s.rabbit3d.status === 'ready');
  assert.equal(await page.locator('.mocap-debug').count(), 0);
  await installFixture();
  await fixture({ lost: false, knee: 155 });
  await page.locator('[data-input-action=camera]').click();
  await wait(s => s.input.calibrationState === 'BEND_INSTRUCTIONS' || s.input.calibrationState === 'BEND_SAMPLING');
  await fixture({ knee: 140 });
  await wait(s => s.input.calibrationReady === true);
  await fixture({ knee: 155 });
  await wait(s => s.rabbit3d.mocap.trackingState === 'tracking');
  assert.equal((await snapshot()).rabbit3d.controlSource, 'mocap');
  assert.equal(await page.locator('.mocap-debug').count(), 0);
  assert.equal(await page.locator('.rabbit-3d-debug').count(), 0);
  assert.ok(Math.abs((await calibrationProfile()).standingAngle - 155) < 1);
  await page.screenshot({ path: `${output}/automatic-without-mocap-debug.png` });
  await fixture({ lost: true });
  await wait(s => s.input.suspended);
  await page.locator('[data-action=pause]').click();
  await page.locator('[data-action=restart]').click();
  await page.locator('[data-input-action=keyboard]').click();
  await wait(s => s.rabbit3d.status === 'ready');
  await page.evaluate(async () => {
    const scene = (await import('/src/main.ts')).game.scene.getScene('CarrotPull');
    if (scene.time.paused) throw new Error('Scene clock remained paused after camera restart');
    window.__clockResumed = false;
    scene.time.delayedCall(80, () => { window.__clockResumed = true; });
  });
  await page.waitForFunction(() => window.__clockResumed);
  check('Restart after tracking loss restores the scene timer for keyboard and missing-asset fallback');
  await page.locator('[data-action=pause]').click();
  await page.locator('[data-action=home]').click();
  await page.locator('[data-action=start]').waitFor();
  assert.ok(await page.evaluate(() => window.__qaStream.getTracks().every(track => track.readyState === 'ended')));
  assert.equal(await page.evaluate(() => window.__mocapStats.closed), 1);
  check('Automatic mocap works without mocapDebug, accepts personal standing below the manual default and releases the second camera');
  assert.deepEqual(report.errors, []);
  check('Console health');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.failure = String(error);
  report.snapshot = await snapshot().catch(() => null);
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally {
  await writeFile(`${output}/browser-report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
