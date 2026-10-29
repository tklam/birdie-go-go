import type Phaser from 'phaser';
import { dropCover, fade, holdCover, reducedMotion } from './motion';

/**
 * Kei's digital-dissolve: the screen breaks into flickering cyan and navy
 * scanline bars until it's covered ('out'), or clears from covered ('in').
 * With reduced motion it's a plain fade through navy, without flicker.
 */
export function glitch(scene: Phaser.Scene, mode: 'in' | 'out', ms = 500): Promise<void> {
  if (reducedMotion(scene)) return fade(scene, mode, ms, 0x101018);
  if (mode === 'in') dropCover(scene);
  const g = scene.add.graphics().setScrollFactor(0).setDepth(10_000_000);
  const colors = [0x3fbf9f, 0x8cc8f0, 0x1b2a4a, 0x101018];
  const start = scene.time.now;
  return new Promise((resolve) => {
    const tick = () => {
      const t = Math.min(1, (scene.time.now - start) / ms);
      const cover = mode === 'out' ? t : 1 - t;
      g.clear();
      for (let y = 0; y < 180; y += 4) {
        if (Math.random() > cover) continue;
        const x = Math.floor(Math.random() * 40) - 20;
        g.fillStyle(colors[Math.floor(Math.random() * colors.length)], 1).fillRect(x, y, 360, 4);
      }
      if (cover > 0.85) g.fillStyle(0x101018, (cover - 0.85) / 0.15).fillRect(0, 0, 320, 180);
      if (t < 1) {
        scene.time.delayedCall(16, tick);
        return;
      }
      if (mode === 'in') g.destroy();
      else holdCover(scene, g.fillStyle(0x101018, 1).fillRect(0, 0, 320, 180));
      resolve();
    };
    tick();
  });
}
