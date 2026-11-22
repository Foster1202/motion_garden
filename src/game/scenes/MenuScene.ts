import { SettingsPanel } from '../settings/SettingsPanel';
import Phaser from 'phaser';
import { GardenView } from '../art/GardenView';
import { Overlay, sproutIcon, carrotIcon, appleIcon, homeIcon } from '../ui/Overlay';
import { HomeCoverVideo } from '../ui/HomeCoverVideo';
import { AudioManager } from '../systems/AudioManager';

export class MenuScene extends Phaser.Scene {
  private ui!: Overlay;
  private audio!: AudioManager;
  private coverVideo?: HomeCoverVideo;
  private settings?: SettingsPanel;
  constructor() { super('Menu'); }

  create() {
    this.audio = new AudioManager();
    new GardenView(this);
    this.ui = new Overlay();
    this.showHome();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.leaveHome();
      this.settings?.destroy();
      this.settings = undefined;
      this.ui.destroy();
      this.audio.destroy();
    });
  }

  private showHome() {
    this.ui.root.parentElement!.setAttribute('data-home-cover', '');
    this.cameras.main.setVisible(false);
    this.ui.render(`
      <video class="home-cover-media home-cover-video" autoplay muted loop playsinline preload="none" aria-hidden="true"></video>
      <div class="home-cover-actions">
        <button class="button primary home-cover-start" data-action="start">開始遊戲 <span aria-hidden="true">→</span></button>
        <button class="button home-cover-settings" data-action="settings">設置</button>
      </div>`);
    this.coverVideo = new HomeCoverVideo(
      this.ui.root.querySelector<HTMLVideoElement>('.home-cover-video')!,
      document.querySelector<HTMLImageElement>('#home-cover-still')!,
    );
    this.ui.on('settings', () => { this.settings = new SettingsPanel(this.ui.root, () => { this.settings = undefined; this.ui.focus('settings'); }); });
    this.ui.on('start', () => this.showSelection());
  }

  private leaveHome() {
    this.coverVideo?.destroy();
    this.coverVideo = undefined;
    this.ui.root.parentElement!.removeAttribute('data-home-cover');
  }

  private showSelection() {
    this.leaveHome();
    this.cameras.main.setVisible(true);
    this.ui.render(`
      <header class="brand-bar"><span class="wordmark">${sproutIcon}動態花園</span><button class="button quiet" data-action="home">返回主頁</button></header>
      <section class="selection" aria-labelledby="selection-title">
        <h1 id="selection-title">今日，一齊玩啲咩？</h1>
        <p>揀一個遊戲，同阿兔慢慢嚟。</p>
        <div class="game-cards">
          <button class="game-card available" data-action="carrot"><span class="card-art">${carrotIcon}</span><span class="card-title">拔蘿蔔</span><span class="card-description">淺屈膝，再慢慢企起身</span><span class="card-link">開始玩 <span aria-hidden="true">→</span></span></button>
          <button class="game-card available" data-action="berry"><span class="card-art"><img class="berry-card-image" src="${import.meta.env.BASE_URL}assets/berry_kick/berry.png" alt=""></span><span class="card-title">莓果大豐收</span><span class="card-description">左右伸腿，收集莓果！</span><span class="card-link">開始玩 →</span></button>
          <button class="game-card available" data-action="apple"><span class="card-art">${appleIcon}</span><span class="card-title">摘蘋果</span><span class="card-description">伸手摘蘋果，再送返籃子</span><span class="card-link">開始玩 →</span></button>
          <button class="game-card" disabled><span class="card-art">${homeIcon}</span><span class="card-title">阿兔回家</span><span class="card-description">陪阿兔一步步返屋企</span><span class="coming-soon">稍後開放</span></button>
        </div>
      </section><footer class="menu-footer"><span>唔使急，享受每一下活動。</span><span>攝像頭 / 鍵盤</span></footer>`);
    this.ui.on('berry', () => this.scene.start('BerryKick'));
    this.ui.on('carrot', () => this.scene.start('CarrotPull'));
    this.ui.on('apple', () => this.scene.start('AppleHarvest'));
    this.ui.on('home', () => { this.showHome(); this.ui.focus('start'); });
    this.ui.focus('carrot');
  }

  getAudioSnapshot() { return this.audio.snapshot(); }
}
