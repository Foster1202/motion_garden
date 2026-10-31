export type PoseCameraErrorCode =
  | 'permission-denied' | 'no-camera' | 'camera-busy' | 'insecure-context'
  | 'unsupported' | 'cancelled' | 'camera-error';

const CAMERA_MESSAGES: Record<PoseCameraErrorCode, string> = {
  'permission-denied': '未獲相機權限，請允許使用相機，或改用鍵盤模式。',
  'no-camera': '找不到相機，請連接相機，或改用鍵盤模式。',
  'camera-busy': '相機可能正被其他程式使用，請關閉該程式後重試。',
  'insecure-context': '相機模式需要 HTTPS 或 localhost，請改用鍵盤模式。',
  unsupported: '這個瀏覽器不支援相機模式，請改用鍵盤模式。',
  cancelled: '相機啟動已取消。',
  'camera-error': '未能啟動相機，請重試，或改用鍵盤模式。',
};

export class PoseCameraError extends Error {
  constructor(readonly code: PoseCameraErrorCode, options?: ErrorOptions) {
    super(CAMERA_MESSAGES[code], options);
    this.name = 'PoseCameraError';
  }
}

export function cameraError(error: unknown): PoseCameraError {
  if (error instanceof PoseCameraError) return error;
  const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
  const code: PoseCameraErrorCode = name === 'NotAllowedError' || name === 'SecurityError'
    ? 'permission-denied'
    : name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError'
      ? 'no-camera'
      : name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError'
        ? 'camera-busy' : 'camera-error';
  return new PoseCameraError(code, { cause: error });
}

export interface PoseCameraOptions {
  video?: HTMLVideoElement;
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'>;
  isSecureContext?: boolean;
  onEnded?: () => void;
}

export class PoseCamera {
  readonly video: HTMLVideoElement;
  private readonly mediaDevices: Pick<MediaDevices, 'getUserMedia'> | undefined;
  private readonly secure: boolean;
  private readonly onEnded?: () => void;
  private stream?: MediaStream;
  private pending?: Promise<HTMLVideoElement>;
  private generation = 0;
  private destroyed = false;

  constructor(options: PoseCameraOptions = {}) {
    this.video = options.video ?? document.createElement('video');
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.mediaDevices = options.mediaDevices ?? globalThis.navigator?.mediaDevices;
    this.secure = options.isSecureContext ?? globalThis.isSecureContext;
    this.onEnded = options.onEnded;
  }

  start(): Promise<HTMLVideoElement> {
    if (this.destroyed) return Promise.reject(new PoseCameraError('cancelled'));
    if (this.pending) return this.pending;
    if (this.stream) return Promise.resolve(this.video);
    const generation = ++this.generation;
    const pending = this.open(generation);
    this.pending = pending;
    void pending.finally(() => {
      if (this.pending === pending) this.pending = undefined;
    }).catch(() => undefined);
    return pending;
  }

  stop(): void {
    ++this.generation;
    this.pending = undefined;
    this.releaseStream();
  }

  destroy(): void {
    this.destroyed = true;
    this.stop();
    this.video.remove?.();
  }

  private async open(generation: number): Promise<HTMLVideoElement> {
    if (!this.secure) throw new PoseCameraError('insecure-context');
    if (!this.mediaDevices?.getUserMedia) throw new PoseCameraError('unsupported');
    let acquired: MediaStream | undefined;
    try {
      acquired = await this.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 360 } },
      });
      if (generation !== this.generation || this.destroyed) {
        for (const track of acquired.getTracks()) track.stop();
        throw new PoseCameraError('cancelled');
      }
      this.stream = acquired;
      for (const track of acquired.getVideoTracks()) track.addEventListener('ended', this.handleEnded);
      this.video.srcObject = acquired;
      await this.video.play();
      if (generation !== this.generation || this.destroyed) throw new PoseCameraError('cancelled');
      return this.video;
    } catch (error) {
      if (this.stream === acquired) this.releaseStream();
      throw cameraError(error);
    }
  }

  private readonly handleEnded = (): void => {
    this.stop();
    this.onEnded?.();
  };

  private releaseStream(): void {
    const stream = this.stream;
    this.stream = undefined;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.removeEventListener('ended', this.handleEnded);
        track.stop();
      }
    }
    this.video.pause();
    this.video.srcObject = null;
  }
}
