import Phaser from 'phaser';
import type { AudioEngine } from '../audio/AudioEngine';
import { hashString, rng } from '../encounter/random';
import { reducedMotion } from '../fx/motion';
import { backdrop, finish, intro, result, slower, type MinigameData } from '../minigames/common';
import {
  gapIndex,
  gapTile,
  isSolved,
  shuffleSlide,
  slide,
  slideSize,
  tileForDir,
  type Dir,
  type SlideState,
} from '../minigames/slide';
import type { Manifest } from '../systems/assets';
import { TEXT } from '../ui/text';

/** The puzzle's area (game px); tiles are at least 56×31, well over 44 CSS px. */
const LEFT = 8;
const TOP = 26;
const AREA_W = 224;
const AREA_H = 126;
const SIDE_X = 276;

const ARROWS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/**
 * The slide puzzle mini game (SPEC.md §4.14): restore a faded old photo cut
 * into size×size pieces with one gap, by sliding pieces into the gap.
 */
export class SlideScene extends Phaser.Scene {
  private objects: Phaser.GameObjects.GameObject[] = [];
  private onKey: ((key: string) => void) | null = null;
  private onButton: ((which: 'hint' | 'leave') => void) | null = null;

  constructor() {
    super('MG_slide');
  }

  create(data: MinigameData): void {
    this.objects = [];
    this.onKey = null;
    this.onButton = null;
    backdrop(this, 0x3a2a1c);
    this.add.text(160, 12, data.game.title, { ...TEXT, color: '#ffe680' }).setOrigin(0.5);
    const size = slideSize(data.game.size);
    const tw = Math.floor(AREA_W / size);
    const th = Math.floor(AREA_H / size);
    const key = this.picture(data.game.image ?? '', size, tw, th);
    this.add.rectangle(LEFT - 2, TOP - 2, tw * size + 4, th * size + 4, 0x101018).setOrigin(0, 0).setStrokeStyle(1, 0x8a5a2c);
    this.add.text(SIDE_X, 40, 'Moves', TEXT).setOrigin(0.5);
    const moves = this.add.text(SIDE_X, 54, '0', { ...TEXT, color: '#ffe680' }).setOrigin(0.5);
    this.button(92, 'Hint', () => this.onButton?.('hint'));
    this.button(128, 'Leave', () => this.onButton?.('leave'));
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.onKey?.(e.key));

    void (async () => {
      for (let attempt = 0; ; attempt++) {
        await intro(
          data.game,
          'Tap a piece next to the gap to slide it in (or use the arrow keys). Put the photo back together; Hint shows the finished picture.',
        );
        const state = shuffleSlide(size, rng(hashString(`${data.game.id}:${attempt}`)));
        const won = await this.play(state, key, tw, th, moves);
        const again = await result(won, won ? [`Restored in ${state.moves} moves.`] : ['The photo can wait for you.']);
        if (!again) {
          finish(this, data, won);
          return;
        }
      }
    })();
  }

  /** A 72×28 button on the right (Phaser text so it scales with the game). */
  private button(y: number, label: string, run: () => void): void {
    const box = this.add.rectangle(SIDE_X, y, 72, 28, 0x2a4a8f).setStrokeStyle(1, 0xe0e4f0);
    this.add.text(SIDE_X, y, label, TEXT).setOrigin(0.5);
    box.setInteractive({ useHandCursor: true }).on('pointerdown', run);
  }

  /** One round: resolves true when solved, false when the player leaves. */
  private play(state: SlideState, key: string, tw: number, th: number, moves: Phaser.GameObjects.Text): Promise<boolean> {
    for (const o of this.objects) o.destroy();
    this.objects = [];
    const audio = this.registry.get('audio') as AudioEngine | undefined;
    const still = reducedMotion(this);
    const { size } = state;
    const at = (pos: number) => ({ x: LEFT + (pos % size) * tw, y: TOP + Math.floor(pos / size) * th });

    const tiles = new Map<number, Phaser.GameObjects.Image>();
    state.tiles.forEach((tile, pos) => {
      const { x, y } = at(pos);
      const img = this.add.image(x, y, key, `t${tile}`).setOrigin(0, 0);
      this.objects.push(img);
      tiles.set(tile, img);
      if (tile === gapTile(size)) img.setVisible(false);
      else img.setInteractive({ useHandCursor: true }).on('pointerdown', () => move(state.tiles.indexOf(tile)));
    });
    moves.setText('0');

    let hint: Phaser.GameObjects.Image | null = null;
    const showHint = () => {
      hint?.destroy();
      audio?.blip();
      const pic = this.add.image(LEFT, TOP, key).setOrigin(0, 0).setDepth(5);
      hint = pic;
      this.objects.push(pic);
      this.time.delayedCall(Math.round(1500 * slower(this)), () => {
        pic.destroy();
        if (hint === pic) hint = null;
      });
    };

    let move: (pos: number) => void = () => undefined;
    return new Promise((resolve) => {
      const end = (won: boolean, ms: number) => {
        this.onKey = null;
        this.onButton = null;
        this.time.delayedCall(ms, () => resolve(won));
      };
      move = (pos: number) => {
        if (!this.onKey) return;
        const tile = state.tiles[pos];
        if (!slide(state, pos)) return;
        audio?.click(0);
        const img = tiles.get(tile);
        if (img) {
          const { x, y } = at(state.tiles.indexOf(tile));
          this.tweens.killTweensOf(img);
          if (still) img.setPosition(x, y);
          else this.tweens.add({ targets: img, x, y, duration: 90, onComplete: () => img.setPosition(x, y) });
        }
        moves.setText(String(state.moves));
        if (isSolved(state)) {
          const gap = tiles.get(gapTile(size));
          const { x, y } = at(gapIndex(state));
          gap?.setPosition(x, y).setVisible(true);
          audio?.chime();
          end(true, 1200);
        }
      };
      this.onKey = (k) => {
        const dir = ARROWS[k];
        if (dir) {
          const pos = tileForDir(state, dir);
          if (pos !== null) move(pos);
        } else if (k === 'h' || k === 'H') showHint();
        else if (k === 'Escape') end(false, 0);
      };
      this.onButton = (which) => (which === 'hint' ? showHint() : end(false, 0));
    });
  }

  /**
   * The faded photo as a texture with one frame per piece ("t<n>"): the
   * manifest image (or a background's layers) scaled to the puzzle, or a
   * drawn harbour scene when the image is missing.
   */
  private picture(image: string, size: number, tw: number, th: number): string {
    const w = tw * size;
    const h = th * size;
    const key = `mg_slide_${image || 'pattern'}_${size}`;
    if (this.textures.exists(key)) return key;
    const dt = this.textures.addDynamicTexture(key, w, h);
    if (!dt) throw new Error(`slide: cannot make texture ${key}`);
    const manifest = this.registry.get('manifest') as Manifest | undefined;
    const entry = manifest?.[image];
    const layers = (entry?.type === 'background' ? (entry.layers ?? []) : [image]).filter(
      (k) => k && this.textures.exists(k),
    );
    if (layers.length) {
      for (const k of layers) {
        const img = this.make.image({ key: k, add: false }).setOrigin(0, 0).setDisplaySize(w, h);
        dt.draw(img);
        img.destroy();
      }
    } else {
      const g = this.make.graphics({}, false);
      drawPattern(g, w, h);
      dt.draw(g);
      g.destroy();
    }
    const wash = this.make.graphics({}, false);
    wash.fillStyle(0xe8d0a0, 0.3).fillRect(0, 0, w, h).lineStyle(2, 0x8a5a2c, 0.6).strokeRect(1, 1, w - 2, h - 2);
    dt.draw(wash);
    wash.destroy();
    for (let t = 0; t < size * size; t++) dt.add(`t${t}`, 0, (t % size) * tw, Math.floor(t / size) * th, tw, th);
    return key;
  }
}

/** A plain harbour picture so the puzzle still works without its image. */
function drawPattern(g: Phaser.GameObjects.Graphics, w: number, h: number): void {
  const sky = [0x3f7fdf, 0x5a94e8, 0x8cc8f0, 0xf0b090];
  const band = Math.ceil((h * 0.55) / sky.length);
  sky.forEach((c, i) => g.fillStyle(c).fillRect(0, i * band, w, band));
  g.fillStyle(0xf0d050).fillCircle(Math.round(w * 0.75), Math.round(h * 0.25), Math.round(h * 0.1));
  const hz = Math.round(h * 0.55);
  g.fillStyle(0x2f6f3f).fillTriangle(0, hz, Math.round(w * 0.25), Math.round(h * 0.3), Math.round(w * 0.5), hz);
  g.fillStyle(0x58a048).fillTriangle(Math.round(w * 0.3), hz, Math.round(w * 0.55), Math.round(h * 0.38), Math.round(w * 0.8), hz);
  g.fillStyle(0x1b2a4a).fillRect(0, hz, w, h - hz);
  for (let y = hz + 4; y < h; y += 8) g.fillStyle(0x3f7fdf).fillRect((y * 7) % 23, y, Math.round(w * 0.6), 1);
  const bx = Math.round(w * 0.2);
  const by = Math.round(h * 0.75);
  g.fillStyle(0x8a5a2c).fillRect(bx, by, Math.round(w * 0.2), 6);
  g.fillStyle(0xc83c3c).fillTriangle(bx + 8, by - 26, bx + 8, by - 2, bx + 30, by - 2);
  g.fillStyle(0xe0e4f0).fillRect(Math.round(w * 0.6), Math.round(h * 0.7), 18, 10);
}
