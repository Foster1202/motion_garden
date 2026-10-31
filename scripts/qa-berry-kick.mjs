import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const url=process.env.QA_URL??'http://127.0.0.1:5175/',out=process.env.QA_OUTPUT??'/tmp/berry-kick-qa';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],checks=[],fps=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const snap=()=>page.evaluate(async()=>(await import('/src/main.ts')).game.scene.getScene('BerryKick').snapshot());
const wait=async predicate=>{for(let i=0;i<150;i++){const s=await snap();if(predicate(s))return s;await page.waitForTimeout(100);}throw Error(JSON.stringify(await snap()));};
const hold=async(key,ms)=>{await page.keyboard.down(key);await page.waitForTimeout(ms);await page.keyboard.up(key);};
try{
 await page.goto(url);await page.locator('[data-action=start]').click();await page.locator('[data-action=berry]').click();await page.locator('[data-action=keyboard]').click();await wait(s=>s.renderMode==='3d');
 assert.match(await page.title(),/動態花園/);assert.equal(await page.locator('vite-error-overlay').count(),0);await page.waitForTimeout(1000);await page.screenshot({path:`${out}/garden-1920.png`});checks.push('Page identity, nonblank, GLB, no framework overlay');
 await hold('q',800);assert.equal((await snap()).score,0);await page.waitForTimeout(500);checks.push('Extension away from tree rejected');
 await hold('a',1800);await page.waitForTimeout(500);assert.equal((await snap()).score,0);await hold('e',600);assert.equal((await snap()).score,0);await page.waitForTimeout(400);checks.push('Translation and wrong foot rejected');
 for(let i=1;i<=3;i++){await page.keyboard.down('q');const s=await wait(s=>s.score===i);fps.push(s.fps);assert.ok(s.feet.left.x>=s.zones.left.x&&s.feet.left.x<=s.zones.left.x+s.zones.left.width);
 if(i===1){await page.screenshot({path:`${out}/left-contact.png`});await page.waitForTimeout(350);await page.screenshot({path:`${out}/berries-falling.png`});await page.waitForTimeout(950);assert.equal((await snap()).score,1);await page.keyboard.press('Escape');const p=await snap();await page.waitForTimeout(400);assert.equal((await snap()).clock,p.clock);await page.locator('[data-action=resume]').click();}
 await page.keyboard.up('q');await page.waitForTimeout(1150);}
 checks.push('Left3, geometric contact, held-leg prevention, retract, cooldown, pause');await page.setViewportSize({width:1512,height:982});await page.waitForTimeout(300);await page.screenshot({path:`${out}/garden-1512.png`});
 await hold('d',3100);await page.waitForTimeout(500);
 for(let i=4;i<=6;i++){await page.keyboard.down('e');const s=await wait(s=>s.score===i);fps.push(s.fps);assert.ok(s.feet.right.x>=s.zones.right.x&&s.feet.right.x<=s.zones.right.x+s.zones.right.width);await page.keyboard.up('e');await page.waitForTimeout(1150);}
 await wait(s=>s.completeShown);assert.match(await page.locator('dialog').innerText(),/成功收集 6 次莓果/);await page.screenshot({path:`${out}/complete.png`});checks.push('Resize and full keyboard6 completion');
 await page.locator('dialog [data-action=restart]').click();await page.locator('[data-action=keyboard]').click();assert.equal((await snap()).score,0);await page.locator('[data-action=home]').click();assert.equal(await page.locator('.berry-camera').count(),0);checks.push('Restart and scene cleanup');
 await page.locator('[data-action=start]').click();await page.screenshot({path:`${out}/menu.png`});assert.equal(await page.locator('[data-action=carrot]').count(),1);assert.equal(await page.locator('.game-card[disabled]').count(),2);
 await page.route('**/rabbit_realtime.glb',r=>r.abort());await page.locator('[data-action=berry]').click();await wait(s=>s.failed);assert.match(await page.locator('dialog').innerText(),/計分已停用/);await hold('q',300);assert.equal((await snap()).score,0);checks.push('Model failure disables scoring');
 assert.deepEqual(errors.filter(e=>!e.includes('net::ERR_FAILED')),[]);await writeFile(`${out}/results.json`,JSON.stringify({checks,fps,errors,url,browser:browser.version()},null,2));console.log(JSON.stringify({checks,fps,errors,out},null,2));
}catch(e){await page.screenshot({path:`${out}/failure.png`});console.error(await snap().catch(()=>({})));throw e;}finally{await browser.close();}
