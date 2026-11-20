import type { AudioManager, VoiceId, VoicePlaybackOptions } from './AudioManager';

// A handled cue is either accepted or intentionally silent in this context.
export function tryVoiceCue(audio: AudioManager, id: VoiceId, options: VoicePlaybackOptions = {}): boolean {
  const state = audio.snapshot();
  if (!state.supported || state.muted || !state.voiceEnabled || state.volumes.voice === 0
    || !state.registeredVoices.includes(id)) return true;
  if (!state.unlocked || state.contextState !== 'running' || state.hidden
    || (state.paused && !options.allowWhilePaused)) return false;
  if (state.voiceId !== undefined && options.interrupt !== true) return false;
  return audio.playVoice(id, { interrupt: false, ...options });
}
