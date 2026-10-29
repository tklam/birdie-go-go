// The rhythm mini game's rules (pure, SPEC.md §4.14): festival drumming. The
// pattern's beats become note times on the audio clock; each tap is judged
// against the nearest unhit note, and notes that slip past the window are
// misses. Times are ms from the first beat (beat 0), already corrected for
// the player's latency offset.

export type Judgement = 'perfect' | 'good' | 'miss';

export interface Windows {
  /** A tap within ±perfect ms of a note is Perfect. */
  perfect: number;
  /** Within ±good ms it is Good; further away it doesn't count for that note. */
  good: number;
}

/** The base windows; `slower` (common.ts slower()) widens them for Slow prompts. */
export function windows(slower = 1): Windows {
  return { perfect: 90 * slower, good: 160 * slower };
}

export interface RhythmNote {
  timeMs: number;
  result: Judgement | null;
}

export interface RhythmState {
  notes: RhythmNote[];
  combo: number;
  bestCombo: number;
  perfect: number;
  good: number;
  miss: number;
  score: number;
}

/** Milliseconds per beat at `tempo` BPM (a non-positive tempo falls back to 100 BPM). */
export function msPerBeat(tempo: number): number {
  return 60000 / (tempo > 0 ? tempo : 100);
}

/** The pattern's beat numbers as ms from beat 0, sorted, without duplicates or negatives. */
export function beatTimesMs(pattern: readonly number[], tempo: number): number[] {
  const ms = msPerBeat(tempo);
  const beats = [...new Set(pattern.filter((b) => Number.isFinite(b) && b >= 0))].sort((a, b) => a - b);
  return beats.map((b) => b * ms);
}

export function startRhythm(pattern: readonly number[], tempo: number): RhythmState {
  return {
    notes: beatTimesMs(pattern, tempo).map((timeMs) => ({ timeMs, result: null })),
    combo: 0,
    bestCombo: 0,
    perfect: 0,
    good: 0,
    miss: 0,
    score: 0,
  };
}

/** Points for a hit: Perfect 100, Good 50, plus 10 per note of combo before it (up to 10). */
export function points(judgement: Judgement, comboBefore: number): number {
  if (judgement === 'miss') return 0;
  return (judgement === 'perfect' ? 100 : 50) + 10 * Math.min(comboBefore, 10);
}

/** How a tap `deltaMs` away from a note is judged (null: outside the windows). */
export function judgeDelta(deltaMs: number, w: Windows): Exclude<Judgement, 'miss'> | null {
  const d = Math.abs(deltaMs);
  if (d <= w.perfect) return 'perfect';
  if (d <= w.good) return 'good';
  return null;
}

/**
 * Marks every unhit note whose window closed before `nowMs` as a miss (the
 * combo breaks). Returns how many were missed. Mutates state.
 */
export function sweepMisses(state: RhythmState, nowMs: number, w: Windows): number {
  let n = 0;
  for (const note of state.notes) {
    if (note.result === null && note.timeMs + w.good < nowMs) {
      note.result = 'miss';
      state.miss++;
      state.combo = 0;
      n++;
    }
  }
  return n;
}

export interface TapResult {
  judgement: Exclude<Judgement, 'miss'>;
  /** Index of the note that was hit. */
  note: number;
  /** Tap − note in ms (negative: early). */
  deltaMs: number;
}

/**
 * Judges a tap at `tapMs` against the nearest unhit note within the Good
 * window. A tap near no note (a stray) returns null and costs nothing.
 * Notes already past their window are swept as misses first. Mutates state.
 */
export function tap(state: RhythmState, tapMs: number, w: Windows): TapResult | null {
  sweepMisses(state, tapMs, w);
  let best = -1;
  for (let i = 0; i < state.notes.length; i++) {
    const note = state.notes[i];
    if (note.result !== null) continue;
    const d = Math.abs(tapMs - note.timeMs);
    if (d > w.good) {
      if (note.timeMs > tapMs) break; // sorted: later notes are further away
      continue;
    }
    if (best < 0 || d < Math.abs(tapMs - state.notes[best].timeMs)) best = i;
  }
  if (best < 0) return null;
  const deltaMs = tapMs - state.notes[best].timeMs;
  const judgement = judgeDelta(deltaMs, w);
  if (!judgement) return null;
  state.notes[best].result = judgement;
  state.score += points(judgement, state.combo);
  state.combo++;
  state.bestCombo = Math.max(state.bestCombo, state.combo);
  if (judgement === 'perfect') state.perfect++;
  else state.good++;
  return { judgement, note: best, deltaMs };
}

/** Hits so far (Perfect + Good). */
export function hits(state: RhythmState): number {
  return state.perfect + state.good;
}

/** True once every note has been judged. */
export function rhythmOver(state: RhythmState): boolean {
  return state.notes.every((n) => n.result !== null);
}

/** Hits needed to win: `target` if set, else three quarters of the notes (at least 1). */
export function rhythmTarget(target: number | undefined, notes: number): number {
  if (target && target > 0) return Math.min(target, Math.max(1, notes));
  return Math.max(1, Math.ceil(notes * 0.75));
}

/** When play is over, in ms from beat 0: the last note's window has closed. */
export function endMs(state: RhythmState, w: Windows): number {
  const last = state.notes.length ? state.notes[state.notes.length - 1].timeMs : 0;
  return last + w.good;
}
