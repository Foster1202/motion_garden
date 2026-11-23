export class GameIntroVideo {
  private readonly video = document.createElement('video');
  private readonly events = new AbortController();
  private paused = false;
  private playAttempt = 0;

  constructor(
    host: HTMLElement,
    private readonly url: string,
    onReady: () => void,
    private readonly onFailure: () => void,
  ) {
    const { video } = this;
    const { signal } = this.events;
    video.className = 'game-intro-video';
    video.autoplay = true;
    video.defaultMuted = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'none';
    video.setAttribute('aria-hidden', 'true');
    video.addEventListener('playing', () => {
      if (!video.paused && !this.paused && !document.hidden) {
        video.classList.add('is-playing');
        onReady();
      }
    }, { signal });
    video.addEventListener('error', onFailure, { signal });
    document.addEventListener('visibilitychange', this.syncPlayback, { signal });
    host.append(video);
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.syncPlayback();
  }

  private syncPlayback = () => {
    if (this.events.signal.aborted) return;
    const attempt = ++this.playAttempt;
    if (this.paused || document.hidden) {
      this.video.pause();
      return;
    }
    if (!this.video.hasAttribute('src')) this.video.src = this.url;
    void this.video.play().catch(() => {
      if (!this.events.signal.aborted && attempt === this.playAttempt && !document.hidden) this.onFailure();
    });
  };

  destroy() {
    this.events.abort();
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.video.remove();
  }
}
