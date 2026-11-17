import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioManager } from '../src/game/systems/AudioManager';
import { DEFAULT_GAME_SETTINGS, GAME_SETTINGS_CHANGED_EVENT, saveGameSettings } from '../src/game/settings/gameSettings';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const settle = async () => {
  for (let turn = 0; turn < 12; turn++) await Promise.resolve();
};

class FakeAudioParam {
  value = 1;
  immediateValues: number[] = [];
  cancelScheduledValues(_time: number) {}
  setValueAtTime(value: number, _time: number) { this.value = value; this.immediateValues.push(value); }
  setTargetAtTime(value: number) { this.value = value; }
}

class FakeNode {
  disconnected = false;
  connect(_destination: unknown) {}
  disconnect() { this.disconnected = true; }
}

class FakeGain extends FakeNode {
  gain = new FakeAudioParam();
}

class FakeCompressor extends FakeNode {
  threshold = new FakeAudioParam();
  knee = new FakeAudioParam();
  ratio = new FakeAudioParam();
  attack = new FakeAudioParam();
  release = new FakeAudioParam();
}

interface FakeBuffer { duration: number; url: string }

class FakeSource extends FakeNode {
  buffer?: FakeBuffer;
  loop = false;
  onended: (() => void) | null = null;
  starts: { when: number; offset: number }[] = [];
  gainsAtStart?: number[];
  stops = 0;
  constructor(private readonly gains: readonly FakeGain[]) { super(); }
  start(when: number, offset: number) {
    this.starts.push({ when, offset });
    this.gainsAtStart = this.gains.map(node => node.gain.value);
  }
  stop() { this.stops++; }
  finish() { this.onended?.(); }
}

class FakeAudioContext {
  state = 'suspended';
  currentTime = 0;
  destination = new FakeNode();
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  compressor = new FakeCompressor();
  decoded: string[] = [];
  closeCalls = 0;
  resumeCalls = 0;
  rejectResume = false;
  decode?: (url: string) => Promise<FakeBuffer>;
  createGain() { const gain = new FakeGain(); this.gains.push(gain); return gain; }
  createDynamicsCompressor() { return this.compressor; }
  createBufferSource() { const source = new FakeSource(this.gains); this.sources.push(source); return source; }
  async decodeAudioData(bytes: ArrayBuffer) {
    const url = new TextDecoder().decode(bytes);
    this.decoded.push(url);
    return this.decode ? this.decode(url) : { duration: 10, url };
  }
  async resume() {
    this.resumeCalls++;
    if (this.rejectResume) throw new Error('gesture required');
    this.state = 'running';
  }
  async close() { this.closeCalls++; this.state = 'closed'; }
}

function audioResponse(url: string, ok = true): Response {
  return { ok, status: ok ? 200 : 503,
    arrayBuffer: async () => new TextEncoder().encode(url).buffer,
  } as Response;
}

function setupAudio(options: {
  supported?: boolean;
  respond?: (url: string, attempt: number) => Response | Promise<Response>;
} = {}) {
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  };
  const events = new EventTarget();
  const documentEvents = Object.assign(new EventTarget(), { hidden: false });
  const values = new Map<string, string>();
  const fetches: { url: string; signal?: AbortSignal | null }[] = [];
  const attempts = new Map<string, number>();
  let context: FakeAudioContext | undefined;
  class Context extends FakeAudioContext {
    constructor() { super(); context = this; }
  }
  replace('AudioContext', options.supported === false ? undefined : Context);
  replace('webkitAudioContext', undefined);
  replace('document', documentEvents);
  replace('window', events);
  replace('navigator', { userActivation: { hasBeenActive: false } });
  replace('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  replace('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    fetches.push({ url, signal: init?.signal });
    const attempt = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, attempt);
    return options.respond?.(url, attempt) ?? audioResponse(url);
  });
  const audio = new AudioManager();
  return {
    audio, events, documentEvents, fetches, values,
    context: () => { assert.ok(context); return context; },
    restore: () => {
      try { audio.destroy(); }
      finally {
        for (const [key, descriptor] of descriptors) {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor);
          else Reflect.deleteProperty(globalThis, key);
        }
      }
    },
  };
}

test('effects decode once, require unlock, and drop events received during loading', async () => {
  const pending = deferred<Response>();
  const fixture = setupAudio({ respond: url => url.endsWith('/grab.wav') ? pending.promise : audioResponse(url) });
  try {
    const { audio } = fixture;
    assert.equal(audio.snapshot().unlocked, false);
    fixture.documentEvents.dispatchEvent(new Event('keydown'));
    await settle();
    assert.equal(fixture.context().resumeCalls, 0);
    audio.playSfx('click');
    assert.equal(fixture.context().sources.length, 0);
    await audio.unlock();
    audio.playSfx('grab');
    pending.resolve(audioResponse('/assets/audio/grab.wav'));
    await audio.preload();
    assert.equal(fixture.context().sources.length, 0);
    assert.deepEqual(new Set(audio.snapshot().loadedSfx), new Set(['click', 'grab', 'success', 'berry', 'complete']));
    audio.playSfx('grab');
    assert.equal(audio.snapshot().active.sfx, 1);
    assert.equal(audio.snapshot().playedSfx.grab, 1);
    await audio.preload();
    assert.equal(fixture.fetches.length, 5);
  } finally { fixture.restore(); }
});

test('unlock retries rejected browser activation without queuing transient sounds', async () => {
  const fixture = setupAudio();
  try {
    await fixture.audio.preload();
    fixture.context().rejectResume = true;
    await fixture.audio.unlock();
    fixture.audio.playSfx('click');
    assert.equal(fixture.audio.snapshot().unlocked, false);
    assert.equal(fixture.context().sources.length, 0);
    fixture.context().rejectResume = false;
    await fixture.audio.unlock();
    assert.equal(fixture.context().sources.length, 0);
    fixture.audio.playSfx('click');
    assert.equal(fixture.audio.snapshot().active.sfx, 1);
  } finally { fixture.restore(); }
});

test('SFX debounce rejects duplicate events while polyphony keeps the newest six effects', async () => {
  const fixture = setupAudio();
  try {
    await fixture.audio.preload();
    await fixture.audio.unlock();
    const context = fixture.context();
    fixture.audio.playSfx('berry');
    fixture.audio.playSfx('berry');
    context.currentTime = .044;
    fixture.audio.playSfx('berry');
    assert.equal(context.sources.length, 1);
    for (let hit = 1; hit < 8; hit++) {
      context.currentTime = hit * .05;
      fixture.audio.playSfx('berry');
    }
    assert.equal(fixture.audio.snapshot().playedSfx.berry, 8);
    assert.equal(fixture.audio.snapshot().active.sfx, 6);
    assert.equal(context.sources[0].stops, 1);
    assert.equal(context.sources[1].stops, 1);
    assert.equal(context.sources[0].disconnected, true);
    context.sources.at(-1)!.finish();
    assert.equal(fixture.audio.snapshot().active.sfx, 5);
    fixture.audio.stopAll();
    fixture.audio.playSfx('click');
    context.currentTime += .079;
    fixture.audio.playSfx('click');
    assert.equal(fixture.audio.snapshot().playedSfx.click, 1);
    context.currentTime += .002;
    fixture.audio.playSfx('click');
    assert.equal(fixture.audio.snapshot().playedSfx.click, 2);
  } finally { fixture.restore(); }
});

test('persisted settings update active SFX gains, stop muted effects and retain other channel volumes', async () => {
  const fixture = setupAudio();
  try {
    await fixture.audio.preload();
    await fixture.audio.unlock();
    fixture.audio.playSfx('success');
    saveGameSettings({ ...DEFAULT_GAME_SETTINGS, sfxEnabled: false, sfxVolume: .35 });
    assert.equal(fixture.audio.snapshot().active.sfx, 0);
    assert.equal(fixture.audio.snapshot().sfxEnabled, false);
    assert.equal(fixture.audio.snapshot().volumes.sfx, .35);
    assert.equal(fixture.context().gains[1].gain.value, 0);
    assert.equal(fixture.context().gains[2].gain.value, .8);
    fixture.audio.playSfx('grab');
    assert.equal(fixture.audio.snapshot().playedSfx.grab, undefined);
    saveGameSettings({ ...DEFAULT_GAME_SETTINGS, sfxVolume: 0 });
    fixture.audio.playSfx('grab');
    assert.equal(fixture.audio.snapshot().active.sfx, 0);
    saveGameSettings({ ...DEFAULT_GAME_SETTINGS, sfxVolume: .4 });
    fixture.audio.playSfx('grab');
    assert.equal(fixture.audio.snapshot().active.sfx, 1);
    assert.equal(fixture.context().gains[1].gain.value, .4);
    fixture.audio.setVolume('voice', 2);
    fixture.audio.setVolume('bgm', -.5);
    fixture.audio.setVolume('voice', NaN);
    assert.equal(fixture.audio.snapshot().volumes.voice, 1);
    assert.equal(fixture.audio.snapshot().volumes.bgm, 0);
    assert.equal(fixture.context().compressor.threshold.value, -12);
    assert.equal(fixture.context().compressor.ratio.value, 8);
  } finally { fixture.restore(); }
});

test('voice requests are latest-wins and duck music only while the current recording plays', async () => {
  const old = deferred<Response>();
  const newer = deferred<Response>();
  const fixture = setupAudio({ respond: url => {
    if (url === '/voice-old.wav') return old.promise;
    if (url === '/voice-new.wav') return newer.promise;
    return audioResponse(url);
  } });
  try {
    await fixture.audio.preload();
    await fixture.audio.unlock();
    const oldRegistration = fixture.audio.registerVoice('ready', '/voice-old.wav');
    fixture.audio.playVoice('ready');
    const newRegistration = fixture.audio.registerVoice('bend', '/voice-new.wav');
    fixture.audio.playVoice('bend');
    newer.resolve(audioResponse('/voice-new.wav'));
    await newRegistration;
    await settle();
    assert.equal(fixture.audio.snapshot().active.voice, 1);
    assert.equal(fixture.context().sources.at(-1)!.buffer!.url, '/voice-new.wav');
    assert.equal(fixture.context().gains[3].gain.value, .25 * .3);
    old.resolve(audioResponse('/voice-old.wav'));
    await oldRegistration;
    await settle();
    assert.equal(fixture.context().sources.length, 1);
    fixture.context().sources.at(-1)!.finish();
    assert.equal(fixture.audio.snapshot().active.voice, 0);
    assert.equal(fixture.context().gains[3].gain.value, .25);
  } finally { fixture.restore(); }
});

test('replacing a registered voice invalidates its pending older recording', async () => {
  const pending = deferred<Response>();
  const fixture = setupAudio({ respond: url => url === '/voice-old.wav' ? pending.promise : audioResponse(url) });
  try {
    await fixture.audio.preload();
    await fixture.audio.unlock();
    const oldRegistration = fixture.audio.registerVoice('ready', '/voice-old.wav');
    fixture.audio.playVoice('ready');
    await fixture.audio.registerVoice('ready', '/voice-replacement.wav');
    pending.resolve(audioResponse('/voice-old.wav'));
    await oldRegistration;
    await settle();
    assert.equal(fixture.context().sources.length, 0);
    fixture.audio.playVoice('ready');
    await settle();
    assert.equal(fixture.context().sources.at(-1)!.buffer!.url, '/voice-replacement.wav');
    assert.equal(fixture.audio.snapshot().active.voice, 1);
  } finally { fixture.restore(); }
});

test('an unregistered prompt stops narration and immediately restores music volume', async () => {
  const fixture = setupAudio();
  try {
    await fixture.audio.preload();
    await fixture.audio.unlock();
    await fixture.audio.registerVoice('ready', '/ready.wav');
    fixture.audio.playVoice('ready');
    await settle();
    assert.equal(fixture.context().gains[3].gain.value, .25 * .3);
    fixture.audio.playVoice('retry');
    assert.equal(fixture.audio.snapshot().active.voice, 0);
    assert.equal(fixture.context().gains[3].gain.value, .25);
    assert.equal(fixture.context().sources[0].stops, 1);
  } finally { fixture.restore(); }
});

test('changing music selection invalidates pending playback and repeated selection has one loop', async () => {
  const old = deferred<Response>();
  const newer = deferred<Response>();
  const fixture = setupAudio({ respond: url => {
    if (url === '/music-old.wav') return old.promise;
    if (url === '/music-new.wav') return newer.promise;
    return audioResponse(url);
  } });
  try {
    await fixture.audio.unlock();
    const oldRegistration = fixture.audio.registerBgm('old', '/music-old.wav');
    const newRegistration = fixture.audio.registerBgm('new', '/music-new.wav');
    fixture.audio.playBgm('old');
    fixture.audio.playBgm('new');
    newer.resolve(audioResponse('/music-new.wav'));
    await newRegistration;
    await settle();
    old.resolve(audioResponse('/music-old.wav'));
    await oldRegistration;
    await settle();
    fixture.audio.playBgm('new');
    await settle();
    assert.equal(fixture.context().sources.length, 1);
    assert.equal(fixture.context().sources[0].buffer!.url, '/music-new.wav');
    assert.equal(fixture.context().sources[0].loop, true);
    assert.equal(fixture.audio.snapshot().bgmId, 'new');
    fixture.audio.stopBgm();
    assert.equal(fixture.audio.snapshot().active.bgm, 0);
    assert.equal(fixture.audio.snapshot().bgmId, undefined);
  } finally { fixture.restore(); }
});

test('locked music starts after unlock while unregistered voice hooks stay silent', async () => {
  const fixture = setupAudio();
  try {
    await fixture.audio.registerBgm('garden', '/garden.wav');
    fixture.audio.playBgm('garden');
    fixture.audio.playVoice('ready');
    assert.equal(fixture.context().sources.length, 0);
    await fixture.audio.unlock();
    await settle();
    assert.equal(fixture.audio.snapshot().active.bgm, 1);
    assert.equal(fixture.audio.snapshot().active.voice, 0);
  } finally { fixture.restore(); }
});

test('pre-unlock zero music volume is applied immediately before the first music source starts', async () => {
  const fixture = setupAudio();
  try {
    await fixture.audio.registerBgm('garden', '/garden.wav');
    fixture.audio.setVolume('bgm', 0);
    fixture.audio.playBgm('garden');
    assert.equal(fixture.context().gains[3].gain.immediateValues.at(-1), 0);
    await fixture.audio.unlock();
    await settle();
    assert.equal(fixture.audio.snapshot().active.bgm, 1);
    assert.equal(fixture.context().sources.at(-1)!.gainsAtStart![3], 0);
  } finally { fixture.restore(); }
});

test('pause preserves the looping offset and resumes without replaying effects or narration', async () => {
  const fixture = setupAudio();
  try {
    await fixture.audio.preload();
    await fixture.audio.registerBgm('garden', '/garden.wav');
    await fixture.audio.registerVoice('ready', '/ready.wav');
    await fixture.audio.unlock();
    fixture.context().currentTime = 5;
    fixture.audio.playBgm('garden');
    fixture.audio.playVoice('ready');
    fixture.audio.playSfx('grab');
    await settle();
    fixture.context().currentTime = 7.25;
    fixture.audio.pause();
    assert.deepEqual(fixture.audio.snapshot().active, { sfx: 0, voice: 0, bgm: 0 });
    assert.equal(fixture.audio.snapshot().bgmOffset, 2.25);
    fixture.audio.playSfx('success');
    fixture.audio.playVoice('ready');
    fixture.audio.playSfx('click');
    assert.equal(fixture.audio.snapshot().active.sfx, 1);
    fixture.context().sources.at(-1)!.finish();
    fixture.context().currentTime = 22;
    fixture.audio.resume();
    await settle();
    assert.deepEqual(fixture.audio.snapshot().active, { sfx: 0, voice: 0, bgm: 1 });
    assert.equal(fixture.context().sources.at(-1)!.starts[0].offset, 2.25);
    assert.equal(fixture.audio.snapshot().playedSfx.grab, 1);
    assert.equal(fixture.audio.snapshot().playedSfx.success, undefined);
    fixture.context().currentTime = 34;
    fixture.audio.pause();
    assert.equal(fixture.audio.snapshot().bgmOffset, 4.25);
    fixture.audio.stopAll();
    fixture.audio.resume();
    await settle();
    assert.equal(fixture.audio.snapshot().active.bgm, 0);
    assert.equal(fixture.audio.snapshot().bgmOffset, 0);
  } finally { fixture.restore(); }
});

test('visibility changes stop active audio and preserve an explicit pause', async () => {
  const fixture = setupAudio();
  try {
    await fixture.audio.preload();
    await fixture.audio.registerBgm('garden', '/garden.wav');
    await fixture.audio.unlock();
    fixture.audio.playBgm('garden');
    fixture.audio.playSfx('berry');
    await settle();
    fixture.context().currentTime = 3;
    fixture.documentEvents.hidden = true;
    fixture.documentEvents.dispatchEvent(new Event('visibilitychange'));
    assert.deepEqual(fixture.audio.snapshot().active, { sfx: 0, voice: 0, bgm: 0 });
    fixture.audio.playSfx('complete');
    assert.equal(fixture.audio.snapshot().playedSfx.complete, undefined);
    fixture.audio.pause();
    fixture.documentEvents.hidden = false;
    fixture.documentEvents.dispatchEvent(new Event('visibilitychange'));
    await settle();
    assert.equal(fixture.audio.snapshot().active.bgm, 0);
    fixture.audio.resume();
    await settle();
    assert.equal(fixture.context().sources.at(-1)!.starts[0].offset, 3);
    assert.equal(fixture.audio.snapshot().active.bgm, 1);
  } finally { fixture.restore(); }
});

test('mute stops transient channels and restores music gain without duplicating the loop', async () => {
  const fixture = setupAudio();
  try {
    await fixture.audio.preload();
    await fixture.audio.registerBgm('garden', '/garden.wav');
    await fixture.audio.registerVoice('ready', '/ready.wav');
    await fixture.audio.unlock();
    fixture.audio.playBgm('garden');
    fixture.audio.playVoice('ready');
    fixture.audio.playSfx('success');
    await settle();
    const count = fixture.context().sources.length;
    fixture.audio.setMuted(true);
    assert.equal(fixture.context().gains[0].gain.value, 0);
    assert.deepEqual(fixture.audio.snapshot().active, { sfx: 0, voice: 0, bgm: 1 });
    fixture.audio.playVoice('ready');
    fixture.audio.playSfx('berry');
    fixture.audio.setMuted(false);
    await settle();
    assert.equal(fixture.context().sources.length, count);
    assert.equal(fixture.context().gains[0].gain.value, 1);
    assert.equal(fixture.context().gains[3].gain.value, .25);
  } finally { fixture.restore(); }
});

test('failed recordings remain silent and a later registration safely retries the resource', async () => {
  const fixture = setupAudio({ respond: (url, attempt) => audioResponse(url, url !== '/retry.wav' || attempt > 1) });
  try {
    await fixture.audio.unlock();
    await fixture.audio.registerVoice('ready', '/retry.wav');
    assert.equal(fixture.audio.snapshot().active.voice, 0);
    assert.deepEqual(fixture.audio.snapshot().errors, ['Audio asset could not be loaded']);
    await fixture.audio.registerVoice('ready', '/retry.wav');
    fixture.audio.playVoice('ready');
    await settle();
    assert.equal(fixture.audio.snapshot().active.voice, 1);
    assert.equal(fixture.fetches.filter(item => item.url === '/retry.wav').length, 2);
    fixture.audio.stopVoice();
    assert.equal(fixture.audio.snapshot().active.voice, 0);
  } finally { fixture.restore(); }
});

test('explicit preload retries a failed bundled effect while retaining successfully decoded effects', async () => {
  const fixture = setupAudio({ respond: (url, attempt) => audioResponse(url, !url.endsWith('/grab.wav') || attempt > 1) });
  try {
    await settle();
    assert.equal(fixture.audio.snapshot().loadedSfx.includes('grab'), false);
    assert.equal(fixture.audio.snapshot().loadedSfx.length, 4);
    await fixture.audio.unlock();
    fixture.audio.playSfx('grab');
    assert.equal(fixture.audio.snapshot().active.sfx, 0);
    await fixture.audio.preload();
    fixture.audio.playSfx('grab');
    assert.equal(fixture.audio.snapshot().active.sfx, 1);
    assert.equal(fixture.fetches.filter(item => item.url.endsWith('/grab.wav')).length, 2);
    assert.equal(fixture.fetches.length, 6);
    assert.equal(fixture.context().decoded.filter(url => url.endsWith('/click.wav')).length, 1);
  } finally { fixture.restore(); }
});

test('destroy aborts pending fetches, disconnects the graph and ignores late completion and events', async () => {
  const pending = deferred<Response>();
  const fixture = setupAudio({ respond: url => url === '/pending.wav' ? pending.promise : audioResponse(url) });
  try {
    await fixture.audio.preload();
    await fixture.audio.unlock();
    const registration = fixture.audio.registerVoice('ready', '/pending.wav');
    fixture.audio.playVoice('ready');
    fixture.audio.playSfx('grab');
    fixture.audio.destroy();
    fixture.audio.destroy();
    assert.equal(fixture.context().closeCalls, 1);
    assert.equal(fixture.context().sources[0].stops, 1);
    assert.equal(fixture.context().sources[0].disconnected, true);
    assert.ok(fixture.context().gains.every(gain => gain.disconnected));
    assert.equal(fixture.context().compressor.disconnected, true);
    assert.ok(fixture.fetches.every(item => item.signal?.aborted));
    pending.resolve(audioResponse('/pending.wav'));
    await registration;
    await settle();
    assert.equal(fixture.context().decoded.includes('/pending.wav'), false);
    assert.equal(fixture.audio.snapshot().destroyed, true);
    assert.deepEqual(fixture.audio.snapshot().active, { sfx: 0, voice: 0, bgm: 0 });
    fixture.documentEvents.hidden = true;
    fixture.documentEvents.dispatchEvent(new Event('visibilitychange'));
    saveGameSettings({ ...DEFAULT_GAME_SETTINGS, sfxEnabled: false });
    fixture.events.dispatchEvent(new Event(GAME_SETTINGS_CHANGED_EVENT));
    assert.equal(fixture.audio.snapshot().hidden, false);
    assert.equal(fixture.audio.snapshot().sfxEnabled, true);
    await fixture.audio.unlock();
    assert.equal(fixture.context().resumeCalls, 1);
  } finally { fixture.restore(); }
});

test('late decode results cannot resurrect playback after destruction', async () => {
  const fixture = setupAudio();
  const decoded = deferred<FakeBuffer>();
  try {
    await fixture.audio.preload();
    await fixture.audio.unlock();
    fixture.context().decode = () => decoded.promise;
    const registration = fixture.audio.registerBgm('late', '/late.wav');
    fixture.audio.playBgm('late');
    await settle();
    fixture.audio.destroy();
    decoded.resolve({ duration: 10, url: '/late.wav' });
    await registration;
    await settle();
    assert.equal(fixture.context().sources.length, 0);
    assert.equal(fixture.audio.snapshot().active.bgm, 0);
  } finally { fixture.restore(); }
});

test('unsupported audio remains safe through the public lifecycle and optional recording hooks', async () => {
  const fixture = setupAudio({ supported: false });
  try {
    await fixture.audio.preload();
    await fixture.audio.unlock();
    await fixture.audio.registerVoice('ready', '/ready.wav');
    await fixture.audio.registerBgm('garden', '/garden.wav');
    fixture.audio.playVoice('ready');
    fixture.audio.playBgm('garden');
    fixture.audio.playSfx('click');
    fixture.audio.pause();
    fixture.audio.resume();
    fixture.audio.setMuted(true);
    fixture.audio.setVolume('sfx', .4);
    fixture.audio.stopAll();
    fixture.audio.destroy();
    assert.equal(fixture.audio.snapshot().supported, false);
    assert.equal(fixture.audio.snapshot().contextState, 'unavailable');
    assert.deepEqual(fixture.audio.snapshot().active, { sfx: 0, voice: 0, bgm: 0 });
    assert.equal(fixture.fetches.length, 0);
  } finally { fixture.restore(); }
});
