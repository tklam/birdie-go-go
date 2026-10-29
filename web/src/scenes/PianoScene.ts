import Phaser from 'phaser';
import { AudioEngine } from '../audio/AudioEngine';
import type { CoreClient } from '../core/client';
import type { ContentBundle, GradedMistake, LessonGradeResult, PerfNote, Performance, Song, Student } from '../core/types.gen';
import { gradientBands } from '../piano/frame';
import { applyLessonResult, isLatencyCalibrated, lessonDifficulty, lessonSeed, pickSong } from '../piano/lesson';
import { beatsPerBar, msPerBeat, notesEndMs, perfToScoreMs, songToNotes } from '../piano/notes';
import { formatTime, mistakeLabel, summarizeMistakes } from '../piano/results';
import { fitX, isBlackKey, labelRows, msToX, pitchToY, PLAYHEAD_X, ROLL_SPEED, rollLayout, type RollLayout } from '../piano/roll';
import { loadJSON } from '../systems/data';
import { newGame, type GameState } from '../systems/state';
import { PIXEL_FONT } from '../ui/text';

export interface PianoSceneData {
  studentId: string;
  songId?: string;
  /** Scene to start when the lesson is over (default 'Map'; 'Title' if that doesn't exist). */
  returnTo?: string;
}

/** Stored in the registry under 'lastLesson' after every graded lesson. */
export interface LastLesson {
  studentId: string;
  songId: string;
  lessonId: string;
  day: number;
  result: LessonGradeResult;
  pay: number;
}

// --- shared 16-bit drawing helpers (also used by CalibrationScene) ---------

export const COLORS = {
  bg: 0x0a0f2a,
  white: 0xf0f0ff,
  text: '#e8ecff',
  dim: '#8a94c0',
  gold: '#ffe680',
  green: 0x58e070,
  red: 0xf05050,
  flag: 0xffd040,
};

export const TEXT: Phaser.Types.GameObjects.Text.TextStyle = { fontFamily: PIXEL_FONT, fontSize: '8px', color: COLORS.text };
export const BIG_TEXT: Phaser.Types.GameObjects.Text.TextStyle = { ...TEXT, fontSize: '16px' };

/** A classic JRPG window: 1-px white border with clipped corners and a banded navy gradient. */
export function drawWindow(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);
  for (const b of gradientBands(h - 2)) {
    g.fillStyle(b.color, 1);
    g.fillRect(x + 1, y + 1 + b.y, w - 2, b.h);
  }
  g.fillStyle(COLORS.white, 1);
  g.fillRect(x + 1, y, w - 2, 1);
  g.fillRect(x + 1, y + h - 1, w - 2, 1);
  g.fillRect(x, y + 1, 1, h - 2);
  g.fillRect(x + w - 1, y + 1, 1, h - 2);
  // A dark inner line under the border, as on the era's windows.
  g.fillStyle(0x000018, 0.6);
  g.fillRect(x + 1, y + 1, w - 2, 1);
  g.fillRect(x + 1, y + 1, 1, h - 2);
}

function pixels(g: Phaser.GameObjects.Graphics, x: number, y: number, pts: readonly (readonly [number, number])[], color: number): void {
  g.fillStyle(color, 1);
  for (const [dx, dy] of pts) g.fillRect(x + dx, y + dy, 1, 1);
}

const CHECK: [number, number][] = [[-3, 0], [-2, 1], [-1, 2], [0, 1], [1, 0], [2, -1], [3, -2], [-2, 0], [-1, 1], [0, 0], [1, -1], [2, -2]];
const CROSS: [number, number][] = [-2, -1, 0, 1, 2].flatMap((i) => [[i, i], [i, -i]] as [number, number][]);

/** The game's AudioEngine from the registry, creating it on first use. */
export function sharedAudio(registry: Phaser.Data.DataManager): AudioEngine {
  let audio = registry.get('audio') as AudioEngine | undefined;
  if (!audio) {
    audio = new AudioEngine();
    registry.set('audio', audio);
  }
  return audio;
}

/** The ContentBundle from the registry, loading it if no one has yet. */
export async function sharedContent(registry: Phaser.Data.DataManager): Promise<ContentBundle> {
  let content = registry.get('content') as ContentBundle | undefined;
  if (!content) {
    content = await loadJSON<ContentBundle>('content/base.json');
    registry.set('content', content);
  }
  return content;
}

/** The GameState from the registry; a fresh one (stored back) if none exists yet. */
export function sharedState(registry: Phaser.Data.DataManager, content: ContentBundle): GameState {
  // In the game, the session owns the state (it can be replaced by New Game or Import).
  const session = registry.get('session') as { state: GameState } | undefined;
  if (session) return session.state;
  let state = registry.get('state') as GameState | undefined;
  if (!state) {
    state = newGame(content, (Math.random() * 2 ** 32) >>> 0);
    registry.set('state', state);
  }
  return state;
}

export function hasScene(scene: Phaser.Scene, key: string): boolean {
  return Boolean((scene.scene.manager.keys as Record<string, unknown>)[key]);
}

// --- layout ----------------------------------------------------------------

const W = 320;
const H = 180;
const ROLL = { x: 6, y: 14, w: 308, h: 108 };
const KEYS_W = 12;
const NOTES_X0 = ROLL.x + 1 + KEYS_W + 1;
const NOTES_X1 = ROLL.x + ROLL.w - 2;
const BUTTON = { x: 100, y: 144, w: 120, h: 28 };
const COUNT_IN = 4;
const TAIL_MS = 1000;
const RESULT_ROLL = { x: 6, y: 12, w: 308, h: 74 };

type Phase = 'loading' | 'intro' | 'starting' | 'playing' | 'grading' | 'results' | 'error';

/**
 * The piano lesson (SPEC.md §6): the student plays a piece generated by the
 * Go core while the player flags the mistakes they hear, then the core
 * grades the flags. Start with
 * `scene.start('Piano', { studentId, songId?, returnTo: 'Map' })`.
 */
export class PianoScene extends Phaser.Scene {
  private params: PianoSceneData = { studentId: '' };
  private phase: Phase = 'loading';
  private run = 0;
  private core!: CoreClient;
  private audio!: AudioEngine;
  private state!: GameState;
  private student!: Student;
  private song!: Song;
  private reference: PerfNote[] = [];
  private layout!: RollLayout;
  private lessonId = '';
  private performance: Performance = { notes: [], durationMs: 0, pauses: [] };
  private startTime = 0;
  private flags: number[] = [];
  private flashUntil = 0;
  private stopAudio: (() => void) | null = null;
  private resultsShownAt = 0;

  private roll!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private flash!: Phaser.GameObjects.Rectangle;
  private header!: Phaser.GameObjects.Text;
  /** O Boy bobbing to the beat on top of the roll (SPEC.md §7.2), if he's along. */
  private oboy: Phaser.GameObjects.Sprite | null = null;
  private countText!: Phaser.GameObjects.Text;
  private buttonText!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private overlay: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('Piano');
  }

  init(data: PianoSceneData): void {
    this.params = { returnTo: 'Map', ...data };
    this.phase = 'loading';
    this.run++;
    this.flags = [];
    this.lessonId = '';
    this.stopAudio = null;
    this.overlay = [];
  }

  create(): void {
    (this.registry.get('music') as { stop(): void } | undefined)?.stop();
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.roll = this.add.graphics();
    this.hud = this.add.graphics();
    this.header = this.add.text(6, 3, '', TEXT);
    this.countText = this.add.text(W / 2, ROLL.y + ROLL.h / 2, '', { ...BIG_TEXT, color: COLORS.gold }).setOrigin(0.5);
    this.buttonText = this.add
      .text(BUTTON.x + BUTTON.w / 2, BUTTON.y + BUTTON.h / 2, 'MISTAKE!', { ...BIG_TEXT, color: '#ffffff' })
      .setOrigin(0.5)
      .setVisible(false);
    this.hint = this.add.text(W / 2, 132, '', { ...TEXT, color: COLORS.dim }).setOrigin(0.5, 0);
    this.flash = this.add.rectangle(0, 0, W, H, 0xffffff, 0).setOrigin(0, 0);
    const party = (this.registry.get('session') as { state: GameState } | undefined)?.state.party ?? [];
    this.oboy =
      party.includes('oboy') && this.textures.exists('char_oboy')
        ? this.add.sprite(ROLL.x + ROLL.w - 16, ROLL.y + 1, 'char_oboy', 0).setOrigin(0.5, 1)
        : null;

    this.audio = sharedAudio(this.registry);
    this.core = this.registry.get('core') as CoreClient;

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointer(p));
    this.input.keyboard?.on('keydown-SPACE', () => this.onKey());
    this.input.keyboard?.on('keydown-ENTER', () => this.onKey());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.run++;
      this.stopAudio?.();
      this.stopAudio = null;
    });

    this.showCard(['Preparing the lesson…']);
    const run = this.run;
    void this.prepare().then(
      () => run === this.run && this.showIntro(),
      (err: unknown) => run === this.run && this.showError(err),
    );
  }

  update(): void {
    if (this.phase === 'playing') {
      const nowMs = (this.audio.outputTime() - this.startTime) * 1000;
      // The roll shows the score, so follow score time, not performance time.
      this.drawPlaying(this.toScore(nowMs));
      if (this.audio.currentTime >= this.startTime + (this.performance.durationMs + TAIL_MS) / 1000) void this.finish();
    }
  }

  // --- flow ------------------------------------------------------------------

  private async prepare(): Promise<void> {
    if (!this.core) throw new Error('core is not available');
    const content = await sharedContent(this.registry);
    this.state = sharedState(this.registry, content);
    const student = content.students.find((s) => s.id === this.params.studentId);
    if (!student) throw new Error(`unknown student "${this.params.studentId}"`);
    const song = pickSong(student, content.songs, this.params.songId);
    if (!song) throw new Error(`${student.name} has no song to play`);
    this.student = student;
    this.song = song;
    this.reference = songToNotes(song);
    this.layout = rollLayout(this.reference, ROLL.y + 1, ROLL.h - 2, 1, 4);
    const lesson = await this.core.generateLesson({
      song,
      tendencies: student.tendencies,
      difficulty: lessonDifficulty(student.level),
      seed: lessonSeed(this.state.worldSeed, this.state.day, student.id),
    });
    this.lessonId = lesson.lessonId;
    this.performance = lesson.performance;
  }

  private showIntro(): void {
    this.phase = 'intro';
    this.header.setText(`Lesson · ${this.student.name}`);
    this.drawPlaying(-1000);
    this.showCard(
      [
        { text: this.student.name, style: { ...BIG_TEXT, color: COLORS.gold } },
        `Song: ${this.song.title}`,
        '',
        'Listen for mistakes!',
        'Hear one? Tap MISTAKE!',
      ],
      'Tap or press Space to begin',
    );
  }

  private begin(): void {
    if (!isLatencyCalibrated(this.state) && hasScene(this, 'Calibration')) {
      void this.audio.unlock();
      this.scene.start('Calibration', { returnTo: 'Piano', returnData: this.params });
      return;
    }
    this.phase = 'starting';
    this.clearOverlay();
    const run = this.run;
    void this.audio.unlock().then(() => {
      if (run !== this.run) return;
      this.audio.setVolume('sfx', this.state.settings.sfxVolume);
      this.audio.setVolume('music', this.state.settings.musicVolume);
      const beat = msPerBeat(this.song) / 1000 || 0.5;
      const t0 = this.audio.currentTime + 0.25;
      for (let i = 0; i < COUNT_IN; i++) this.audio.click(t0 + i * beat, i === 0);
      this.startTime = t0 + COUNT_IN * beat;
      this.stopAudio = this.audio.schedule(this.performance.notes, this.startTime).stop;
      this.flags = [];
      this.phase = 'playing';
      this.buttonText.setVisible(true);
      this.hint.setText('Tap when you hear a mistake');
    });
  }

  private flag(): void {
    const ms = (this.audio.currentTime - this.startTime) * 1000;
    if (ms < 0) return;
    this.flags.push(ms);
    this.flashUntil = this.audio.currentTime + 0.15;
    if (!this.state.settings.reducedMotion) {
      this.flash.setAlpha(0.22);
      this.tweens.add({ targets: this.flash, alpha: 0, duration: 140 });
    }
  }

  private async finish(): Promise<void> {
    if (this.phase !== 'playing') return;
    this.phase = 'grading';
    this.stopAudio = null;
    this.buttonText.setVisible(false);
    this.hint.setText('');
    this.countText.setText('');
    const run = this.run;
    try {
      const result = await this.core.gradeLesson({
        lessonId: this.lessonId,
        flagsMs: this.flags,
        latencyOffsetMs: this.state.settings.latencyOffsetMs,
      });
      if (run !== this.run) return;
      const { pay } = applyLessonResult(this.state, this.student, result.score);
      const last: LastLesson = {
        studentId: this.student.id,
        songId: this.song.id,
        lessonId: this.lessonId,
        day: this.state.day,
        result,
        pay,
      };
      this.registry.set('lastLesson', last);
      this.game.events.emit('lesson:complete', last);
      this.audio.chime();
      this.showResults(result, pay);
    } catch (err) {
      if (run === this.run) this.showError(err);
    }
  }

  private leave(): void {
    const target = this.params.returnTo && hasScene(this, this.params.returnTo) ? this.params.returnTo : 'Title';
    this.scene.start(target, { from: 'Piano', studentId: this.params.studentId });
  }

  // --- input -----------------------------------------------------------------

  private onPointer(p: Phaser.Input.Pointer): void {
    switch (this.phase) {
      case 'intro':
        this.begin();
        break;
      case 'playing':
        if (p.y >= H / 2 || this.inButton(p.x, p.y)) this.flag();
        break;
      case 'results':
      case 'error':
        if (this.time.now - this.resultsShownAt > 400) this.leave();
        break;
    }
  }

  private onKey(): void {
    if (this.phase === 'intro') this.begin();
    else if (this.phase === 'playing') this.flag();
    else if ((this.phase === 'results' || this.phase === 'error') && this.time.now - this.resultsShownAt > 400) this.leave();
  }

  private inButton(x: number, y: number): boolean {
    return x >= BUTTON.x && x < BUTTON.x + BUTTON.w && y >= BUTTON.y && y < BUTTON.y + BUTTON.h;
  }

  // --- drawing ---------------------------------------------------------------

  /** Performance time → score time (see perfToScoreMs). */
  private toScore(perfMs: number): number {
    return perfToScoreMs(perfMs, this.performance.pauses);
  }

  /** Draws the scrolling reference roll with the playhead at `nowMs` (score time). */
  private drawPlaying(nowMs: number): void {
    const g = this.roll;
    const l = this.layout;
    if (this.oboy) {
      // A hop on each beat: a visual metronome.
      const beat = msPerBeat(this.song);
      const onBeat = beat > 0 && nowMs >= 0 && nowMs % beat < beat * 0.25;
      this.oboy.setVisible(true).setFrame(onBeat ? 1 : 0).setY(ROLL.y + (onBeat ? 0 : 1));
    }
    g.clear();
    drawWindow(g, ROLL.x, ROLL.y, ROLL.w, ROLL.h);

    // Pitch rows: black-key rows darker, a faint line at each C.
    for (let p = l.minPitch; p <= l.maxPitch; p++) {
      const y = pitchToY(l, p);
      if (isBlackKey(p)) {
        g.fillStyle(0x000010, 0.28);
        g.fillRect(NOTES_X0, y, NOTES_X1 - NOTES_X0, l.rowH);
      }
      if (p % 12 === 0) {
        g.fillStyle(0xffffff, 0.12);
        g.fillRect(NOTES_X0, y + l.rowH - 1, NOTES_X1 - NOTES_X0, 1);
      }
    }

    // Beat and bar lines.
    const beatMs = msPerBeat(this.song);
    if (beatMs > 0) {
      const bar = beatsPerBar(this.song);
      const first = Math.ceil((nowMs - ((PLAYHEAD_X - NOTES_X0) * 1000) / ROLL_SPEED) / beatMs);
      for (let b = Math.max(0, first); ; b++) {
        const x = msToX(b * beatMs, nowMs);
        if (x >= NOTES_X1) break;
        if (x < NOTES_X0) continue;
        g.fillStyle(0xffffff, b % bar === 0 ? 0.22 : 0.08);
        g.fillRect(x, l.top, 1, l.height);
      }
    }

    // Reference notes (the song as written).
    const active = new Set<number>();
    for (const n of this.reference) {
      const x0 = msToX(n.startMs, nowMs);
      const x1 = msToX(n.startMs + n.durMs, nowMs);
      if (x1 <= NOTES_X0 || x0 >= NOTES_X1) continue;
      const playing = n.startMs <= nowMs && nowMs < n.startMs + n.durMs;
      if (playing) active.add(n.pitch);
      const past = n.startMs + n.durMs <= nowMs;
      const base = n.pitch >= 60 ? 0xffd860 : 0x70d0ff;
      const color = playing ? 0xffffff : past ? (n.pitch >= 60 ? 0x806c30 : 0x386880) : base;
      const a = Math.max(x0, NOTES_X0);
      const b = Math.min(x1 - 1, NOTES_X1);
      const y = pitchToY(l, n.pitch);
      g.fillStyle(color, 1);
      g.fillRect(a, y, Math.max(1, b - a), Math.max(1, l.rowH - (l.rowH > 2 ? 1 : 0)));
      if (x0 >= NOTES_X0 && l.rowH > 1) {
        g.fillStyle(0xffffff, 0.8);
        g.fillRect(x0, y, 1, Math.max(1, l.rowH - 1));
      }
    }

    // Keyboard strip, lit for the notes under the playhead.
    const kx = ROLL.x + 1;
    for (let p = l.minPitch; p <= l.maxPitch; p++) {
      const y = pitchToY(l, p);
      const black = isBlackKey(p);
      g.fillStyle(active.has(p) ? (p >= 60 ? 0xffd860 : 0x70d0ff) : black ? 0x202038 : 0xe0e4f0, 1);
      g.fillRect(kx, y, black ? KEYS_W - 4 : KEYS_W, l.rowH);
      if (black) {
        g.fillStyle(0xe0e4f0, 1);
        g.fillRect(kx + KEYS_W - 4, y, 4, l.rowH);
      }
    }
    g.fillStyle(0x000018, 1);
    g.fillRect(kx + KEYS_W, l.top, 1, l.height);

    // Flags so far (no right/wrong yet).
    for (const f of this.flags) {
      const x = msToX(this.toScore(f), nowMs);
      if (x < NOTES_X0 || x >= NOTES_X1) continue;
      pixels(g, x, ROLL.y + 2, [[-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]], COLORS.flag);
    }

    // Playhead.
    g.fillStyle(0xff6080, 1);
    g.fillRect(PLAYHEAD_X, ROLL.y + 1, 1, ROLL.h - 2);
    g.fillStyle(0xff6080, 0.35);
    g.fillRect(PLAYHEAD_X - 1, ROLL.y + 1, 1, ROLL.h - 2);
    g.fillRect(PLAYHEAD_X + 1, ROLL.y + 1, 1, ROLL.h - 2);

    // Progress bar.
    const total = Math.max(1, this.performance.durationMs);
    const frac = Math.min(1, Math.max(0, nowMs / total));
    g.fillStyle(0x283060, 1);
    g.fillRect(ROLL.x, ROLL.y + ROLL.h + 2, ROLL.w, 2);
    g.fillStyle(0x80a0ff, 1);
    g.fillRect(ROLL.x, ROLL.y + ROLL.h + 2, Math.round(ROLL.w * frac), 2);

    // Count-in numbers.
    if (this.phase === 'playing' && nowMs < 0 && beatMs > 0) {
      const beatsLeft = Math.ceil(-nowMs / beatMs);
      this.countText.setText(beatsLeft <= COUNT_IN ? String(COUNT_IN - beatsLeft + 1) : '');
    } else {
      this.countText.setText('');
    }

    this.drawButton();
  }

  private drawButton(): void {
    const h = this.hud;
    h.clear();
    if (this.phase !== 'playing' && this.phase !== 'starting') return;
    const pressed = this.audio.currentTime < this.flashUntil;
    const { x, y, w, h: bh } = BUTTON;
    h.fillStyle(0x000010, 1);
    h.fillRect(x + 1, y + 2, w, bh);
    for (const b of gradientBands(bh - 2, pressed ? 0xffe070 : 0xf06070, pressed ? 0xc08020 : 0x902038)) {
      h.fillStyle(b.color, 1);
      h.fillRect(x + 1, y + 1 + b.y + (pressed ? 1 : 0), w - 2, b.h);
    }
    h.fillStyle(COLORS.white, 1);
    const oy = pressed ? 1 : 0;
    h.fillRect(x + 1, y + oy, w - 2, 1);
    h.fillRect(x + 1, y + bh - 1 + oy, w - 2, 1);
    h.fillRect(x, y + 1 + oy, 1, bh - 2);
    h.fillRect(x + w - 1, y + 1 + oy, 1, bh - 2);
    this.buttonText.setY(y + bh / 2 + oy);
  }

  /** The whole piece compressed to fit, with every mistake marked hit/missed. */
  private drawResultsRoll(result: LessonGradeResult): void {
    const g = this.roll;
    g.clear();
    this.hud.clear();
    const R = RESULT_ROLL;
    drawWindow(g, R.x, R.y, R.w, R.h);
    const l = rollLayout(this.reference, R.y + 9, R.h - 12, 1, 3);
    const end = Math.max(this.performance.durationMs, notesEndMs(this.reference), ...result.mistakes.map((m) => m.onsetMs + 200));
    const x0 = R.x + 4;
    const x1 = R.x + R.w - 5;
    const fx = fitX(end, x0, x1);
    for (const n of this.reference) {
      const a = fx(n.startMs);
      const b = fx(n.startMs + n.durMs);
      g.fillStyle(n.pitch >= 60 ? 0xb8a050 : 0x4c88a8, 1);
      g.fillRect(a, pitchToY(l, n.pitch), Math.max(1, b - a - 1), Math.max(1, l.rowH - 1));
    }
    for (const f of this.flags) {
      const x = fx(this.toScore(f - this.state.settings.latencyOffsetMs));
      pixels(g, x, R.y + R.h - 4, [[0, 0], [-1, 1], [0, 1], [1, 1]], COLORS.flag);
    }
    const xs = result.mistakes.map((m) => fx(this.toScore(m.onsetMs)));
    result.mistakes.forEach((m: GradedMistake, i) => {
      const color = m.hit ? COLORS.green : COLORS.red;
      g.fillStyle(color, 0.55);
      g.fillRect(xs[i], R.y + 8, 1, R.h - 12);
      pixels(g, xs[i], R.y + 4, m.hit ? CHECK : CROSS, color);
    });
    const labels = result.mistakes.map((m) => mistakeLabel(m.type));
    // Press Start 2P glyphs are 8 px wide.
    const width = Math.max(30, ...labels.map((s) => s.length * 8));
    const rows = labelRows(xs, width, 2);
    result.mistakes.forEach((m, i) => {
      const x = Math.min(W - 4 - width / 2, Math.max(4 + width / 2, xs[i]));
      const t = this.add
        .text(Math.round(x), R.y + R.h + 1 + rows[i] * 9, labels[i], { ...TEXT, color: m.hit ? '#78f090' : '#ff7070' })
        .setOrigin(0.5, 0);
      this.overlay.push(t);
    });
  }

  private showResults(result: LessonGradeResult, pay: number): void {
    this.oboy?.setVisible(false);
    this.phase = 'results';
    this.resultsShownAt = this.time.now;
    this.clearOverlay();
    this.header.setText(`${this.student.name} · ${this.song.title}`).setY(2);
    this.drawResultsRoll(result);

    const card = this.add.graphics();
    const cy = 108;
    drawWindow(card, 6, cy, 308, 70);
    this.overlay.push(card);
    const add = (x: number, y: number, s: string, style: Phaser.Types.GameObjects.Text.TextStyle = TEXT) => {
      const t = this.add.text(x, y, s, style);
      this.overlay.push(t);
      return t;
    };
    add(14, cy + 5, `Score ${result.score}`, { ...BIG_TEXT, color: COLORS.gold });
    add(306, cy + 5, `+$${pay}`, { ...BIG_TEXT, color: '#a0ffb0' }).setOrigin(1, 0);
    add(14, cy + 24, `Caught ${result.hits}/${result.hits + result.misses} Missed ${result.misses} Wrong taps ${result.falseAlarms}`);
    const rows = summarizeMistakes(result.mistakes);
    rows.forEach((r, i) => {
      // Short labels ("Wrong", "Missed", …) so three fit per line.
      add(14 + (i % 3) * 98, cy + 35 + Math.floor(i / 3) * 10, `${r.label.split(' ')[0]} ${r.hit}/${r.total}`, { ...TEXT, color: COLORS.dim });
    });
    if (rows.length === 0) add(14, cy + 35, 'A clean performance!', { ...TEXT, color: COLORS.dim });
    const prompt = add(306, cy + 58, 'Tap to go on', { ...TEXT, color: COLORS.text }).setOrigin(1, 0);
    this.tweens.add({ targets: prompt, alpha: 0.25, duration: 600, yoyo: true, repeat: -1 });
    const firstMiss = result.mistakes.find((m) => !m.hit);
    if (firstMiss) add(14, cy + 58, `1st miss ${formatTime(firstMiss.onsetMs)}`, { ...TEXT, color: COLORS.dim });
  }

  private showError(err: unknown): void {
    this.phase = 'error';
    this.resultsShownAt = this.time.now;
    this.stopAudio?.();
    this.stopAudio = null;
    this.buttonText.setVisible(false);
    this.hint.setText('');
    this.audio.buzz();
    this.showCard(['The lesson could not start.', '', String(err instanceof Error ? err.message : err)], 'Tap to go back');
  }

  /** A centred window with lines of text and an optional blinking prompt. */
  private showCard(lines: (string | { text: string; style: Phaser.Types.GameObjects.Text.TextStyle })[], prompt?: string): void {
    this.clearOverlay();
    const g = this.add.graphics();
    const w = 240;
    const h = 100;
    const x = (W - w) / 2;
    const y = 36;
    drawWindow(g, x, y, w, h);
    this.overlay.push(g);
    let ty = y + 10;
    for (const line of lines) {
      const { text, style } = typeof line === 'string' ? { text: line, style: TEXT } : line;
      const t = this.add.text(W / 2, ty, text, style).setOrigin(0.5, 0);
      t.setWordWrapWidth(w - 16);
      this.overlay.push(t);
      ty += Number.parseInt(String(style.fontSize ?? '8'), 10) + 4;
    }
    if (prompt) {
      const t = this.add.text(W / 2, y + h - 16, prompt, { ...TEXT, color: COLORS.gold }).setOrigin(0.5, 0);
      this.tweens.add({ targets: t, alpha: 0.25, duration: 600, yoyo: true, repeat: -1 });
      this.overlay.push(t);
    }
  }

  private clearOverlay(): void {
    for (const o of this.overlay) o.destroy();
    this.overlay = [];
  }
}
