// Shared pieces of the mini games (SPEC.md §4.14): the data each scene gets,
// intro and result panels, the easier setting and icon textures. Each game
// type is one scene, "MG_<type>", launched over the paused map.
import type Phaser from 'phaser';
import type { Minigame } from '../core/types.gen';
import { frameIndex, type Manifest } from '../systems/assets';
import type { Session } from '../systems/session';
import { showMenu } from '../ui/menu';
import { modal } from '../ui/overlay';
import { floatingButton, showPanel } from '../ui/panel';
import { ensureProp } from './props';

export interface MinigameData {
  game: Minigame;
  /** Reports the outcome; the scene stops itself after calling it. */
  done: (won: boolean) => void;
}

/** 1.5 with Settings → Slow prompts (longer windows, slower falling things), else 1. */
export function slower(scene: Phaser.Scene): number {
  const s = scene.registry.get('session') as Session | undefined;
  return s?.state.settings.slowerPrompts ? 1.5 : 1;
}

/** The intro panel: the favour in the story's words, then how to play. */
export function intro(game: Minigame, howTo: string): Promise<void> {
  return showPanel(game.title, [game.intro, howTo], 'Start');
}

/**
 * The result: on a win, a cheer and Continue; otherwise Try again or Leave
 * (failing never costs anything). Resolves true to play again.
 */
export async function result(won: boolean, lines: string[]): Promise<boolean> {
  let again = false;
  await showMenu(won ? 'Well done!' : 'Not quite...', [
    ...(won
      ? [{ label: 'Continue', detail: () => lines.join(' '), run: async () => false }]
      : [
          { label: 'Try again', detail: () => lines.join(' '), run: async () => ((again = true), false) },
          { label: 'Leave for now', detail: () => 'You can try again any time.', run: async () => false },
        ]),
  ]);
  return again;
}

/**
 * Every mini game's way out mid-round: a Leave button (top left) and Esc.
 * `onLeave` should end the round as not won (the result menu then offers
 * Try again or Leave for now); it may be called when no round is on.
 * Both go away when the scene shuts down.
 */
export function leaveControls(scene: Phaser.Scene, onLeave: () => void): void {
  const remove = floatingButton('Leave', 'back', onLeave);
  scene.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
    if (e.code === 'Escape' && !modal.open) onLeave();
  });
  scene.events.once('shutdown', remove);
}

/** Ends the game: reports the outcome and stops the scene. */
export function finish(scene: Phaser.Scene, data: MinigameData, won: boolean): void {
  data.done(won);
  scene.scene.stop();
}

/** Texture and frame for an icon: "bird:<species>" (its perched frame) or "prop:<name>". */
export function iconTexture(scene: Phaser.Scene, icon: string): { key: string; frame: number } {
  const [kind, name] = icon.split(':');
  if (kind === 'bird') {
    const key = `bird_${name}`;
    const manifest = scene.registry.get('manifest') as Manifest | undefined;
    if (scene.textures.exists(key)) return { key, frame: Math.max(0, frameIndex(manifest?.[key], 'perched')) };
    return { key: ensureProp(scene, 'leaf'), frame: 0 };
  }
  return { key: ensureProp(scene, name ?? 'leaf'), frame: 0 };
}

/** A plain 16-bit backdrop: a colour with a darker band at the bottom. */
export function backdrop(scene: Phaser.Scene, top = 0x1b2a4a, bottom = 0x101018): void {
  scene.add.rectangle(0, 0, 320, 180, top).setOrigin(0, 0);
  scene.add.rectangle(0, 150, 320, 30, bottom).setOrigin(0, 0);
}

/** Fisher–Yates shuffle with a given random source (pure). */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
