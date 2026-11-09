import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const output=process.env.QA_OUTPUT??'/private/tmp/motion-garden-4b-qa';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const page=await browser.newPage({viewport:{width:1512,height:982}});
const report={status:'RUNNING',input:'Real MediaPipe WASM/model with virtual webcam test pattern; no human present and no human accuracy/latency claim',errors:[],warnings:[],engineDiagnostics:[]};
page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'){if(m.text()==='INFO: Created TensorFlow Lite XNNPACK delegate for CPU.')report.engineDiagnostics.push(m.text());else report.errors.push(m.text());}if(m.type()==='warning')report.warnings.push(m.text());});
try{
  await page.goto(`${process.env.QA_URL??'http://127.0.0.1:5173/'}?rabbit3dDebug=1&mocapDebug=1`);
  await page.locator('[data-action=start]').click();await page.locator('[data-action=carrot]').click();await page.waitForSelector('.mocap-debug');
  await page.evaluate(async()=>{
    window.__engineFrames=[];
    const {MediapipeMotionInput}=await import('/src/game/input/MediapipeMotionInput.ts');
    const accept=MediapipeMotionInput.prototype.acceptFrame;
    MediapipeMotionInput.prototype.acceptFrame=function(frame){window.__engineFrames.push({timestampMs:frame.timestampMs,poseFps:frame.poseFps,inferenceMs:frame.inferenceMs,averageInferenceMs:frame.averageInferenceMs,landmarks:frame.landmarks?.length??0});return accept.call(this,frame);};
    const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async options=>{const stream=await original(options);window.__engineStream=stream;return stream;};
  });
  await page.locator('[data-input-action=camera]').click();await page.waitForFunction(()=>window.__engineFrames.length>20,{},{timeout:30000});
  assert.equal(await page.locator('.calibration-panel,[data-calibration-state]').count(),0);
  await page.waitForTimeout(5000);
  const sample=await page.evaluate(async()=>({frames:window.__engineFrames,scene:(await import('/src/main.ts')).game.scene.getScene('CarrotPull').getDebugSnapshot()}));
  assert.ok(sample.frames.length>20);assert.ok(sample.frames.every((f,i)=>i===0||f.timestampMs>sample.frames[i-1].timestampMs));
  report.frameCount=sample.frames.length;report.lastFrame=sample.frames.at(-1);report.threeFps=sample.scene.rabbit3d.fps;
  assert.equal(sample.scene.paused,false);
  assert.equal(sample.scene.input.requestPause,false);
  assert.equal(sample.scene.input.suspended,true);
  assert.equal(sample.scene.score,0);
  assert.equal(await page.locator('dialog[open]').count(),0);
  assert.match(await page.locator('.person-status').innerText(),/未偵測到人物/);
  await page.screenshot({path:`${output}/engine-waiting.png`});
  if (!sample.scene.paused) await page.locator('[data-action=pause]').click();
  report.waitedWithoutAutomaticRest=true;
  await page.locator('[data-action=home]').click();await page.locator('[data-action=start]').waitFor();
  report.cameraTracks=await page.evaluate(()=>window.__engineStream.getTracks().map(t=>t.readyState));assert.ok(report.cameraTracks.every(s=>s==='ended'));
  assert.deepEqual(report.errors,[]);report.status='PASS';
}catch(error){report.status='FAIL';report.failure=String(error);throw error;}
finally{await writeFile(`${output}/engine-report.json`,JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify(report,null,2));}
