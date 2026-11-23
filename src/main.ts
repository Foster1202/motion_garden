import Phaser from 'phaser';
import { gameConfig } from './game/config';
import { PerformancePanel } from './game/performance/PerformancePanel';
import './style.css';

export const game = new Phaser.Game(gameConfig);
new PerformancePanel(game, document.querySelector<HTMLElement>('#game-frame')!);
if (import.meta.hot) import.meta.hot.dispose(() => game.destroy(true));
