export type VoiceId = 'ready' | 'bend' | 'grabbed' | 'stand' | 'success' | 'retry' | 'complete';
export type SfxId = 'grab' | 'success' | 'complete' | 'click';

// Audio hooks remain silent until licensed voice and sound assets are supplied.
export class AudioManager {
  playVoice(_id: VoiceId): void {}

  playSfx(_id: SfxId): void {}

  destroy(): void {}
}
