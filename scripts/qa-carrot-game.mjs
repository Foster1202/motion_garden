import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const production = process.env.QA_PRODUCTION === '1';
const base = process.env.QA_URL ?? (production ? 'http://127.0.0.1:5179/' : 'http://127.0.0.1:5178/');
const output = process.env.QA_OUTPUT ?? '/private/tmp/motion-garden-4d2-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
const report = {
  status: 'RUNNING', browser: browser.version(), url: base,
  browserPlugin: 'Browser plugin not available; installed Chrome through Playwright',
  input: 'Virtual camera with deterministic Landmarker output through the existing PoseEstimator scheduler, calibration, classifier, mocap and CarrotRound.',
  humanWebcamQA: 'NOT VERIFIED',
  checks: [], screenshots: [], rounds: [], resources: [], errors: [], expectedDiagnostics: [], warnings: [], requests: [],
};
const expectedFailureUrls = new Set();
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => {
  if (message.type() === 'error') {
    const detail = { message: message.text(), url: message.location().url };
    if (detail.message.includes('net::ERR_FAILED') && expectedFailureUrls.has(detail.url)) {
      report.expectedDiagnostics.push(detail);
    } else report.errors.push(detail);
  }
  if (message.type() === 'warning') report.warnings.push(message.text());
});
page.on('request', request => {
  if (/\.glb(?:\?|$)/.test(request.url())) report.requests.push(request.url());
});
const check = (name, detail) => report.checks.push({ name, result: 'PASS', detail });
const snapshot = () => page.evaluate(async () =>
  (await import('/src/main.ts')).game.scene.getScene('CarrotPull').getDebugSnapshot());
const fixture = value => page.evaluate(value => Object.assign(window.__carrotGameFixture, value), value);
async function waitSnapshot(predicate, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await snapshot();
    if (predicate(last)) return last;
    await page.waitForTimeout(30);
  }
  throw new Error(`Gameplay snapshot timeout ${JSON.stringify(last)}`);
}
async function capture(name) {
  await page.screenshot({ path: `${output}/${name}.png` });
  report.screenshots.push(`${name}.png`);
}
async function enter(search = '?carrotGameDebug=1') {
  await page.goto(`${base}${search}`);
  await page.locator('[data-action=start]').click();
  await page.locator('[data-action=carrot]').click();
}

async function installFixture(compiled = false) {
  await page.evaluate(async compiled => {
    const PoseEstimator = compiled ? undefined : (await import('/src/game/vision/PoseEstimator.ts')).PoseEstimator;
    window.__carrotGameFixture = { left: 0, right: 0, knee: 170, lean: 0, shift: 0,
      lost: true, leftHidden: false, forward: false };
    window.__carrotGameStats = { models: 0, inferences: 0, closed: 0, streams: 0, timestamps: [] };
    const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => {
      const stream = await getMedia(options);
      window.__carrotGameStream = stream;
      window.__carrotGameStats.streams++;
      return stream;
    };
    window.__createCarrotGameLandmarker = async () => {
      window.__carrotGameStats.models++;
      return {
        close() { window.__carrotGameStats.closed++; },
        detectForVideo(video, timestamp) {
          const value = window.__carrotGameFixture;
          const stats = window.__carrotGameStats;
          stats.inferences++;
          stats.timestamps.push(timestamp);
          if (value.lost) return { landmarks: [] };
          const width = video.videoWidth;
          const height = video.videoHeight;
          const center = width * (.5 + value.shift);
          const shoulderY = height * .28;
          const hipY = height * .52;
          const lean = Math.tan(value.lean * Math.PI / 180) * (hipY - shoulderY);
          const point = (x, y, visibility = .99) =>
            ({ x: x / width, y: y / height, z: 0, visibility, presence: .99 });
          const points = Array.from({ length: 33 }, () => point(center, height * .5));
          for (const [shoulder, elbow, wrist, hip, knee, ankle, sign, angle] of [
            [11, 13, 15, 23, 25, 27, 1, value.left],
            [12, 14, 16, 24, 26, 28, -1, value.right],
          ]) {
            const x = center + sign * height * .12;
            const armRadians = angle * Math.PI / 180;
            const kneeRadians = (180 - value.knee) * Math.PI / 180;
            points[shoulder] = point(x + lean, shoulderY);
            points[elbow] = point(x + lean + sign * Math.sin(armRadians) * height * .13,
              shoulderY + Math.cos(armRadians) * height * .13);
            points[wrist] = point(x + lean + sign * Math.sin(armRadians) * height * .25,
              shoulderY + Math.cos(armRadians) * height * .25);
            points[hip] = point(x, hipY);
            points[knee] = point(x, height * .69);
            points[ankle] = point(x + Math.sin(kneeRadians) * height * .17,
              height * .69 + Math.cos(kneeRadians) * height * .17);
          }
          if (value.forward) {
            for (const [shoulder, elbow, wrist] of [[11, 13, 15], [12, 14, 16]]) {
              points[elbow] = { ...points[shoulder], z: -.10 };
              points[wrist] = { ...points[shoulder], z: -.20 };
            }
          }
          if (value.leftHidden) for (const index of [13, 15]) points[index].visibility = .1;
          return { landmarks: [points] };
        },
      };
    };
    if (PoseEstimator) {
      const initialize = PoseEstimator.prototype.initialize;
      PoseEstimator.prototype.initialize = function () {
        this.options.createLandmarker = window.__createCarrotGameLandmarker;
        return initialize.call(this);
      };
    }
  }, compiled);
}

async function calibrationProfile() {
  return page.evaluate(async () =>
    (await import('/src/main.ts')).game.scene.getScene('CarrotPull').motion.active.getCalibration());
}
async function calibrate() {
  await fixture({ lost: false, knee: 170 });
  await waitSnapshot(value => ['BEND_INSTRUCTIONS', 'BEND_SAMPLING'].includes(value.input.calibrationState));
  await fixture({ knee: 150 });
  await waitSnapshot(value => value.input.calibrationReady === true);
  const profile = await calibrationProfile();
  assert.ok(Math.abs(profile.standingAngle - 170) < 1);
  assert.ok(Math.abs(profile.bendingAngle - 150) < 1);
  await fixture({ knee: 170 });
  await waitSnapshot(value => value.rabbit3d.mocap?.trackingState === 'tracking' && value.input.ready);
  return profile;
}
async function resourceSnapshot() {
  return page.evaluate(async () => {
    const { game } = await import('/src/main.ts');
    const scene = game.scene.getScene('CarrotPull');
    const preview = scene.rabbit3d;
    let carrotModels = 0;
    preview.overlay?.scene.traverse(object => { if (object.name === 'Carrot3D') carrotModels++; });
    return { stats: { ...window.__carrotGameStats, timestamps: undefined },
      carrotModels, spriteRabbitVisible: scene.rabbit.root.visible, spriteCarrotVisible: scene.carrot.root.visible,
      phaserCarrotAlpha: scene.carrot.root.alpha, soilVisible: scene.soil.visible,
      textures: game.textures.getTextureKeys().filter(key => key.startsWith('rabbit-three-')),
      geometries: preview.overlay?.renderer.info.memory.geometries,
      gpuTextures: preview.overlay?.renderer.info.memory.textures,
      canvasCount: document.querySelectorAll('#phaser-stage canvas').length };
  });
}
async function pauseAndResume(label) {
  await page.locator('[data-action=pause]').click();
  const before = await snapshot();
  const inferences = await page.evaluate(() => window.__carrotGameStats.inferences);
  await page.waitForTimeout(350);
  const after = await snapshot();
  assert.equal(after.rabbit3d.renderedFrames, before.rabbit3d.renderedFrames, label);
  assert.equal(after.state, before.state, label);
  assert.equal(after.progress, before.progress, label);
  assert.equal(after.score, before.score, label);
  assert.deepEqual(after.rabbit3d.gameplay, before.rabbit3d.gameplay, label);
  assert.equal(await page.evaluate(() => window.__carrotGameStats.inferences), inferences, label);
  await page.locator('[data-action=resume]').click();
  await waitSnapshot(value => !value.paused && value.input.ready && !value.input.suspended);
  check(`Pause preserves ${label} and resumes its original state`);
}
async function lossAndRecovery(label) {
  await fixture({ lost: true });
  await waitSnapshot(value => value.input.suspended);
  const before = await snapshot();
  await page.waitForTimeout(700);
  const after = await snapshot();
  assert.equal(after.state, before.state, label);
  assert.equal(after.progress, before.progress, label);
  assert.equal(after.score, before.score, label);
  assert.equal(after.rabbit3d.gameplay.phase, before.rabbit3d.gameplay.phase, label);
  assert.equal(after.rabbit3d.gameplay.pullProgress, before.rabbit3d.gameplay.pullProgress, label);
  assert.equal(after.rabbit3d.gameplay.transferElapsed, before.rabbit3d.gameplay.transferElapsed, label);
  assert.equal(await page.locator('dialog[open]').count(), 0);
  await fixture({ lost: false });
  await waitSnapshot(value => value.input.ready && !value.input.suspended);
  check(`Tracking loss freezes ${label} without a modal and reliable recovery resumes`);
}
async function beginRoundCapture(targetScore) {
  await page.evaluate(async targetScore => {
    const { game } = await import('/src/main.ts');
    const scene = game.scene.getScene('CarrotPull');
    const canvas = document.createElement('canvas');
    canvas.width = 800; canvas.height = 486;
    const context = canvas.getContext('2d');
    window.__carrotGameFrames = [];
    let ticks = 0;
    let completedTicks = 0;
    window.__carrotGameFrameListener = () => {
      ticks++;
      if (ticks % 6 !== 0) return;
      const state = scene.getDebugSnapshot();
      context.fillStyle = '#f5f3e9'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(game.canvas, 0, 36, 800, 450);
      context.fillStyle = '#294d3a'; context.font = '18px sans-serif';
      context.fillText(`${state.state} / ${state.rabbit3d.gameplay.phase} / Score ${state.score}`, 14, 25);
      window.__carrotGameFrames.push({ image: canvas.toDataURL('image/png'), state: state.state,
        phase: state.rabbit3d.gameplay.phase, score: state.score, atMs: performance.now(),
        pullProgress: state.rabbit3d.gameplay.pullProgress,
        error: state.rabbit3d.gameplay.attachmentError });
      if (state.score >= targetScore) completedTicks++;
      if (completedTicks >= 8 || window.__carrotGameFrames.length >= 100) {
        game.events.off('postrender', window.__carrotGameFrameListener);
        delete window.__carrotGameFrameListener;
      }
    };
    game.events.on('postrender', window.__carrotGameFrameListener);
  }, targetScore);
}
async function saveRoundCapture() {
  const frames = await page.evaluate(async () => {
    const { game } = await import('/src/main.ts');
    if (window.__carrotGameFrameListener) game.events.off('postrender', window.__carrotGameFrameListener);
    delete window.__carrotGameFrameListener;
    return window.__carrotGameFrames;
  });
  assert.ok(frames.length >= 20, `Full-round frame count ${frames.length}`);
  const directory = `${output}/full-round-frames`;
  await mkdir(directory, { recursive: true });
  for (let index = 0; index < frames.length; index++) {
    await writeFile(`${directory}/frame-${String(index).padStart(3, '0')}.png`,
      Buffer.from(frames[index].image.split(',')[1], 'base64'));
  }
  const gif = spawnSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '10', '-i', `${directory}/frame-%03d.png`,
    '-vf', 'split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse', '-loop', '0', `${output}/full-round.gif`], { encoding: 'utf8' });
  assert.equal(gif.status, 0, String(gif.error ?? gif.stderr));
  const firstPull = frames.find(frame => frame.pullProgress > .01);
  const fullyPulled = frames.find(frame => frame.pullProgress >= .99);
  report.visualSequence = { frames: frames.length, seconds: frames.length / 10,
    observedPullSeconds: firstPull && fullyPulled ? (fullyPulled.atMs - firstPull.atMs) / 1000 : null,
    states: [...new Set(frames.map(frame => frame.state))],
    phases: [...new Set(frames.map(frame => frame.phase))],
    kind: 'Actual Phaser postrender frames during a calibrated synthetic-camera round, observational state caption',
    path: 'full-round.gif' };
  check('A continuous camera-driven full-round GIF records actual rendering', report.visualSequence);
}
async function measurePerformance() {
  const before = await snapshot();
  const started = performance.now();
  const samples = [];
  const inferenceBefore = await page.evaluate(() => window.__carrotGameStats.inferences);
  for (let index = 0; index < 60; index++) {
    await page.waitForTimeout(50);
    const value = await snapshot();
    samples.push({ threeFps: value.rabbit3d.fps, mediaPipeFps: value.rabbit3d.mocap.mediaPipeFps,
      ikMs: value.rabbit3d.ik.solverTimeMs, grabError: value.rabbit3d.gameplay.attachmentError,
      gameplayMs: value.rabbit3d.gameplay.updateMs });
  }
  const after = await snapshot();
  const elapsedMs = performance.now() - started;
  const inferenceAfter = await page.evaluate(() => window.__carrotGameStats.inferences);
  const summary = key => {
    const values = samples.map(sample => sample[key]).filter(Number.isFinite).sort((a, b) => a - b);
    return values.length ? { samples: values.length, mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      p95: values[Math.floor((values.length - 1) * .95)], maximum: values.at(-1) } : null;
  };
  report.performance = { elapsedMs,
    observedRenderFps: (after.rabbit3d.renderedFrames - before.rabbit3d.renderedFrames) * 1000 / elapsedMs,
    observedInferenceFps: (inferenceAfter - inferenceBefore) * 1000 / elapsedMs,
    threeFps: summary('threeFps'), mediaPipeFps: summary('mediaPipeFps'), ikMs: summary('ikMs'), gameplayMs: summary('gameplayMs'),
    inferenceKind: 'Synthetic model output through the existing real camera and PoseEstimator scheduler',
    viewport: after.rabbit3d.viewport };
  assert.ok(report.performance.observedRenderFps > 35);
  check('The real game render clock and shared inference scheduler remain live', report.performance);
}
async function visualFacts() {
  return page.evaluate(async () => {
    const scene = (await import('/src/main.ts')).game.scene.getScene('CarrotPull');
    const preview = scene.rabbit3d;
    const overlay = preview.overlay;
    const gameplay = preview.snapshot().gameplay;
    overlay.renderer.render(overlay.scene, overlay.camera);
    const canvas = document.createElement('canvas');
    canvas.width = overlay.viewport.width; canvas.height = overlay.viewport.height;
    const context = canvas.getContext('2d');
    context.drawImage(overlay.renderer.domElement, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const soilRow = 681 - gameplay.soilWorldY * overlay.rabbit.pixelsPerUnit - overlay.viewport.y;
    let orangePixels = 0;
    let orangeBelowSoil = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const [red, green, blue, alpha] = pixels.subarray(index, index + 4);
      if (alpha < 100 || red < 130 || green < 35 || green > 190 || blue > 80 || red < green * 1.25) continue;
      orangePixels++;
      if (Math.floor(index / 4 / canvas.width) > soilRow + 2) orangeBelowSoil++;
    }
    const materials = [];
    preview.carrot.model.traverse(object => {
      if (!object.isMesh) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.push({ name: material.name, planes: material.clippingPlanes?.map(plane =>
          ({ normal: plane.normal.toArray(), constant: plane.constant })) ?? [] });
      }
    });
    return { soilRow, orangePixels, orangeBelowSoil, localClipping: overlay.renderer.localClippingEnabled,
      materials, gameplay, soilSpriteVisible: scene.soil.visible,
      environment: preview.snapshot().environment,
      dataRenderMode: document.querySelector('#game-ui').dataset.carrotRender };
  });
}

async function waitDom(predicate, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => ({
      renderMode: document.querySelector('#game-ui')?.dataset.carrotRender,
      state: document.querySelector('#game-ui')?.dataset.roundState,
      score: document.querySelector('#score')?.textContent,
      progress: document.querySelector('#progress-label')?.textContent,
      calibration: document.querySelector('[data-calibration-state]')?.dataset.calibrationState,
      status: document.querySelector('.motion-status')?.textContent,
    }));
    if (predicate(last)) return last;
    await page.waitForTimeout(30);
  }
  throw new Error(`Production DOM timeout ${JSON.stringify(last)}`);
}

async function productionGame() {
  report.input = 'Built production player with virtual camera. Only the dynamically loaded MediaPipe module is replaced by deterministic inference output; the camera, existing scheduler, calibration, classifier and game execute normally.';
  await page.route('**/assets/vision_bundle-*.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `export const FilesetResolver = { forVisionTasks: async () => ({}) };
export const PoseLandmarker = { createFromOptions: async () => window.__createCarrotGameLandmarker() };`,
  }));
  await enter('?rabbit3dDebug=1&mocapDebug=1&carrotGrabDebug=1&carrotGameDebug=1&carrotGameSim=1');
  await installFixture(true);
  await page.locator('[data-input-action=camera]').click();
  await waitDom(value => value.renderMode === '3d-game');
  assert.match(await page.title(), /動態花園/);
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  assert.equal(await page.locator('.rabbit-tools,.rabbit-3d-debug,.rabbit-ik-debug,.mocap-debug,.carrot-grab-debug,.carrot-game-debug,[data-carrot-grab-action]').count(), 0);
  assert.equal(await page.getByRole('combobox', { name: '阿兔渲染模式' }).count(), 0);
  assert.ok(!(await page.locator('body').innerText()).includes('開發預覽'));
  check('Built camera player enters real 3D gameplay and all developer query flags retain player-only controls');
  await fixture({ lost: false, knee: 170 });
  await waitDom(value => ['BEND_INSTRUCTIONS', 'BEND_SAMPLING'].includes(value.calibration));
  await fixture({ knee: 150 });
  await waitDom(value => value.calibration === undefined);
  await fixture({ knee: 170 });
  await waitDom(value => /即時動作同步中/.test(value.status ?? ''));
  await capture('production-ready');
  check('Production camera uses the automatic comfortable calibration and standing reference');
  for (let round = 1; round <= 5; round++) {
    await fixture({ knee: 150 });
    await waitDom(value => value.state === 'GRABBED');
    await fixture({ knee: 170 });
    const value = await waitDom(value => value.score === `分數：${round}`);
    report.rounds.push({ production: true, round, ...value });
    if (round < 5) await waitDom(value => value.state === 'READY');
  }
  const completed = await waitDom(value => value.state === 'COMPLETE' && /5\s*\/\s*5/.test(value.progress ?? ''));
  await capture('production-complete');
  const inferences = await page.evaluate(() => window.__carrotGameStats.inferences);
  await fixture({ knee: 150 });
  await page.waitForTimeout(1000);
  assert.equal((await waitDom(() => true)).score, '分數：5');
  assert.equal(await page.evaluate(() => window.__carrotGameStats.inferences), inferences);
  assert.equal(await page.evaluate(() => window.__carrotGameStats.streams), 1);
  assert.equal(await page.evaluate(() => window.__carrotGameStats.models), 1);
  assert.equal(report.requests.filter(url => /rabbit_realtime_v3\.glb/.test(url)).length, 1);
  assert.equal(report.requests.filter(url => /carrot_realtime\.glb/.test(url)).length, 1);
  check('Built production player completes five calibrated camera rounds and stops at 5/5 with one stream and one model load', completed);
  await page.locator('[data-action=home]').click();
  await page.locator('[data-action=start]').waitFor();
  assert.equal(await page.evaluate(() => window.__carrotGameStream.getTracks().every(track => track.readyState === 'ended')), true);
  assert.equal(await page.evaluate(() => window.__carrotGameStats.closed), 1);
  check('Production home ends camera tracks and closes the single inference model');
  await page.locator('[data-action=start]').click();
  await page.locator('[data-action=carrot]').click();
  await page.locator('[data-input-action=keyboard]').click();
  await waitDom(value => value.renderMode === 'sprite');
  assert.equal(await page.locator('.rabbit-tools,[data-carrot-grab-action]').count(), 0);
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(1250);
  await page.keyboard.up('ArrowDown');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1000);
  await page.keyboard.up('ArrowUp');
  await waitDom(value => value.score === '分數：1');
  check('Production keyboard keeps the Sprite game even when simulation and debug queries are present');
  assert.deepEqual(report.errors, []);
  check('Production page and console errors remain clear');

  const failCarrot = route => {
    expectedFailureUrls.add(route.request().url());
    return route.abort('failed');
  };
  await page.route('**/assets/carrot3d/carrot_realtime.glb', failCarrot);
  await enter('?rabbit3dDebug=1&mocapDebug=1&carrotGrabDebug=1&carrotGameDebug=1&carrotGameSim=1');
  await installFixture(true);
  await page.locator('[data-input-action=camera]').click();
  await page.locator('.rabbit-render-mode').filter({ hasText: '暫時未能顯示立體阿兔' }).waitFor({ state: 'visible' });
  await waitDom(value => value.renderMode === 'sprite');
  assert.equal(await page.locator('.rabbit-tools,[data-carrot-grab-action]').count(), 0);
  await capture('production-fallback');
  await page.locator('[data-input-action=change-mode]').click();
  await page.locator('[data-input-action=keyboard]').click();
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(1250);
  await page.keyboard.up('ArrowDown');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1000);
  await page.keyboard.up('ArrowUp');
  await waitDom(value => value.score === '分數：1');
  await page.unroute('**/assets/carrot3d/carrot_realtime.glb', failCarrot);
  check('Production model failure shows a visible Hong Kong Chinese fallback notice and the Sprite game remains playable');
  assert.deepEqual(report.errors, []);
}

async function developmentLifecycle() {
  await page.evaluate(async () => {
    const scene = (await import('/src/main.ts')).game.scene.getScene('CarrotPull');
    window.__retiredCarrotPreview = scene.rabbit3d;
  });
  await page.locator('[data-action=again]').click();
  await page.locator('[data-input-action=keyboard]').click();
  await waitSnapshot(value => value.rabbit3d.mode === 'sprite' && value.score === 0);
  assert.equal(await page.evaluate(() => window.__carrotGameStream.getTracks().every(track => track.readyState === 'ended')), true);
  assert.equal(await page.evaluate(() => window.__carrotGameStats.closed), 1);
  const retired = await page.evaluate(() => {
    const preview = window.__retiredCarrotPreview;
    return { destroyed: preview.destroyed, textureExists: preview.snapshot().textureExists };
  });
  assert.equal(retired.destroyed, true);
  assert.equal(retired.textureExists, false);
  check('Restart clears completed 3D resources, ends camera input and begins a fresh keyboard Sprite round', retired);
  await page.locator('[data-action=pause]').click();
  await page.locator('[data-action=home]').click();
  await page.locator('[data-action=start]').waitFor();
  assert.equal(await page.locator('.rabbit-tools,.carrot-game-debug').count(), 0);

  await enter('?carrotGameDebug=1&carrotGameSim=1');
  await page.locator('[data-input-action=keyboard]').click();
  await waitSnapshot(value => value.rabbit3d.renderMode === '3d-game' && value.rabbit3d.gameplayReady);
  assert.equal(await page.getByRole('slider').count(), 0);
  await page.keyboard.down('ArrowDown');
  await waitSnapshot(value => value.state === 'GRABBED' && value.rabbit3d.gameplay.phase === 'ATTACHED');
  await page.keyboard.up('ArrowDown');
  await page.keyboard.down('ArrowUp');
  await waitSnapshot(value => value.state === 'SUCCESS' && value.rabbit3d.gameplay.phase === 'TRANSFERRING');
  await page.keyboard.up('ArrowUp');
  await page.evaluate(async () => {
    const preview = (await import('/src/main.ts')).game.scene.getScene('CarrotPull').rabbit3d;
    window.__failedCarrotCoordinator = preview.coordinator;
    preview.overlay.renderer.forceContextLoss();
  });
  let value = await waitSnapshot(value => value.rabbit3d.mode === 'sprite' && value.rabbit3d.status.includes('WebGL context lost'));
  assert.equal(value.rabbit3d.spriteVisible, true);
  assert.equal(value.rabbit3d.textureExists, false);
  await waitSnapshot(value => value.score === 1);
  await page.waitForTimeout(1200);
  assert.equal((await snapshot()).score, 1);
  assert.equal(await page.evaluate(() => window.__failedCarrotCoordinator.snapshot().disposed), true);
  check('A real WebGL failure during transfer returns to Sprite and the cancelled 3D callback cannot award a second score');
  await page.locator('[data-action=pause]').click();
  await page.locator('[data-action=home]').click();
  await page.locator('[data-action=start]').waitFor();

  const failureRequests = [];
  const failCarrot = route => {
    failureRequests.push(route.request().url());
    expectedFailureUrls.add(route.request().url());
    return route.abort('failed');
  };
  await page.route('**/assets/carrot3d/carrot_realtime.glb', failCarrot);
  await enter('?carrotGameDebug=1&carrotGameSim=1');
  await page.locator('[data-input-action=keyboard]').click();
  value = await waitSnapshot(value => value.rabbit3d.mode === 'sprite' && value.rabbit3d.status.startsWith('fallback:'));
  assert.equal(value.rabbit3d.spriteVisible, true);
  assert.equal(value.rabbit3d.textureExists, false);
  assert.equal(await page.locator('.carrot-game-debug').count(), 0);
  assert.equal(failureRequests.length, 1);
  await page.waitForTimeout(700);
  assert.equal((await snapshot()).rabbit3d.mode, 'sprite');
  await page.unroute('**/assets/carrot3d/carrot_realtime.glb', failCarrot);
  check('Failed Carrot GLB loading disposes partial resources and retains the playable Sprite fallback');
  await page.locator('[data-action=pause]').click();
  await page.locator('[data-action=home]').click();
  await page.locator('[data-action=start]').waitFor();

  const delayCarrot = async route => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    await route.continue().catch(() => {});
  };
  await page.route('**/assets/carrot3d/carrot_realtime.glb', delayCarrot);
  await enter('?carrotGameDebug=1&carrotGameSim=1');
  const pending = page.waitForRequest('**/assets/carrot3d/carrot_realtime.glb');
  await page.locator('[data-input-action=keyboard]').click();
  await pending;
  await page.locator('[data-action=pause]').click();
  await page.locator('[data-action=home]').click();
  await page.locator('[data-action=start]').waitFor();
  await page.waitForTimeout(1700);
  const remaining = await page.evaluate(async () => ({
    textures: (await import('/src/main.ts')).game.textures.getTextureKeys().filter(key => key.startsWith('rabbit-three-')),
    controls: document.querySelectorAll('.carrot-game-debug,.rabbit-tools').length,
    canvases: document.querySelectorAll('#phaser-stage canvas').length,
  }));
  assert.deepEqual(remaining, { textures: [], controls: 0, canvases: 1 });
  await page.unroute('**/assets/carrot3d/carrot_realtime.glb', delayCarrot);
  check('Home during pending Carrot loading rejects late work and leaves no texture, duplicate canvas or game controls', remaining);
}

async function maximumScaleLayout() {
  await enter('?carrotGameSim=1');
  await page.evaluate(async () => {
    const { DEFAULT_GAME_SETTINGS, saveGameSettings } = await import('/src/game/settings/gameSettings.ts');
    saveGameSettings({ ...DEFAULT_GAME_SETTINGS, rabbitScale: 1.5 });
  });
  await page.reload();
  await page.locator('[data-action=start]').click();
  await page.locator('[data-action=carrot]').click();
  await page.locator('[data-input-action=keyboard]').click();
  await waitSnapshot(value => value.rabbit3d.renderMode === '3d-game');
  report.layoutCases = [];
  for (const viewport of [{ width: 1512, height: 982 }, { width: 600, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(200);
    const result = await page.evaluate(async () => {
      const scene = (await import('/src/main.ts')).game.scene.getScene('CarrotPull');
      const overlay = scene.rabbit3d.overlay;
      const stage = document.querySelector('#phaser-stage canvas').getBoundingClientRect();
      const rect = element => {
        const value = element.getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom };
      };
      const instruction = rect(document.querySelector('.instruction'));
      const point = overlay.rabbit.pivot.position.clone();
      const meshes = [];
      overlay.scene.updateMatrixWorld(true);
      overlay.rabbit.model.traverse(mesh => {
        if (!mesh.isMesh || !/^Rabbit_(Ear|Head)/.test(mesh.name)) return;
        let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
        const positions = mesh.geometry.getAttribute('position');
        for (let index = 0; index < positions.count; index++) {
          mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld);
          const x = stage.left + (894 + point.x * overlay.rabbit.pixelsPerUnit) * stage.width / 1600;
          const y = stage.top + (681 - point.y * overlay.rabbit.pixelsPerUnit) * stage.height / 900;
          left = Math.min(left, x); right = Math.max(right, x);
          top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
        meshes.push({ name: mesh.name, left, right, top, bottom });
      });
      return { instruction, meshes, score: rect(document.querySelector('.score-panel')),
        pause: rect(document.querySelector('[data-action=pause]')),
        headingFits: document.querySelector('#prompt').scrollWidth <= document.querySelector('#prompt').clientWidth,
        stepsVisible: getComputedStyle(document.querySelector('.steps')).display !== 'none' };
    });
    const overlaps = (left, right) => left.left < right.right && left.right > right.left
      && left.top < right.bottom && left.bottom > right.top;
    assert.ok(result.meshes.length >= 3);
    for (const mesh of result.meshes) assert.equal(overlaps(mesh, result.instruction), false, mesh.name);
    assert.equal(overlaps(result.score, result.instruction), false, 'Score and instructions');
    assert.equal(overlaps(result.pause, result.instruction), false, 'Pause and instructions');
    assert.equal(result.headingFits, true);
    assert.equal(result.stepsVisible, false);
    report.layoutCases.push({ viewport, ...result });
    await capture(`layout-scale1.5-${viewport.width}`);
  }
  await page.evaluate(async () => (await import('/src/game/settings/gameSettings.ts')).resetGameSettings());
  await page.locator('[data-action=pause]').click();
  await page.locator('[data-action=home]').click();
  check('Maximum rabbit scale keeps ears, head, score, pause and instructions clear at desktop and narrow viewports', report.layoutCases);
}

try {
  if (process.env.QA_LAYOUT_ONLY === '1') {
    report.input = 'Explicit development keyboard simulation for the supported maximum rabbit-scale layout';
    await maximumScaleLayout();
  } else if (production) {
    await productionGame();
  } else {
    await enter();
    await installFixture();
    await page.locator('[data-input-action=camera]').click();
    await waitSnapshot(value => value.rabbit3d.renderMode === '3d-game' && value.rabbit3d.status === 'ready');
    assert.match(await page.title(), /動態花園/);
    assert.equal(await page.locator('vite-error-overlay').count(), 0);
    assert.equal(await page.locator('[data-carrot-grab-action],[data-carrot-grab-toggle]').count(), 0);
    check('Camera input selects the complete 3D game with ordinary player controls');
    await page.waitForTimeout(3400);
    let value = await snapshot();
    assert.equal(value.score, 0);
    assert.equal(value.progress, 0);
    assert.equal(value.input.requestPause, false);
    assert.equal(await page.locator('dialog[open]').count(), 0);
    await capture('waiting-for-person');
    check('Empty camera waits without progress or a blocking rest dialog');
    let profile = await calibrate();
    value = await waitSnapshot(item => item.state === 'READY');
    report.calibration = profile;
    await capture('01-ready');
    await page.locator('.carrot-game-debug').evaluate(details => { details.open = false; });
    check('Existing personal comfortable calibration and standing reference enable READY', profile);

    const planted = await visualFacts();
    assert.equal((await snapshot()).rabbit3d.environment?.soilFrontVisible, true);
    assert.equal(planted.localClipping, true);
    assert.ok(planted.materials.some(material => material.planes.length > 0));
    assert.equal(planted.orangeBelowSoil, 0);
    report.plantedVisual = planted;
    check('Actual carrot materials clip planted roots below the raised soil surface', planted);
    report.resources.push(await resourceSnapshot());
    assert.equal(report.resources[0].carrotModels, 1);
    assert.equal(report.resources[0].spriteCarrotVisible, false);
    assert.equal(report.resources[0].spriteRabbitVisible, false);

    const rest = await snapshot();
    await fixture({ left: 55, right: 25, lean: 6, shift: .02 });
    await page.waitForTimeout(800);
    value = await snapshot();
    assert.equal(value.state, 'READY');
    assert.notDeepEqual(value.rabbit3d.quaternions['upper_arm.L'], rest.rabbit3d.quaternions['upper_arm.L']);
    assert.notDeepEqual(value.rabbit3d.quaternions.body, rest.rabbit3d.quaternions.body);
    assert.equal(value.score, 0);
    await fixture({ left: 0, right: 0, lean: 0, shift: 0, knee: 160 });
    await page.waitForTimeout(900);
    assert.equal((await snapshot()).state, 'READY');
    await fixture({ knee: 170 });
    await page.waitForTimeout(500);
    check('Continuous arm and torso motion remain live while standing and subthreshold bend does not grab');
    await measurePerformance();
    await page.setViewportSize({ width: 600, height: 800 });
    await page.waitForTimeout(350);
    assert.equal(await page.locator('vite-error-overlay').count(), 0);
    assert.equal((await snapshot()).rabbit3d.renderMode, '3d-game');
    await capture('responsive-600');
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.waitForTimeout(350);
    check('Responsive FIT layout preserves the 3D game and player controls at 600 by 800');

    await fixture({ knee: 150 });
    await waitSnapshot(item => item.state === 'BENDING' && item.progress > .12 && item.progress < .6);
    await fixture({ knee: 170 });
    value = await waitSnapshot(item => item.state === 'READY');
    assert.equal(value.rabbit3d.gameplay.phase, 'PLANTED');
    assert.equal(value.score, 0);
    check('Standing before the existing bend hold completes cancels the attempt and preserves the planted carrot');

    await fixture({ knee: 150 });
    await waitSnapshot(item => item.state === 'BENDING' && item.progress > .1);
    await capture('02-bending');
    await lossAndRecovery('bend hold');
    await waitSnapshot(item => item.state === 'GRABBED' && item.rabbit3d.gameplay.phase === 'REACHING');
    await pauseAndResume('assisted reach');
    value = await waitSnapshot(item => item.state === 'GRABBED' && item.rabbit3d.gameplay.phase === 'ATTACHED');
    assert.ok(value.rabbit3d.gameplay.attachmentError < .01);
    assert.equal(value.rabbit3d.gameplay.attachment.distanceBypassAllowed, false);
    assert.equal(value.rabbit3d.gameplay.attachment.distanceLimitEnabled, true);
    report.firstGrab = value.rabbit3d.gameplay;
    assert.ok(report.firstGrab.maximumAttachStep < .06, 'Attachment grip remains continuous at the scene clock');
    report.assistedGrabActiveSeconds = report.firstGrab.reachElapsed + report.firstGrab.attachment.transitionElapsed;
    await capture('03-grabbed');
    check('Comfortable calibrated bend automatically reaches and attaches through bounded existing IK without placement or grab buttons', report.firstGrab);

    await fixture({ knee: 162, right: 35, lean: 4, shift: -.015 });
    value = await waitSnapshot(item => item.rabbit3d.gameplay.pullProgress > .1 && item.rabbit3d.gameplay.pullProgress < .9);
    const partialPull = value.rabbit3d.gameplay;
    assert.ok(partialPull.extractionHeight > 0);
    assert.equal(value.score, 0);
    await capture('partial-pull');
    await fixture({ knee: 150 });
    await page.waitForTimeout(500);
    value = await snapshot();
    assert.equal(value.state, 'GRABBED');
    assert.ok(value.rabbit3d.gameplay.pullProgress >= partialPull.pullProgress - .01);
    assert.ok(value.rabbit3d.gameplay.attachmentError < .01);
    check('Continuous comfortable return exposes the root while a renewed bend retains the same carrot and previous extraction',
      { partialPull, afterRebend: value.rabbit3d.gameplay });

    await fixture({ knee: 170, right: 0, lean: 0, shift: 0 });
    await waitSnapshot(item => item.state === 'RETURNING' && item.progress > .1 && item.progress < .65);
    await capture('04-returning');
    await fixture({ knee: 150 });
    value = await waitSnapshot(item => item.state === 'GRABBED');
    assert.equal(value.score, 0);
    assert.equal(value.rabbit3d.gameplay.attachment.state, 'ATTACHED');
    check('Renewed bending during RETURNING returns to GRABBED without duplicate attachment or score');
    await fixture({ knee: 170 });
    await waitSnapshot(item => item.state === 'RETURNING' && item.progress > .1 && item.progress < .65);
    await lossAndRecovery('return hold and pull progress');
    value = await waitSnapshot(item => item.state === 'SUCCESS');
    await page.locator('#prompt').evaluate(async element => {
      await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
    });
    await capture('05-success');
    const extracted = await visualFacts();
    report.extractedVisual = extracted;
    assert.ok(extracted.orangePixels > planted.orangePixels);
    check('Stable standing reaches SUCCESS and reveals more actual 3D root before scoring',
      { plantedOrangePixels: planted.orangePixels, extractedOrangePixels: extracted.orangePixels });
    await waitSnapshot(item => item.rabbit3d.gameplay.phase === 'TRANSFERRING');
    await capture('06-basket-transfer');
    await pauseAndResume('basket transfer');
    await lossAndRecovery('basket transfer and scoring callback');
    await waitSnapshot(item => item.rabbit3d.gameplay.phase === 'TRANSFERRING'
      && item.rabbit3d.gameplay.transferProgress > .65);
    await capture('06-basket-arrival');
    value = await waitSnapshot(item => item.score === 1);
    await capture('06-basket-harvested');
    report.rounds.push({ round: 1, state: value.state, score: value.score, gameplay: value.rabbit3d.gameplay });
    await waitSnapshot(item => item.state === 'READY');
    assert.deepEqual(await calibrationProfile(), profile);
    report.resources.push(await resourceSnapshot());
    check('First basket arrival calls the original celebration scoring path once and preserves calibration');
    await page.locator('[data-input-action=recalibrate]').click();
    profile = await calibrate();
    value = await snapshot();
    assert.equal(value.score, 1);
    assert.equal(value.state, 'READY');
    assert.equal(value.rabbit3d.gameplay.phase, 'PLANTED');
    assert.equal(await page.evaluate(() => window.__carrotGameStats.models), 1);
    assert.equal(await page.evaluate(() => window.__carrotGameStats.streams), 1);
    report.recalibration = profile;
    check('Explicit recalibration preserves score and reuses the existing camera, model and 3D resources');

    for (let round = 2; round <= 5; round++) {
      if (round === 2) await beginRoundCapture(round);
      await fixture({ knee: 150, left: 15, right: 25, lean: round % 2 ? -4 : 4, shift: round % 2 ? .01 : -.01 });
      await waitSnapshot(item => item.state === 'GRABBED' && item.rabbit3d.gameplay.phase === 'ATTACHED');
      const grab = (await snapshot()).rabbit3d.gameplay;
      assert.ok(grab.attachmentError < .01);
      await fixture({ knee: 162 });
      await page.waitForTimeout(250);
      await fixture({ knee: 170 });
      if (round === 3) {
        await waitSnapshot(item => item.state === 'RETURNING' && item.progress > .1 && item.progress < .7);
        await pauseAndResume('continuous pull');
      }
      value = await waitSnapshot(item => item.score === round);
      report.rounds.push({ round, state: value.state, score: value.score, grab, gameplay: value.rabbit3d.gameplay });
      if (round < 5) {
        await waitSnapshot(item => item.state === 'READY');
        assert.deepEqual(await calibrationProfile(), profile);
        const resources = await resourceSnapshot();
        report.resources.push(resources);
        assert.equal(resources.carrotModels, 1);
        assert.equal(resources.textures.length, 1);
        assert.equal(resources.stats.models, 1);
        assert.equal(resources.stats.streams, 1);
      }
      if (round === 2) {
        await page.waitForTimeout(850);
        await saveRoundCapture();
      }
    }
    value = await waitSnapshot(item => item.state === 'COMPLETE' && item.score === 5);
    assert.match(await page.locator('#progress-label').innerText(), /5\s*\/\s*5/);
    await capture('07-complete');
    const completeFrames = value.rabbit3d.renderedFrames;
    await fixture({ knee: 150 });
    await page.waitForTimeout(1200);
    assert.equal((await snapshot()).score, 5);
    assert.equal((await snapshot()).state, 'COMPLETE');
    assert.equal((await snapshot()).rabbit3d.gameplay.phase, 'COMPLETE');
    const stats = await page.evaluate(() => ({ ...window.__carrotGameStats, timestamps: undefined }));
    assert.equal(stats.models, 1);
    assert.equal(stats.streams, 1);
    const rabbitLoads = report.requests.filter(url => /rabbit_realtime_v3\.glb/.test(url));
    const carrotLoads = report.requests.filter(url => /carrot_realtime\.glb/.test(url));
    assert.equal(rabbitLoads.length, 1);
    assert.equal(carrotLoads.length, 1);
    report.complete = { state: value.state, score: value.score, stats, rabbitLoads, carrotLoads, completeFrames };
    check('Five camera-driven rounds finish at 5/5 with no sixth carrot, one stream and one load per GLB', report.complete);
    await developmentLifecycle();
    assert.deepEqual(report.errors, []);
    check('Console health after deliberate asset and WebGL failure checks');
    await maximumScaleLayout();
  }
  assert.deepEqual(report.errors, []);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = String(error);
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/browser-report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length,
    failure: report.failure, performance: report.performance, errors: report.errors,
    report: `${output}/browser-report.json` }, null, 2));
}
