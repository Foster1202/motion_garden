import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const durations = { click: .13, grab: .32, success: .78, berry: .46, complete: 2.45 };

test('bundled original effects are complete, gentle mono PCM WAV files', () => {
  for (const [id, duration] of Object.entries(durations)) {
    const bytes = readFileSync(new URL(`../public/assets/audio/${id}.wav`, import.meta.url));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    assert.equal(bytes.toString('ascii', 12, 16), 'fmt ');
    assert.equal(bytes.readUInt16LE(20), 1);
    assert.equal(bytes.readUInt16LE(22), 1);
    assert.equal(bytes.readUInt32LE(24), 44100);
    assert.equal(bytes.readUInt16LE(34), 16);
    assert.equal(bytes.toString('ascii', 36, 40), 'data');
    assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
    assert.equal(bytes.length - 44, Math.round(duration * 44100) * 2);
    let peak = 0;
    for (let offset = 44; offset < bytes.length; offset += 2) {
      peak = Math.max(peak, Math.abs(bytes.readInt16LE(offset)) / 32768);
    }
    assert.ok(peak > .01 && peak <= .231, `${id} has a bounded nonzero signal`);
    assert.equal(bytes.readInt16LE(44), 0);
    assert.ok(Math.abs(bytes.readInt16LE(bytes.length - 2)) < 5);
  }
});
