// Transit on the client (SPEC.md §4.11): the in-game clock that timetables
// run on, discovered stops and unlocked lines. Timetables and route planning
// live in the Go core (core/transit).
import type { TransitCard, TransitLine } from '../core/types.gen';
import type { GameState, TimeSlot } from './state';

/** When each time slot starts, in minutes after midnight, and how long it lasts. */
export const SLOT_START_MIN: Record<TimeSlot, number> = { morning: 7 * 60, afternoon: 12 * 60, evening: 17 * 60 };
export const SLOT_LENGTH_MIN = 5 * 60;
export const MINUTES_PER_DAY = 24 * 60;

/**
 * The absolute in-game minute (day × 1440 + minutes since midnight): the
 * slot's start plus the minutes played in it (one per real second on the
 * map), held at the slot's last minute.
 */
export function clockMinutes(day: number, slot: TimeSlot, elapsed: number): number {
  return day * MINUTES_PER_DAY + SLOT_START_MIN[slot] + Math.min(SLOT_LENGTH_MIN - 1, Math.max(0, elapsed));
}

/** "07:42" for an absolute or daily minute. */
export function clockLabel(minutes: number): string {
  const m = ((Math.floor(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export const stopFlag = (id: string) => `stop:${id}`;
export const lineFlag = (id: string) => `line:${id}`;

/** Marks a stop as discovered; true the first time. Mutates state. */
export function discoverStop(state: Pick<GameState, 'flags'>, id: string): boolean {
  if (state.flags[stopFlag(id)]) return false;
  state.flags[stopFlag(id)] = true;
  return true;
}

/** Lines Angie can ride: unlocked from the start or opened by an unlock_line event. */
export function openLines(lines: readonly Pick<TransitLine, 'id' | 'locked'>[], state: Pick<GameState, 'flags'>): string[] {
  return lines.filter((l) => !l.locked || state.flags[lineFlag(l.id)]).map((l) => l.id);
}

/**
 * Pays a fare from the transit card (or from cash when the game has no
 * card). Returns false, changing nothing, when there isn't enough. Mutates state.
 */
export function payFare(state: Pick<GameState, 'money' | 'card'>, fare: number, card: TransitCard | undefined): boolean {
  if (card) {
    if (state.card < fare) return false;
    state.card -= fare;
    return true;
  }
  if (state.money < fare) return false;
  state.money -= fare;
  return true;
}

/** Tops up the card by one top-up from cash; false if Angie can't afford it. Mutates state. */
export function topUp(state: Pick<GameState, 'money' | 'card'>, card: TransitCard): boolean {
  if (state.money < card.topUp) return false;
  state.money -= card.topUp;
  state.card += card.topUp;
  return true;
}
