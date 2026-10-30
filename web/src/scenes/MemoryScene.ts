import Phaser from 'phaser';
import type { AudioEngine } from '../audio/AudioEngine';
import { hashString, rng } from '../encounter/random';
import { reducedMotion } from '../fx/motion';
import { backdrop, finish, iconTexture, intro, leaveControls, result, slower, type MinigameData } from '../minigames/common';
import {
  deal,
  flip,
  hideMiss,
  memoryGrid,
  memoryOver,
  memoryWon,
  moveCursor,
  moveLimit,
  movesLeft,
  pairCount,
  pairsMatched,
  startMemory,
  type MemoryState,
} from '../minigames/memory';
import { PROP_NAMES } from '../minigames/props';
import { TEXT } from '../ui/text';

/** Card size and gap in game pixels (34 px is well over 44 CSS px at any zoom ≥ 1.3). */
const CARD = 34;
const GAP = 4;
const BOARD_TOP = 26;
const BOARD_HEIGHT = 124;

interface Card {
  box: Phaser.GameObjects.Container;
  back: Phaser.GameObjects.Container;
  face: Phaser.GameObjects.Container;
  plate: Phaser.GameObjects.Rectangle;
}

/**
 * The memory mini game (SPEC.md §4.14): face-down cards in pairs of
 * pictures; flip two at a time and match them all before the moves run out.
 */
export class MemoryScene extends Phaser.Scene {
  private objects: Phaser.GameObjects.GameObject[] = [];
  private onKey: ((key: string) => void) | null = null;
  /** Ends the current round early (Leave or Esc); null between rounds. */
  private leave: (() => void) | null = null;

  constructor() {
    super('MG_memory');
  }

  create(data: MinigameData): void {
    this.objects = [];
    this.onKey = null;
    this.leave = null;
    backdrop(this, 0x1f3a2e);
    this.add.text(160, 12, data.game.title, { ...TEXT, color: '#ffe680' }).setOrigin(0.5);
    const status = this.add.text(160, 164, '', TEXT).setOrigin(0.5);
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.onKey?.(e.key));
    leaveControls(this, () => this.leave?.());

    const icons = data.game.icons?.length ? data.game.icons : PROP_NAMES.map((n) => `prop:${n}`);
    const pairs = pairCount(data.game.pairs, icons.length);
    const limit = moveLimit(pairs, slower(this));
    void (async () => {
      for (let attempt = 0; ; attempt++) {
        await intro(
          data.game,
          `Tap two cards to turn them over (or arrows and Space). Find all ${pairs} pairs within ${limit} moves.`,
        );
        const cards = deal(icons, pairs, rng(hashString(`${data.game.id}:${attempt}`)));
        const state = await this.play(startMemory(cards, limit), status);
        const won = memoryWon(state);
        const again = await result(won, [`${pairsMatched(state)} of ${pairs} pairs found in ${state.moves} moves.`]);
        if (!again) {
          finish(this, data, won);
          return;
        }
      }
    })();
  }

  /** One round: resolves with the final state once won or out of moves. */
  private play(state: MemoryState, status: Phaser.GameObjects.Text): Promise<MemoryState> {
    for (const o of this.objects) o.destroy();
    this.objects = [];
    const audio = this.registry.get('audio') as AudioEngine | undefined;
    const still = reducedMotion(this);
    const count = state.cards.length;
    const { cols, rows } = memoryGrid(count);
    const left = Math.floor((320 - (cols * (CARD + GAP) - GAP)) / 2);
    const top = BOARD_TOP + Math.floor((BOARD_HEIGHT - (rows * (CARD + GAP) - GAP)) / 2);
    const centre = (i: number) => ({
      x: left + (i % cols) * (CARD + GAP) + CARD / 2,
      y: top + Math.floor(i / cols) * (CARD + GAP) + CARD / 2,
    });

    let pick: (i: number) => void = () => undefined;
    let cursor = 0;
    const ring = this.add.rectangle(0, 0, CARD + 4, CARD + 4).setStrokeStyle(2, 0xffe680).setVisible(false).setDepth(1);
    const placeCursor = () => {
      const { x, y } = centre(cursor);
      ring.setPosition(x, y);
    };
    placeCursor();

    const cards: Card[] = state.cards.map((icon, i) => {
      const { x, y } = centre(i);
      const back = this.add.container(0, 0, [
        this.add.rectangle(0, 0, CARD, CARD, 0x3f7fdf).setStrokeStyle(1, 0xe0e4f0),
        this.add.rectangle(0, 0, CARD - 8, CARD - 8, 0x2a4a8f),
        this.add.rectangle(0, 0, 6, 6, 0xf0d050).setAngle(45),
      ]);
      const plate = this.add.rectangle(0, 0, CARD, CARD, 0xf0e0c8).setStrokeStyle(1, 0x8a5a2c);
      const tex = iconTexture(this, icon);
      const pic = this.add.image(0, 0, tex.key, tex.frame);
      pic.setScale(Math.max(1, Math.floor(32 / Math.max(pic.width, pic.height))));
      const face = this.add.container(0, 0, [plate, pic]).setVisible(false);
      const box = this.add.container(x, y, [back, face]);
      const hit = this.add.zone(x, y, CARD, CARD).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => {
        cursor = i;
        placeCursor();
        pick(i);
      });
      this.objects.push(box, hit);
      return { box, back, face, plate };
    });

    this.objects.push(ring);

    const show = (i: number, up: boolean) => {
      const c = cards[i];
      const swap = () => {
        c.face.setVisible(up);
        c.back.setVisible(!up);
      };
      if (still) {
        swap();
        return;
      }
      this.tweens.killTweensOf(c.box);
      c.box.setScale(1, 1);
      this.tweens.add({
        targets: c.box,
        scaleX: 0,
        duration: 70,
        yoyo: true,
        onYoyo: swap,
        onComplete: () => c.box.setScale(1, 1),
      });
    };
    const update = () =>
      status.setText(`Moves left ${movesLeft(state)} · Pairs ${pairsMatched(state)}/${count / 2}`);
    update();

    return new Promise((resolve) => {
      let busy = false;
      const end = (ms: number) => {
        this.onKey = null;
        this.leave = null;
        this.time.delayedCall(ms, () => resolve(state));
      };
      this.leave = () => end(0);
      pick = (i: number) => {
        if (busy || !this.onKey) return;
        const r = flip(state, i);
        if (r === 'ignored') return;
        show(i, true);
        update();
        if (r === 'first') {
          audio?.blip();
        } else if (r === 'match') {
          audio?.chime();
          state.matched.forEach((m, j) => m && cards[j].plate.setFillStyle(0xc8e8b0));
          if (memoryWon(state)) end(700);
        } else {
          busy = true;
          this.time.delayedCall(Math.round(800 * slower(this)), () => {
            audio?.buzz();
            for (const j of hideMiss(state)) show(j, false);
            busy = false;
            update();
            if (memoryOver(state)) end(500);
          });
        }
      };
      this.onKey = (key) => {
        const step: Record<string, [number, number]> = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        };
        if (key in step) {
          const [dx, dy] = step[key];
          cursor = moveCursor(cursor, dx, dy, cols, count);
          ring.setVisible(true);
          placeCursor();
        } else if (key === ' ' || key === 'Enter') {
          ring.setVisible(true);
          pick(cursor);
        }
      };
    });
  }
}
