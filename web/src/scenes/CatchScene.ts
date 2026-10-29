import Phaser from 'phaser';
import type { AudioEngine } from '../audio/AudioEngine';
import { hashString } from '../encounter/random';
import { reducedMotion } from '../fx/motion';
import { BASKET_HALF, BASKET_SPEED, BASKET_Y, catchOver, clampBasket, startCatch, stepCatch, timeLeft, type CatchConfig, type CatchState } from '../minigames/catch';
import { backdrop, finish, iconTexture, intro, result, slower, type MinigameData } from '../minigames/common';
import type { Session } from '../systems/session';
import { modal } from '../ui/overlay';
import { floatingButton } from '../ui/panel';
import { TEXT } from '../ui/text';

const BAR = { x: 60, y: 14, w: 200, h: 4 };

/**
 * The catch mini game (SPEC.md §4.14): things fall from the top; move the
 * basket by dragging or touching anywhere (it follows the pointer's x) or
 * with the arrow keys. Catch `icons`, dodge `avoid`; `target` before `seconds`.
 */
export class CatchScene extends Phaser.Scene {
  private cfg!: CatchConfig;
  private state: CatchState | null = null;
  private sprites = new Map<number, Phaser.GameObjects.Image>();
  private basket!: Phaser.GameObjects.Graphics;
  private bar!: Phaser.GameObjects.Rectangle;
  private score!: Phaser.GameObjects.Text;
  private aimX = 160;
  private keys: { left?: Phaser.Input.Keyboard.Key; right?: Phaser.Input.Keyboard.Key; a?: Phaser.Input.Keyboard.Key; d?: Phaser.Input.Keyboard.Key } = {};
  private roundDone: ((won: boolean) => void) | null = null;
  private audio: AudioEngine | undefined;

  constructor() {
    super('MG_catch');
  }

  create(data: MinigameData): void {
    const game = data.game;
    this.audio = this.registry.get('audio') as AudioEngine | undefined;
    const session = this.registry.get('session') as Session | undefined;
    backdrop(this, 0x3a2a4a, 0x2a1c18);
    this.add.text(160, 4, game.title, { ...TEXT, color: '#ffe680' }).setOrigin(0.5, 0);
    this.add.rectangle(BAR.x, BAR.y, BAR.w, BAR.h, 0x101018).setOrigin(0, 0);
    this.bar = this.add.rectangle(BAR.x, BAR.y, BAR.w, BAR.h, 0x58a048).setOrigin(0, 0);
    this.score = this.add.text(316, 170, '', TEXT).setOrigin(1, 0);
    this.basket = this.add.graphics().setDepth(5);
    this.drawBasket();
    this.setupInput();
    const removeBack = floatingButton('Leave', 'back', () => this.roundDone?.(false));
    this.events.once('shutdown', () => {
      removeBack();
      this.clearItems();
      this.state = null;
      this.roundDone = null;
    });

    const target = Math.max(1, game.target ?? 1);
    const howTo =
      `Catch ${target} of the falling things` +
      (game.seconds ? ` in ${game.seconds} seconds` : '') +
      '. Drag or touch anywhere to move the basket (or use the arrow keys).' +
      ((game.avoid?.length ?? 0) > 0 ? ' Dodge the litter: it costs a point.' : '');
    const worldSeed = session?.state.worldSeed ?? 0;
    const day = session?.state.day ?? 0;
    void (async () => {
      for (let attempt = 0; ; attempt++) {
        await intro(game, howTo);
        this.cfg = {
          icons: game.icons ?? [],
          avoid: game.avoid ?? [],
          target,
          seconds: game.seconds ?? 0,
          slower: slower(this),
          seed: hashString(`${worldSeed >>> 0}:${day}:${game.id}:${attempt}`),
        };
        this.state = startCatch(this.cfg);
        this.aimX = 160;
        const won = await new Promise<boolean>((resolve) => (this.roundDone = resolve));
        this.roundDone = null;
        const s = this.state;
        this.state = null;
        this.clearItems();
        const again = await result(won, [`Caught ${s?.caught ?? 0}` + ((s?.bad ?? 0) > 0 ? `, oops ${s?.bad}` : '') + ` · score ${s?.score ?? 0} of ${target}.`]);
        if (!again) {
          finish(this, data, won);
          return;
        }
      }
    })();
  }

  private setupInput(): void {
    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture('LEFT,RIGHT');
      this.keys = { left: kb.addKey('LEFT'), right: kb.addKey('RIGHT'), a: kb.addKey('A'), d: kb.addKey('D') };
    }
    const follow = (p: Phaser.Input.Pointer) => {
      if (!modal.open) this.aimX = p.x;
    };
    this.input.on('pointerdown', follow);
    this.input.on('pointermove', follow);
  }

  update(_time: number, deltaMs: number): void {
    const s = this.state;
    if (!s || modal.open || !this.roundDone) return;
    const dt = Math.min(deltaMs, 50) / 1000;
    const dir = (this.keys.right?.isDown || this.keys.d?.isDown ? 1 : 0) - (this.keys.left?.isDown || this.keys.a?.isDown ? 1 : 0);
    if (dir !== 0) this.aimX = clampBasket(s.basketX + dir * BASKET_SPEED * dt);
    // The basket glides to the pointer quickly but not instantly (so it reads as moving).
    const k = Math.min(1, dt * 18);
    const x = clampBasket(dir !== 0 ? this.aimX : s.basketX + (this.aimX - s.basketX) * k);
    const step = stepCatch(s, this.cfg, dt, x);
    for (const it of step.spawned) {
      const tex = iconTexture(this, it.icon);
      this.sprites.set(it.id, this.add.image(it.x, it.y, tex.key, tex.frame).setDisplaySize(16, 16).setDepth(4));
    }
    const motion = !reducedMotion(this);
    for (const it of [...step.caught, ...step.bad]) {
      const img = this.sprites.get(it.id);
      this.sprites.delete(it.id);
      if (it.good) this.audio?.chime();
      else this.audio?.buzz();
      if (!img) continue;
      if (motion) {
        img.setTint(it.good ? 0xffffff : 0xc83c3c);
        this.tweens.add({ targets: img, y: img.y - (it.good ? 10 : 0), alpha: 0, duration: 250, onComplete: () => img.destroy() });
      } else img.destroy();
      if (motion && !it.good) this.cameras.main.shake(120, 0.004);
    }
    for (const it of step.missed) {
      this.sprites.get(it.id)?.destroy();
      this.sprites.delete(it.id);
    }
    for (const it of s.items) this.sprites.get(it.id)?.setPosition(Math.round(it.x), Math.round(it.y));
    this.drawBasket();
    const left = timeLeft(s, this.cfg);
    this.bar.width = Number.isFinite(left) ? Math.round((BAR.w * left) / Math.max(1, this.cfg.seconds)) : BAR.w;
    this.bar.fillColor = left < 5 ? 0xc83c3c : 0x58a048;
    this.score.setText(`${s.score}/${this.cfg.target}`);
    const end = catchOver(s, this.cfg);
    if (end.over) this.roundDone(end.won);
  }

  private drawBasket(): void {
    const x = Math.round(this.state?.basketX ?? 160);
    const g = this.basket.clear();
    g.fillStyle(0x8a5a2c).fillRect(x - BASKET_HALF, BASKET_Y - 3, BASKET_HALF * 2, 9);
    g.fillStyle(0xb8742c).fillRect(x - BASKET_HALF, BASKET_Y - 4, BASKET_HALF * 2, 2);
    g.fillStyle(0x5a3a1c);
    for (let i = -BASKET_HALF + 3; i < BASKET_HALF; i += 5) g.fillRect(x + i, BASKET_Y - 1, 1, 7);
  }

  private clearItems(): void {
    for (const img of this.sprites.values()) img.destroy();
    this.sprites.clear();
  }
}
