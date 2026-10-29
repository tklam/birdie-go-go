// Piano-roll layout on the 320×180 screen: pitch → row, ms → x. All results
// are whole pixels (SPEC.md §1.3).
import type { PerfNote } from '../core/types.gen';

export const SCREEN_W = 320;
/** Where the playhead sits; notes scroll left past it. */
export const PLAYHEAD_X = 80;
/** Default scroll speed in game px per second. */
export const ROLL_SPEED = 48;

export interface RollLayout {
  /** Lowest and highest pitch shown (inclusive). */
  minPitch: number;
  maxPitch: number;
  /** Height of one pitch row in px. */
  rowH: number;
  /** y of the top of the highest row. */
  top: number;
  /** Total height of the rows (rows × rowH). */
  height: number;
}

/**
 * Fits the pitch range of `notes` (plus `pad` semitones each side) into
 * `maxHeight` px starting at `top`, using the biggest whole-pixel row height
 * up to `maxRowH`, centred vertically.
 */
export function rollLayout(notes: readonly Pick<PerfNote, 'pitch'>[], top: number, maxHeight: number, pad = 1, maxRowH = 4): RollLayout {
  let lo = 60;
  let hi = 72;
  if (notes.length > 0) {
    lo = Math.min(...notes.map((n) => n.pitch));
    hi = Math.max(...notes.map((n) => n.pitch));
  }
  let minPitch = lo - pad;
  let maxPitch = hi + pad;
  let rows = maxPitch - minPitch + 1;
  if (rows > maxHeight) {
    // Too many pitches for one px each: clip symmetrically around the middle.
    const mid = Math.round((lo + hi) / 2);
    minPitch = mid - Math.floor(maxHeight / 2);
    maxPitch = minPitch + maxHeight - 1;
    rows = maxHeight;
  }
  const rowH = Math.max(1, Math.min(maxRowH, Math.floor(maxHeight / rows)));
  const height = rows * rowH;
  return { minPitch, maxPitch, rowH, top: top + Math.floor((maxHeight - height) / 2), height };
}

/** y of the top of a pitch's row (higher pitches are higher on screen). */
export function pitchToY(layout: RollLayout, pitch: number): number {
  return layout.top + (layout.maxPitch - pitch) * layout.rowH;
}

/** Screen x of a time while the playhead is at `nowMs`. */
export function msToX(ms: number, nowMs: number, pxPerSec = ROLL_SPEED, playheadX = PLAYHEAD_X): number {
  return Math.round(playheadX + ((ms - nowMs) * pxPerSec) / 1000);
}

/** The time span visible between x = 0 and x = width. */
export function visibleRange(nowMs: number, pxPerSec = ROLL_SPEED, playheadX = PLAYHEAD_X, width = SCREEN_W): [number, number] {
  return [nowMs - (playheadX * 1000) / pxPerSec, nowMs + ((width - playheadX) * 1000) / pxPerSec];
}

/** A whole-piece view: maps 0…durationMs onto x0…x1. */
export function fitX(durationMs: number, x0: number, x1: number): (ms: number) => number {
  const span = Math.max(1, durationMs);
  return (ms) => Math.round(x0 + ((x1 - x0) * Math.min(Math.max(ms, 0), span)) / span);
}

const BLACK = new Set([1, 3, 6, 8, 10]);

export function isBlackKey(pitch: number): boolean {
  return BLACK.has(((pitch % 12) + 12) % 12);
}

/**
 * Assigns label rows so labels of `width` px at the given x positions
 * (centred) don't overlap: greedy, lowest free row first, at most `maxRows`
 * rows (the last row takes the overflow).
 */
export function labelRows(xs: readonly number[], width: number, maxRows = 2, gap = 2): number[] {
  const rowEnd: number[] = Array.from({ length: maxRows }, () => -Infinity);
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const rows = new Array<number>(xs.length).fill(0);
  for (const [x, i] of order) {
    const left = x - width / 2;
    let row = rowEnd.findIndex((end) => end + gap <= left);
    if (row < 0) row = rowEnd.indexOf(Math.min(...rowEnd));
    rows[i] = row;
    rowEnd[row] = left + width;
  }
  return rows;
}
