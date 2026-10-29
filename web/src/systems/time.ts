// Day and time-slot progression (SPEC.md §3.1).
import type { TriggerInput } from './events';
import { season, TIME_SLOTS, type GameState } from './state';

/**
 * Moves `state` (mutated in place) to the next slot: morning → afternoon →
 * evening → next day's morning. Returns the triggers to fire afterwards, in
 * order: `day_start` (with {day, season}) when the day changed, then
 * `time_slot_start` with {slot}.
 */
export function advanceSlot(state: GameState): TriggerInput[] {
  const index = TIME_SLOTS.indexOf(state.slot);
  const triggers: TriggerInput[] = [];
  if (index < 0 || index === TIME_SLOTS.length - 1) {
    state.day += 1;
    state.slot = TIME_SLOTS[0];
    triggers.push({ type: 'day_start', params: { day: String(state.day), season: season(state.day) } });
  } else {
    state.slot = TIME_SLOTS[index + 1];
  }
  triggers.push({ type: 'time_slot_start', params: { slot: state.slot } });
  return triggers;
}
