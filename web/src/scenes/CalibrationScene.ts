import Phaser from 'phaser';
import type { AudioEngine } from '../audio/AudioEngine';
import { clickTimes } from '../audio/voice';
import { calibrate } from '../piano/calibration';
import { setLatencyOffset } from '../piano/lesson';
import type { GameState } from '../systems/state';
import { BIG_TEXT, COLORS, drawWindow, hasScene, sharedAudio, sharedContent, sharedState, TEXT } from './PianoScene';

export interface CalibrationSceneData {
  /** Scene to start afterwards (default 'Title'). */
  returnTo?: string;
  returnData?: object;
}

const W = 320;
const CLICKS = 8;
const BPM = 100;
const WARMUP = 2;
const LEAD_S = 1.2;
const DOTS = { x: 76, y: 92, gap: 24 };

type Phase = 'loading' | 'intro' | 'running' | 'done' | 'retry';

/**
 * Latency calibration (SPEC.md §6.4): the player taps along with 8 clicks at
 * 100 BPM; the median tap − click offset (ignoring the first 2 clicks)
 * becomes settings.latencyOffsetMs.
 */
export class CalibrationScene extends Phaser.Scene {
  private params: CalibrationSceneData = {};
  private phase: Phase = 'loading';
  private run = 0;
  private audio!: AudioEngine;
  private state!: GameState;
  private t0 = 0;
  private clicks: number[] = [];
  private taps: number[] = [];
  private g!: Phaser.GameObjects.Graphics;
  private body!: Phaser.GameObjects.Text;
  private prompt!: Phaser.GameObjects.Text;

  constructor() {
    super('Calibration');
  }

  init(data: CalibrationSceneData): void {
    this.params = { returnTo: 'Title', ...data };
    this.phase = 'loading';
    this.run++;
    this.taps = [];
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.audio = sharedAudio(this.registry);
    const frame = this.add.graphics();
    drawWindow(frame, 24, 20, 272, 140);
    this.g = this.add.graphics();
    this.add.text(W / 2, 30, 'Timing check', { ...BIG_TEXT, color: COLORS.gold }).setOrigin(0.5, 0);
    this.body = this.add.text(W / 2, 54, '', { ...TEXT, align: 'center' }).setOrigin(0.5, 0);
    this.prompt = this.add.text(W / 2, 140, '', { ...TEXT, color: COLORS.gold }).setOrigin(0.5, 0);
    this.tweens.add({ targets: this.prompt, alpha: 0.25, duration: 600, yoyo: true, repeat: -1 });

    this.input.on('pointerdown', () => this.onTap());
    this.input.keyboard?.on('keydown-SPACE', () => this.onTap());
    this.input.keyboard?.on('keydown-ENTER', () => this.onTap());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.run++);

    const run = this.run;
    void sharedContent(this.registry).then((content) => {
      if (run !== this.run) return;
      this.state = sharedState(this.registry, content);
      this.showIntro();
    });
  }

  update(): void {
    if (this.phase !== 'running') return;
    const now = this.audio.outputTime();
    this.drawDots(now);
    const last = this.t0 + this.clicks[this.clicks.length - 1] / 1000;
    if (this.audio.currentTime > last + 0.6) this.evaluate();
  }

  private showIntro(): void {
    this.phase = 'intro';
    this.body.setText('Tap along with the clicks.\n\nTap anywhere (or Space)\nexactly on each click.\nIt tunes lesson timing\nto your device.');
    this.prompt.setText('Tap to start');
    this.g.clear();
  }

  private onTap(): void {
    switch (this.phase) {
      case 'intro':
      case 'retry':
        this.start();
        break;
      case 'running':
        this.taps.push((this.audio.currentTime - this.t0) * 1000);
        break;
      case 'done':
        this.scene.start(this.params.returnTo && hasScene(this, this.params.returnTo) ? this.params.returnTo : 'Title', this.params.returnData);
        break;
    }
  }

  private start(): void {
    this.phase = 'loading';
    const run = this.run;
    void this.audio.unlock().then(() => {
      if (run !== this.run) return;
      this.audio.setVolume('sfx', Math.max(0.3, this.state.settings.sfxVolume));
      this.t0 = this.audio.currentTime + LEAD_S;
      this.clicks = clickTimes(CLICKS, BPM, 0).map((t) => t * 1000);
      this.clicks.forEach((ms, i) => this.audio.click(this.t0 + ms / 1000, i === 0));
      this.taps = [];
      this.body.setText('Listen… then tap on every click.');
      this.prompt.setText('');
      this.phase = 'running';
    });
  }

  private evaluate(): void {
    const r = calibrate(this.taps, this.clicks, { warmup: WARMUP, windowMs: 250, minTaps: 4 });
    this.drawDots(Infinity);
    if (r.ok) {
      setLatencyOffset(this.state, r.offsetMs);
      this.phase = 'done';
      const sign = r.offsetMs >= 0 ? '+' : '';
      this.body.setText(`All set! Your offset is ${sign}${r.offsetMs} ms\n(${r.deltas.length} taps counted).`);
      this.prompt.setText('Tap to continue');
      this.audio.chime();
    } else {
      this.phase = 'retry';
      this.body.setText(`Only ${r.deltas.length} taps matched the clicks.\nLet's try once more.`);
      this.prompt.setText('Tap to retry');
      this.audio.buzz();
    }
  }

  /** One dot per click: warm-up dots hollow, lit as each click sounds; tap marks below. */
  private drawDots(now: number): void {
    const g = this.g;
    g.clear();
    const elapsedMs = (now - this.t0) * 1000;
    this.clicks.forEach((ms, i) => {
      const x = DOTS.x + i * DOTS.gap;
      const since = elapsedMs - ms;
      const lit = since >= 0 && since < 120;
      const passed = since >= 0;
      const color = lit ? 0xffffff : passed ? (i < WARMUP ? 0x6070a0 : 0xffd860) : 0x303868;
      g.fillStyle(color, 1);
      g.fillRect(x - 3, DOTS.y - 3, 7, 7);
      if (i < WARMUP && !lit) {
        g.fillStyle(0x182048, 1);
        g.fillRect(x - 2, DOTS.y - 2, 5, 5);
      }
    });
    // Tap marks on a timeline under the dots: 1 px per 25 ms, centred on each click's dot.
    const beatMs = 60000 / BPM;
    g.fillStyle(0x58e070, 1);
    for (const tap of this.taps) {
      const x = Math.round(DOTS.x + (tap / beatMs) * DOTS.gap);
      g.fillRect(x, DOTS.y + 8, 1, 5);
    }
  }
}
