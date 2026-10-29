// The Escape mash race (SPEC.md §4.13): Angie's run meter fills with taps,
// the enemy's chase meter fills as if it tapped mashRate times a second.
// Pure; the scene feeds it taps, holds and dodge results each frame.
import type { Direction } from './combo';
import { DIRECTIONS } from './combo';

/** Seconds the chase takes to fill from 0 (and Angie at exactly mashRate). */
export const RACE_SECONDS = 4;
/** With "Hold instead of mash", holding fills this much faster than needed. */
export const HOLD_FACTOR = 1.15;
/** Meter points for a dodge hit (to Angie) or miss (to the enemy). */
export const DODGE_BURST = 12;
/** Chase head start after being caught once ("retry from closer"). */
export const RETRY_HEAD_START = 15;
/** Dodge prompts come every 1.5–2.5 s and stay up this long (ms). */
export const DODGE_GAP_MS: readonly [number, number] = [1500, 2500];
export const DODGE_WINDOW_MS = 900;

export interface RaceParams {
  /** Run meter points per tap. */
  tapGain: number;
  /** Chase meter points per second. */
  chasePerSec: number;
  /** Run meter points per second while holding (hold mode only). */
  holdPerSec: number;
}

export interface RaceState {
  run: number;
  chase: number;
}

export type RaceStatus = 'running' | 'escaped' | 'caught';

/** Race tuning for an enemy: escaping needs more than mashRate taps/s. */
export function raceParams(mashRate: number): RaceParams {
  const rate = Math.max(0.5, mashRate);
  const chasePerSec = 100 / RACE_SECONDS;
  return { tapGain: chasePerSec / rate, chasePerSec, holdPerSec: chasePerSec * HOLD_FACTOR };
}

export function startRace(caughtBefore: number): RaceState {
  return { run: 0, chase: caughtBefore > 0 ? RETRY_HEAD_START : 0 };
}

export interface RaceInput {
  dtMs: number;
  taps: number;
  /** Hold mode and the pointer or Space is down. */
  holding: boolean;
  /** Dodge result this step: a hit bursts Angie, a miss bursts the enemy. */
  dodge?: 'hit' | 'miss';
}

/** One simulation step. Reaching 100 first wins; a tie goes to Angie. */
export function stepRace(s: RaceState, p: RaceParams, input: RaceInput): { state: RaceState; status: RaceStatus } {
  const dt = Math.max(0, input.dtMs) / 1000;
  let run = s.run + input.taps * p.tapGain + (input.holding ? p.holdPerSec * dt : 0);
  let chase = s.chase + p.chasePerSec * dt;
  if (input.dodge === 'hit') run += DODGE_BURST;
  if (input.dodge === 'miss') chase += DODGE_BURST;
  run = Math.min(100, run);
  chase = Math.min(100, chase);
  const status: RaceStatus = run >= 100 ? 'escaped' : chase >= 100 ? 'caught' : 'running';
  return { state: { run, chase }, status };
}

/** Delay before the next dodge prompt (ms). */
export function nextDodgeDelay(random: () => number): number {
  const [a, b] = DODGE_GAP_MS;
  return a + random() * (b - a);
}

export function dodgeDirection(random: () => number): Direction {
  return DIRECTIONS[Math.floor(random() * DIRECTIONS.length)];
}
