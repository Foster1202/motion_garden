import { SettingsPanel } from '../settings/SettingsPanel';
import Phaser from 'phaser';
import { GardenView } from '../art/GardenView';
import { Rabbit } from '../art/Rabbit';
import { MenuCarrot as Carrot } from '../art/MenuCarrot';
import { Overlay, sproutIcon, carrotIcon, appleIcon, homeIcon } from '../ui/Overlay';
import { AudioManager } from '../systems/AudioManager';
import { REDUCED_MOTION } from '../config';

export class MenuScene extends Phaser.Scene {
  private ui!: Overlay;
  private rabbit!: Rabbit;
  private carrot!: Carrot;
  private audio!: AudioManager;
  private settings?: SettingsPanel;
  constructor() { super('Menu'); }

  create() {
    this.audio = new AudioManager();
    new GardenView(this);
    this.rabbit = new Rabbit(this, 1140, 692, 1.04);
    this.carrot = new Carrot(this, 1252, 617, .8);
    this.carrot.root.angle = 20;
    this.ui = new Overlay();
    this.showHome();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.settings?.destroy(); this.ui.destroy(); this.audio.destroy(); });
  }

  private showHome() {
    this.rabbit.root.setVisible(true);
    this.carrot.root.setVisible(true);
    this.ui.render(`
      <header class="brand-bar"><span class="wordmark">${sproutIcon}動態花園</span><button class="button quiet" data-action="settings">設置</button></header>
      <section class="welcome" aria-labelledby="welcome-title">
        <h1 id="welcome-title">動態花園<span>阿兔 AI 小教練</span></h1>
        <p>同阿兔一齊郁動身體，<br>收穫今日的小小快樂。</p>
        <button class="button primary start-button" data-action="start">開始遊戲 <span aria-hidden="true">→</span></button>
        <p class="welcome-note">按自己的步伐，輕鬆嚟就得。</p>
      </section>
      <div class="rabbit-greeting" aria-hidden="true">準備好未？</div>
      <footer class="menu-footer"><span>舒服地活動 · 隨時可以休息</span><span>攝像頭 / 鍵盤</span></footer>`);
    this.ui.on('settings', () => { this.settings = new SettingsPanel(this.ui.root, () => { this.settings = undefined; this.ui.focus('settings'); }); });
    this.ui.on('start', () => { this.audio.playSfx('click'); this.showSelection(); });
  }

  private showSelection() {
    this.rabbit.root.setVisible(false);
    this.carrot.root.setVisible(false);
    this.ui.render(`
      <header class="brand-bar"><span class="wordmark">${sproutIcon}動態花園</span><button class="button quiet" data-action="home">返回主頁</button></header>
      <section class="selection" aria-labelledby="selection-title">
        <h1 id="selection-title">今日，一齊玩啲咩？</h1>
        <p>揀一個遊戲，同阿兔慢慢嚟。</p>
        <div class="game-cards">
          <button class="game-card available" data-action="carrot"><span class="card-art">${carrotIcon}</span><span class="card-title">拔蘿蔔</span><span class="card-description">淺屈膝，再慢慢企起身</span><span class="card-link">開始玩 <span aria-hidden="true">→</span></span></button>
          <button class="game-card available" data-action="berry"><span class="card-art"><img class="berry-card-image" src="${import.meta.env.BASE_URL}assets/berry_kick/berry.png" alt=""></span><span class="card-title">莓果大豐收</span><span class="card-description">左右伸腿，收集莓果！</span><span class="card-link">開始玩 →</span></button>
          <button class="game-card" disabled><span class="card-art">${appleIcon}</span><span class="card-title">摘蘋果</span><span class="card-description">同阿兔伸伸手</span><span class="coming-soon">稍後開放</span></button>
          <button class="game-card" disabled><span class="card-art">${homeIcon}</span><span class="card-title">阿兔回家</span><span class="card-description">陪阿兔一步步返屋企</span><span class="coming-soon">稍後開放</span></button>
        </div>
      </section><footer class="menu-footer"><span>唔使急，享受每一下活動。</span><span>攝像頭 / 鍵盤</span></footer>`);
    this.ui.on('berry', () => { this.audio.playSfx('click'); this.scene.start('BerryKick'); });
    this.ui.on('carrot', () => { this.audio.playSfx('click'); this.scene.start('CarrotPull'); });
    this.ui.on('home', () => this.showHome());
    this.ui.focus('carrot');
  }

  update(time: number) { this.rabbit?.setPose(0, time, REDUCED_MOTION); }
}
