import Phaser from 'phaser';
import type { AudioEngine } from '../audio/AudioEngine';
import type { TransitLeg } from '../core/types.gen';
import { reducedMotion } from '../fx/motion';
import type { Session } from '../systems/session';
import { floatingButton } from '../ui/panel';
import { TEXT } from '../ui/text';

const W = 320;
const H = 180;
/** Seconds on the platform before boarding, and in the car per stop passed. */
const PLATFORM_S = 1.6;
const PER_STOP_S = 1.4;

export interface MetroSceneData {
  lineName: string;
  /** Stop names in riding order, from where Angie boards to where she gets off. */
  stops: string[];
  /** Remaining legs of the trip after this ride (transfers). */
  legs: TransitLeg[];
}

/**
 * The metro (SPEC.md §4.11): the platform as the train pulls in, then the
 * inside of the car with tunnel lights streaming past and the route strip
 * filling up, and a chime on arrival. Skip jumps to the end.
 */
export class MetroScene extends Phaser.Scene {
  private params!: MetroSceneData;
  private g!: Phaser.GameObjects.Graphics;
  private t = 0;
  private total = 0;
  private done = false;
  private removeSkip: () => void = () => {};
  private texts: Phaser.GameObjects.Text[] = [];
  private riders: Phaser.GameObjects.Sprite[] = [];

  constructor() {
    super('Metro');
  }

  create(data: MetroSceneData): void {
    this.params = data;
    this.t = 0;
    this.done = false;
    this.total = PLATFORM_S + Math.max(1, data.stops.length - 1) * PER_STOP_S;
    this.g = this.add.graphics();
    this.texts = [];
    this.riders = [];
    const label = (x: number, y: number, s: string, color = '#f0f0f0') => {
      const t = this.add.text(x, y, s, { ...TEXT, color }).setOrigin(0.5).setShadow(1, 1, '#101018', 0).setDepth(10);
      this.texts.push(t);
      return t;
    };
    label(W / 2, 30, data.stops[0] ?? '', '#ffe680').setName('sign');
    label(W / 2, 8, data.lineName).setName('line').setVisible(false);
    // Stop names under the route strip's dots.
    const n = data.stops.length;
    data.stops.forEach((s, i) => {
      const x = n > 1 ? 30 + ((W - 60) * i) / (n - 1) : 30;
      label(x, 30, s.replace(/ (Station|Stop)$/, ''), '#c8d0e0').setName('strip').setVisible(false).setFontSize(6);
    });
    // Fellow passengers, seated (whoever's sprites are loaded).
    const people = ['char_office_worker', 'char_student', 'char_auntie', 'char_angie', 'char_jogger'].filter((k) => this.textures.exists(k));
    people.forEach((key, i) => {
      const s = this.add
        .sprite(48 + i * 56, 132, key, 0)
        .setOrigin(0.5, 1)
        .setVisible(false)
        .setDepth(5);
      this.riders.push(s);
    });
    const session = this.registry.get('session') as Session | undefined;
    if (session?.state.party.includes('oboy') && this.textures.exists('char_oboy')) {
      const angie = this.riders.find((r) => r.texture.key === 'char_angie');
      if (angie) this.riders.push(this.add.sprite(angie.x + 6, angie.y - 22, 'char_oboy', 0).setVisible(false).setDepth(6));
    }
    this.removeSkip = floatingButton('Skip', 'back', () => (this.t = this.total));
    this.input.keyboard?.on('keydown-SPACE', () => (this.t = this.total));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.removeSkip());
    this.cameras.main.fadeIn(300, 0, 0, 0);
  }

  update(_time: number, delta: number): void {
    if (this.done) return;
    this.t += Math.min(delta, 50) / 1000;
    const g = this.g.clear();
    if (this.t < PLATFORM_S) this.drawPlatform(g, this.t / PLATFORM_S);
    else this.drawCar(g, Math.min(1, (this.t - PLATFORM_S) / (this.total - PLATFORM_S)));
    if (this.t >= this.total) void this.arrive();
  }

  /** The platform: tiled wall, the line's band, the station sign; the train slides in. */
  private drawPlatform(g: Phaser.GameObjects.Graphics, p: number): void {
    g.fillStyle(0x26262e).fillRect(0, 0, W, 140);
    for (let x = 0; x < W; x += 8) for (let y = 0; y < 140; y += 8) if ((x + y) % 16 === 0) g.fillStyle(0x2e2e38).fillRect(x, y, 8, 8);
    g.fillStyle(0x3fbf9f).fillRect(0, 20, W, 20);
    g.fillStyle(0x1b2a4a).fillRect(W / 2 - 70, 22, 140, 16);
    g.fillStyle(0x6e6e80).fillRect(0, 140, W, 40);
    g.fillStyle(0xf0d050).fillRect(0, 140, W, 2);
    // The train glides in and stops.
    const ease = 1 - (1 - Math.min(1, p * 1.4)) ** 3;
    const x = Math.round(W - ease * W);
    g.fillStyle(0xd8dce8).fillRect(x, 60, W + 40, 78);
    g.fillStyle(0x3fbf9f).fillRect(x, 112, W + 40, 6);
    for (let i = 0; i < 5; i++) g.fillStyle(0x1b2a4a).fillRect(x + 16 + i * 64, 72, 40, 28);
    this.riders.forEach((r) => r.setVisible(false));
    (this.children.getByName('sign') as Phaser.GameObjects.Text | null)?.setVisible(true);
    (this.children.getByName('line') as Phaser.GameObjects.Text | null)?.setVisible(false);
    for (const t of this.texts) if (t.name === 'strip') t.setVisible(false);
  }

  /** Inside the car: tunnel windows with lights streaming past, seats, riders and the route strip. */
  private drawCar(g: Phaser.GameObjects.Graphics, p: number): void {
    (this.children.getByName('sign') as Phaser.GameObjects.Text | null)?.setVisible(false);
    (this.children.getByName('line') as Phaser.GameObjects.Text | null)?.setVisible(true);
    for (const t of this.texts) if (t.name === 'strip') t.setVisible(true);
    g.fillStyle(0xc8ccd8).fillRect(0, 0, W, H);
    // Route strip: stops as dots, filled up to where the train is.
    const n = this.params.stops.length;
    const x0 = 30;
    const x1 = W - 30;
    g.fillStyle(0x1b2a4a).fillRect(0, 0, W, 38);
    g.fillStyle(0x6e6e80).fillRect(x0, 22, x1 - x0, 2);
    g.fillStyle(0x3fbf9f).fillRect(x0, 22, Math.round((x1 - x0) * p), 2);
    for (let i = 0; i < n; i++) {
      const x = n > 1 ? x0 + ((x1 - x0) * i) / (n - 1) : x0;
      g.fillStyle(i / Math.max(1, n - 1) <= p ? 0x3fbf9f : 0x6e6e80).fillCircle(x, 23, 3);
    }
    // Windows onto the dark tunnel; light streaks pass by (still with reduced motion).
    const calm = reducedMotion(this);
    for (let i = 0; i < 4; i++) {
      const wx = 14 + i * 78;
      g.fillStyle(0x101018).fillRect(wx, 46, 60, 34);
      if (!calm) {
        const offset = (this.t * 420 + i * 37) % 120;
        g.fillStyle(0xf0d8a0, 0.8).fillRect(wx + 60 - offset, 60, 14, 2);
      }
    }
    // Poles, seats and the floor.
    for (let x = 40; x < W; x += 80) g.fillStyle(0x8a94c0).fillRect(x, 34, 2, 110);
    g.fillStyle(0x3fbf9f).fillRect(0, 118, W, 16);
    g.fillStyle(0x6e6e80).fillRect(0, 144, W, 36);
    this.riders.forEach((r) => r.setVisible(true));
  }

  private async arrive(): Promise<void> {
    this.done = true;
    this.removeSkip();
    (this.registry.get('audio') as AudioEngine | undefined)?.chime();
    const dest = this.params.stops[this.params.stops.length - 1] ?? '';
    this.add.text(W / 2, 100, `Arriving at ${dest}`, { ...TEXT, color: '#ffe680' }).setOrigin(0.5).setShadow(1, 1, '#101018', 0).setDepth(20);
    await new Promise((r) => this.time.delayedCall(900, r));
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
      this.scene.start('Map', { title: dest, legs: this.params.legs }),
    );
  }
}
