import { BerryKickScene } from './scenes/BerryKickScene';
import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { CarrotPullScene } from './scenes/CarrotPullScene';
import { GAME_WIDTH, GAME_HEIGHT } from './layout';

export { GAME_WIDTH, GAME_HEIGHT } from './layout';
export const SHOW_KEYBOARD_HINTS = import.meta.env.VITE_SHOW_KEYBOARD_HINTS !== 'false';
export const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'phaser-stage',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#e6f2e8',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, roundPixels: false },
  audio: { noAudio: true },
  scene: [BootScene, MenuScene, CarrotPullScene, BerryKickScene],
};
