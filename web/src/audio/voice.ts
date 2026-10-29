// Pure (DSP-free) maths for the synthesized piano and the note scheduler:
// pitch → frequency, partial tables, envelopes and scheduling plans. The
// AudioEngine turns these numbers into Web Audio nodes.

/** A note to play, in milliseconds relative to the schedule's start time. */
export interface ScheduleNote {
  pitch: number;
  startMs: number;
  durMs: number;
  vel: number;
}

/** Equal-tempered frequency of a MIDI pitch (A4 = 69 = 440 Hz). */
export function midiToFreq(pitch: number): number {
  return 440 * 2 ** ((pitch - 69) / 12);
}

/** One sine component of a piano voice. */
export interface VoicePartial {
  /** Frequency in Hz. */
  freq: number;
  /** Peak gain (the partials of one voice sum to the voice's peak gain). */
  gain: number;
  /** Exponential decay time constant in seconds. */
  decay: number;
}

/** Piano string inharmonicity coefficient; stiffer (higher) strings stray more. */
export function inharmonicity(pitch: number): number {
  return 0.0004 * 2 ** ((pitch - 60) / 24);
}

/** Frequency of partial n (1-based) of a stiff string: n·f0·√(1 + B·n²). */
export function partialFreq(f0: number, n: number, b: number): number {
  return n * f0 * Math.sqrt(1 + b * n * n);
}

/** Peak gain for a velocity 1–127: a soft power curve, 0 for silent notes. */
export function velocityGain(vel: number): number {
  const v = Math.min(127, Math.max(0, vel)) / 127;
  return 0.42 * v ** 1.5;
}

/** Brightness 0–1 for a velocity: harder hits excite more upper partials. */
export function velocityBrightness(vel: number): number {
  return 0.3 + 0.7 * (Math.min(127, Math.max(0, vel)) / 127);
}

/** Decay time constant of the fundamental: long in the bass, short in the treble. */
export function fundamentalDecay(pitch: number): number {
  return Math.min(4, Math.max(0.35, 2.2 * 2 ** (-(pitch - 48) / 20)));
}

export const MAX_PARTIALS = 8;

/**
 * The additive partials of a piano note: a slightly inharmonic series whose
 * upper partials are weaker and die faster, brighter at higher velocity.
 * The two lowest partials are doubled with a tiny detune, like the unison
 * strings of a real piano, which gives the tone its gentle beating.
 * Partials above `maxFreq` (the anti-alias limit) are dropped.
 */
export function pianoPartials(pitch: number, vel: number, maxFreq = 16000): VoicePartial[] {
  const f0 = midiToFreq(pitch);
  const b = inharmonicity(pitch);
  const bright = velocityBrightness(vel);
  const tau1 = fundamentalDecay(pitch);
  const raw: VoicePartial[] = [];
  for (let n = 1; n <= MAX_PARTIALS; n++) {
    const freq = partialFreq(f0, n, b);
    if (freq > maxFreq) break;
    // Rolloff steepens for soft notes; a hammer near 1/7 of the string damps the 7th.
    let amp = 1 / n ** (2.6 - 1.4 * bright);
    if (n === 7) amp *= 0.35;
    // Bass notes have a weak fundamental relative to their 2nd/3rd partials.
    if (n === 1 && pitch < 48) amp *= 0.7;
    const decay = tau1 / (1 + 0.55 * (n - 1));
    if (n <= 2) {
      raw.push({ freq: freq * 0.99965, gain: amp / 2, decay }, { freq: freq * 1.00035, gain: amp / 2, decay: decay * 1.4 });
    } else {
      raw.push({ freq, gain: amp, decay });
    }
  }
  const total = raw.reduce((s, p) => s + p.gain, 0) || 1;
  const peak = velocityGain(vel);
  return raw.map((p) => ({ ...p, gain: (p.gain / total) * peak }));
}

/** Attack time of a piano voice in seconds (hammer strike). */
export const ATTACK_S = 0.004;

/** Damper release time constant in seconds: bass dampers are slower. */
export function releaseTau(pitch: number): number {
  return pitch < 48 ? 0.12 : 0.07;
}

export interface Envelope {
  peak: number;
  attack: number;
  /** Decay time constant while held. */
  decay: number;
  /** Seconds after the onset at which the key is released. */
  releaseAt: number;
  releaseTau: number;
}

/**
 * Gain of a struck-and-held envelope `t` seconds after the onset: a linear
 * attack, exponential decay while held and a faster exponential release.
 * Mirrors what the AudioEngine schedules with setTargetAtTime.
 */
export function envelopeGainAt(t: number, e: Envelope): number {
  const held = (tt: number) =>
    tt <= 0 ? 0 : tt < e.attack ? (e.peak * tt) / e.attack : e.peak * Math.exp(-(tt - e.attack) / e.decay);
  if (t <= e.releaseAt) return held(t);
  return held(e.releaseAt) * Math.exp(-(t - e.releaseAt) / e.releaseTau);
}

/** Seconds after the onset when a voice is inaudible (−60 dB below release) and can stop. */
export function voiceLength(durS: number, relTau: number): number {
  return Math.max(durS, ATTACK_S) + relTau * 7;
}

/** Absolute AudioContext start and end (key release) times of a scheduled note. */
export function noteTimes(note: ScheduleNote, atTime: number): { start: number; end: number } {
  const start = atTime + note.startMs / 1000;
  return { start, end: start + Math.max(0, note.durMs) / 1000 };
}

/**
 * Lookahead scheduling: given notes sorted by startMs and the index of the
 * first note not yet scheduled, returns the index just past the last note
 * that starts before `horizon` (an AudioContext time). Notes in
 * [cursor, result) should be scheduled now. Notes whose start is already in
 * the past are included so nothing is skipped; the engine starts them late.
 */
export function dueUntil(notes: readonly ScheduleNote[], cursor: number, atTime: number, horizon: number): number {
  let i = cursor;
  while (i < notes.length && atTime + notes[i].startMs / 1000 < horizon) i++;
  return i;
}

/** Sorts notes by start (then pitch) without modifying the input. */
export function sortNotes<T extends ScheduleNote>(notes: readonly T[]): T[] {
  return [...notes].sort((a, b) => a.startMs - b.startMs || a.pitch - b.pitch);
}

/** AudioContext time at which a whole schedule has finished sounding. */
export function scheduleEnd(notes: readonly ScheduleNote[], atTime: number): number {
  let end = atTime;
  for (const n of notes) {
    end = Math.max(end, atTime + n.startMs / 1000 + voiceLength(n.durMs / 1000, releaseTau(n.pitch)));
  }
  return end;
}

/** Metronome click times (AudioContext seconds) for `count` beats at `bpm`. */
export function clickTimes(count: number, bpm: number, atTime: number): number[] {
  const beat = 60 / bpm;
  return Array.from({ length: Math.max(0, count) }, (_, i) => atTime + i * beat);
}

/** Clamps a volume to 0–1 (NaN → 0). */
export function clampVolume(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}
