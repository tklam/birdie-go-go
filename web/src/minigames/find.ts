// The find mini game's rules (pure, SPEC.md §4.14): birds hidden around a
// scene among decoy props; tap a bird to find it, tapping empty scenery
// costs a little time. Layout comes from a seeded random source.
import { rng } from '../encounter/random';
import { shuffle } from './common';

/** Taps this close to a bird's centre count (birds are small; be generous). */
export const HIT_R = 22;
/** Seconds a tap on empty scenery costs. */
export const MISS_PENALTY = 2;
/** Seconds of play before the Hint button shows. */
export const HINT_AFTER = 15;
/** Birds keep at least this far apart so taps are never ambiguous. */
export const MIN_GAP = 30;
/** Where birds and decoys may go (keeps clear of the timer bar and edges). */
export const AREA = { left: 18, right: 302, top: 34, bottom: 162 };

export type BirdPose = 'perched' | 'perched_alert' | 'back_turned';

export interface HiddenBird {
  icon: string;
  x: number;
  y: number;
  /** 0.5 (small, far away) or 1. */
  scale: number;
  pose: BirdPose;
  /** Partly behind a leaf in front of it. */
  covered: boolean;
  found: boolean;
}

export interface Decoy {
  prop: string;
  x: number;
  y: number;
}

export interface FindLayout {
  birds: HiddenBird[];
  decoys: Decoy[];
}

export interface FindConfig {
  icons: readonly string[];
  /** Birds to find to win (clamped to the birds there are). */
  target: number;
  /** Time limit (0 = none). */
  seconds: number;
  /** 1, or 1.5 with Slow prompts (more time). */
  slower: number;
  seed: number;
}

export interface FindState {
  t: number;
  penalty: number;
  found: number;
}

export type TapResult = { kind: 'bird'; index: number } | { kind: 'again'; index: number } | { kind: 'miss' };

const DECOYS = ['leaf', 'flower', 'leaf', 'leaf', 'flower'];
const POSES: BirdPose[] = ['perched', 'perched_alert', 'back_turned'];

function inArea(x: number, y: number): boolean {
  return x >= AREA.left && x <= AREA.right && y >= AREA.top && y <= AREA.bottom;
}

function clear(points: readonly { x: number; y: number }[], x: number, y: number, gap: number): boolean {
  return points.every((p) => Math.hypot(p.x - x, p.y - y) >= gap);
}

/**
 * Places one bird per icon: first on the background's perches (shuffled),
 * then anywhere in the area, keeping MIN_GAP apart; plus decoy props.
 */
export function layoutFind(icons: readonly string[], perches: readonly (readonly [number, number])[], seed: number, decoys = 12): FindLayout {
  const r = rng(seed);
  const birds: HiddenBird[] = [];
  const spots = shuffle(perches.filter(([x, y]) => inArea(x, y)), r);
  for (const icon of icons) {
    let pos: [number, number] | undefined;
    while (spots.length && !pos) {
      const s = spots.shift() as readonly [number, number];
      if (clear(birds, s[0], s[1], MIN_GAP)) pos = [s[0], s[1]];
    }
    for (let i = 0; i < 200 && !pos; i++) {
      const x = Math.round(AREA.left + r() * (AREA.right - AREA.left));
      const y = Math.round(AREA.top + r() * (AREA.bottom - AREA.top));
      if (clear(birds, x, y, MIN_GAP)) pos = [x, y];
    }
    if (!pos) break;
    birds.push({
      icon,
      x: pos[0],
      y: pos[1],
      scale: r() < 0.5 ? 0.5 : 1,
      pose: POSES[Math.floor(r() * POSES.length) % POSES.length],
      covered: r() < 0.5,
      found: false,
    });
  }
  const out: Decoy[] = [];
  for (let i = 0; i < 400 && out.length < decoys; i++) {
    const x = Math.round(AREA.left + r() * (AREA.right - AREA.left));
    const y = Math.round(AREA.top + r() * (AREA.bottom - AREA.top));
    if (clear(birds, x, y, 14) && clear(out, x, y, 16)) out.push({ prop: DECOYS[out.length % DECOYS.length], x, y });
  }
  return { birds, decoys: out };
}

/** The bird a tap at (x, y) lands on: the nearest within HIT_R, else none. */
export function hitTest(birds: readonly HiddenBird[], x: number, y: number, radius = HIT_R): number {
  let best = -1;
  let bestD = radius;
  birds.forEach((b, i) => {
    const d = Math.hypot(b.x - x, b.y - y);
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

export function startFind(): FindState {
  return { t: 0, penalty: 0, found: 0 };
}

/** The number of birds that wins: the target, at most the birds placed. */
export function findTarget(cfg: Pick<FindConfig, 'target'>, layout: FindLayout): number {
  const n = layout.birds.length;
  return Math.max(1, Math.min(cfg.target > 0 ? cfg.target : n, n));
}

/** A tap: finds a bird (marking it), taps one already found, or misses (costs time). */
export function tapFind(state: FindState, layout: FindLayout, x: number, y: number): TapResult {
  const i = hitTest(layout.birds, x, y);
  if (i < 0) {
    state.penalty += MISS_PENALTY;
    return { kind: 'miss' };
  }
  const b = layout.birds[i];
  if (b.found) return { kind: 'again', index: i };
  b.found = true;
  state.found++;
  return { kind: 'bird', index: i };
}

/** Seconds left: the limit (longer with Slow prompts) minus play and misses. */
export function findTimeLeft(state: FindState, cfg: FindConfig): number {
  return cfg.seconds > 0 ? Math.max(0, cfg.seconds * cfg.slower - state.t - state.penalty) : Infinity;
}

export function findOver(state: FindState, cfg: FindConfig, layout: FindLayout): { over: boolean; won: boolean } {
  const won = state.found >= findTarget(cfg, layout);
  return { over: won || findTimeLeft(state, cfg) <= 0, won };
}

/** The bird a hint points at once HINT_AFTER seconds have passed: the first unfound one. */
export function hintBird(state: FindState, layout: FindLayout): number {
  if (state.t < HINT_AFTER) return -1;
  return layout.birds.findIndex((b) => !b.found);
}
