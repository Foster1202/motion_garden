import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const output = fileURLToPath(new URL('../qa/rig-v3/', import.meta.url));
const renders = path.join(output, 'renders');
const manifest = JSON.parse(await readFile(path.join(renders, 'render-manifest.json'), 'utf8'));
const temporary = '/private/tmp/motion-garden-v3-contact-sheets';
await mkdir(temporary, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1320, height: 900 }, deviceScaleFactor: 1 });
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const labels = {
  rest: '自然站立', both_90: '雙臂側抬 90°', both_120: '雙臂側抬 120°',
  both_150: '雙臂側抬 150°', forward_120: '雙臂前抬 120°',
  diagonal_120: '斜向舉手 120°', elbow_110: '手肘彎曲 110°',
  raised_elbow_45: '舉手 120° ＋ 屈肘 45°', lean: '身體側傾',
  knee_50: '淺屈膝 50%', knee_100: '淺屈膝 100%',
  combined: '舉手 ＋ 屈肘 ＋ 側傾 ＋ 淺屈膝',
  elbow_detail: '肘部細節 110°', knee_detail: '膝蓋與腳踝細節 100%',
  unsupported_150_elbow_110: '未支援組合，舉手 150° ＋ 屈肘 110°',
};
const views = { front: '正面', quarter: '3/4 視角', side: '側面' };

function tile(version, pose, view) {
  const entry = manifest.images.find(image => image.version === version && image.pose.name === pose && image.view === view);
  assert.ok(entry, `Missing Blender render ${version}/${pose}/${view}`);
  const imageUrl = pathToFileURL(path.join(renders, entry.image)).href;
  return `<figure><img src="${escape(imageUrl)}"><figcaption>${escape(version.toUpperCase())} · ${escape(views[view])}</figcaption></figure>`;
}

async function sheet(name, title, subtitle, columns, rows) {
  const body = rows.map(({ pose, tiles }) => `<section><h2>${escape(labels[pose] ?? pose)}</h2><div class="row">${tiles.join('')}</div></section>`).join('');
  const html = `<!doctype html><html lang="zh-HK"><meta charset="utf-8"><title>${escape(title)}</title>
    <style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#f5f3e9;color:#294d3a;font-family:"PingFang HK",sans-serif;width:${columns * 320 + 48}px}h1{font-size:28px;margin:0 0 8px}p{font-size:15px;line-height:1.5;margin:0 0 18px}section{margin-top:15px}h2{font-size:18px;margin:0 0 7px}.row{display:grid;grid-template-columns:repeat(${columns},1fr);gap:8px}figure{margin:0;background:#fff;border:1px solid #d6dfca;border-radius:8px;overflow:hidden}img{display:block;width:100%;aspect-ratio:1}figcaption{padding:8px;text-align:center;font-size:15px;font-weight:600}</style>
    <h1>${escape(title)}</h1><p>${escape(subtitle)}</p>${body}</html>`;
  const documentPath = path.join(temporary, name + '.html');
  await writeFile(documentPath, html);
  await page.setViewportSize({ width: columns * 320 + 48, height: 900 });
  await page.goto(pathToFileURL(documentPath).href);
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
  await page.evaluate(() => document.fonts.ready);
  const height = await page.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
  await page.setViewportSize({ width: columns * 320 + 48, height });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: path.join(output, name + '.png'), fullPage: false });
}

try {
  const consistent = 'Blender Cycles、線性蒙皮。各版本保持相同視角、燈光和站立顯示高度。';
  for (const [name, poses] of [
    ['contact-v3-upper', ['rest', 'both_90', 'both_120', 'both_150', 'forward_120', 'diagonal_120', 'raised_elbow_45']],
    ['contact-v3-body-legs', ['elbow_110', 'lean', 'knee_50', 'knee_100', 'combined']],
  ]) {
    await sheet(name, '阿兔 V3 動作驗收', consistent, 3,
      poses.map(pose => ({ pose, tiles: ['front', 'quarter', 'side'].map(view => tile('v3', pose, view)) })));
  }
  await sheet('comparison-v2-v3', '阿兔 V2 ／ V3 比較',
    consistent + ' V2 高舉姿勢為未限幅幾何測試。', 4,
    ['rest', 'both_90', 'both_120', 'both_150', 'forward_120', 'elbow_110', 'knee_100', 'combined']
      .map(pose => ({ pose, tiles: [tile('v2', pose, 'front'), tile('v3', pose, 'front'),
        tile('v2', pose, 'quarter'), tile('v3', pose, 'quarter')] })));
  await sheet('joint-details-v2-v3', '阿兔肘部、膝蓋及腳踝', consistent, 4,
    ['elbow_detail', 'knee_detail'].map(pose => ({ pose,
      tiles: [tile('v2', pose, 'quarter'), tile('v3', pose, 'quarter'), tile('v2', pose, 'side'), tile('v3', pose, 'side')] })));
  await sheet('unsupported-combinations', '超出驗收範圍的組合姿勢',
    '以下保留未限幅的失敗姿勢，顯示大幅舉手與屈肘仍然存在的幾何限制。', 3,
    [{ pose: 'unsupported_150_elbow_110', tiles: ['front', 'quarter', 'side'].map(view => tile('v3', 'unsupported_150_elbow_110', view)) }]);
  console.log(`Saved five Blender contact sheets to ${output}`);
} finally {
  await browser.close();
}
