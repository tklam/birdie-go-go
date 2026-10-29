// Confront combos (SPEC.md §4.13): sequences of directions and A/B buttons
// entered within a time window. Pure, so it is unit-tested.
import type { Enemy } from '../core/types.gen';

export const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const BUTTONS = ['A', 'B'] as const;
export type Button = (typeof BUTTONS)[number];
export type ComboSymbol = Direction | Button;

/** Windows are this much longer with the "Slower prompts" setting. */
export const SLOWER_PROMPTS_FACTOR = 1.5;

export interface ComboParams {
  length: number;
  /** Time to enter the whole sequence, in ms. */
  windowMs: number;
}

export function isDirection(s: ComboSymbol): s is Direction {
  return (DIRECTIONS as readonly string[]).includes(s);
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Difficulty at a resolve fraction (1 = full resolve = easy, 0 = hard):
 * length and window interpolate from comboLength[0]/windowMs[0] to [1].
 * enemy.windowMs is per symbol, so the whole sequence gets length × window.
 */
export function comboParams(
  enemy: Pick<Enemy, 'comboLength' | 'windowMs'>,
  resolveFraction: number,
  slowerPrompts = false,
): ComboParams {
  const t = 1 - clamp01(resolveFraction);
  const [l0, l1] = [enemy.comboLength[0] ?? 3, enemy.comboLength[1] ?? enemy.comboLength[0] ?? 3];
  const [w0, w1] = [enemy.windowMs[0] ?? 1500, enemy.windowMs[1] ?? enemy.windowMs[0] ?? 1500];
  const length = Math.max(1, Math.round(lerp(l0, l1, t)));
  const perSymbol = lerp(w0, w1, t) * (slowerPrompts ? SLOWER_PROMPTS_FACTOR : 1);
  return { length, windowMs: Math.round(perSymbol * length) };
}

/**
 * A combo of `length` symbols from a seeded random source. It always ends
 * with a button (like "← → A") and never repeats a symbol three times in a row.
 */
export function generateCombo(length: number, random: () => number): ComboSymbol[] {
  const n = Math.max(1, Math.floor(length));
  const out: ComboSymbol[] = [];
  for (let i = 0; i < n - 1; i++) {
    let s: ComboSymbol;
    do {
      // Mostly directions, sometimes a button mid-sequence.
      s = random() < 0.75 ? DIRECTIONS[Math.floor(random() * 4)] : BUTTONS[Math.floor(random() * 2)];
    } while (i >= 2 && out[i - 1] === s && out[i - 2] === s);
    out.push(s);
  }
  const [p1, p2] = [out[n - 2], out[n - 3]];
  let last: Button = BUTTONS[Math.floor(random() * 2)];
  if (p1 === last && p2 === last) last = last === 'A' ? 'B' : 'A';
  out.push(last);
  return out;
}

export interface ComboAttempt {
  combo: readonly ComboSymbol[];
  /** Symbols entered correctly so far. */
  index: number;
  startedAt: number;
  windowMs: number;
}

export type ComboStatus = 'pending' | 'complete' | 'wrong' | 'timeout';

export function startAttempt(combo: readonly ComboSymbol[], windowMs: number, now: number): ComboAttempt {
  return { combo, index: 0, startedAt: now, windowMs };
}

/** Feeds one input to an attempt. Returns the new attempt and its status. */
export function inputSymbol(a: ComboAttempt, s: ComboSymbol, now: number): { attempt: ComboAttempt; status: ComboStatus } {
  if (a.index >= a.combo.length) return { attempt: a, status: 'complete' };
  if (now - a.startedAt > a.windowMs) return { attempt: a, status: 'timeout' };
  if (a.combo[a.index] !== s) return { attempt: a, status: 'wrong' };
  const next = { ...a, index: a.index + 1 };
  return { attempt: next, status: next.index >= a.combo.length ? 'complete' : 'pending' };
}

/** Checks the clock: 'timeout' once the window has passed with symbols left. */
export function checkTimeout(a: ComboAttempt, now: number): ComboStatus {
  if (a.index >= a.combo.length) return 'complete';
  return now - a.startedAt > a.windowMs ? 'timeout' : 'pending';
}

/** Fraction of the window left (1 → 0). */
export function timeLeft(a: ComboAttempt, now: number): number {
  return clamp01(1 - (now - a.startedAt) / a.windowMs);
}

/** A swipe direction from a pointer displacement (CSS px), or null if too short. */
export function swipeDirection(dx: number, dy: number, minPx = 12): Direction | null {
  if (Math.hypot(dx, dy) < minPx) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

/** Keyboard code → combo symbol (arrows/WASD, Z/J = A, X/K = B). */
export function keySymbol(code: string): ComboSymbol | null {
  switch (code) {
    case 'ArrowUp':
    case 'KeyW':
      return 'up';
    case 'ArrowDown':
    case 'KeyS':
      return 'down';
    case 'ArrowLeft':
    case 'KeyA':
      return 'left';
    case 'ArrowRight':
    case 'KeyD':
      return 'right';
    case 'KeyZ':
    case 'KeyJ':
      return 'A';
    case 'KeyX':
    case 'KeyK':
      return 'B';
  }
  return null;
}
