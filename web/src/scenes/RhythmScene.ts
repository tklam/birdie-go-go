import Phaser from 'phaser';
import type { AudioEngine } from '../audio/AudioEngine';
import { reducedMotion } from '../fx/motion';
import { backdrop, finish, intro, result, slower, type MinigameData } from '../minigames/common';
import {
  endMs,
  hits,
  msPerBeat,
  rhythmTarget,
  startRhythm,
  sweepMisses,
  tap,
  windows,
  type Judgement,
  type RhythmState,
  type Windows,
} from '../minigames/rhythm';
import type { Session } from '../systems/session';
import { modal, overlay } from '../ui/overlay';
import { TEXT } from '../ui/text';
import { sharedAudio } from './PianoScene';

const W = 320;
/** The hit line, just right of the drum; notes scroll right → left toward it. */
const HIT_X = 52;
const LANE_Y = 96;
const DRUM_X = 26;
const COUNT_IN = 4;
/** How long (ms) a note takes to cross the lane at normal speed. */
const TRAVEL_MS = 1800;
/** Guide clicks are created this far ahead (s) of the audio clock. */
const LOOKAHEAD_S = 0.15;
/** Extra time (ms) after the last note before the round ends. */
const TAIL_MS = 400;

const FEEDBACK: Record<Judgement, { text: string; color: string }> = {
  perfect: { text: 'Perfect!', color: '#ffe680' },
  good: { text: 'Good', color: '#90e0a0' },
  miss: { text: 'Miss', color: '#f07070' },
};

type Phase = 'idle' | 'playing';

/**
 * The rhythm mini game (SPEC.md §4.14): festival drumming for a dragon-boat
 * crew. After a four-click count-in, the pattern's beats scroll toward the
 * drum and the player strikes on each one (DRUM button, the right half of
 * the screen, Space or Z). Taps are judged on the audio clock, corrected by
 * the player's latency offset; win with `target` hits.
 */
export class RhythmScene extends Phaser.Scene {
  private audio!: AudioEngine;
  private phase: Phase = 'idle';
  private run = 0;
  private state: RhythmState = startRhythm([], 100);
  private win: Windows = windows();
  private target = 1;
  private beatS = 0.6;
  /** AudioContext time of beat 0. */
  private startTime = 0;
  private offsetMs = 0;
  private travelMs = TRAVEL_MS;
  private nextGuide = 0;
  private lastBeat = 0;
  private onDone: (() => void) | null = null;

  private notes!: Phaser.GameObjects.Graphics;
  private drum!: Phaser.GameObjects.Graphics;
  private feedback!: Phaser.GameObjects.Text;
  private readout!: Phaser.GameObjects.Text;
  private countText!: Phaser.GameObjects.Text;
  private button: HTMLButtonElement | null = null;
  private struckUntil = 0;

  constructor() {
    super('MG_rhythm');
  }

  create(data: MinigameData): void {
    this.phase = 'idle';
    this.run++;
    this.audio = sharedAudio(this.registry);
    this.drawStage(data.game.title);
    this.setupInput();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.run++;
      this.phase = 'idle';
      this.onDone = null;
      this.button?.remove();
      this.button = null;
    });

    const run = this.run;
    const pattern = data.game.pattern ?? [];
    void (async () => {
      for (;;) {
        const notes = startRhythm(pattern, data.game.tempo ?? 100).notes.length;
        this.target = rhythmTarget(data.game.target, notes);
        await intro(
          data.game,
          `After four clicks, strike the drum as each beat reaches it: tap DRUM, the right half of the screen, or press Space. Hit ${this.target} of ${notes} beats.`,
        );
        if (run !== this.run) return;
        const state = await this.play(data);
        if (run !== this.run) return;
        const won = hits(state) >= this.target;
        const again = await result(won, [
          `${hits(state)} of ${state.notes.length} beats hit (${state.perfect} perfect).`,
          `Best combo ${state.bestCombo}. Score ${state.score}.`,
        ]);
        if (run !== this.run) return;
        if (!again) {
          finish(this, data, won);
          return;
        }
      }
    })();
  }

  update(): void {
    if (this.phase !== 'playing') return;
    const audioNow = this.audio.currentTime;
    // Guide clicks on whole beats, made a little ahead on the audio clock.
    while (this.nextGuide <= this.lastBeat && this.startTime + this.nextGuide * this.beatS < audioNow + LOOKAHEAD_S) {
      this.audio.click(this.startTime + this.nextGuide * this.beatS, this.nextGuide % 4 === 0);
      this.nextGuide++;
    }
    // Judging time: no later (corrected) tap can reach a note before this.
    const judgeMs = (audioNow - this.startTime) * 1000 - this.offsetMs;
    if (sweepMisses(this.state, judgeMs, this.win) > 0) this.show('miss');
    this.drawNotes((this.audio.outputTime() - this.startTime) * 1000);
    this.drawDrum(audioNow < this.struckUntil);
    if (judgeMs > endMs(this.state, this.win) + TAIL_MS) {
      this.phase = 'idle';
      this.showButton(false);
      const done = this.onDone;
      this.onDone = null;
      done?.();
    }
  }

  // --- flow ------------------------------------------------------------------

  /** One round: count-in, then the pattern; resolves when every note is judged. */
  private async play(data: MinigameData): Promise<RhythmState> {
    const run = this.run;
    await this.audio.unlock().catch(() => undefined);
    const session = this.registry.get('session') as Session | undefined;
    this.offsetMs = session?.state.settings.latencyOffsetMs ?? 0;
    const slow = slower(this);
    this.win = windows(slow);
    this.travelMs = TRAVEL_MS * slow;
    const tempo = data.game.tempo ?? 100;
    this.beatS = msPerBeat(tempo) / 1000;
    this.state = startRhythm(data.game.pattern ?? [], tempo);
    const last = this.state.notes.at(-1)?.timeMs ?? 0;
    this.lastBeat = Math.ceil(last / 1000 / this.beatS);
    this.nextGuide = 0;
    const t0 = this.audio.currentTime + 0.3;
    for (let i = 0; i < COUNT_IN; i++) {
      this.audio.click(t0 + i * this.beatS, i === 0);
      const n = i + 1;
      this.time.delayedCall((t0 + i * this.beatS - this.audio.currentTime) * 1000, () => {
        if (run === this.run) this.countText.setText(String(n));
      });
    }
    this.startTime = t0 + COUNT_IN * this.beatS;
    this.time.delayedCall((this.startTime - this.audio.currentTime) * 1000, () => {
      if (run === this.run) this.countText.setText('');
    });
    this.feedback.setText('');
    this.updateReadout();
    this.showButton(true);
    this.phase = 'playing';
    return new Promise<RhythmState>((resolve) => {
      this.onDone = () => resolve(this.state);
    });
  }

  private strike(): void {
    if (this.phase !== 'playing' || modal.open) return;
    const now = this.audio.currentTime;
    this.audio.drum(now);
    this.struckUntil = now + 0.08;
    const tapMs = (now - this.startTime) * 1000 - this.offsetMs;
    const missed = sweepMisses(this.state, tapMs, this.win);
    const r = tap(this.state, tapMs, this.win);
    if (r) this.show(r.judgement);
    else if (missed > 0) this.show('miss');
    this.updateReadout();
  }

  private show(j: Judgement): void {
    const f = FEEDBACK[j];
    this.feedback.setText(f.text).setColor(f.color);
    this.updateReadout();
  }

  private updateReadout(): void {
    const s = this.state;
    this.readout.setText(`Hits ${hits(s)}/${this.target}  Combo ${s.combo}  Score ${s.score}`);
  }

  // --- input -----------------------------------------------------------------

  private setupInput(): void {
    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture('SPACE,Z');
      kb.on('keydown', (e: KeyboardEvent) => {
        if (e.repeat) return;
        if (e.code === 'Space' || e.code === 'KeyZ') this.strike();
      });
    }
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.x >= W / 2) this.strike();
    });
    const b = document.createElement('button');
    b.className = 'btn rhythm-drum rhythm-hidden';
    b.textContent = 'DRUM';
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.strike();
    });
    overlay().appendChild(b);
    this.button = b;
  }

  private showButton(on: boolean): void {
    this.button?.classList.toggle('rhythm-hidden', !on);
  }

  // --- drawing ---------------------------------------------------------------

  private drawStage(title: string): void {
    backdrop(this, 0x2a4a6a, 0x183048);
    // Harbour water and a dragon boat's long hull along the bottom.
    this.add.rectangle(0, 128, W, 22, 0x204060).setOrigin(0, 0);
    this.add.rectangle(40, 136, 240, 6, 0x8a3020).setOrigin(0, 0);
    this.add.rectangle(36, 132, 8, 6, 0xd0a030).setOrigin(0, 0);
    this.add.rectangle(276, 132, 6, 6, 0xd0a030).setOrigin(0, 0);
    for (let x = 60; x < 270; x += 20) this.add.rectangle(x, 130, 2, 6, 0xe0c080).setOrigin(0, 0);
    // The lane the beats travel along, and the hit line.
    this.add.rectangle(HIT_X - 12, LANE_Y - 14, W - HIT_X + 12, 28, 0x101828, 0.75).setOrigin(0, 0);
    this.add.rectangle(HIT_X - 1, LANE_Y - 14, 2, 28, 0xffe680).setOrigin(0, 0);
    this.add.text(160, 14, title, { ...TEXT, color: '#ffe680' }).setOrigin(0.5);
    this.readout = this.add.text(160, 30, '', TEXT).setOrigin(0.5);
    this.feedback = this.add.text(160, 60, '', TEXT).setOrigin(0.5);
    this.countText = this.add.text(160, 60, '', { ...TEXT, fontSize: '16px', color: '#ffffff' }).setOrigin(0.5);
    this.notes = this.add.graphics();
    this.drum = this.add.graphics();
    this.drawDrum(false);
  }

  /** The drum on the left; struck, its skin lights up (and it dips a pixel unless motion is reduced). */
  private drawDrum(struck: boolean): void {
    const g = this.drum.clear();
    const dy = struck && !reducedMotion(this) ? 1 : 0;
    const y = LANE_Y + dy;
    g.fillStyle(0x601810).fillRect(DRUM_X - 13, y - 9, 26, 20);
    g.fillStyle(0xb03020).fillRect(DRUM_X - 12, y - 8, 24, 18);
    g.fillStyle(0xd0a030).fillRect(DRUM_X - 13, y - 9, 26, 2).fillRect(DRUM_X - 13, y + 9, 26, 2);
    g.fillStyle(struck ? 0xfff4d0 : 0xe0c890).fillEllipse(DRUM_X, y - 9, 26, 8);
  }

  /** The beats still to come, at their place on the lane for time `nowMs`. */
  private drawNotes(nowMs: number): void {
    const g = this.notes.clear();
    const speed = (W - HIT_X + 8) / this.travelMs;
    const beatMs = this.beatS * 1000;
    for (const note of this.state.notes) {
      if (note.result !== null && note.result !== 'miss') continue;
      const x = Math.round(HIT_X + (note.timeMs - nowMs) * speed);
      if (x > W + 8) break;
      if (x < HIT_X - 16) continue;
      const offBeat = Math.abs(note.timeMs / beatMs - Math.round(note.timeMs / beatMs)) > 0.01;
      const r = offBeat ? 4 : 6;
      const color = note.result === 'miss' ? 0x606070 : offBeat ? 0x90e0f0 : 0xffd060;
      g.fillStyle(0x000018).fillCircle(x, LANE_Y, r + 1);
      g.fillStyle(color).fillCircle(x, LANE_Y, r);
    }
  }
}
