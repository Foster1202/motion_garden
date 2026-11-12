import { copyFile, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const actions = ['idle', 'bend', 'grab', 'return', 'pull', 'celebrate'];
const rabbitFiles = actions.flatMap(action => [`rabbit_${action}.png`, `rabbit_${action}.json`])
  .concat(['rabbit_animations.json', 'rabbit_attachment_points.json']);
const sceneLayers = ['background_far', 'background_mid', 'platform', 'foreground', 'soil_patch', 'carrot', 'basket'];
const sceneMetadataFile = 'carrot_scene_assets.json';
const groups = [
  { name: 'berry_kick', source: path.join(root, 'model/dist/berry_kick'), files: ['berry_background.png', 'berry_foreground.png', 'berry_tree_left.png', 'berry_tree_right.png', 'berry.png', 'berry_basket.png', 'manifest.json', 'tree-art-v2.json'] },
  { name: 'rabbit', source: path.join(root, 'model/dist/rabbit'), files: rabbitFiles },
  { name: 'rabbit3d', source: path.join(root, 'model/dist/rabbit3d'), files: ['rabbit_realtime.glb'], optionalFiles: ['rabbit_realtime_v3.glb'] },
  { name: 'carrot3d', source: path.join(root, 'model/dist/carrot3d'), files: ['carrot_realtime.glb'] },
  { name: 'carrot_pull', source: path.join(root, 'model/assets/rendered/carrot_pull'),
    files: [...sceneLayers.map(layer => `${layer}.png`), sceneMetadataFile] },
];

// Validate both sources before replacing either public asset group.
for (const group of groups) {
  const available = await readdir(group.source);
  group.files.push(...(group.optionalFiles ?? []).filter(file => available.includes(file)));
  for (const file of group.files) {
    if (!available.includes(file)) throw new Error(`${group.name} asset missing: ${path.join(group.source, file)}`);
    if (file.endsWith('.json')) JSON.parse(await readFile(path.join(group.source, file), 'utf8'));
  }
}
const sceneSource = groups.find(group => group.name === 'carrot_pull').source;
const metadata = JSON.parse(await readFile(path.join(sceneSource, sceneMetadataFile), 'utf8'));
if (metadata.schemaVersion !== 1 || metadata.canvas?.join(',') !== '1920,1080') {
  throw new Error('Carrot Pull scene metadata is missing or incompatible');
}
for (const layer of sceneLayers) {
  const spec = metadata.layers?.[layer];
  if (spec?.file !== `${layer}.png`) throw new Error(`Invalid Carrot Pull layer metadata: ${layer}`);
  const bytes = await readFile(path.join(sceneSource, spec.file));
  if (createHash('sha256').update(bytes).digest('hex') !== spec.sha256) {
    throw new Error(`Carrot Pull asset does not match metadata: ${spec.file}`);
  }
}

for (const group of groups) {
  const destination = path.join(root, 'public/assets', group.name);
  const staging = `${destination}.syncing`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  for (const file of group.files) await copyFile(path.join(group.source, file), path.join(staging, file));
  await rm(destination, { recursive: true, force: true });
  await rename(staging, destination);
  console.log(`Synced ${group.files.length} ${group.name} assets to public/assets/${group.name}`);
}
