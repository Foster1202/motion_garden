import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageRoot = join(root, 'node_modules/@mediapipe/tasks-vision');
const target = join(root, 'public/mediapipe');
const modelPath = join(target, 'models/pose_landmarker_lite.task');
const modelSha256 = '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a';
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const model = await readFile(modelPath);
if (sha256(model) !== modelSha256) throw new Error('Pose Landmarker Lite model checksum mismatch.');
const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
await mkdir(join(target, 'wasm'), { recursive: true });
await cp(join(packageRoot, 'wasm'), join(target, 'wasm'), { recursive: true });
const files = {};
for (const filename of (await readdir(join(target, 'wasm'))).sort()) {
  files[`wasm/${filename}`] = sha256(await readFile(join(target, 'wasm', filename)));
}
await writeFile(join(target, 'manifest.json'), `${JSON.stringify({
  package: '@mediapipe/tasks-vision', version: packageJson.version,
  model: 'Pose Landmarker Lite float16 version 1',
  modelSource: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  modelSha256,
  files,
}, null, 2)}\n`);
console.log(`Synced MediaPipe ${packageJson.version} WASM and verified Pose Landmarker Lite model.`);
