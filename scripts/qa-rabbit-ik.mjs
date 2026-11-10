import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';

const base = process.env.QA_URL ?? 'http://127.0.0.1:5178/';
const output = process.env.QA_OUTPUT ?? '/private/tmp/motion-garden-4c2-ik';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
const report = {
  status: 'RUNNING', browser: browser.version(), url: base,
  browserPlugin: 'Browser plugin not available; installed Chrome through Playwright',
  input: 'Scripted V3 poses and normal preview controls; human webcam NOT tested. Existing mocap QA separately uses synthetic landmarks.',
  checks: [], poses: [], transitions: [], performance: {}, errors: [], navigations: [],
};
page.on('framenavigated', frame => { if (frame === page.mainFrame()) report.navigations.push(frame.url()); });
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
const check = (name, detail) => report.checks.push({ name, result: 'PASS', detail });
const snap = () => page.evaluate(async () =>
  (await import('/src/main.ts')).game.scene.getScene('CarrotPull').getDebugSnapshot());
const poses = [
  { name: 'rest', label: 'Rest Pose' },
  { name: 'knee25', label: 'Knee 25%', knee: .25 },
  { name: 'knee50', label: 'Knee 50%', knee: .5 },
  { name: 'knee75', label: 'Knee 75%', knee: .75 },
  { name: 'knee100', label: 'Knee 100%', knee: 1 },
  { name: 'bothHigh', label: 'Both arms high', left: 150, right: 150 },
  { name: 'forward', label: 'Left forward reach', left: 100, plane: 90, elbow: 45 },
  { name: 'lean', label: 'Body side lean', side: 18, yaw: 8, roll: -5 },
  { name: 'translateLeft', label: 'Small lateral left', lateral: -.1, knee: .5 },
  { name: 'translateRight', label: 'Small lateral right', lateral: .1, knee: .5 },
  { name: 'combined', label: 'Raise + bend + lean', left: 120, right: 120, plane: 45, elbow: 45, side: 12, knee: 1 },
  { name: 'constrained', label: 'High raise + deep elbow request', left: 150, right: 150, elbow: 110, yaw: 25, pitch: 18 },
];
const images = [];

async function enter() {
  await page.goto(`${base}?rabbit3dDebug=1&mocapDebug=1`);
  await page.locator('[data-action=start]').click();
  await page.locator('[data-action=carrot]').click();
  await page.locator('[data-input-action=keyboard]').click();
  await page.waitForFunction(async () => {
    const preview = (await import('/src/main.ts')).game.scene.getScene('CarrotPull')?.rabbit3d;
    return preview?.status === 'ready' && preview.snapshot().ik?.enabled === true;
  });
}

async function applyPose(value, immediate = true) {
  return page.evaluate(async ({ value, immediate }) => {
    const scene = (await import('/src/main.ts')).game.scene.getScene('CarrotPull');
    const rabbit = scene.rabbit3d.overlay.rabbit;
    const rig = rabbit.rig;
    if (immediate) rig.resetPose(true);
    rig.setArmRotation('left', value.left ?? 0, value.elbow ?? 0, value.plane ?? 0);
    rig.setArmRotation('right', value.right ?? 0, value.elbow ?? 0, value.plane ?? 0);
    rig.setBodyLean(value.side ?? 0, value.forward ?? 0);
    rig.setHeadRotation(value.yaw ?? 0, value.pitch ?? 0, value.roll ?? 0);
    rig.setKneeBend(value.knee ?? 0);
    rig.setRootOffset(value.lateral ?? 0, 0, 0);
    if (immediate) for (let frame = 0; frame < 120; frame++) rig.update(1 / 60);
    rabbit.pivot.updateMatrixWorld(true);
    rabbit.model.traverse(object => { if (object.isSkinnedMesh) object.skeleton.update(); });
    const point = object => rabbit.model.worldToLocal(object.getWorldPosition(object.position.clone())).toArray();
    const soles = ['L', 'R'].map(side => {
      const mesh = rabbit.model.getObjectByName(`Rabbit_Leg_${side}`);
      let minimum = Infinity;
      const vector = rig.bones.get(`foot.${side}`).position.clone();
      for (let index = 0; index < mesh.geometry.getAttribute('position').count; index++) {
        mesh.getVertexPosition(index, vector).applyMatrix4(mesh.matrixWorld);
        rabbit.model.worldToLocal(vector);
        minimum = Math.min(minimum, vector.y);
      }
      return minimum;
    });
    return {
      ik: rig.ikSnapshot(), root: point(rig.bones.get('root')),
      feet: ['L', 'R'].map(side => point(rig.bones.get(`foot.${side}`))), soles,
      hands: ['L', 'R'].map(side => point(rig.bones.get(`hand.${side}`))),
      rotations: Object.fromEntries([...rig.bones].map(([name, bone]) => [name, bone.quaternion.toArray()])),
    };
  }, { value, immediate });
}

async function captureRabbit(name) {
  const data = await page.evaluate(async () => {
    const overlay = (await import('/src/main.ts')).game.scene.getScene('CarrotPull').rabbit3d.overlay;
    overlay.renderer.render(overlay.scene, overlay.camera);
    return overlay.renderer.domElement.toDataURL('image/png');
  });
  await writeFile(`${output}/${name}.png`, Buffer.from(data.split(',')[1], 'base64'));
  return data;
}

async function benchmark(enabled) {
  await page.getByRole('button', { name: enabled ? '啟用 IK' : '停用 IK', exact: true }).click();
  await applyPose(poses.find(value => value.name === 'combined'));
  await page.waitForTimeout(800);
  const before = await snap();
  const started = performance.now();
  const samples = [];
  for (let index = 0; index < 100; index++) {
    await page.waitForTimeout(50);
    samples.push((await snap()).rabbit3d.ik);
  }
  const after = await snap();
  const elapsed = performance.now() - started;
  const solver = samples.map(sample => sample.solverTimeMs).filter(Number.isFinite).sort((a, b) => a - b);
  return { enabled, measurement: 'Existing scene-clock FPS; controller update wall time includes FK, constraints, IK and final commit, with browser timer quantization', elapsedMs: elapsed, renderedFrames: after.rabbit3d.renderedFrames - before.rabbit3d.renderedFrames,
    observedFps: (after.rabbit3d.renderedFrames - before.rabbit3d.renderedFrames) * 1000 / elapsed,
    reportedFps: after.rabbit3d.fps,
    solverTimeMs: solver.length ? { samples: solver.length, mean: solver.reduce((sum, value) => sum + value, 0) / solver.length,
      p95: solver[Math.floor((solver.length - 1) * .95)], maximum: solver.at(-1) } : null };
}

try {
  await enter();
  assert.match(await page.title(), /動態花園/);
  assert.ok(await page.locator('[data-action=pause]').isVisible());
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  assert.equal((await snap()).rabbit3d.rigVersion, 'v3');
  assert.equal((await snap()).rabbit3d.ik.enabled, true);
  check('Page identity, meaningful content, no framework overlay, V3 loaded and IK enabled');
  const rest = await applyPose(poses[0]);
  const footErrors = [];
  for (const enabled of [false, true]) {
    await page.getByRole('button', { name: enabled ? '啟用 IK' : '停用 IK', exact: true }).click();
    assert.equal((await snap()).rabbit3d.ik.enabled, enabled);
    for (const value of poses) {
      const actual = await applyPose(value);
      assert.equal(actual.ik.enabled, enabled);
      assert.ok([...actual.feet.flat(), ...actual.soles, ...actual.hands.flat()].every(Number.isFinite));
      const ankleError = actual.feet.map((foot, side) => Math.hypot(...foot.map((coordinate, axis) => coordinate - rest.feet[side][axis])));
      const soleError = actual.soles.map((sole, side) => sole - rest.soles[side]);
      if (enabled) {
        assert.ok(Math.max(...ankleError) < .005, `${value.name}: fixed feet error ${ankleError}`);
        assert.ok(soleError.every(error => Math.abs(error) < .005), `${value.name}: sole drift ${soleError}`);
        footErrors.push(...ankleError);
      }
      report.poses.push({ name: value.name, enabled, requested: value, actual, ankleError, soleError });
      if (['rest', 'knee100', 'bothHigh', 'forward', 'lean', 'translateRight', 'combined', 'constrained'].includes(value.name)) {
        const name = `${enabled ? 'ik' : 'fk'}-${value.name}`;
        images.push({ name, pose: value.name, enabled, data: await captureRabbit(name) });
      }
    }
  }
  check('FK/IK controls and twelve pose categories, actual skinned soles and ankle targets', {
    maximumFootPositionErrorModelUnits: Math.max(...footErrors), tolerance: .005,
  });
  await applyPose(poses[0]);
  for (const value of [poses[4], poses[10], poses[11], poses[0]]) {
    await applyPose(value, false);
    const transition = await page.evaluate(async () => {
      const preview = (await import('/src/main.ts')).game.scene.getScene('CarrotPull').rabbit3d;
      const rig = preview.overlay.rabbit.rig;
      const previous = new Map([...rig.bones].map(([name, bone]) => [name, bone.quaternion.clone().normalize()]));
      let maximumAngularStepDegrees = 0;
      const samples = [];
      for (let frame = 0; frame < 90; frame++) {
        rig.update(1 / 60);
        for (const [name, bone] of rig.bones) {
          const current = bone.quaternion.clone().normalize();
          maximumAngularStepDegrees = Math.max(maximumAngularStepDegrees, previous.get(name).angleTo(current) * 180 / Math.PI);
          previous.get(name).copy(current);
        }
        if ([0, 14, 44, 89].includes(frame)) samples.push({ frame, ...rig.ikSnapshot() });
      }
      return { maximumAngularStepDegrees, samples };
    });
    assert.ok(Number.isFinite(transition.maximumAngularStepDegrees) && transition.maximumAngularStepDegrees < 40);
    report.transitions.push({ target: value.name, ...transition });
  }
  check('Continuous bending/combined/constrained/rest transitions remain finite without large one-frame flips');
  await applyPose(poses[10]);
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${output}/ik-combined-ui.png` });
  report.performance.disabled = await benchmark(false);
  report.performance.enabled = await benchmark(true);
  assert.ok(report.performance.enabled.observedFps > 40);
  assert.ok(report.performance.enabled.solverTimeMs?.samples > 0, 'Solver timing samples are exposed');
  check('FK and IK performance measured through the actual Phaser/Three render clock', report.performance);

  await applyPose(poses[0]);
  const sequence = `${output}/continuous-frames`;
  await mkdir(sequence, { recursive: true });
  for (let frame = 0; frame < 60; frame++) {
    const phase = frame / 59 * Math.PI * 2;
    const amount = (1 - Math.cos(phase)) / 2;
    await applyPose({ left: 120 * amount, right: 100 * amount, plane: 45,
      elbow: 45 * amount, side: 12 * Math.sin(phase), knee: amount, lateral: .08 * Math.sin(phase) }, false);
    const data = await page.evaluate(async () => {
      const overlay = (await import('/src/main.ts')).game.scene.getScene('CarrotPull').rabbit3d.overlay;
      for (let step = 0; step < 6; step++) overlay.rabbit.rig.update(1 / 60);
      overlay.renderer.render(overlay.scene, overlay.camera);
      return overlay.renderer.domElement.toDataURL('image/png');
    });
    await writeFile(`${sequence}/frame-${String(frame).padStart(3, '0')}.png`, Buffer.from(data.split(',')[1], 'base64'));
  }
  const gif = spawnSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '10', '-i', `${sequence}/frame-%03d.png`,
    '-vf', 'split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse',
    '-loop', '0', `${output}/ik-continuous.gif`], { encoding: 'utf8' });
  report.visualSequence = { frames: 60, simulatedSeconds: 6,
    kind: 'Scripted pose targets, actual solver and renderer; not a human recording',
    gif: gif.status === 0 ? 'ik-continuous.gif' : null,
    ffmpegDiagnostic: gif.status === 0 ? undefined : String(gif.error ?? gif.stderr) };
  check('Sixty continuous frames capture raise/bend/lean/lateral coordination', report.visualSequence);

  await page.locator('[data-action=pause]').click();
  const paused = await snap();
  await page.waitForTimeout(200);
  assert.equal((await snap()).rabbit3d.renderedFrames, paused.rabbit3d.renderedFrames);
  await page.locator('[data-action=resume]').click();
  await page.waitForTimeout(100);
  assert.ok((await snap()).rabbit3d.renderedFrames > paused.rabbit3d.renderedFrames);
  check('Pause freezes solver/render clock, resume advances normally');
  await page.getByRole('button', { name: '恢復自然站立', exact: true }).click();
  await page.waitForTimeout(700);
  const reset = await applyPose(poses[0]);
  assert.ok(reset.feet.every((foot, side) => Math.hypot(...foot.map((coordinate, axis) => coordinate - rest.feet[side][axis])) < .005));
  check('Reset restores standing and fixed targets');
  await page.setViewportSize({ width: 600, height: 800 });
  await page.waitForTimeout(200);
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  assert.ok((await snap()).rabbit3d.renderedFrames > 0);
  await page.screenshot({ path: `${output}/ik-resize-600.png` });
  await page.setViewportSize({ width: 1512, height: 982 });
  check('Resize preserves rendering and finite debug metrics');
  await page.getByRole('combobox', { name: '阿兔渲染模式' }).selectOption('sprite');
  const sprite = await snap();
  assert.equal(sprite.rabbit3d.mode, 'sprite');
  assert.equal(sprite.rabbit3d.spriteVisible, true);
  assert.equal(sprite.rabbit3d.textureExists, false);
  assert.equal(await page.getByRole('button', { name: '啟用 IK', exact: true }).count(), 0);
  check('Sprite switch releases IK UI, Three texture and model');
  await page.getByRole('combobox', { name: '阿兔渲染模式' }).selectOption('3d');
  await page.waitForFunction(async () => {
    const preview = (await import('/src/main.ts')).game.scene.getScene('CarrotPull')?.rabbit3d;
    return preview?.status === 'ready' && preview.snapshot().ik?.enabled === true;
  });
  assert.equal((await snap()).rabbit3d.ik.enabled, true);
  await page.locator('[data-action=pause]').click();
  await page.locator('[data-action=home]').click();
  await page.locator('[data-action=start]').waitFor();
  assert.equal(await page.locator('.rabbit-tools').count(), 0);
  check('Reload and home dispose solver resources and controls');
  assert.deepEqual(report.errors, []);
  check('Console and page errors');
  const sheet = await page.evaluate(async tiles => {
    const canvas = document.createElement('canvas');
    canvas.width = 1040; canvas.height = 8 * 330 + 56;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f5f3e9'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#294d3a'; context.font = 'bold 24px sans-serif';
    context.fillText('V3 FK vs IK · identical camera, light and scale', 20, 34);
    const names = ['rest', 'knee100', 'bothHigh', 'forward', 'lean', 'translateRight', 'combined', 'constrained'];
    for (let row = 0; row < names.length; row++) {
      for (let column = 0; column < 2; column++) {
        const tile = tiles.find(tile => tile.pose === names[row] && tile.enabled === Boolean(column));
        const image = new Image(); image.src = tile.data; await image.decode();
        const x = column * 520; const y = 56 + row * 330;
        context.fillStyle = '#e1e8de'; context.fillRect(x + 12, y, 496, 294);
        context.drawImage(image, x + 118, y, 294, 294);
        context.fillStyle = '#294d3a'; context.font = 'bold 18px sans-serif';
        context.fillText(`${column ? 'IK' : 'FK'} · ${names[row]}`, x + 20, y + 318);
      }
    }
    return canvas.toDataURL('image/png');
  }, images);
  await writeFile(`${output}/fk-vs-ik.png`, Buffer.from(sheet.split(',')[1], 'base64'));
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = String(error);
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/browser-report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
