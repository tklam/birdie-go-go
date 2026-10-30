import Phaser from 'phaser';
import './style.css';
import { startCore } from './core/client';
import { BootScene } from './scenes/BootScene';
import { AudioEngine } from './audio/AudioEngine';
import { MusicPlayer } from './audio/music';
import { CalibrationScene } from './scenes/CalibrationScene';
import { EncounterScene } from './scenes/EncounterScene';
import { MapScene } from './scenes/MapScene';
import { MetroScene } from './scenes/MetroScene';
import { WeddingScene } from './scenes/WeddingScene';
import { QuizScene } from './scenes/QuizScene';
import { RhythmScene } from './scenes/RhythmScene';
import { CatchScene } from './scenes/CatchScene';
import { FindScene } from './scenes/FindScene';
import { MemoryScene } from './scenes/MemoryScene';
import { SlideScene } from './scenes/SlideScene';
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
  scene: [BootScene, TitleScene, MapScene, PhotoScene, PianoScene, CalibrationScene, EncounterScene, MetroScene, WeddingScene, QuizScene, RhythmScene, CatchScene, FindScene, MemoryScene, SlideScene],
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
// Browsers only look for a new version when the page loads, and an installed
// app resumed from the background doesn't reload, so also look when it comes
// back to the foreground and hourly. Offline, the check just fails quietly.
const UPDATE_CHECK_MS = 60 * 60 * 1000;
const updateSW = registerSW({
  onNeedRefresh: () => setAppUpdate(() => void updateSW(true)),
  onRegisteredSW: (_url, registration) => {
    if (!registration) return;
    const check = () => {
      if (navigator.onLine) registration.update().catch(() => undefined);
    };
    setInterval(check, UPDATE_CHECK_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  },
});
onAppUpdate(() => {
  if (!game.scene.isActive('Title')) toast('A new version is ready. It loads from the title screen or next time you start.', 5000);
});

// Exposed for automated browser checks and debugging.
(window as unknown as { __game: Phaser.Game }).__game = game;
