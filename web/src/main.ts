import Phaser from 'phaser';
import './style.css';
import { startCore } from './core/client';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { fitZoom, GAME_HEIGHT, GAME_WIDTH } from './systems/display';

const currentZoom = () => fitZoom(window.innerWidth, window.innerHeight, window.devicePixelRatio);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#000000',
  pixelArt: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.CENTER_BOTH, zoom: currentZoom() },
  scene: [BootScene, TitleScene],
});

game.registry.set('core', startCore());
window.addEventListener('resize', () => game.scale.setZoom(currentZoom()));
