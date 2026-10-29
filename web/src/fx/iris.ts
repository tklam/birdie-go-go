import Phaser from 'phaser';
import { fade, reducedMotion } from './motion';

/**
 * Classic 16-bit iris wipe: a black screen with a circular hole that shrinks
 * onto (x, y) (out) or grows from the centre (in). Resolves when done.
 * With reduced motion it's a plain fade.
 */
export function iris(scene: Phaser.Scene, mode: 'in' | 'out', x = 160, y = 90, ms = 450): Promise<void> {
  if (reducedMotion(scene)) return fade(scene, mode, ms);
  const cam = scene.cameras.main;
  const full = Math.hypot(320, 180);
  const hole = scene.make.graphics({}, false).setScrollFactor(0);
  const mask = hole.createGeometryMask();
  mask.setInvertAlpha(true);
  const cover = scene.add
    .rectangle(0, 0, 320, 180, 0x000000, 1)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(10_000_000)
    .setMask(mask);
  const state = { r: mode === 'out' ? full : 0 };
  const draw = () => {
    hole.clear().fillStyle(0xffffff).fillCircle(Math.round(x - cam.scrollX), Math.round(y - cam.scrollY), Math.max(0, Math.round(state.r)));
  };
  draw();
  return new Promise((resolve) => {
    scene.tweens.add({
      targets: state,
      r: mode === 'out' ? 0 : full,
      duration: ms,
      ease: mode === 'out' ? 'Quad.easeIn' : 'Quad.easeOut',
      onUpdate: draw,
      onComplete: () => {
        if (mode === 'in') {
          cover.destroy();
          mask.destroy();
          hole.destroy();
        }
        resolve();
      },
    });
  });
}
