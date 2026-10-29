import type Phaser from 'phaser';

/** Whether the player turned on Settings → Reduced motion (SPEC.md §1.3). */
export function reducedMotion(scene: Phaser.Scene): boolean {
  const session = scene.registry.get('session') as { state: { settings: { reducedMotion: boolean } } } | undefined;
  return session?.state.settings.reducedMotion ?? false;
}

/**
 * The cover left on screen by a scene's last 'out' transition. An 'in'
 * transition in the same scene must remove it, or the screen stays dark.
 */
const covers = new WeakMap<Phaser.Scene, Phaser.GameObjects.GameObject>();

/** Remembers the cover an 'out' transition leaves behind. */
export function holdCover(scene: Phaser.Scene, cover: Phaser.GameObjects.GameObject): void {
  covers.get(scene)?.destroy();
  covers.set(scene, cover);
}

/** Removes the cover left by an earlier 'out' transition, if any. */
export function dropCover(scene: Phaser.Scene): void {
  covers.get(scene)?.destroy();
  covers.delete(scene);
}

/** A plain fade to or from black, used instead of wipes when motion is reduced. */
export function fade(scene: Phaser.Scene, mode: 'in' | 'out', ms: number, color = 0x000000): Promise<void> {
  if (mode === 'in') dropCover(scene);
  const cover = scene.add
    .rectangle(0, 0, 320, 180, color, mode === 'out' ? 0 : 1)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(10_000_000);
  return new Promise((resolve) => {
    scene.tweens.add({
      targets: cover,
      alpha: mode === 'out' ? 1 : 0,
      duration: ms,
      onComplete: () => {
        if (mode === 'in') cover.destroy();
        else holdCover(scene, cover);
        resolve();
      },
    });
  });
}
