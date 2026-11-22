import videoUrl from '../../../assets/home-cover-web.mp4?url';

const CHECK_INTERVAL_MS = 2000;
const NO_PROGRESS_LIMIT_MS = 6000;
const MIN_SAMPLE_FRAMES = 24;
const MAX_DROP_RATIO = 0.3;
const POOR_SAMPLE_LIMIT = 2;

export class HomeCoverVideo {
  private readonly events = new AbortController();
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private stillReady = false;
  private failed = false;
  private playAttempt = 0;
  private frameCallback?: number;
  private checkTimer?: number;
  private lastAdvance = 0;
  private lastMediaTime = 0;
  private lastQuality?: VideoPlaybackQuality;
  private poorSamples = 0;

  constructor(private readonly video: HTMLVideoElement, still: HTMLImageElement) {
    const { signal } = this.events;
    video.muted = true;
    video.addEventListener('playing', this.onPlaying, { signal });
    video.addEventListener('error', () => {
      if (video.hasAttribute('src')) this.fallback();
    }, { signal });
    document.addEventListener('visibilitychange', this.syncPlayback, { signal });
    this.reducedMotion.addEventListener('change', this.syncPlayback, { signal });
    void still.decode().catch(() => {}).then(() => {
      this.stillReady = true;
      this.syncPlayback();
    });
  }

  private syncPlayback = () => {
    if (this.events.signal.aborted || !this.stillReady || this.failed) return;
    if (this.reducedMotion.matches) {
      this.unload();
      return;
    }
    if (document.hidden) {
      this.pause();
      return;
    }
    if (this.checkTimer !== undefined) return;

    const attempt = ++this.playAttempt;
    if (!this.video.hasAttribute('src')) this.video.src = videoUrl;
    this.lastAdvance = performance.now();
    this.lastMediaTime = this.video.currentTime;
    this.lastQuality = this.video.getVideoPlaybackQuality?.();
    this.poorSamples = 0;
    this.checkTimer = window.setInterval(this.checkPlayback, CHECK_INTERVAL_MS);
    void this.video.play().catch(() => {
      if (attempt === this.playAttempt) this.fallback();
    });
  };

  private onPlaying = () => {
    if (this.video.classList.contains('is-playing') || this.frameCallback !== undefined) return;
    if (this.video.requestVideoFrameCallback) {
      this.frameCallback = this.video.requestVideoFrameCallback(() => {
        this.frameCallback = undefined;
        this.reveal();
      });
    } else {
      this.reveal();
    }
  };

  private reveal() {
    if (this.checkTimer !== undefined && !this.video.paused && this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      this.video.classList.add('is-playing');
    }
  }

  private checkPlayback = () => {
    const now = performance.now();
    const mediaTime = this.video.currentTime;
    if (mediaTime !== this.lastMediaTime) {
      this.lastMediaTime = mediaTime;
      this.lastAdvance = now;
    }
    if (now - this.lastAdvance >= NO_PROGRESS_LIMIT_MS) {
      this.fallback();
      return;
    }

    const previous = this.lastQuality;
    const quality = this.video.getVideoPlaybackQuality?.();
    this.lastQuality = quality;
    if (!quality || !previous) return;

    const total = quality.totalVideoFrames - previous.totalVideoFrames;
    if (total < MIN_SAMPLE_FRAMES) return;
    const dropped = quality.droppedVideoFrames - previous.droppedVideoFrames;
    this.poorSamples = dropped / total >= MAX_DROP_RATIO ? this.poorSamples + 1 : 0;
    if (this.poorSamples >= POOR_SAMPLE_LIMIT) this.fallback();
  };

  private pause() {
    this.playAttempt++;
    this.video.pause();
    window.clearInterval(this.checkTimer);
    this.checkTimer = undefined;
    if (this.frameCallback !== undefined) {
      this.video.cancelVideoFrameCallback(this.frameCallback);
      this.frameCallback = undefined;
    }
  }

  private unload() {
    this.video.classList.remove('is-playing');
    this.pause();
    if (this.video.hasAttribute('src')) {
      this.video.removeAttribute('src');
      this.video.load();
    }
  }

  private fallback() {
    this.failed = true;
    this.unload();
  }

  destroy() {
    this.events.abort();
    this.unload();
  }
}
