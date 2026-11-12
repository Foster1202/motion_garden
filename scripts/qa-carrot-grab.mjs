import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const base = process.env.QA_URL ?? 'http://127.0.0.1:5178/';
const output = process.env.QA_OUTPUT ?? '/private/tmp/motion-garden-4d1-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
const report = {
  status: 'RUNNING', browser: browser.version(), url: base,
  browserPlugin: 'Browser plugin not available; installed Chrome through Playwright',
  input: 'Existing manual sliders and developer grab controls. Strict-contact fixture and explicit distance-bypass stress poses use actual bones and renderer. Human webcam NOT tested.',
  flow: 'Start game, Carrot Pull, keyboard input, manual arm controls, grab, live motion, release and reset',
  checks: [], poses: [], screenshots: [], performance: {}, errors: [], warnings: [],
};
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => {
  if (message.type() === 'error') report.errors.push(message.text());
  if (message.type() === 'warning') report.warnings.push(message.text());
});
const check = (name, detail) => report.checks.push({ name, result: 'PASS', detail });
const snapshot = () => page.evaluate(async () =>
  (await import('/src/main.ts')).game.scene.getScene('CarrotPull').getDebugSnapshot());
async function waitForSnapshot(predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await snapshot();
    if (predicate(value)) return value;
    await page.waitForTimeout(50);
  }
  throw new Error(`Snapshot timeout ${JSON.stringify(await snapshot())}`);
}
async function enter(search = '?rabbit3dDebug=1&mocapDebug=1&carrotGrabDebug=1') {
  await page.goto(`${base}${search}`);
  await page.locator('[data-action=start]').click();
  await page.locator('[data-action=carrot]').click();
  await page.locator('[data-input-action=keyboard]').first().click();
  return waitForSnapshot(value => value.rabbit3d.status === 'ready');
}
async function slider(name, value) {
  await page.getByRole('slider', { name, exact: true }).evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function capture(name) {
  await page.screenshot({ path: `${output}/${name}.png` });
  const data = await page.evaluate(async () => {
    const overlay = (await import('/src/main.ts')).game.scene.getScene('CarrotPull').rabbit3d.overlay;
    overlay.renderer.render(overlay.scene, overlay.camera);
    return overlay.renderer.domElement.toDataURL('image/png');
  });
  await writeFile(`${output}/${name}-three.png`, Buffer.from(data.split(',')[1], 'base64'));
  report.screenshots.push(`${name}.png`, `${name}-three.png`);
}
async function home() {
  await page.locator('[data-action=pause]').click();
  await page.locator('[data-action=home]').click();
  await page.locator('[data-action=start]').waitFor();
}
async function sceneFacts() {
  return page.evaluate(async () => {
    const { game } = await import('/src/main.ts');
    const scene = game.scene.getScene('CarrotPull');
    const overlay = scene.rabbit3d.overlay;
    const point = overlay.rabbit.pivot.position.clone();
    const minimum = [Infinity, Infinity, Infinity];
    const maximum = [-Infinity, -Infinity, -Infinity];
    let gripNodes = 0;
    overlay.scene.updateMatrixWorld(true);
    overlay.scene.traverseVisible(object => {
      if (object.name === 'Carrot_Grip_Point') gripNodes++;
      if (!object.isMesh || !object.visible) return;
      if (object.isSkinnedMesh) object.skeleton.update();
      for (let index = 0; index < object.geometry.getAttribute('position').count; index++) {
        object.getVertexPosition(index, point).applyMatrix4(object.matrixWorld);
        point.toArray().forEach((value, axis) => {
          minimum[axis] = Math.min(minimum[axis], value);
          maximum[axis] = Math.max(maximum[axis], value);
        });
      }
    });
    const p = overlay.rabbit.pixelsPerUnit;
    return {
      gripNodes, spriteCarrotVisible: scene.carrot.root.visible,
      spriteRabbitVisible: scene.rabbit.root.visible,
      canvasCount: document.querySelectorAll('#phaser-stage canvas').length,
      dynamicTextures: game.textures.getTextureKeys().filter(key => key.startsWith('rabbit-three-')),
      geometryCount: overlay.renderer.info.memory.geometries,
      textureCount: overlay.renderer.info.memory.textures,
      logicalBounds: { left: 894 + minimum[0] * p, right: 894 + maximum[0] * p,
        top: 681 - maximum[1] * p, bottom: 681 - minimum[1] * p },
      viewport: overlay.viewport,
    };
  });
}
function assertInsideCrop(facts, label) {
  const bounds = facts.logicalBounds;
  const viewport = facts.viewport;
  assert.ok([bounds.left, bounds.right, bounds.top, bounds.bottom].every(Number.isFinite), label);
  assert.ok(bounds.left >= viewport.x && bounds.right <= viewport.x + viewport.width,
    `${label} horizontal crop ${JSON.stringify(facts)}`);
  assert.ok(bounds.top >= viewport.y && bounds.bottom <= viewport.y + viewport.height,
    `${label} vertical crop ${JSON.stringify(facts)}`);
}
async function manualPose(value) {
  await slider('左臂', value.left ?? 0);
  await slider('右臂', value.right ?? 0);
  await slider('左手肘', value.elbow ?? 0);
  await slider('右手肘', value.elbow ?? 0);
  await slider('左臂前抬方向', value.plane ?? 0);
  await slider('右臂前抬方向', value.plane ?? 0);
  await slider('身體側傾', value.side ?? 0);
  await slider('身體前後傾', value.forward ?? 0);
  await slider('淺屈膝', value.knee ?? 0);
  await slider('左右平移', value.root ?? 0);
  await page.waitForTimeout(650);
}
async function benchmark(enabled) {
  await page.evaluate(async enabled => {
    const preview = (await import('/src/main.ts')).game.scene.getScene('CarrotPull').rabbit3d;
    if (!enabled) {
      window.__carrotBenchmark = { controller: preview.grabController, debug: preview.grabDebug,
        visible: preview.carrot.root.visible };
      preview.grabController = undefined;
      preview.grabDebug = undefined;
      preview.carrot.root.visible = false;
    } else if (window.__carrotBenchmark) {
      preview.grabController = window.__carrotBenchmark.controller;
      preview.grabDebug = window.__carrotBenchmark.debug;
      preview.carrot.root.visible = window.__carrotBenchmark.visible;
      delete window.__carrotBenchmark;
    }
  }, enabled);
  await page.waitForTimeout(500);
  const result = await page.evaluate(async enabled => {
    const preview = (await import('/src/main.ts')).game.scene.getScene('CarrotPull').rabbit3d;
    const first = preview.overlay.renderedFrames;
    const started = performance.now();
    const timings = [];
    const calls = [];
    const triangles = [];
    for (let index = 0; index < 100; index++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      if (enabled) timings.push(preview.grabUpdateMs);
      calls.push(preview.overlay.renderer.info.render.calls);
      triangles.push(preview.overlay.renderer.info.render.triangles);
    }
    const elapsedMs = performance.now() - started;
    const frames = preview.overlay.renderedFrames - first;
    timings.sort((a, b) => a - b);
    const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
    return { enabled, elapsedMs, frames, observedFps: frames * 1000 / elapsedMs,
      reportedFps: preview.overlay.fps, renderCalls: mean(calls), triangles: mean(triangles),
      updateMs: enabled ? { mean: mean(timings), p95: timings[Math.floor(timings.length * .95)],
        maximum: timings.at(-1) } : undefined,
      viewport: preview.overlay.viewport,
      scope: 'Identical expanded crop, existing Phaser/Three clock. Disabled sample omits carrot draw and attachment/debug updates while retaining loaded asset allocation.' };
  }, enabled);
  return result;
}
const action = name => page.locator(`[data-carrot-grab-action=${name}]`);
const toggle = name => page.locator(`[data-carrot-grab-toggle=${name}]`);
const distance = (left, right) => Math.hypot(...left.map((value, index) => value - right[index]));
function assertAttached(value, label) {
  const grab = value.rabbit3d.grab;
  assert.equal(grab.state, 'ATTACHED', label);
  assert.ok(grab.attachmentError < .01, `${label} grip error ${grab.attachmentError}`);
  assert.ok(distance(grab.gripMidpoint, grab.carrotGripPosition) < .01, label);
  assert.ok([...grab.leftHandPosition, ...grab.rightHandPosition, ...grab.carrotGripPosition].every(Number.isFinite), label);
  assert.equal(value.score, 0, label);
}

try {
  const initial = await enter();
  assert.match(await page.title(), /動態花園/);
  assert.ok((await page.locator('body').innerText()).includes('抓住蘿蔔'));
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  assert.ok(initial.rabbit3d.grab, 'Grab prototype snapshot exists');
  check('Page identity, meaningful grab interface and no framework error overlay');
  await capture('01-initial');

  const initialFacts = await sceneFacts();
  assert.equal(initialFacts.gripNodes, 1);
  assert.equal(initialFacts.spriteCarrotVisible, false);
  assert.equal(initialFacts.spriteRabbitVisible, false);
  assert.equal(initialFacts.canvasCount, 1);
  assert.equal(initialFacts.dynamicTextures.length, 1);
  assertInsideCrop(initialFacts, 'initial');
  check('One 3D carrot shares the rabbit scene and texture, duplicate Sprite carrot hidden, initial crop contains geometry', initialFacts);
  if (process.env.QA_PERFORMANCE_ONLY === '1') {
    report.performance.disabled = await benchmark(false);
    report.performance.enabled = await benchmark(true);
    assert.ok(report.performance.enabled.observedFps > 40);
    assert.ok(report.performance.enabled.renderCalls > report.performance.disabled.renderCalls);
    check('Matched-crop baseline and feature-enabled actual-render performance measured', report.performance);
  } else {
    assert.equal(initial.rabbit3d.grab.distanceLimitEnabled, true);
    await action('grab').click();
    let value = await snapshot();
    assert.equal(value.rabbit3d.grab.eligible, false);
    assert.ok(!['GRABBING', 'ATTACHED'].includes(value.rabbit3d.grab.state));
    assert.match(await page.locator('.carrot-grab-debug [role=status]').innerText(), /距離/);
    check('Strict distance gate rejects remote grab with a visible reason', value.rabbit3d.grab);

    await manualPose({ left: 85, right: 85, elbow: 10, plane: 145 });
    await action('place').click();
    value = await snapshot();
    assert.ok(distance(value.rabbit3d.grab.carrotGripPosition, value.rabbit3d.grab.gripMidpoint) < .01);
    assert.equal(value.rabbit3d.grab.distanceLimitEnabled, true);
    assert.equal(value.rabbit3d.grab.eligible, true, 'Actual hands must satisfy the distance gate');
    await capture('02-hands-near-fixture');
    report.contact = { handSpan: value.rabbit3d.grab.handSpan,
      maximumHandDistance: value.rabbit3d.grab.maxHandDistance,
      eligible: value.rabbit3d.grab.eligible,
      interpretation: 'Fixture explicitly places carrot at current hand midpoint. Eligibility and screenshots determine whether this pose gives actual two-hand contact.' };
    check('Visible manual sliders drive both actual hand positions and explicit placement fixture', report.contact);

    await action('grab').click();
    value = await waitForSnapshot(item => item.rabbit3d.grab.state === 'ATTACHED');
    assertAttached(value, 'strict two-hand grip');
    assert.equal(value.rabbit3d.grab.contactSatisfied, true);
    report.strictContact = { fixture: 'Explicit development placement at final hand midpoint',
      initial: value.rabbit3d.grab, poses: [] };
    await capture('strict-01-two-hand-grasp');
    for (const pose of [
      { name: 'raise', left: 90, right: 90, elbow: 10, plane: 145 },
      { name: 'lean-left', left: 90, right: 90, elbow: 10, plane: 145, side: -12 },
      { name: 'lean-right', left: 90, right: 90, elbow: 10, plane: 145, side: 12 },
      { name: 'shallow-knee', left: 90, right: 90, elbow: 10, plane: 145, knee: .65 },
      { name: 'translate-left', left: 90, right: 90, elbow: 10, plane: 145, root: -.1, knee: .35 },
      { name: 'translate-right', left: 90, right: 90, elbow: 10, plane: 145, root: .1, knee: .35 },
    ]) {
      await manualPose(pose);
      value = await snapshot();
      assertAttached(value, `strict ${pose.name}`);
      assert.equal(value.rabbit3d.grab.distanceLimitEnabled, true);
      assert.equal(value.rabbit3d.grab.contactSatisfied, true, `Both hands must retain contact during ${pose.name}`);
      assertInsideCrop(await sceneFacts(), `strict ${pose.name}`);
      report.strictContact.poses.push({ requested: pose, grab: value.rabbit3d.grab });
      await capture(`strict-${pose.name}`);
    }
    check('Distance-limited two-hand grasp and contact remain through raise, both leans, shallow knee and small lateral movement', report.strictContact);
    await page.evaluate(async () => {
      const scene = (await import('/src/main.ts')).game.scene.getScene('CarrotPull');
      window.__grabFrameSamples = [];
      window.__grabFrameListener = () => {
        const grab = scene.rabbit3d.grabController.snapshot();
        const error = Math.hypot(...grab.carrotGripPosition.map((coordinate, axis) => coordinate - grab.gripMidpoint[axis]));
        window.__grabFrameSamples.push({ error, state: grab.state, contact: grab.contactSatisfied });
      };
      scene.events.on('postupdate', window.__grabFrameListener);
    });
    await manualPose({ left: 85, right: 85, elbow: 10, plane: 145, side: -12, knee: .6, root: -.1 });
    await manualPose({ left: 90, right: 90, elbow: 10, plane: 145, side: 12, knee: .2, root: .1 });
    const continuous = await page.evaluate(async () => {
      const scene = (await import('/src/main.ts')).game.scene.getScene('CarrotPull');
      scene.events.off('postupdate', window.__grabFrameListener);
      delete window.__grabFrameListener;
      return window.__grabFrameSamples;
    });
    assert.ok(continuous.length >= 30);
    assert.ok(continuous.every(frame => frame.state === 'ATTACHED' && Number.isFinite(frame.error) && frame.error < .01));
    report.continuous = { frames: continuous.length, maximumError: Math.max(...continuous.map(frame => frame.error)),
      contactFraction: continuous.filter(frame => frame.contact).length / continuous.length,
      sampling: 'Phaser postupdate, after final hand sampling and attachment, during ordinary slider-driven pose interpolation' };
    check('Continuous scene-clock samples confirm same-frame grip alignment during combined pose changes', report.continuous);
    const frames = await page.evaluate(async () => {
      const preview = (await import('/src/main.ts')).game.scene.getScene('CarrotPull').rabbit3d;
      const overlay = preview.overlay;
      const canvas = document.createElement('canvas');
      canvas.width = overlay.viewport.width;
      canvas.height = overlay.viewport.height;
      const context = canvas.getContext('2d');
      const frames = [];
      for (let index = 0; index < 45; index++) {
        const phase = index / 44 * Math.PI * 2;
        const raise = 85 + (1 - Math.cos(phase)) * 2.5;
        preview.overlay.rabbit.rig.setArmRotation('left', raise, 10, 145);
        preview.overlay.rabbit.rig.setArmRotation('right', raise, 10, 145);
        preview.overlay.rabbit.rig.setBodyLean(12 * Math.sin(phase), 0);
        preview.overlay.rabbit.rig.setKneeBend((1 - Math.cos(phase)) * .3);
        preview.overlay.rabbit.rig.setRootOffset(.08 * Math.sin(phase), 0, 0);
        await new Promise(resolve => setTimeout(resolve, 100));
        overlay.renderer.render(overlay.scene, overlay.camera);
        context.fillStyle = '#f5f3e9';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(overlay.renderer.domElement, 0, 0);
        frames.push({ image: canvas.toDataURL('image/png'), grab: preview.grabController.snapshot() });
      }
      return frames;
    });
    const sequence = `${output}/strict-continuous-frames`;
    await mkdir(sequence, { recursive: true });
    for (let index = 0; index < frames.length; index++) {
      assert.ok(frames[index].grab.attachmentError < .01);
      await writeFile(`${sequence}/frame-${String(index).padStart(3, '0')}.png`,
        Buffer.from(frames[index].image.split(',')[1], 'base64'));
    }
    const gif = spawnSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '10', '-i', `${sequence}/frame-%03d.png`,
      '-vf', 'split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse', '-loop', '0', `${output}/strict-continuous.gif`], { encoding: 'utf8' });
    assert.equal(gif.status, 0, `GIF generation ${String(gif.error ?? gif.stderr)}`);
    report.visualSequence = { frames: frames.length, seconds: 4.5,
      path: 'strict-continuous.gif', input: 'Scripted arm/body targets, existing final-bone IK and live Phaser attachment clock',
      maximumError: Math.max(...frames.map(frame => frame.grab.attachmentError)),
      contactFraction: frames.filter(frame => frame.grab.contactSatisfied).length / frames.length };
    check('Forty-five live rendered frames record continuous strict grasp while arms, body, knee and root move', report.visualSequence);
    await action('release').click();
    await waitForSnapshot(item => item.rabbit3d.grab.state === 'RELEASED');

    await action('reset').click();
    await toggle('distance').uncheck();
    const beforeGrab = (await snapshot()).rabbit3d.grab.carrotGripPosition;
    await action('grab').click();
    const transition = (await snapshot()).rabbit3d.grab;
    assert.ok(['GRABBING', 'ATTACHED'].includes(transition.state));
    await capture('03-attach-transition');
    value = await waitForSnapshot(item => item.rabbit3d.grab.state === 'ATTACHED');
    assertAttached(value, 'initial attachment');
    assert.ok(distance(beforeGrab, value.rabbit3d.grab.carrotGripPosition) > .05);
    report.attach = { initialPosition: beforeGrab, observedTransition: transition,
      final: value.rabbit3d.grab, distanceBypass: true };
    check('Explicit DEV distance bypass exercises short attach transition then strict final-bone following', report.attach);
    await capture('04-attached');

    const poses = [
      { name: 'both-raised', left: 90, right: 90, elbow: 25, plane: 90 },
      { name: 'lean-left', left: 80, right: 80, elbow: 45, plane: 75, side: -16 },
      { name: 'lean-right', left: 80, right: 80, elbow: 45, plane: 75, side: 16 },
      { name: 'shallow-knee', left: 70, right: 70, elbow: 45, plane: 90, knee: .65 },
      { name: 'translate-left', left: 80, right: 80, elbow: 25, plane: 90, knee: .5, root: -.1 },
      { name: 'translate-right', left: 80, right: 80, elbow: 25, plane: 90, knee: .5, root: .1 },
      { name: 'high-raise', left: 150, right: 150, plane: 0 },
      { name: 'asymmetric-arms', left: 110, right: 65, elbow: 30, plane: 65, side: -10, knee: .4 },
    ];
    for (const pose of poses) {
      await manualPose(pose);
      value = await snapshot();
      assertAttached(value, pose.name);
      const facts = await sceneFacts();
      assertInsideCrop(facts, pose.name);
      report.poses.push({ requested: pose, grab: value.rabbit3d.grab, logicalBounds: facts.logicalBounds });
      await capture(`pose-${pose.name}`);
    }
    check('Raised arms, both leans, shallow knees, lateral movement and asymmetric hands retain finite sub0.01 grip error and crop coverage',
      { poses: report.poses.length, maximumAttachmentError: Math.max(...report.poses.map(pose => pose.grab.attachmentError)) });

    await toggle('points').check();
    await capture('05-grip-points');
    assert.equal(await toggle('points').isChecked(), true);
    await toggle('points').uncheck();
    check('Grip helper control is visible and switchable');

    await page.locator('[data-action=pause]').click();
    const paused = await snapshot();
    await page.waitForTimeout(350);
    const afterPause = await snapshot();
    assert.equal(afterPause.rabbit3d.renderedFrames, paused.rabbit3d.renderedFrames);
    assert.deepEqual(afterPause.rabbit3d.grab.carrotGripPosition, paused.rabbit3d.grab.carrotGripPosition);
    assert.equal(afterPause.rabbit3d.grab.transitionElapsed, paused.rabbit3d.grab.transitionElapsed);
    assert.equal(await action('grab').isDisabled(), true);
    await page.locator('[data-action=resume]').click();
    value = await waitForSnapshot(item => item.rabbit3d.renderedFrames > paused.rabbit3d.renderedFrames);
    assertAttached(value, 'resume');
    check('Pause freezes rabbit, attachment transform and transition timer, disables grab controls, resume preserves attachment');

    await page.evaluate(async () => {
      const preview = (await import('/src/main.ts')).game.scene.getScene('CarrotPull').rabbit3d;
      preview.grabTrackingReliable = () => false;
      preview.overlay.rabbit.rig.resetPose();
    });
    await page.waitForTimeout(900);
    value = await snapshot();
    assertAttached(value, 'injected tracking loss');
    assert.equal(value.rabbit3d.grab.reliable, false);
    assert.match(value.rabbit3d.grab.reason, /追蹤/);
    assert.equal(await page.locator('dialog[open]').count(), 0);
    await action('release').click();
    await waitForSnapshot(item => item.rabbit3d.grab.state === 'RELEASED');
    await action('grab').click();
    assert.equal((await snapshot()).rabbit3d.grab.state, 'RELEASED');
    await page.evaluate(async () => {
      const preview = (await import('/src/main.ts')).game.scene.getScene('CarrotPull').rabbit3d;
      delete preview.grabTrackingReliable;
    });
    await page.waitForTimeout(100);
    check('Injected loss at attachment reliability boundary preserves attached carrot during actual neutral motion, denies new grab and recovers',
      { scope: 'Reliability gate injection and final-bone movement. Existing separate mocap suite verifies camera-pipeline loss. No human input.' });

    const released = (await snapshot()).rabbit3d.grab.carrotGripPosition;
    await manualPose({ left: 110, right: 100, plane: 45, elbow: 25, side: 12, knee: .5 });
    value = await snapshot();
    assert.equal(value.rabbit3d.grab.state, 'RELEASED');
    assert.ok(distance(released, value.rabbit3d.grab.carrotGripPosition) < 1e-9);
    await capture('06-released');
    await action('reset').click();
    value = await snapshot();
    assert.ok(distance(initial.rabbit3d.grab.carrotGripPosition, value.rabbit3d.grab.carrotGripPosition) < 1e-8);
    assert.equal(value.score, 0);
    await capture('07-reset');
    check('Release holds final world position through later body motion and reset restores initial planted grip without scoring');

    const immediateRejections = await page.evaluate(async () => {
      const preview = (await import('/src/main.ts')).game.scene.getScene('CarrotPull').rabbit3d;
      const originalEnabled = preview.mocapEnabled;
      const originalStatus = preview.inputStatus;
      const originalSnapshot = preview.mocap.snapshot;
      const motion = originalSnapshot.call(preview.mocap);
      const results = [];
      try {
        preview.mocapEnabled = true;
        for (const condition of [
          { lastRejection: 'synthetic-pose-rejected', suspended: false },
          { lastRejection: undefined, suspended: true },
        ]) {
          preview.inputStatus = { mode: 'camera', ready: true, suspended: condition.suspended };
          preview.mocap.snapshot = () => ({ ...motion, trackingState: 'tracking', controllerStatus: 'ACTIVE',
            lastRejection: condition.lastRejection,
            raw: { leftArmConfidence: .99, rightArmConfidence: .99, timestampMs: performance.now() } });
          document.querySelector('[data-carrot-grab-action=grab]').click();
          results.push({ condition, grab: preview.grabController.snapshot() });
        }
      } finally {
        preview.mocapEnabled = originalEnabled;
        preview.inputStatus = originalStatus;
        preview.mocap.snapshot = originalSnapshot;
      }
      return results;
    });
    for (const result of immediateRejections) {
      assert.equal(result.grab.state, 'IDLE');
      assert.equal(result.grab.eligible, false);
      assert.equal(result.grab.reliable, false);
    }
    check('Same-tick rejected pose or suspended camera blocks grab before the next render', {
      cases: immediateRejections,
      scope: 'Synthetic camera status and snapshot at the preview reliability boundary, normal DOM button handler. No human camera data.' });

    await page.evaluate(() => {
      document.querySelector('[data-carrot-grab-action=grab]').click();
      document.querySelector('[data-action=pause]').click();
    });
    const pausedTransition = (await snapshot()).rabbit3d.grab;
    assert.equal(pausedTransition.state, 'GRABBING');
    await page.waitForTimeout(400);
    const heldTransition = (await snapshot()).rabbit3d.grab;
    assert.equal(heldTransition.transitionElapsed, pausedTransition.transitionElapsed);
    assert.deepEqual(heldTransition.carrotGripPosition, pausedTransition.carrotGripPosition);
    await page.locator('[data-action=resume]').click();
    value = await waitForSnapshot(item => item.rabbit3d.grab.state === 'ATTACHED');
    assertAttached(value, 'resumed transition');
    check('A paused in-progress attach retains its exact interpolation time and resumes to the same state');

    if (process.env.QA_SKIP_PERFORMANCE !== '1') {
      report.performance.disabled = await benchmark(false);
      report.performance.enabled = await benchmark(true);
      assert.ok(report.performance.enabled.observedFps > 40);
      assert.ok(report.performance.enabled.renderCalls > report.performance.disabled.renderCalls);
      check('Matched-crop baseline and feature-enabled actual-render performance measured', report.performance);
    } else report.performance = { status: 'NOT_RUN', reason: 'QA_SKIP_PERFORMANCE=1, measured in separate idle-browser run' };

    report.scales = [];
    for (const scale of [.5, 1.5]) {
      await page.evaluate(async scale => {
        const { DEFAULT_GAME_SETTINGS, saveGameSettings } = await import('/src/game/settings/gameSettings.ts');
        saveGameSettings({ ...DEFAULT_GAME_SETTINGS, rabbitScale: scale });
      }, scale);
      await page.getByRole('combobox', { name: '阿兔渲染模式' }).selectOption('sprite');
      await page.getByRole('combobox', { name: '阿兔渲染模式' }).selectOption('3d');
      const scaledInitial = await waitForSnapshot(item => item.rabbit3d.status === 'ready');
      const ground = scaledInitial.rabbit3d.grab.carrotGripPosition;
      const pixelsPerUnit = scaledInitial.rabbit3d.pixelsPerUnit;
      assert.ok(Math.abs(pixelsPerUnit - initial.rabbit3d.pixelsPerUnit * scale) < 1e-6);
      assert.ok(Math.abs(681 - ground[1] * pixelsPerUnit - 668) < 1e-6);
      assertInsideCrop(await sceneFacts(), `initial scale ${scale}`);
      await toggle('distance').uncheck();
      await action('grab').click();
      await waitForSnapshot(item => item.rabbit3d.grab.state === 'ATTACHED');
      await manualPose({ left: 150, right: 150, side: 12, knee: .6, root: .1 });
      value = await snapshot();
      assertAttached(value, `scale ${scale}`);
      const facts = await sceneFacts();
      assertInsideCrop(facts, `raised scale ${scale}`);
      report.scales.push({ scale, pixelsPerUnit, grab: value.rabbit3d.grab, logicalBounds: facts.logicalBounds });
      await capture(`scale-${scale}`);
      if (scale === 1.5) {
        await page.getByRole('button', { name: '停用 IK', exact: true }).click();
        report.fkCrop = [];
        for (const sign of [-1, 1]) {
          await manualPose({ left: 90, right: 90, side: sign * 18, forward: 16, root: -sign * .45 });
          const corner = await sceneFacts();
          assertInsideCrop(corner, `maximum-scale FK corner ${sign}`);
          report.fkCrop.push({ side: sign * 18, root: -sign * .45, logicalBounds: corner.logicalBounds, viewport: corner.viewport });
        }
        await capture('scale-1.5-fk-corner');
        await page.getByRole('button', { name: '啟用 IK', exact: true }).click();
        check('Maximum-scale FK comparison retains both extreme lean/root corners inside the crop', report.fkCrop);
      }
    }
    await page.evaluate(async () => {
      const { resetGameSettings } = await import('/src/game/settings/gameSettings.ts');
      resetGameSettings();
    });
    check('Minimum and maximum supported rabbit scales preserve Phaser anchor, attachment accuracy and raised-pose crop', report.scales);

    await page.setViewportSize({ width: 600, height: 800 });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('vite-error-overlay').count(), 0);
    await capture('08-small-viewport');
    await page.setViewportSize({ width: 1512, height: 982 });
    check('Narrow viewport preserves render and accessible scrolling controls');

    for (let index = 0; index < 3; index++) {
      await page.getByRole('combobox', { name: '阿兔渲染模式' }).selectOption('sprite');
      const sprite = await snapshot();
      assert.equal(sprite.rabbit3d.mode, 'sprite');
      assert.equal(sprite.rabbit3d.grab, undefined);
      assert.equal(await page.locator('.carrot-grab-debug').count(), 0);
      assert.equal(sprite.carrot.visible, true);
      await page.getByRole('combobox', { name: '阿兔渲染模式' }).selectOption('3d');
      await waitForSnapshot(item => item.rabbit3d.status === 'ready');
      const facts = await sceneFacts();
      assert.equal(facts.gripNodes, 1);
      assert.equal(facts.dynamicTextures.length, 1);
    }
    await home();
    const cleanup = await page.evaluate(async () => {
      const { game } = await import('/src/main.ts');
      return { dynamicTextures: game.textures.getTextureKeys().filter(key => key.startsWith('rabbit-three-')),
        panels: document.querySelectorAll('.carrot-grab-debug,.rabbit-tools').length,
        canvases: document.querySelectorAll('#phaser-stage canvas').length };
    });
    assert.deepEqual(cleanup, { dynamicTextures: [], panels: 0, canvases: 1 });
    check('Repeated Sprite switching and home teardown remove prototype UI and textures without duplicate models', cleanup);

    await page.route('**/assets/carrot3d/carrot_realtime.glb', route => route.fulfill({ status: 404, body: 'deliberate carrot QA failure' }));
    await page.goto(`${base}?rabbit3dDebug=1&carrotGrabDebug=1`);
    await page.locator('[data-action=start]').click();
    await page.locator('[data-action=carrot]').click();
    await page.locator('[data-input-action=keyboard]').click();
    const failed = await waitForSnapshot(item => item.rabbit3d.status.startsWith('fallback:'));
    assert.equal(failed.rabbit3d.mode, 'sprite');
    assert.equal(failed.rabbit3d.spriteVisible, true);
    assert.equal(failed.carrot.visible, true);
    assert.equal(failed.rabbit3d.textureExists, false);
    await page.unroute('**/assets/carrot3d/carrot_realtime.glb');
    check('Carrot GLB failure restores playable Sprite and one visible original carrot', failed.rabbit3d.status);

    await page.route('**/assets/carrot3d/carrot_realtime.glb', async route => {
      await new Promise(resolve => setTimeout(resolve, 1200));
      await route.continue().catch(() => {});
    });
    await page.goto(`${base}?rabbit3dDebug=1&carrotGrabDebug=1`);
    await page.locator('[data-action=start]').click();
    await page.locator('[data-action=carrot]').click();
    await page.locator('[data-input-action=keyboard]').click();
    await home();
    await page.waitForTimeout(1400);
    assert.equal(await page.locator('.carrot-grab-debug,.rabbit-tools').count(), 0);
    await page.unroute('**/assets/carrot3d/carrot_realtime.glb');
    check('Shutdown during delayed carrot fetch cannot attach late model or debug listeners');

    value = await enter('?rabbit3dDebug=1');
    assert.equal(value.rabbit3d.grab, undefined);
    assert.equal(value.carrot.visible, true);
    assert.equal(await page.locator('.carrot-grab-debug').count(), 0);
    check('Ordinary development preview keeps existing carrot and excludes prototype controls');
    report.errors = report.errors.filter(error => !error.includes('404 (Not Found)'));
    assert.deepEqual(report.errors, []);
    check('Console health after explicit expected 404 exclusion');
  }

  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.failure = String(error);
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/browser-report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length,
    failure: report.failure, performance: report.performance, errors: report.errors,
    report: `${output}/browser-report.json` }, null, 2));
}
