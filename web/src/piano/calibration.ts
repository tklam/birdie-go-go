// Latency calibration maths (SPEC.md §6.4): the median offset between the
// player's taps and the metronome clicks they tapped along to.

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface CalibrationOptions {
  /** Clicks at the start that don't count (the player is finding the beat). */
  warmup?: number;
  /** A tap counts for a click only within ±windowMs of it. */
  windowMs?: number;
  /** Fewer valid taps than this means "try again". */
  minTaps?: number;
}

export interface CalibrationResult {
  ok: boolean;
  /** Median tap − click in whole ms (positive = taps arrive late). 0 when not ok. */
  offsetMs: number;
  /** The tap − click differences that counted. */
  deltas: number[];
}

/**
 * Matches each counted click with the nearest unused tap within the window
 * and returns the median difference. Times are in ms on one clock.
 */
export function calibrate(tapsMs: readonly number[], clicksMs: readonly number[], options: CalibrationOptions = {}): CalibrationResult {
  const { warmup = 2, windowMs = 250, minTaps = 4 } = options;
  const used = new Set<number>();
  const deltas: number[] = [];
  for (const click of clicksMs.slice(warmup)) {
    let best = -1;
    for (let i = 0; i < tapsMs.length; i++) {
      if (used.has(i) || Math.abs(tapsMs[i] - click) > windowMs) continue;
      if (best < 0 || Math.abs(tapsMs[i] - click) < Math.abs(tapsMs[best] - click)) best = i;
    }
    if (best >= 0) {
      used.add(best);
      deltas.push(tapsMs[best] - click);
    }
  }
  const ok = deltas.length >= minTaps;
  return { ok, offsetMs: ok ? Math.round(median(deltas)) : 0, deltas };
}
