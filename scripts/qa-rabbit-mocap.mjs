import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.QA_URL ?? 'http://127.0.0.1:5173/';
const output = process.env.QA_OUTPUT ?? '/private/tmp/motion-garden-4b-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
const report = { status: 'RUNNING', browser: browser.version(), input: 'Virtual webcam + simulated Landmarker output through existing PoseEstimator scheduler; NOT a human mocap test', checks: [], errors: [], warnings: [] };
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); if(message.type()==='warning')report.warnings.push(message.text()); });
const check = (name, detail) => report.checks.push({name,result:'PASS',detail});
const snapshot = () => page.evaluate(async () => (await import('/src/main.ts')).game.scene.getScene('CarrotPull').getDebugSnapshot());
const wait = async (predicate, timeout=15000) => {
  const end=Date.now()+timeout;
  while(Date.now()<end){const value=await snapshot();if(predicate(value))return value;await page.waitForTimeout(60);}
  throw new Error(`Snapshot timeout: ${JSON.stringify(await snapshot())}`);
};
const fixture = values => page.evaluate(values=>Object.assign(window.__mocapFixture,values),values);
try {
  await page.goto(`${base}?rabbit3dDebug=1&mocapDebug=1`);
  await page.locator('[data-action=start]').click();await page.locator('[data-action=carrot]').click();
  await page.waitForSelector('.mocap-debug');
  assert.match(await page.title(),/動態花園/);assert.equal(await page.locator('vite-error-overlay').count(),0);
  check('Page identity, nonblank, no framework overlay, 3D rabbit and debug UI');
  await page.evaluate(async()=>{
    const {PoseEstimator}=await import('/src/game/vision/PoseEstimator.ts');
    window.__mocapFixture={left:0,right:0,knee:170,lean:0,shift:0,lost:false,leftHidden:false};
    window.__mocapStats={models:0,inferences:0,closed:0,timestamps:[]};
    const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async options=>{const stream=await original(options);window.__qaStream=stream;return stream;};
    // Replace only Landmarker output; camera ownership and the existing inference scheduler stay real.
    PoseEstimator.prototype.initialize=function(){
      if(!this.landmarker){window.__mocapStats.models++;
        this.landmarker={close(){window.__mocapStats.closed++;},detectForVideo(video,timestamp){
          const f=window.__mocapFixture;const stats=window.__mocapStats;stats.inferences++;stats.timestamps.push(timestamp);
          if(f.lost)return {landmarks:[]};
          const w=video.videoWidth,h=video.videoHeight,c=w*(.5+f.shift),shoulderY=h*.28,hipY=h*.52;
          const offset=Math.tan(f.lean*Math.PI/180)*(hipY-shoulderY);
          const point=(x,y,visibility=.99)=>({x:x/w,y:y/h,z:0,visibility,presence:.99});
          const p=Array.from({length:33},()=>point(c,h*.5));
          for(const [s,e,r,hip,k,a,sign,angle]of [[11,13,15,23,25,27,1,f.left],[12,14,16,24,26,28,-1,f.right]]){
            const x=c+sign*h*.12,rad=angle*Math.PI/180,drop=(180-f.knee)*Math.PI/180;
            p[s]=point(x+offset,shoulderY);p[e]=point(x+offset+sign*Math.sin(rad)*h*.13,shoulderY+Math.cos(rad)*h*.13);
            p[r]=point(x+offset+sign*Math.sin(rad)*h*.25,shoulderY+Math.cos(rad)*h*.25);
            p[hip]=point(x,hipY);p[k]=point(x,h*.69);p[a]=point(x+Math.sin(drop)*h*.17,h*.69+Math.cos(drop)*h*.17);
          }
          if(f.leftHidden)for(const index of [13,15])p[index].visibility=.1;
          return {landmarks:[p]};
        }};
      }
      return Promise.resolve();
    };
  });
  await page.locator('[data-mocap-action=toggle]').click();
  assert.equal(await page.locator('.rabbit-3d-debug').count(),0);
  await page.locator('[data-input-action=camera]').click();
  await wait(s=>s.rabbit3d.mocap.referenceReady);
  assert.equal(await page.locator('.calibration-panel,[data-calibration-state]').count(),0);
  const profile=await page.evaluate(async()=>{
    const scene=(await import('/src/main.ts')).game.scene.getScene('CarrotPull');
    const expected=(await import('/src/game/settings/motionRange.ts')).manualMotionRange();
    return {actual:scene.motion.active.getCalibration(),expected};
  });
  assert.deepEqual(profile.actual,profile.expected);
  assert.equal(profile.actual.timestamp,0);
  assert.equal((await snapshot()).rabbit3d.controlSource,'mocap');
  check('Camera starts without calibration UI and uses configured motion range',profile.actual);
  check('Runtime natural reference acquired automatically from reliable tracking');
  await page.waitForTimeout(200);await page.screenshot({path:`${output}/standing.png`});
  const rest=await snapshot();
  for(const angle of [15,30,45,60]){await fixture({left:angle});await page.waitForTimeout(140);}
  await wait(s=>s.rabbit3d.mocap.smoothed.leftArmElevation>59);
  const raised=await snapshot();
  assert.ok(raised.rabbit3d.mocap.boneDeltasDegrees['upper_arm.L']>40);
  assert.ok(raised.rabbit3d.mocap.boneDeltasDegrees['upper_arm.R']<.01);
  assert.ok(raised.rabbit3d.mocap.raw.leftArmElevation>59);
  check('Continuous anatomical left arm moves actual left GLB bone, right stays independent');
  for(const angle of [15,30,45,60]){await fixture({right:angle});await page.waitForTimeout(140);}
  await fixture({lean:8,knee:(profile.actual.standingAngle+profile.actual.bendingAngle)/2,shift:.035});await page.waitForTimeout(800);
  let value=await snapshot();
  assert.ok(value.rabbit3d.mocap.smoothed.rightArmElevation>50);
  assert.ok(value.rabbit3d.mocap.smoothed.torsoLean>6);
  assert.ok(Math.abs(value.rabbit3d.mocap.mapped.bendAmount-.5)<.03);
  assert.ok(value.rabbit3d.mocap.smoothed.lateralOffset<0);
  assert.notDeepEqual(value.rabbit3d.quaternions['shin.L'],rest.rabbit3d.quaternions['shin.L']);
  report.performance={mediaPipeFps:value.rabbit3d.mocap.mediaPipeFps,threeFps:value.rabbit3d.fps,kind:'Simulated output, real shared scheduler/render loop'};
  check('Both arms, torso, configured continuous knee and mirrored relative translation drive real rig');
  await page.screenshot({path:`${output}/continuous-pose.png`});
  await fixture({leftHidden:true});await page.waitForTimeout(800);
  value=await snapshot();assert.equal(value.rabbit3d.mocap.mapped.leftArmElevation,0);assert.ok(value.rabbit3d.mocap.smoothed.rightArmElevation>50);
  check('Partial low-confidence arm returns neutral while reliable other arm continues');
  await fixture({leftHidden:false,lean:-8,shift:-.035,knee:170});await page.waitForTimeout(700);
  value=await snapshot();assert.ok(value.rabbit3d.mocap.smoothed.torsoLean<-6);assert.ok(value.rabbit3d.mocap.smoothed.lateralOffset>0);
  check('Opposite torso/root directions and tracking recovery');
  await fixture({lost:true});await page.waitForTimeout(320);
  const holding=await snapshot();assert.equal(holding.rabbit3d.mocap.trackingState,'holding');
  await page.waitForTimeout(500);value=await snapshot();assert.equal(value.rabbit3d.mocap.trackingState,'returning-neutral');
  assert.ok(value.rabbit3d.mocap.smoothed.rightArmElevation<holding.rabbit3d.mocap.smoothed.rightArmElevation);
  await fixture({lost:false});await wait(s=>s.rabbit3d.mocap.trackingState==='tracking');
  check('Short loss holds, sustained loss returns gradually, fresh tracking recovers');
  await page.locator('[data-action=pause]').click();const paused=await snapshot();await page.waitForTimeout(300);
  assert.equal((await snapshot()).rabbit3d.renderedFrames,paused.rabbit3d.renderedFrames);
  await page.locator('[data-action=resume]').click();await wait(s=>s.rabbit3d.mocap.trackingState==='tracking');
  assert.equal((await snapshot()).animationPaused,true);
  check('Pause/Resume preserves reference and hidden sprite remains paused');
  await page.locator('[data-mocap-action=toggle]').click();await page.waitForTimeout(200);
  assert.equal((await snapshot()).rabbit3d.controlSource,'manual');assert.equal(await page.locator('.rabbit-3d-debug').count(),1);
  await page.locator('[data-mocap-action=toggle]').click();assert.equal(await page.locator('.rabbit-3d-debug').count(),0);
  await fixture({left:0,right:0,lean:0,shift:0});await wait(s=>s.rabbit3d.mocap.referenceReady);
  await page.locator('[data-mocap-action=reference]').click();assert.equal((await snapshot()).rabbit3d.mocap.referenceReady,false);
  await wait(s=>s.rabbit3d.mocap.referenceReady);
  check('Mocap/manual mutual exclusion, stop and reference reset');
  for(const viewport of [{width:1440,height:900},{width:900,height:700},{width:600,height:800}]){
    await page.setViewportSize(viewport);await page.waitForTimeout(250);
    assert.equal((await snapshot()).rabbit3d.status,'ready');
    const overlap=await page.evaluate(()=>{const a=document.querySelector('.rabbit-tools').getBoundingClientRect(),b=document.querySelector('.pose-preview').getBoundingClientRect();return Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));});
    assert.equal(overlap,0);
    await page.screenshot({path:`${output}/resize-${viewport.width}.png`});
  }
  await page.setViewportSize({width:1512,height:982});
  await page.evaluate(async()=>(await import('/src/main.ts')).game.scene.getScene('CarrotPull').rabbit3d.overlay.renderer.forceContextLoss());
  await wait(s=>s.rabbit3d.mode==='sprite');assert.equal(await page.locator('.mocap-debug').count(),0);
  assert.equal((await snapshot()).rabbit3d.spriteVisible,true);
  await fixture({lost:true});await wait(s=>s.paused,5000);
  check('WebGL fallback preserves sprite and existing 3s tracking-loss safety pause');
  await page.locator('[data-action=home]').click();await page.locator('[data-action=start]').waitFor();
  const resources=await page.evaluate(async()=>({tracks:window.__qaStream.getTracks().map(t=>t.readyState),stats:window.__mocapStats,textures:(await import('/src/main.ts')).game.textures.getTextureKeys().filter(key=>key.startsWith('rabbit-three-'))}));
  assert.ok(resources.tracks.every(state=>state==='ended'));assert.equal(resources.stats.models,1);assert.equal(resources.stats.closed,1);assert.equal(resources.textures.length,0);
  assert.equal(await page.locator('.mocap-debug,.rabbit-tools,.pose-preview').count(),0);
  report.resources={tracks:resources.tracks,models:resources.stats.models,inferences:resources.stats.inferences,closed:resources.stats.closed,textures:resources.textures};
  const timestamps=resources.stats.timestamps;assert.ok(timestamps.every((v,i)=>i===0||v>timestamps[i-1]));
  check('One estimator model, ordered inference, webcam ended, Three/debug cleanup on home',report.resources);
  assert.deepEqual(report.errors,[]);check('Console health');report.status='PASS';
} catch(error){report.status='FAIL';report.failure=String(error);await page.screenshot({path:`${output}/failure.png`});throw error;}
finally {await writeFile(`${output}/browser-report.json`,JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify(report,null,2));}
