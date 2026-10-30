import Phaser from 'phaser';
import type { AudioEngine } from '../audio/AudioEngine';
import { hashString } from '../encounter/random';
import { reducedMotion } from '../fx/motion';
import { finish, iconTexture, intro, leaveControls, result, slower, type MinigameData } from '../minigames/common';
import { findOver, findTarget, findTimeLeft, hintBird, HIT_R, layoutFind, startFind, tapFind, type FindConfig, type FindLayout, type FindState } from '../minigames/find';
import { ensureProp } from '../minigames/props';
import { frameIndex, type Manifest } from '../systems/assets';
import type { Session } from '../systems/session';
import { modal } from '../ui/overlay';
import { floatingButton } from '../ui/panel';
import { TEXT } from '../ui/text';

const BAR = { x: 60, y: 14, w: 200, h: 4 };
const DEFAULT_BG = 'bg_garden';
const CURSOR_SPEED = 110;

/**
 * The find mini game (SPEC.md §4.14): spot birds hidden around a scene
 * among leaves and flowers. Tap a bird to find it; tapping empty scenery
 * costs a little time. Keys: arrows move a cursor, Space/Enter taps, H hints.
 */
export class FindScene extends Phaser.Scene {
  private cfg!: FindConfig;
  private layout: FindLayout | null = null;
  private state: FindState | null = null;
  private round: Phaser.GameObjects.GameObject[] = [];
  private bar!: Phaser.GameObjects.Rectangle;
  private status!: Phaser.GameObjects.Text;
  private cursor!: Phaser.GameObjects.Graphics;
  private cursorPos = { x: 160, y: 100 };
  private cursorShown = false;
  private keys: Partial<Record<'left' | 'right' | 'up' | 'down', Phaser.Input.Keyboard.Key>> = {};
  private roundDone: ((won: boolean) => void) | null = null;
  private removeHint: (() => void) | null = null;
  private hintRing: Phaser.GameObjects.Graphics | null = null;
  private audio: AudioEngine | undefined;
  private names = new Map<string, string>();
  private perches: [number, number][] = [];

  constructor() {
    super('MG_find');
  }

  create(data: MinigameData): void {
    const game = data.game;
    this.audio = this.registry.get('audio') as AudioEngine | undefined;
    const session = this.registry.get('session') as Session | undefined;
    for (const b of session?.content.birds ?? []) this.names.set(`bird:${b.id}`, b.name);
    this.drawBackground(game.image);
    this.add.rectangle(0, 0, 320, 24, 0x101018, 0.6).setOrigin(0, 0).setDepth(50);
    this.add.text(160, 4, game.title, { ...TEXT, color: '#ffe680' }).setOrigin(0.5, 0).setDepth(51);
    this.add.rectangle(BAR.x, BAR.y, BAR.w, BAR.h, 0x101018).setOrigin(0, 0).setDepth(51);
    this.bar = this.add.rectangle(BAR.x, BAR.y, BAR.w, BAR.h, 0x58a048).setOrigin(0, 0).setDepth(52);
    this.status = this.add.text(316, 170, '', TEXT).setOrigin(1, 0).setDepth(51).setShadow(1, 1, '#101018', 0);
    this.cursor = this.add.graphics().setDepth(60).setVisible(false);
    this.setupInput();
    leaveControls(this, () => this.roundDone?.(false));
    this.events.once('shutdown', () => {
      this.removeHint?.();
      this.removeHint = null;
      this.clearRound();
      this.roundDone = null;
    });

    const icons = game.icons ?? [];
    const target = Math.max(1, Math.min(game.target ?? icons.length, icons.length || 1));
    const howTo =
      `Spot ${target} hidden bird${target === 1 ? '' : 's'}` +
      (game.seconds ? ` in ${game.seconds} seconds` : '') +
      '. Tap a bird to find it; tapping empty scenery costs a little time. Keys: arrows and Space.';
    const worldSeed = session?.state.worldSeed ?? 0;
    const day = session?.state.day ?? 0;
    void (async () => {
      for (let attempt = 0; ; attempt++) {
        await intro(game, howTo);
        this.cfg = { icons, target, seconds: game.seconds ?? 0, slower: slower(this), seed: hashString(`${worldSeed >>> 0}:${day}:${game.id}:${attempt}`) };
        this.layout = layoutFind(icons, this.perches, this.cfg.seed);
        this.state = startFind();
        this.drawRound(this.layout);
        const won = await new Promise<boolean>((resolve) => (this.roundDone = resolve));
        this.roundDone = null;
        const found = this.state?.found ?? 0;
        const of = this.layout ? findTarget(this.cfg, this.layout) : target;
        if (!won && this.layout) this.revealAll(this.layout);
        if (!won) await new Promise((r) => this.time.delayedCall(900, r));
        this.removeHint?.();
        this.removeHint = null;
        this.clearRound();
        const again = await result(won, [`Found ${found} of ${of} birds.`]);
        if (!again) {
          finish(this, data, won);
          return;
        }
      }
    })();
  }

  /** The manifest background's layers (game.image if it is one, else the garden), or a drawn park. */
  private drawBackground(image: string | undefined): void {
    const manifest = (this.registry.get('manifest') as Manifest | undefined) ?? {};
    const id = image && manifest[image]?.type === 'background' ? image : DEFAULT_BG;
    const entry = manifest[id];
    const layers = (entry?.layers ?? []).filter((l) => this.textures.exists(l));
    if (entry && layers.length > 0) {
      layers.forEach((l, i) => this.add.image(0, 0, l).setOrigin(0, 0).setDepth(i));
      this.perches = (entry.perches ?? []).map(([x, y]) => [x, y - 8]);
      return;
    }
    // A generated park: sky, hills, trees and bushes, all whole pixels.
    const g = this.add.graphics().setDepth(0);
    g.fillStyle(0x8cc8f0).fillRect(0, 0, 320, 180);
    g.fillStyle(0x58a048).fillEllipse(80, 120, 260, 90).fillEllipse(260, 126, 240, 80);
    g.fillStyle(0x2f6f3f).fillRect(0, 140, 320, 40);
    this.perches = [];
    for (let i = 0; i < 7; i++) {
      const x = 24 + i * 45;
      const top = 50 + ((i * 37) % 30);
      g.fillStyle(0x8a5a2c).fillRect(x - 2, top + 10, 4, 150 - top);
      g.fillStyle(0x2f6f3f).fillCircle(x, top, 18);
      g.fillStyle(0x58a048).fillCircle(x - 6, top - 4, 9);
      this.perches.push([x + (i % 2 ? 10 : -10), top + 12]);
    }
    for (let x = 10; x < 320; x += 34) g.fillStyle(0x3f8f3f).fillEllipse(x, 150, 26, 14);
  }

  private drawRound(layout: FindLayout): void {
    const manifest = this.registry.get('manifest') as Manifest | undefined;
    const leaf = ensureProp(this, 'leaf');
    for (const d of layout.decoys) {
      const tex = ensureProp(this, d.prop);
      this.round.push(this.add.image(d.x, d.y, tex).setDepth(20));
    }
    for (const b of layout.birds) {
      const tex = iconTexture(this, b.icon);
      const isBird = b.icon.startsWith('bird:') && this.textures.exists(tex.key) && tex.key.startsWith('bird_');
      const frame = isBird ? Math.max(0, frameIndex(manifest?.[tex.key], b.pose)) : tex.frame;
      const img = this.add.image(b.x, b.y, tex.key, frame).setDepth(21);
      img.setScale(isBird ? b.scale : 1);
      this.round.push(img);
      if (b.covered) {
        // A leaf in front, over one side, so only part of the bird shows.
        const dx = b.x + (b.x % 2 ? 4 : -4) * (isBird ? b.scale * 2 : 1);
        this.round.push(this.add.image(Math.round(dx), Math.round(b.y + 2), leaf).setDepth(22));
      }
    }
  }

  private setupInput(): void {
    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture('UP,DOWN,LEFT,RIGHT,SPACE');
      this.keys = { left: kb.addKey('LEFT'), right: kb.addKey('RIGHT'), up: kb.addKey('UP'), down: kb.addKey('DOWN') };
      kb.on('keydown', (e: KeyboardEvent) => {
        if (modal.open || e.repeat || !this.roundDone) return;
        if (e.code === 'Space' || e.code === 'Enter') {
          this.cursorShown = true;
          this.tap(this.cursorPos.x, this.cursorPos.y);
        } else if (e.code === 'KeyH') this.hint();
        else if (e.code.startsWith('Arrow')) this.cursorShown = true;
      });
    }
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (modal.open || !this.roundDone) return;
      this.cursorShown = false;
      this.cursorPos = { x: Math.round(p.x), y: Math.round(p.y) };
      this.tap(p.x, p.y);
    });
  }

  private tap(x: number, y: number): void {
    const s = this.state;
    const layout = this.layout;
    if (!s || !layout) return;
    const r = tapFind(s, layout, x, y);
    if (r.kind === 'miss') {
      this.audio?.blip();
      this.flash(Math.round(x), Math.round(y), '-2s', '#f08080');
      return;
    }
    if (r.kind === 'again') return;
    const b = layout.birds[r.index];
    this.audio?.chime();
    if (this.hintRing) {
      this.hintRing.destroy();
      this.hintRing = null;
    }
    const ring = this.add.graphics().setDepth(30);
    ring.lineStyle(2, 0xf0d050).strokeCircle(b.x, b.y, b.icon.startsWith('bird:') ? 6 + 8 * b.scale : 11);
    this.round.push(ring);
    const name = this.names.get(b.icon) ?? b.icon.split(':')[1] ?? b.icon;
    const label = this.add
      .text(Math.min(300, Math.max(20, b.x)), Math.max(28, b.y - 22), name, { ...TEXT, color: '#ffe680' })
      .setOrigin(0.5, 1)
      .setDepth(31)
      .setShadow(1, 1, '#101018', 0);
    this.round.push(label);
    if (!reducedMotion(this)) this.tweens.add({ targets: ring, alpha: { from: 0.2, to: 1 }, duration: 200 });
  }

  private flash(x: number, y: number, text: string, color: string): void {
    const t = this.add.text(x, y, text, { ...TEXT, color }).setOrigin(0.5).setDepth(40).setShadow(1, 1, '#101018', 0);
    if (reducedMotion(this)) this.time.delayedCall(600, () => t.destroy());
    else this.tweens.add({ targets: t, y: y - 10, alpha: 0, duration: 700, onComplete: () => t.destroy() });
  }

  private hint(): void {
    const s = this.state;
    const layout = this.layout;
    if (!s || !layout || this.hintRing) return;
    const i = hintBird(s, layout);
    if (i < 0) return;
    const b = layout.birds[i];
    const ring = this.add.graphics().setDepth(30).setPosition(b.x, b.y);
    ring.lineStyle(1, 0xffffff).strokeCircle(0, 0, HIT_R);
    this.hintRing = ring;
    this.round.push(ring);
    const hide = () => {
      if (ring.active) ring.setVisible(false);
    };
    if (reducedMotion(this)) this.time.delayedCall(2500, hide);
    else this.tweens.add({ targets: ring, scale: { from: 1.3, to: 0.8 }, alpha: { from: 1, to: 0.3 }, duration: 600, yoyo: true, repeat: 1, onComplete: hide });
    this.time.delayedCall(2600, () => {
      if (this.hintRing === ring) this.hintRing = null;
    });
  }

  private revealAll(layout: FindLayout): void {
    for (const b of layout.birds) {
      if (b.found) continue;
      const ring = this.add.graphics().setDepth(30);
      ring.lineStyle(1, 0xffffff).strokeCircle(b.x, b.y, 12);
      this.round.push(ring);
    }
  }

  update(_time: number, deltaMs: number): void {
    const s = this.state;
    const layout = this.layout;
    if (!s || !layout || modal.open || !this.roundDone) {
      this.cursor.setVisible(false);
      return;
    }
    const dt = Math.min(deltaMs, 50) / 1000;
    s.t += dt;
    const dx = (this.keys.right?.isDown ? 1 : 0) - (this.keys.left?.isDown ? 1 : 0);
    const dy = (this.keys.down?.isDown ? 1 : 0) - (this.keys.up?.isDown ? 1 : 0);
    if (dx || dy) {
      this.cursorPos.x = Math.min(316, Math.max(4, this.cursorPos.x + dx * CURSOR_SPEED * dt));
      this.cursorPos.y = Math.min(176, Math.max(26, this.cursorPos.y + dy * CURSOR_SPEED * dt));
    }
    const cx = Math.round(this.cursorPos.x);
    const cy = Math.round(this.cursorPos.y);
    this.cursor.setVisible(this.cursorShown).clear().lineStyle(1, 0xffffff).strokeCircle(cx, cy, 7).fillStyle(0xffffff).fillRect(cx, cy, 1, 1);
    if (!this.removeHint && hintBird(s, layout) >= 0) this.removeHint = floatingButton('Hint', 'deck', () => this.hint());
    const left = findTimeLeft(s, this.cfg);
    const total = this.cfg.seconds * this.cfg.slower;
    this.bar.width = Number.isFinite(left) ? Math.round((BAR.w * left) / Math.max(1, total)) : BAR.w;
    this.bar.fillColor = left < 5 ? 0xc83c3c : 0x58a048;
    this.status.setText(`${s.found}/${findTarget(this.cfg, layout)}`);
    const end = findOver(s, this.cfg, layout);
    if (end.over) this.roundDone(end.won);
  }

  private clearRound(): void {
    for (const o of this.round) o.destroy();
    this.round = [];
    this.hintRing = null;
    this.layout = null;
    this.state = null;
  }
}
