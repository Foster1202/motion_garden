/* Verify asset format using the installed parser, without starting a game. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const JSONHash = require('../../../node_modules/phaser/src/textures/parsers/JSONHash.js');
const Frame = require('../../../node_modules/phaser/src/textures/Frame.js');
const version = require('../../../node_modules/phaser/package.json').version;
const root = path.resolve(__dirname, '../..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'dist/rabbit/rabbit_animations.json')));
const results = {};
for (const [action, animation] of Object.entries(config)) {
  const atlas = JSON.parse(fs.readFileSync(path.join(root, 'dist/rabbit', animation.atlas)));
  const texture = {
    source: [{width: atlas.meta.size.w, height: atlas.meta.size.h}],
    customData: {}, frames: {},
    add(name, source, x, y, width, height) {
      assert.equal(this.frames[name], undefined);
      return this.frames[name] = new Frame(this, name, source, x, y, width, height);
    },
  };
  JSONHash(texture, 0, atlas);
  assert.equal(Object.keys(texture.frames).length, animation.frames.length + 1);
  for (const frame of animation.frames) {
    assert.equal(frame.key, animation.texture);
    const actual = texture.frames[frame.frame];
    assert.ok(actual);
    assert.equal(actual.realWidth, 512);
    assert.equal(actual.realHeight, 512);
    assert.equal(actual.customPivot, true);
    assert.equal(actual.pivotX, animation.origin.x);
    assert.equal(actual.pivotY, animation.origin.y);
    assert.equal(actual.customData.duration, 1000 / animation.frameRate);
  }
  results[action] = {framesParsed: animation.frames.length, pivotRetained: true};
}
const report = {status: 'PASS', phaserVersion: version, parser: 'JSONHash', actions: results,
  scope: 'Texture parser and Frame only; no Scene, animations or game integration created'};
fs.writeFileSync(path.join(root, 'qa/rabbit/phaser_atlas_validation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
