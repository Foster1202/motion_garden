import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const base = process.env.QA_URL ?? 'http://127.0.0.1:5173/';
const output = process.env.QA_OUTPUT ?? fileURLToPath(new URL('../docs/qa/task-4a/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { browser: browser.version(), browserPlugin: 'Browser plugin not available; Playwright with installed Google Chrome', url: base, checks: [], errors: [], viewports: [], fps: [] };
const check = (name, detail) => report.checks.push({ name, result: 'PASS', detail });
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
const snapshot = () => page.evaluate(async () => (await import('/src/main.ts')).game.scene.getScene('CarrotPull').getDebugSnapshot());
const waitSnapshot = async predicate => {
  const end = Date.now() + 15000;
  while (Date.now() < end) { const value = await snapshot(); if (predicate(value)) return value; await page.waitForTimeout(80); }
  throw new Error(`Snapshot timeout: ${JSON.stringify(await snapshot())}`);
};
const enter = async (url = `${base}?rabbit3dDebug=1`) => {
  await page.goto(url);
  await page.locator('[data-action=start]').click();
  await page.locator('[data-action=carrot]').click();
  await page.locator('[data-input-action=keyboard]').first().click();
};
const slider = async (name, value) => {
  await page.getByRole('slider', { name, exact: true }).evaluate((input, value) => {
    input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
};
try {
  await enter();
  await waitSnapshot(s => s.rabbit3d.status === 'ready');
  assert.match(await page.title(), /動態花園/);
  assert.ok((await page.locator('body').innerText()).includes('3D 阿兔'));
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  let rest = await snapshot();
  assert.equal(rest.rabbit3d.bones.length, 19); assert.equal(rest.rabbit3d.spriteVisible, false);
  check('Page identity, nonblank, no framework overlay, GLB load, 19 bones, single rabbit', rest.rabbit3d.status);
  await page.screenshot({ path: `${output}standing-1512.png` });
  const track=await page.getByRole('slider',{name:'左臂',exact:true}).boundingBox();
  await page.mouse.move(track.x+8,track.y+track.height/2);await page.mouse.down();
  await page.mouse.move(track.x+track.width*.75,track.y+track.height/2,{steps:8});await page.waitForTimeout(60);
  assert.notDeepEqual((await snapshot()).rabbit3d.quaternions['upper_arm.L'],rest.rabbit3d.quaternions['upper_arm.L']);
  await page.mouse.up();
  check('Real pointer drag changes bone before mouse release');
  await page.getByRole('button',{name:'恢復自然站立'}).click();await page.waitForTimeout(1000);rest=await snapshot();
  await slider('左臂', 50); await page.waitForTimeout(40);
  const intermediate = await snapshot();
  await page.waitForTimeout(500); let posed = await snapshot();
  assert.notDeepEqual(intermediate.rabbit3d.quaternions['upper_arm.L'], rest.rabbit3d.quaternions['upper_arm.L']);
  assert.notDeepEqual(intermediate.rabbit3d.quaternions['upper_arm.L'], posed.rabbit3d.quaternions['upper_arm.L']);
  assert.deepEqual(posed.rabbit3d.quaternions['upper_arm.R'], rest.rabbit3d.quaternions['upper_arm.R']);
  check('Left arm responds before pointer release, interpolates, right remains independent');
  await slider('右臂', 50); await slider('身體前後傾', 5); await slider('身體側傾', -10); await slider('頭部轉向', 15);
  await page.waitForTimeout(700); posed = await snapshot();
  assert.notDeepEqual(posed.rabbit3d.quaternions['upper_arm.R'], rest.rabbit3d.quaternions['upper_arm.R']);
  assert.notDeepEqual(posed.rabbit3d.quaternions.body, rest.rabbit3d.quaternions.body);
  assert.notDeepEqual(posed.rabbit3d.quaternions.head, rest.rabbit3d.quaternions.head);
  await page.screenshot({ path: `${output}arms-body-head.png` });
  await slider('身體側傾', 10); await page.waitForTimeout(500);
  assert.notDeepEqual((await snapshot()).rabbit3d.quaternions.body, posed.rabbit3d.quaternions.body);
  check('Both arms, head, forward lean and both side lean directions');
  await page.getByRole('button', { name: '恢復自然站立' }).click(); await page.waitForTimeout(1000);
  rest = await snapshot();
  for (const amount of [.25, .5, 1]) { await slider('淺屈膝', amount); await page.waitForTimeout(400); const next = await snapshot(); assert.notDeepEqual(next.rabbit3d.quaternions['shin.L'], rest.rabbit3d.quaternions['shin.L']); }
  await page.screenshot({ path: `${output}shallow-knee.png` });
  await slider('左右平移', -.4); await page.waitForTimeout(500); const left = await snapshot();
  await slider('左右平移', .4); await slider('輕微高度', .02); await page.waitForTimeout(500); const right = await snapshot();
  assert.ok(right.rabbit3d.rootPosition[0] > left.rabbit3d.rootPosition[0]);
  check('Continuous shallow knee and root movement both directions plus bounded height');
  await page.getByRole('button', { name: '恢復自然站立' }).click(); await page.waitForTimeout(1200);
  const reset = await snapshot();
  for (const name of rest.rabbit3d.bones) assert.ok(reset.rabbit3d.quaternions[name].every((v, i) => Math.abs(v - rest.rabbit3d.quaternions[name][i]) < 1e-5));
  check('Reset to rest');
  const beforePause = await snapshot();
  await page.locator('[data-action=pause]').click(); await page.waitForTimeout(100); const pause = await snapshot();
  await page.waitForTimeout(350); assert.equal((await snapshot()).rabbit3d.renderedFrames, pause.rabbit3d.renderedFrames);
  await page.locator('[data-action=resume]').click(); await page.waitForTimeout(300);
  assert.ok((await snapshot()).rabbit3d.renderedFrames > beforePause.rabbit3d.renderedFrames);
  assert.equal((await snapshot()).animationPaused, true);
  check('Pause freezes Three frames, resume keeps hidden sprite paused');
  for (const viewport of [{width:1920,height:1080},{width:1440,height:900},{width:1512,height:982},{width:900,height:700},{width:600,height:800}]) {
    await page.setViewportSize(viewport); await page.waitForTimeout(1100);
    const value = await snapshot(); const geometry = await page.evaluate(() => {
      const canvas = document.querySelector('#phaser-stage canvas'); const rect = canvas.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, logicalWidth: canvas.width, logicalHeight: canvas.height };
    });
    assert.equal(value.rabbit.x, 894); assert.equal(value.rabbit.y, 681); assert.equal(value.rabbit3d.pixelsPerUnit, rest.rabbit3d.pixelsPerUnit);
    assert.ok(Math.abs(geometry.width / geometry.height - 1600 / 900) < .002);
    assert.ok(value.layers.find(layer => layer.name === 'foreground').depth > 40);
    assert.ok(value.carrot.depth > 40);
    report.viewports.push({ ...viewport, geometry, footCSS: {x:geometry.x+894*geometry.width/1600,y:geometry.y+681*geometry.height/900} });
    report.fps.push({ ...viewport, fps: value.rabbit3d.fps });
    await page.screenshot({ path: `${output}resize-${viewport.width}x${viewport.height}.png` });
  }
  check('FIT alignment, uniform scale, native depth across five viewports');
  await page.setViewportSize({width:1512,height:982});
  await page.getByRole('combobox',{name:'阿兔渲染模式'}).selectOption('sprite');
  const sprite = await waitSnapshot(s => s.rabbit3d.mode === 'sprite');
  assert.equal(sprite.rabbit3d.spriteVisible,true); assert.equal(sprite.rabbit3d.textureExists,false); assert.equal(await page.locator('.rabbit-3d-debug').count(),0);
  for (let carrot=1;carrot<=5;carrot++) {
    await page.keyboard.down('ArrowDown'); await waitSnapshot(s=>s.state==='GRABBED'); await page.keyboard.up('ArrowDown');
    await page.keyboard.down('ArrowUp'); await waitSnapshot(s=>s.state==='SUCCESS'); await page.keyboard.up('ArrowUp');
    await waitSnapshot(s=>s.score===carrot);
  }
  assert.equal((await snapshot()).state,'COMPLETE');
  await page.screenshot({path:`${output}sprite-complete.png`});
  check('Sprite fallback full five-carrot keyboard game, attachment and celebration');
  await page.locator('[data-action=home]').click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.rabbit-render-mode,.rabbit-3d-debug').count(),0);
  const resources = await page.evaluate(async()=>{const {game}=await import('/src/main.ts');return {textures:game.textures.getTextureKeys().filter(key=>key.startsWith('rabbit-three-')),canvases:document.querySelectorAll('#phaser-stage canvas').length};});
  assert.equal(resources.textures.length,0);assert.equal(resources.canvases,1);
  check('Scene shutdown removes debug UI, dynamic textures and extra canvases',resources);
  await page.route('**/assets/rabbit3d/rabbit_realtime*.glb', route=>route.fulfill({status:404,body:'not found'}));
  await enter(); const failed=await waitSnapshot(s=>s.rabbit3d.status.startsWith('fallback:'));
  assert.equal(failed.rabbit3d.mode,'sprite');assert.equal(failed.rabbit3d.spriteVisible,true);assert.equal(failed.rabbit3d.textureExists,false);
  check('Actual GLB HTTP failure returns to playable sprite',failed.rabbit3d.status);
  await page.unroute('**/assets/rabbit3d/rabbit_realtime*.glb');
  await page.getByRole('combobox',{name:'阿兔渲染模式'}).selectOption('3d');await waitSnapshot(s=>s.rabbit3d.status==='ready');
  for(let i=0;i<3;i++){await page.getByRole('combobox',{name:'阿兔渲染模式'}).selectOption('sprite');await page.getByRole('combobox',{name:'阿兔渲染模式'}).selectOption('3d');await waitSnapshot(s=>s.rabbit3d.status==='ready');}
  await page.evaluate(async()=>{const {game}=await import('/src/main.ts');game.scene.getScene('CarrotPull').rabbit3d.overlay.renderer.forceContextLoss();});
  await waitSnapshot(s=>s.rabbit3d.status.includes('WebGL context lost'));
  assert.equal((await snapshot()).rabbit3d.spriteVisible,true);
  check('Actual WebGL context loss returns to sprite');
  await page.getByRole('combobox',{name:'阿兔渲染模式'}).selectOption('3d');await waitSnapshot(s=>s.rabbit3d.status==='ready');
  await page.evaluate(async()=>{const {game}=await import('/src/main.ts');window.__qaOverlay=game.scene.getScene('CarrotPull').rabbit3d.overlay;});
  await page.locator('[data-action=pause]').click();await page.locator('[data-action=home]').click();
  await page.locator('[data-action=start]').waitFor();
  const disposed=await page.evaluate(()=>{const o=window.__qaOverlay;return {geometries:o.renderer.info.memory.geometries,textures:o.renderer.info.memory.textures,programs:o.renderer.info.programs?.length,children:o.scene.children.length,canvasConnected:o.renderer.domElement.isConnected,contextLost:o.renderer.getContext().isContextLost()};});
  // Three r186 retains its shared 16x16 DFG LUT counter; context loss frees the native allocation.
  assert.deepEqual(disposed,{geometries:0,textures:1,programs:0,children:0,canvasConnected:false,contextLost:true});
  report.disposedRenderer=disposed;
  assert.equal(await page.locator('.rabbit-render-mode,.rabbit-3d-debug').count(),0);
  check('Repeated 3D/sprite switching and shutdown while 3D active');
  await page.route('**/assets/rabbit3d/rabbit_realtime*.glb',async route=>{await new Promise(resolve=>setTimeout(resolve,1500));await route.fulfill({status:404,body:'delayed failure'}).catch(()=>{});});
  await enter();await page.locator('[data-action=pause]').click();await page.locator('[data-action=home]').click();await page.waitForTimeout(1700);
  assert.equal(await page.locator('.rabbit-render-mode,.rabbit-3d-debug').count(),0);
  check('Shutdown during pending GLB fetch cannot attach late model');
  // The deliberate 404 is the only expected browser console error.
  report.errors = report.errors.filter(error => !error.includes('404 (Not Found)'));
  assert.deepEqual(report.errors,[]);
  check('Console health, excluding deliberate GLB 404');
  report.status='PASS';
} catch(error) {report.status='FAIL';report.failure=String(error);await page.screenshot({path:`${output}failure.png`});throw error;}
finally {await writeFile(`${output}browser-report.json`,JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify(report,null,2));}
