import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const repository = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('assets/audio-sources/voice-processing.json', repository), 'utf8')) as {
  clips: {
    id: string;
    source: { path: string; sha256: string };
    output: { path: string; sha256: string; metrics: { frames: number; duration_seconds: number } };
  }[];
  reserves: { id: string; status: string; source: { path: string; sha256: string }; output: null }[];
};
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('selected Cantonese recordings retain source provenance and ship bounded complete mono voice files', () => {
  const expected = [
    'berry-complete', 'berry-ready', 'berry-success', 'calibration-bend', 'calibration-standing',
    'carrot-complete', 'carrot-grabbed', 'carrot-ready', 'carrot-success', 'next-carrot',
    'rest', 'retry', 'safety', 'tracking-lost',
  ];
  assert.deepEqual(manifest.clips.map(clip => clip.id).sort(), expected);
  assert.deepEqual(readdirSync(new URL('public/assets/audio/voice/', repository)).sort(), expected.map(id => `${id}.wav`));
  for (const clip of manifest.clips) {
    const source = readFileSync(new URL(clip.source.path, repository));
    assert.equal(hash(source), clip.source.sha256, `${clip.id} retains its recorded source`);
    const bytes = readFileSync(new URL(clip.output.path, repository));
    assert.equal(hash(bytes), clip.output.sha256, `${clip.id} matches its processing manifest`);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    assert.equal(bytes.readUInt16LE(20), 1);
    assert.equal(bytes.readUInt16LE(22), 1);
    assert.equal(bytes.readUInt32LE(24), 44100);
    assert.equal(bytes.readUInt16LE(34), 16);
    assert.equal(bytes.toString('ascii', 36, 40), 'data');
    assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
    assert.equal(bytes.length - 44, clip.output.metrics.frames * 2);
    assert.ok(clip.output.metrics.duration_seconds > .4 && clip.output.metrics.duration_seconds <= 6);
    let peak = 0;
    for (let offset = 44; offset < bytes.length; offset += 2) {
      peak = Math.max(peak, Math.abs(bytes.readInt16LE(offset)) / 32768);
    }
    assert.ok(peak > .01 && peak <= .65, `${clip.id} has a nonzero bounded signal`);
    assert.equal(bytes.readInt16LE(44), 0);
    assert.equal(bytes.readInt16LE(bytes.length - 2), 0);
  }
  assert.equal(manifest.reserves.length, 1);
  assert.equal(manifest.reserves[0].id, 'praise');
  assert.equal(manifest.reserves[0].status, 'source-reserve');
  assert.equal(manifest.reserves[0].output, null);
  assert.equal(hash(readFileSync(new URL(manifest.reserves[0].source.path, repository))), manifest.reserves[0].source.sha256);
});
