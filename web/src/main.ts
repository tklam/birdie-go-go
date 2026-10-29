import Phaser from 'phaser';
import './style.css';
import { startCore } from './core/client';
import { BootScene } from './scenes/BootScene';
import { AudioEngine } from './audio/AudioEngine';
import { MusicPlayer } from './audio/music';
import { CalibrationScene } from './scenes/CalibrationScene';
import { EncounterScene } from './scenes/EncounterScene';
import { MapScene } from './scenes/MapScene';
import { PhotoScene } from './scenes/PhotoScene';
import { PianoScene } from './scenes/PianoScene';
import { TitleScene } from './scenes/TitleScene';
import { fitZoom, GAME_HEIGHT, GAME_WIDTH } from './systems/display';
import { overlay, setOverlayZoom } from './ui/overlay';
import { registerSW } from 'virtual:pwa-register';
import { onAppUpdate, setAppUpdate } from './systems/appUpdate';
import { toast } from './ui/toast';

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
  scene: [BootScene, TitleScene, MapScene, PhotoScene, PianoScene, CalibrationScene, EncounterScene],
});

game.registry.set('core', startCore());
const audio = new AudioEngine();
audio.unlockOnFirstGesture();
game.registry.set('audio', audio);
game.registry.set('music', new MusicPlayer(() => audio.context, () => audio.musicOutput()));
overlay();
setOverlayZoom(currentZoom());
window.addEventListener('resize', () => {
  const zoom = currentZoom();
  game.scale.setZoom(zoom);
  setOverlayZoom(zoom);
});

// App updates wait for the title screen or the next launch (SPEC.md §9.1).
const updateSW = registerSW({ onNeedRefresh: () => setAppUpdate(() => void updateSW(true)) });
onAppUpdate(() => {
  if (!game.scene.isActive('Title')) toast('A new version is ready. It loads from the title screen or next time you start.', 5000);
});

// Exposed for automated browser checks and debugging.
(window as unknown as { __game: Phaser.Game }).__game = game;
