import berryDemo from '../../../assets/berry-kick-demo.mp4?url';
import carrotDemo from '../../../assets/carrot-pull-demo.mp4?url';
import { GameIntroVideo } from './GameIntroVideo';
import { appleIcon, carrotIcon, sproutIcon } from './Overlay';

type IntroMedia = { icon: string; video?: string };

const introMedia = {
  carrot: { icon: carrotIcon, video: carrotDemo },
  berry: { icon: sproutIcon, video: berryDemo },
  apple: { icon: appleIcon },
} satisfies Record<string, IntroMedia>;

export class GameIntroLayout {
  readonly element = document.createElement('div');
  private readonly media: HTMLElement;
  private readonly placeholder: HTMLElement;
  private readonly caption: HTMLElement;
  private readonly videoUrl?: string;
  private video?: GameIntroVideo;

  constructor(game: keyof typeof introMedia, content: string) {
    const { icon, video }: IntroMedia = introMedia[game];
    this.videoUrl = video;
    this.element.className = 'game-intro-layout';
    this.element.innerHTML = `
      <div class="game-intro-media">
        <div class="game-intro-placeholder">
          <span class="game-intro-icon" aria-hidden="true">${icon}</span>
          <span class="game-intro-caption">${video ? '動作示範' : '動作示範即將推出'}</span>
        </div>
      </div>
      <div class="game-intro-copy">${content}</div>`;
    this.media = this.element.querySelector('.game-intro-media')!;
    this.placeholder = this.element.querySelector('.game-intro-placeholder')!;
    this.caption = this.element.querySelector('.game-intro-caption')!;
  }

  startVideo(paused = false) {
    if (!this.videoUrl || this.video) return;
    this.caption.textContent = '動作示範';
    this.video = new GameIntroVideo(this.media, this.videoUrl, () => { this.placeholder.hidden = true; }, () => {
      this.stopVideo();
      this.caption.textContent = '暫時未能播放動作示範';
    });
    this.video.setPaused(paused);
  }

  setPaused(paused: boolean) { this.video?.setPaused(paused); }

  stopVideo() {
    this.video?.destroy();
    this.video = undefined;
    this.placeholder.hidden = false;
  }
}
