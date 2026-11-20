import { GAME_SETTINGS_CHANGED_EVENT, getGameSettings } from '../settings/gameSettings';

export type VoiceId = 'ready' | 'bend' | 'grabbed' | 'stand' | 'success' | 'retry' | 'complete'
  | 'safety' | 'calibrationStanding' | 'calibrationBend' | 'trackingLost' | 'rest' | 'nextRound';
export type SfxId = 'grab' | 'success' | 'complete' | 'click' | 'berry';
export type AudioChannel = 'sfx' | 'voice' | 'bgm';
export type VoiceProfile = 'carrot' | 'berry';

export interface VoicePlaybackOptions {
  interrupt?: boolean;
  cooldownMs?: number;
  allowWhilePaused?: boolean;
}

const COMMON_VOICES = { safety: 'safety', trackingLost: 'tracking-lost', rest: 'rest', retry: 'retry' };
const PROFILE_VOICES: Record<VoiceProfile, Partial<Record<VoiceId, string>>> = {
  carrot: { ...COMMON_VOICES, ready: 'carrot-ready', grabbed: 'carrot-grabbed', success: 'carrot-success',
    complete: 'carrot-complete', calibrationStanding: 'calibration-standing', calibrationBend: 'calibration-bend',
    nextRound: 'next-carrot' },
  berry: { ...COMMON_VOICES, ready: 'berry-ready', success: 'berry-success', complete: 'berry-complete' },
};

const SFX_IDS: readonly SfxId[] = ['click', 'grab', 'success', 'berry', 'complete'];
const MAX_SFX = 6;

interface PlayingAudio {
  source: AudioBufferSourceNode;
  channel: AudioChannel;
  startedAt: number;
  offset: number;
  buffer: AudioBuffer;
}

/** Scene-owned effects, narration and music with explicit playback lifecycles. */
export class AudioManager {
  private readonly context?: AudioContext;
  private readonly master?: GainNode;
  private readonly limiter?: DynamicsCompressorNode;
  private readonly gains = new Map<AudioChannel, GainNode>();
  private readonly buffers = new Map<string, Promise<AudioBuffer | undefined>>();
  private readonly sfx = new Map<SfxId, AudioBuffer>();
  private readonly voices = new Map<VoiceId, string>();
  private readonly music = new Map<string, string>();
  private readonly playing = new Set<PlayingAudio>();
  private readonly requests = new AbortController();
  private readonly lastSfx = new Map<SfxId, number>();
  private readonly playedSfx: Partial<Record<SfxId, number>> = {};
  private readonly playedVoices: Partial<Record<VoiceId, number>> = {};
  private readonly lastVoice = new Map<VoiceId, number>();
  private readonly errors: string[] = [];
  private readonly volumes: Record<AudioChannel, number> = { sfx: .6, voice: .8, bgm: .25 };
  private enabled = true;
  private voiceEnabled = true;
  private muted = false;
  private paused = false;
  private hidden = typeof document !== 'undefined' && document.hidden;
  private unlocked = false;
  private destroyed = false;
  private voiceRequest = 0;
  private voiceId?: VoiceId;
  private bgmRequest = 0;
  private bgmId?: string;
  private bgmOffset = 0;
  private preloadPromise: Promise<void> = Promise.resolve();

  constructor(profile?: VoiceProfile) {
    this.readSettings();
    const base = import.meta.env?.BASE_URL ?? '/';
    if (profile) {
      for (const [id, file] of Object.entries(PROFILE_VOICES[profile])) {
        this.voices.set(id as VoiceId, `${base}assets/audio/voice/${file}.wav`);
      }
    }
    const AudioContextClass = globalThis.AudioContext
      ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    try {
      if (AudioContextClass) {
        this.context = new AudioContextClass();
        this.master = this.context.createGain();
        this.limiter = this.context.createDynamicsCompressor();
        this.limiter.threshold.value = -12;
        this.limiter.knee.value = 12;
        this.limiter.ratio.value = 8;
        this.limiter.attack.value = .005;
        this.limiter.release.value = .15;
        this.master.connect(this.limiter);
        this.limiter.connect(this.context.destination);
        for (const channel of ['sfx', 'voice', 'bgm'] as const) {
          const gain = this.context.createGain();
          gain.gain.value = this.volumes[channel];
          gain.connect(this.master);
          this.gains.set(channel, gain);
        }
        this.updateGains();
        this.preloadPromise = this.loadAssets();
      }
    } catch { this.errors.push('Audio output unavailable'); }
    if (typeof document !== 'undefined') {
      document.addEventListener('pointerdown', this.onGesture, true);
      document.addEventListener('keydown', this.onGesture, true);
      document.addEventListener('click', this.onButtonClick, true);
      document.addEventListener('visibilitychange', this.onVisibility);
      window.addEventListener(GAME_SETTINGS_CHANGED_EVENT, this.onSettings);
      // New scenes may reuse the browser's existing user activation.
      if (navigator.userActivation?.hasBeenActive) void this.unlock();
    }
  }

  /** Preload the scene audio without starting playback. */
  async preload(): Promise<void> {
    await this.preloadPromise;
    if (!this.destroyed && (this.sfx.size < SFX_IDS.length || [...this.voices.values()].some(url => !this.buffers.has(url)))) {
      this.preloadPromise = this.loadAssets();
      await this.preloadPromise;
    }
  }

  private async loadAssets(): Promise<void> {
    const base = import.meta.env?.BASE_URL ?? '/';
    await Promise.all([
      ...SFX_IDS.map(async id => {
        const buffer = await this.load(`${base}assets/audio/${id}.wav`);
        if (buffer && !this.destroyed) this.sfx.set(id, buffer);
      }),
      ...[...this.voices.values()].map(url => this.load(url)),
    ]);
  }

  private load(url: string): Promise<AudioBuffer | undefined> {
    const cached = this.buffers.get(url);
    if (cached) return cached;
    const request = (async () => {
      if (!this.context || this.destroyed) return undefined;
      try {
        const response = await fetch(url, { signal: this.requests.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (this.destroyed) return undefined;
        const buffer = await this.context.decodeAudioData(bytes);
        return this.destroyed ? undefined : buffer;
      } catch {
        if (!this.destroyed) {
          this.errors.splice(0, Math.max(0, this.errors.length - 7));
          this.errors.push('Audio asset could not be loaded');
          this.buffers.delete(url);
        }
        return undefined;
      }
    })();
    this.buffers.set(url, request);
    return request;
  }

  /** Call from a user gesture when integrating a custom control outside game-ui. */
  async unlock(): Promise<void> {
    if (!this.context || this.destroyed) return;
    try {
      await this.context.resume();
      if (this.destroyed) return;
      this.unlocked = this.context.state === 'running';
      if (this.unlocked) this.startBgm();
    } catch { /* A later trusted gesture can retry browser activation. */ }
  }

  private readonly onGesture = (event: Event) => {
    if (event.isTrusted) void this.unlock();
  };

  private readonly onButtonClick = (event: Event) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('#game-ui button');
    if (button && !button.disabled) this.playSfx('click');
  };

  private readonly onVisibility = () => {
    this.hidden = document.hidden;
    if (this.hidden) this.suspendPlayback();
    else if (!this.paused) this.startBgm();
  };

  private readonly onSettings = () => {
    this.readSettings();
    if (!this.enabled || this.volumes.sfx === 0) this.stopChannel('sfx');
    if (!this.voiceEnabled || this.volumes.voice === 0) this.stopVoice();
    this.updateGains();
  };

  private readSettings(): void {
    const settings = getGameSettings();
    this.enabled = settings.sfxEnabled;
    this.volumes.sfx = settings.sfxVolume;
    this.voiceEnabled = settings.voiceEnabled;
    this.volumes.voice = settings.voiceVolume;
  }

  private canPlay(): boolean {
    return !this.destroyed && !this.hidden && !this.muted && this.unlocked && this.context?.state === 'running';
  }

  playSfx(id: SfxId): void {
    const buffer = this.sfx.get(id);
    if (!buffer || !this.canPlay() || !this.enabled || this.volumes.sfx === 0 || (this.paused && id !== 'click')) return;
    const now = this.context!.currentTime;
    if (now - (this.lastSfx.get(id) ?? -Infinity) < (id === 'click' ? .08 : .045)) return;
    const effects = [...this.playing].filter(item => item.channel === 'sfx');
    if (effects.length >= MAX_SFX) this.stop(effects[0]);
    this.lastSfx.set(id, now);
    this.start(buffer, 'sfx');
    this.playedSfx[id] = (this.playedSfx[id] ?? 0) + 1;
  }

  /** Register recordings before their existing scene prompt hooks are used. */
  registerVoice(id: VoiceId, url: string): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (this.voiceId === id) this.stopVoice();
    this.voices.set(id, url);
    return this.load(url).then(() => undefined);
  }

  playVoice(id: VoiceId, options: VoicePlaybackOptions = {}): boolean {
    if (options.interrupt === false && this.voiceId !== undefined) return false;
    const elapsedMs = (this.context?.currentTime ?? 0) * 1000 - (this.lastVoice.get(id) ?? -Infinity);
    if (elapsedMs < (options.cooldownMs ?? 0)) return false;
    this.stopVoice();
    const token = this.voiceRequest;
    const url = this.voices.get(id);
    if (!url || !this.voiceEnabled || this.volumes.voice === 0
      || (this.paused && !options.allowWhilePaused) || !this.canPlay()) return false;
    this.voiceId = id;
    void this.load(url).then(buffer => {
      if (token !== this.voiceRequest || (this.paused && !options.allowWhilePaused) || !this.canPlay()) return;
      if (!buffer) { this.voiceId = undefined; return; }
      this.start(buffer, 'voice');
      this.lastVoice.set(id, this.context!.currentTime * 1000);
      this.playedVoices[id] = (this.playedVoices[id] ?? 0) + 1;
      this.updateGains();
    });
    return true;
  }

  registerBgm(id: string, url: string): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (this.bgmId === id) this.stopBgm();
    this.music.set(id, url);
    return this.load(url).then(() => undefined);
  }

  /** Select one looping music track. A later user gesture starts locked music. */
  playBgm(id: string): void {
    if (this.destroyed || !this.music.has(id)) return;
    if (this.bgmId !== id) {
      this.stopBgm();
      this.bgmId = id;
    }
    this.startBgm();
  }

  private startBgm(): void {
    const url = this.bgmId && this.music.get(this.bgmId);
    if (!url || this.paused || !this.canPlay() || this.hasChannel('bgm')) return;
    const token = ++this.bgmRequest;
    void this.load(url).then(buffer => {
      if (!buffer || token !== this.bgmRequest || this.paused || !this.canPlay() || this.hasChannel('bgm')) return;
      this.start(buffer, 'bgm', this.bgmOffset % buffer.duration);
    });
  }

  stopVoice(id?: VoiceId): void {
    if (id !== undefined && id !== this.voiceId) return;
    ++this.voiceRequest;
    this.voiceId = undefined;
    this.stopChannel('voice');
    this.updateGains();
  }

  stopBgm(): void {
    ++this.bgmRequest;
    this.bgmId = undefined;
    this.bgmOffset = 0;
    this.stopChannel('bgm');
  }

  setVolume(channel: AudioChannel, volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.volumes[channel] = Math.max(0, Math.min(1, volume));
    if (channel === 'voice' && this.volumes.voice === 0) this.stopVoice();
    this.updateGains();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.stopChannel('sfx');
      this.stopVoice();
    }
    this.updateGains();
    if (!muted) this.startBgm();
  }

  private updateGains(): void {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.setGain(this.master, this.muted ? 0 : 1, now, .015);
    for (const [channel, gain] of this.gains) {
      let volume = this.volumes[channel];
      if (channel === 'sfx' && !this.enabled) volume = 0;
      if (channel === 'voice' && !this.voiceEnabled) volume = 0;
      if (channel === 'sfx' && this.hasChannel('voice')) volume *= .35;
      if (channel === 'bgm' && this.hasChannel('voice')) volume *= .3;
      this.setGain(gain, volume, now, .025);
    }
  }

  private setGain(node: GainNode, value: number, now: number, smoothing: number): void {
    if (this.unlocked) node.gain.setTargetAtTime(value, now, smoothing);
    else {
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(value, now);
    }
  }

  private hasChannel(channel: AudioChannel): boolean {
    return [...this.playing].some(item => item.channel === channel);
  }

  private start(buffer: AudioBuffer, channel: AudioChannel, offset = 0): void {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = channel === 'bgm';
    source.connect(this.gains.get(channel)!);
    const item: PlayingAudio = { source, channel, startedAt: context.currentTime, offset, buffer };
    source.onended = () => {
      this.playing.delete(item);
      source.disconnect();
      if (channel === 'voice') { this.voiceId = undefined; this.updateGains(); }
    };
    this.playing.add(item);
    source.start(0, offset);
  }

  private stop(item: PlayingAudio): void {
    item.source.onended = null;
    item.source.stop();
    item.source.disconnect();
    this.playing.delete(item);
  }

  private stopChannel(channel: AudioChannel): void {
    for (const item of this.playing) if (item.channel === channel) this.stop(item);
  }

  private suspendPlayback(): void {
    ++this.voiceRequest;
    this.voiceId = undefined;
    ++this.bgmRequest;
    for (const item of this.playing) {
      if (item.channel === 'bgm') this.bgmOffset = (item.offset + this.context!.currentTime - item.startedAt) % item.buffer.duration;
      this.stop(item);
    }
    this.updateGains();
  }

  pause(): void {
    if (this.destroyed || this.paused) return;
    this.paused = true;
    this.suspendPlayback();
  }

  resume(): void {
    if (this.destroyed) return;
    this.paused = false;
    this.startBgm();
  }

  stopAll(): void {
    this.stopVoice();
    this.stopBgm();
    this.stopChannel('sfx');
    this.lastSfx.clear();
  }

  snapshot() {
    const active = { sfx: 0, voice: 0, bgm: 0 };
    for (const item of this.playing) active[item.channel]++;
    return { supported: !!this.context, contextState: this.context?.state ?? 'unavailable',
      unlocked: this.unlocked, paused: this.paused, hidden: this.hidden, destroyed: this.destroyed,
      muted: this.muted, sfxEnabled: this.enabled, voiceEnabled: this.voiceEnabled, voiceId: this.voiceId,
      registeredVoices: [...this.voices.keys()], playedVoices: { ...this.playedVoices }, volumes: { ...this.volumes }, active,
      loadedSfx: [...this.sfx.keys()], playedSfx: { ...this.playedSfx }, bgmId: this.bgmId,
      bgmOffset: this.bgmOffset, errors: [...this.errors] };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.requests.abort();
    this.stopAll();
    if (typeof document !== 'undefined') {
      document.removeEventListener('pointerdown', this.onGesture, true);
      document.removeEventListener('keydown', this.onGesture, true);
      document.removeEventListener('click', this.onButtonClick, true);
      document.removeEventListener('visibilitychange', this.onVisibility);
      window.removeEventListener(GAME_SETTINGS_CHANGED_EVENT, this.onSettings);
    }
    for (const gain of this.gains.values()) gain.disconnect();
    this.master?.disconnect();
    this.limiter?.disconnect();
    this.gains.clear();
    this.sfx.clear();
    this.buffers.clear();
    this.voices.clear();
    this.lastVoice.clear();
    this.music.clear();
    if (this.context) void this.context.close().catch(() => undefined);
  }
}
