import type Phaser from 'phaser';

/** Whether the player turned on Settings → Reduced motion (SPEC.md §1.3). */
export function reducedMotion(scene: Phaser.Scene): boolean {
  const session = scene.registry.get('session') as { state: { settings: { reducedMotion: boolean } } } | undefined;
  return session?.state.settings.reducedMotion ?? false;
}

/** A plain fade to or from black, used instead of wipes when motion is reduced. */
export function fade(scene: Phaser.Scene, mode: 'in' | 'out', ms: number, color = 0x000000): Promise<void> {
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
        resolve();
      },
    });
  });
}
