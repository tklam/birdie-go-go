import Phaser from 'phaser';
import './style.css';
import { startCore } from './core/client';
import { BootScene } from './scenes/BootScene';
import { MapScene } from './scenes/MapScene';
import { TitleScene } from './scenes/TitleScene';
import { fitZoom, GAME_HEIGHT, GAME_WIDTH } from './systems/display';
import { overlay, setOverlayZoom } from './ui/overlay';

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
  scene: [BootScene, TitleScene, MapScene],
});

game.registry.set('core', startCore());
overlay();
setOverlayZoom(currentZoom());
window.addEventListener('resize', () => {
  const zoom = currentZoom();
  game.scale.setZoom(zoom);
  setOverlayZoom(zoom);
});

// Exposed for automated browser checks and debugging.
(window as unknown as { __game: Phaser.Game }).__game = game;
