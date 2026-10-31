import Phaser from 'phaser';
import { gameConfig } from './game/config';
import './style.css';

export const game = new Phaser.Game(gameConfig);
if (import.meta.hot) import.meta.hot.dispose(() => game.destroy(true));
