// Synthesized sound cues and soundscapes (SPEC.md §1.3): the pure part.
// Content describes a cue as notes (content/sounds.yaml); this expands them
// into timed events for AudioEngine.playCue, and decides which of a
// soundscape's scattered cues may play now. Nothing here touches Web Audio.
import type { SoundCue, SoundscapeCue } from '../core/types.gen';

/** One oscillator or noise burst, `start` seconds after the cue begins. */
export interface CueEvent {
  wave: string;
  freq: number;
  /** Pitch to glide to over the note (same as freq when there's no glide). */
  to: number;
  start: number;
  dur: number;
  gain: number;
  env: 'pluck' | 'swell';
  q: number;
}

export const DEFAULT_NOTE_GAIN = 0.3;

/**
 * The cue's notes with repeats unrolled and defaults filled in, pitched by
 * `pitch` (1 = as written), in start order.
 */
export function expandCue(cue: Pick<SoundCue, 'notes'>, pitch = 1): CueEvent[] {
  const out: CueEvent[] = [];
  for (const n of cue.notes) {
    const freq = n.freq * pitch;
    const base: Omit<CueEvent, 'start'> = {
      wave: n.wave,
      freq,
      to: n.to ? n.to * pitch : freq,
      dur: n.dur,
      gain: n.gain || DEFAULT_NOTE_GAIN,
      env: n.env === 'swell' ? 'swell' : 'pluck',
      q: n.q || 1,
    };
    const at = n.at ?? 0;
    for (let i = 0; i <= (n.repeat ?? 0); i++) out.push({ ...base, start: at + i * (n.every ?? 0) });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Seconds from the cue's start to the end of its last note. */
export function cueLength(events: readonly CueEvent[]): number {
  return events.reduce((m, e) => Math.max(m, e.start + e.dur), 0);
}

/** Rain (0–1, as heard) above which dry cues (birds, insects) fall silent. */
export const DRY_RAIN = 0.3;

/** Whether a soundscape cue may play in this slot, season and rain. */
export function cueAllowed(c: Pick<SoundscapeCue, 'slots' | 'seasons' | 'dry'>, slot: string, season: string, rain: number): boolean {
  if (c.slots?.length && !c.slots.includes(slot)) return false;
  if (c.seasons?.length && !c.seasons.includes(season)) return false;
  return !(c.dry && rain > DRY_RAIN);
}

/** A wait in seconds within [min, max] for a uniform random `r` in [0, 1). */
export function nextWait(every: readonly [number, number] | number[], r: number): number {
  return every[0] + (every[1] - every[0]) * r;
}

/**
 * Loudness and stereo position of a sound at (x, y) heard from (hx, hy):
 * gain falls from 1 to 0 at `range` px, pan follows the horizontal offset.
 */
export function placeSound(x: number, y: number, hx: number, hy: number, range: number): { gain: number; pan: number } {
  const d = Math.hypot(x - hx, y - hy);
  const near = Math.max(0, 1 - d / range);
  return { gain: near * near, pan: Math.max(-1, Math.min(1, (x - hx) / range)) };
}
