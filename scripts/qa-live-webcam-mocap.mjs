import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.QA_URL ?? 'http://127.0.0.1:5179/';
const output = process.env.QA_OUTPUT ?? '/private/tmp/motion-garden-4e-live-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
const report = { status: 'RUNNING', url, browser: browser.version(), humanWebcamQA: 'NOT VERIFIED',
  input: 'Synthetic monocular-depth/jitter/occlusion landmarks through one actual camera scheduler, calibration, production 3D game and final GLB bones.',
  checks: [], rounds: [], errors: [] };
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
const check = (name, evidence) => report.checks.push({ name, evidence });
const snapshot = () => page.evaluate(async () => (await import('/src/main.ts')).game.scene.getScene('CarrotPull').getDebugSnapshot());
const fixture = changes => page.evaluate(changes => Object.assign(window.__liveFixture, changes), changes);
async function wait(predicate, timeout = 20000) {
  const until = Date.now() + timeout;
  let value;
  while (Date.now() < until) {
    value = await snapshot();
    if (predicate(value)) return value;
    await page.waitForTimeout(40);
  }
  throw new Error(`Live Webcam regression timeout ${JSON.stringify(value)}`);
}
const calibration = () => page.evaluate(async () =>
  (await import('/src/main.ts')).game.scene.getScene('CarrotPull').motion.active.getCalibration());
const different = (before, after) => before.some((value, index) => Math.abs(value - after[index]) > .005);
async function installFixture() {
  await page.evaluate(async () => {
    const { PoseEstimator } = await import('/src/game/vision/PoseEstimator.ts');
    window.__liveFixture = { left: 70, right: 70, knee: 170, lean: 0, shift: 0,
      depth: -.075, factor: 1, torsoFactor: 1, widthFactor: 1, jitter: false, hiddenArm: false, lost: false };
    window.__liveStats = { models: 0, closed: 0, streams: 0, inferences: 0, timestamps: [] };
    const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => {
      window.__liveStats.streams++;
      return window.__liveStream = await getMedia(options);
    };
    const initialize = PoseEstimator.prototype.initialize;
    PoseEstimator.prototype.initialize = function () {
      this.options.createLandmarker = async () => {
        window.__liveStats.models++;
        return {
          close() { window.__liveStats.closed++; },
          detectForVideo(video, timestamp) {
            const f = window.__liveFixture, stats = window.__liveStats;
            stats.inferences++;
            stats.timestamps.push(timestamp);
            if (f.lost) return { landmarks: [] };
            const width = video.videoWidth, height = video.videoHeight;
            const center = width * (.5 + f.shift);
            const hy = height * .52;
            const sy = hy - height * .24 * f.torsoFactor;
            const lean = Math.tan(f.lean * Math.PI / 180) * (hy - sy);
            const jitter = f.jitter ? Math.sin(stats.inferences) * .5 : 0;
            const depth = f.depth + (f.jitter ? Math.sin(stats.inferences * .7) * .005 : 0);
            const factor = f.factor;
            const verticalShift = Math.min(0, .98 - (.55 + (.87 - .55) * factor));
            const point = (x, y, z = 0) => ({ x: (center + (x - center) * factor) / width,
              y: .55 + (y / height - .55) * factor + verticalShift,
              z: z * factor, visibility: .99, presence: .99 });
            const points = Array.from({ length: 33 }, () => point(center, height * .5));
            for (const index of [0, 7, 8]) points[index].visibility = .1;
            for (const [shoulder, elbow, wrist, hip, knee, ankle, sign, angle] of [
              [11, 13, 15, 23, 25, 27, 1, f.left], [12, 14, 16, 24, 26, 28, -1, f.right],
            ]) {
              const x = center + sign * height * .12 * f.widthFactor;
              const radians = angle * Math.PI / 180;
              const kneeRadians = (180 - f.knee) * Math.PI / 180;
              points[shoulder] = point(x + lean, sy);
              points[elbow] = point(x + lean + sign * Math.sin(radians) * height * .13 + jitter,
                sy + Math.cos(radians) * height * .13, depth);
              points[wrist] = point(x + lean + sign * Math.sin(radians) * height * .25 + jitter,
                sy + Math.cos(radians) * height * .25, depth * 2);
              points[hip] = point(x, hy);
              points[knee] = point(x, height * .69);
              points[ankle] = point(x + Math.sin(kneeRadians) * height * .17,
                height * .69 + Math.cos(kneeRadians) * height * .17);
            }
            if (f.hiddenArm && stats.inferences % 9 === 4) points[15].visibility = .2;
            return { landmarks: [points] };
          },
        };
      };
      return initialize.call(this);
    };
  });
}

try {
  await page.goto(`${url}?carrotGameDebug=1`);
  await page.locator('[data-action=start]').click();
  await page.locator('[data-action=carrot]').click();
  await installFixture();
  await page.locator('[data-input-action=camera]').click();
  await wait(value => ['BEND_INSTRUCTIONS', 'BEND_SAMPLING'].includes(value.input.calibrationState));
  await fixture({ knee: 150 });
  await wait(value => value.input.calibrationReady);
  const profile = await calibration();
  await fixture({ knee: 170 });
  await wait(value => value.rabbit3d.mocap?.humanPosesExtracted > 15);
  await page.waitForTimeout(800);
  let value = await snapshot();
  assert.equal(value.rabbit3d.renderMode, '3d-game');
  assert.equal(value.rabbit3d.mocap.enabled, true);
  assert.equal(value.rabbit3d.mocap.referenceReady, false);
  assert.equal(value.rabbit3d.mocap.mappedPoses, 0);
  assert.ok(value.rabbit3d.mocap.referenceRejectionReason);
  assert.ok(value.rabbit3d.mocap.referenceConditions.some(condition => !condition.pass));
  assert.equal(await page.locator('dialog[open]').count(), 0);
  await page.screenshot({ path: `${output}/reference-rejected.png` });
  check('Normal 3D game receives/extracts frames and reports the exact raised-arm reference failure without a modal', value.rabbit3d.mocap);

  await fixture({ left: 8, right: 8, jitter: true, hiddenArm: true });
  value = await wait(value => value.rabbit3d.mocap?.trackingState === 'tracking' && value.rabbit3d.gameplayReady
    && value.rabbit3d.mocap.raw?.leftArmElevation > 25
    && value.rabbit3d.mocap.raw?.leftArmProjectedElevation < 25);
  assert.ok(value.rabbit3d.mocap.raw.leftArmElevation > 25);
  assert.ok(value.rabbit3d.mocap.raw.leftArmProjectedElevation < 25);
  assert.ok(value.rabbit3d.mocap.mappedPoses > 0);
  assert.equal(value.rabbit3d.mocap.referenceReady, true);
  await page.screenshot({ path: `${output}/reference-ready.png` });
  check('Natural down arms with monocular depth bias acquire reference and enter TRACKING despite intermittent wrist occlusion', value.rabbit3d.mocap);
  await fixture({ jitter: false, hiddenArm: false });
  await page.waitForTimeout(500);
  const rest = await snapshot();
  const gestures = [
    { name: 'human-left-mirrored', motion: { left: 80 }, bone: 'upper_arm.R', target: 'rightArmElevation' },
    { name: 'human-right-mirrored', motion: { right: 80 }, bone: 'upper_arm.L', target: 'leftArmElevation' },
    { name: 'both', motion: { left: 80, right: 80 }, bone: 'upper_arm.L', target: 'leftArmElevation' },
    { name: 'lean-left', motion: { lean: 8 }, bone: 'body', target: 'torsoLean' },
    { name: 'lean-right', motion: { lean: -8 }, bone: 'body', target: 'torsoLean' },
    { name: 'shallow-bend', motion: { knee: 160 }, bone: 'shin.L', target: 'bendAmount' },
  ];
  for (const gesture of gestures) {
    await fixture({ left: 8, right: 8, knee: 170, lean: 0, shift: 0, ...gesture.motion });
    await page.waitForTimeout(1000);
    value = await snapshot();
    assert.equal(value.rabbit3d.mocap.trackingState, 'tracking', gesture.name);
    assert.ok(Math.abs(value.rabbit3d.mocap.mapped[gesture.target]) > .01, gesture.name);
    assert.ok(different(rest.rabbit3d.quaternions[gesture.bone], value.rabbit3d.quaternions[gesture.bone]), gesture.name);
    assert.ok(value.rabbit3d.renderedFrames > rest.rabbit3d.renderedFrames, gesture.name);
    check(`Mapped ${gesture.name} gesture changes actual final GLB ${gesture.bone} and rendered-frame count`, {
      target: value.rabbit3d.mocap.mapped, baselineQuaternion: rest.rabbit3d.quaternions[gesture.bone],
      baselinePosition: rest.rabbit3d.mocap.bonePositions[gesture.bone], finalQuaternion: value.rabbit3d.quaternions[gesture.bone],
      finalPosition: value.rabbit3d.mocap.bonePositions[gesture.bone], renderedFrames: value.rabbit3d.renderedFrames,
    });
    if (gesture.name === 'both') await page.screenshot({ path: `${output}/both-arms-final-bones.png` });
    await fixture({ left: 8, right: 8, knee: 170, lean: 0, shift: 0 });
    await page.waitForTimeout(650);
  }
  const stable = await snapshot();
  await page.waitForTimeout(600);
  value = await snapshot();
  assert.ok(!different(stable.rabbit3d.quaternions['upper_arm.L'], value.rabbit3d.quaternions['upper_arm.L']));
  check('Natural standing remains stable at the actual arm bone');

  assert.equal(await page.locator('[data-input-action=reference]').isVisible(), true);
  await page.locator('[data-input-action=reference]').click();
  await fixture({ left: 70, right: 70 });
  await page.waitForTimeout(900);
  value = await snapshot();
  assert.equal(value.rabbit3d.mocap.referenceReady, false);
  assert.ok(value.rabbit3d.mocap.referenceRejectionReason);
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.deepEqual(await calibration(), profile);
  await fixture({ left: 8, right: 8 });
  value = await wait(value => value.rabbit3d.mocap?.trackingState === 'tracking' && value.rabbit3d.gameplayReady);
  assert.deepEqual(await calibration(), profile);
  check('Reference reset after gameplay was ready reacquires TRACKING without repeating knee calibration', value.rabbit3d.mocap);

  const originalReference = { ...value.rabbit3d.mocap.reference };
  const scoreBeforeMovement = value.score;
  const resourcesBeforeMovement = await page.evaluate(() => ({ models: window.__liveStats.models, streams: window.__liveStats.streams }));
  const movements = [
    { name: 'screen-left', motion: { shift: .16, factor: 1 }, signs: { x: -1, z: 0 } },
    { name: 'screen-right', motion: { shift: -.16, factor: 1 }, signs: { x: 1, z: 0 } },
    { name: 'forward', motion: { shift: 0, factor: 1.6 }, signs: { x: 0, z: 1 } },
    { name: 'backward', motion: { shift: 0, factor: .72 }, signs: { x: 0, z: -1 } },
    { name: 'left-forward-corner', motion: { shift: .16, factor: 1.6 }, signs: { x: -1, z: 1 } },
    { name: 'right-forward-corner', motion: { shift: -.16, factor: 1.6 }, signs: { x: 1, z: 1 } },
    { name: 'left-backward-corner', motion: { shift: .16, factor: .72 }, signs: { x: -1, z: -1 } },
    { name: 'right-backward-corner', motion: { shift: -.16, factor: .72 }, signs: { x: 1, z: -1 } },
  ];
  for (const movement of movements) {
    await fixture({ left: 8, right: 8, ...movement.motion });
    value = await wait(value => {
      const world = value.rabbit3d.worldMovement;
      return value.rabbit3d.mocap.trackingState === 'tracking' && world
        && Object.entries(movement.signs).every(([axis, sign]) => sign
          ? world.offset[axis] * sign > 1 && Math.abs(world.offset[axis] - world.target[axis]) < .02
          : Math.abs(world.offset[axis]) < .03);
    });
    const world = value.rabbit3d.worldMovement;
    assert.equal(value.rabbit3d.mocap.mapped.lateralOffset, 0);
    assert.ok(world.scaleFactor >= .8 && world.scaleFactor <= 1.2);
    assert.equal(world.locked, false);
    assert.deepEqual(value.rabbit3d.mocap.reference, originalReference);
    assert.deepEqual(await calibration(), profile);
    assert.equal(value.score, scoreBeforeMovement);
    await fixture({ left: 80, right: 80 });
    await wait(value => value.rabbit3d.mocap.mapped?.leftArmElevation > 50 && value.rabbit3d.mocap.mapped?.rightArmElevation > 50);
    await page.waitForTimeout(700);
    const bounds = await page.evaluate(async () => {
      const overlay = (await import('/src/main.ts')).game.scene.getScene('CarrotPull').rabbit3d.overlay;
      const box = overlay.rabbit.bounds.clone().setFromObject(overlay.rabbit.pivot, true);
      const positions = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const point = overlay.rabbit.pivot.position.clone().set(x, y, z).project(overlay.camera);
        positions.push({ x: (point.x + 1) * .5, y: (1 - point.y) * .5 });
      }
      return { positions, viewport: overlay.viewport };
    });
    assert.ok(bounds.positions.every(point => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1), JSON.stringify(bounds));
    await page.screenshot({ path: `${output}/world-${movement.name}.png` });
    check(`Reliable ${movement.name} movement drives the world transform and keeps the complete avatar within the garden render`, { world, bounds });
    await fixture({ left: 8, right: 8, shift: 0, factor: 1 });
    await wait(value => Math.abs(value.rabbit3d.worldMovement.offset.x) < .03 && Math.abs(value.rabbit3d.worldMovement.offset.z) < .03);
  }
  await fixture({ shift: .16 });
  await wait(value => Math.abs(value.rabbit3d.worldMovement.offset.x) > 2);
  await fixture({ knee: 150 });
  await page.waitForTimeout(1100);
  value = await snapshot();
  assert.equal(value.state, 'READY');
  assert.equal(value.score, scoreBeforeMovement);
  assert.equal(await page.locator('dialog[open]').count(), 0);
  await fixture({ knee: 170, shift: 0, factor: 1 });
  await wait(value => Math.abs(value.rabbit3d.worldMovement.offset.x) < .03 && Math.abs(value.rabbit3d.worldMovement.offset.z) < .03);
  assert.deepEqual(await page.evaluate(() => ({ models: window.__liveStats.models, streams: window.__liveStats.streams })), resourcesBeforeMovement);
  check('Far from the fixed planting bed, bending keeps READY and the user can freely return with the same reference and camera');

  await fixture({ lost: true });
  await wait(value => value.input.suspended);
  await page.waitForTimeout(900);
  assert.equal(await page.locator('dialog[open]').count(), 0);
  const lostState = await snapshot();
  const lostMappedPoses = lostState.rabbit3d.mocap.mappedPoses;
  const lostArm = lostState.rabbit3d.quaternions['upper_arm.R'];
  await fixture({ lost: false, left: 80, right: 8 });
  let recoveringMotion;
  const recoveryDeadline = Date.now() + 900;
  while (Date.now() < recoveryDeadline) {
    const recovery = await snapshot();
    if (recovery.input.suspended && recovery.rabbit3d.mocap.mappedPoses > lostMappedPoses
      && different(lostArm, recovery.rabbit3d.quaternions['upper_arm.R'])) {
      assert.equal(recovery.score, lostState.score);
      assert.equal(recovery.state, lostState.state);
      assert.equal(recovery.progress, lostState.progress);
      recoveringMotion = { input: recovery.input, mappedPosesBefore: lostMappedPoses,
        mappedPosesAfter: recovery.rabbit3d.mocap.mappedPoses,
        beforeArm: lostArm, afterArm: recovery.rabbit3d.quaternions['upper_arm.R'],
        mapped: recovery.rabbit3d.mocap.mapped, score: recovery.score, state: recovery.state, progress: recovery.progress };
      break;
    }
    if (!recovery.input.suspended) break;
    await page.waitForTimeout(10);
  }
  assert.ok(recoveringMotion, `Fresh reliable motion remained frozen during input recovery ${JSON.stringify(await snapshot())}`);
  await wait(value => value.rabbit3d.gameplayReady && value.rabbit3d.mocap.trackingState === 'tracking');
  assert.deepEqual(await calibration(), profile);
  check('Leaving the camera and returning preserves calibration/reference and resumes final-bone driving');
  check('Fresh reliable pose frames change mapped poses and final mirrored arm bones during action debounce while score and round progress remain held', recoveringMotion);
  await fixture({ left: 8, right: 8 });
  await page.waitForTimeout(650);

  for (let round = 1; round <= 5; round++) {
    await fixture({ knee: 150, left: 55, right: 8, shift: 0, factor: 1,
      torsoFactor: round === 1 ? .65 : 1, widthFactor: round === 1 ? .8 : 1 });
    if (round === 1) {
      const shortening = await wait(value => value.state === 'BENDING' && value.progress > .05);
      assert.ok(shortening.rabbit3d.mocap.raw.torsoScale < shortening.rabbit3d.mocap.reference.torsoScale * .75);
      assert.ok(shortening.rabbit3d.mocap.raw.bodyScale < shortening.rabbit3d.mocap.reference.bodyScale * .85);
      assert.ok(Math.abs(shortening.rabbit3d.worldMovement.offset.z) < .05);
      assert.ok(Math.abs(shortening.rabbit3d.worldMovement.target.z) < .05);
      check('Comfortable bending with a shortened torso and narrower shoulders starts the original bend hold without a false backward world step', {
        raw: shortening.rabbit3d.mocap.raw, reference: shortening.rabbit3d.mocap.reference,
        world: shortening.rabbit3d.worldMovement, state: shortening.state, progress: shortening.progress,
      });
    }
    await wait(value => value.state === 'GRABBED' && value.rabbit3d.gameplay.phase === 'ATTACHED');
    value = await snapshot();
    assert.ok(value.rabbit3d.mocap.mapped.rightArmElevation > 10);
    assert.ok(different(rest.rabbit3d.quaternions['upper_arm.R'], value.rabbit3d.quaternions['upper_arm.R']));
    const grab = value.rabbit3d;
    assert.equal(grab.worldMovement.locked, true);
    const lockedWorld = { ...grab.worldMovement.offset };
    await fixture({ shift: .1, factor: 1.2 });
    await page.waitForTimeout(250);
    assert.deepEqual((await snapshot()).rabbit3d.worldMovement.offset, lockedWorld);
    await fixture({ knee: 170, shift: 0, factor: 1, torsoFactor: 1, widthFactor: 1 });
    value = await wait(value => value.score === round);
    report.rounds.push({ round, score: value.score, mappedAtGrab: grab.mocap.mapped,
      actualRightArm: grab.quaternions['upper_arm.R'], finalQuaternions: value.rabbit3d.quaternions,
      attachmentError: grab.gameplay.attachmentError, lockedWorld });
    if (round < 5) await wait(value => value.state === 'READY');
  }
  await wait(value => value.state === 'COMPLETE');
  assert.equal(report.rounds.length, 5);
  const stats = await page.evaluate(() => window.__liveStats);
  assert.equal(stats.models, 1);
  assert.equal(stats.streams, 1);
  assert.ok(stats.timestamps.every((timestamp, index) => index === 0 || timestamp > stats.timestamps[index - 1]));
  await page.screenshot({ path: `${output}/five-rounds-complete.png` });
  check('Five actual camera-driven carrot rounds keep the right arm live through final GLB bones using one stream and inference scheduler', stats);
  await page.locator('dialog [data-action=home]').click();
  await page.locator('[data-action=start]').waitFor();
  assert.equal(await page.evaluate(() => window.__liveStats.closed), 1);
  assert.ok(await page.evaluate(() => window.__liveStream.getTracks().every(track => track.readyState === 'ended')));
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
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, failure: report.failure,
    report: `${output}/results.json`, errors: report.errors }, null, 2));
}
