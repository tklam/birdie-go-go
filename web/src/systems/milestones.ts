// Album milestones (SPEC.md §5.6). Pure: the session fires the triggers.
import type { Event } from '../core/types.gen';
import type { TriggerInput } from './events';
import type { GameState } from './state';

/**
 * The `album_milestone` triggers reached with the album as it stands: one per
 * species count used by an event (`trigger: { type: album_milestone,
 * species: "10" }`) that the album has reached. Events fire once, so firing
 * a reached milestone again is harmless.
 */
export function albumMilestones(state: Pick<GameState, 'album'>, events: readonly Pick<Event, 'trigger'>[]): TriggerInput[] {
  const count = Object.keys(state.album).length;
  const thresholds = new Set<number>();
  for (const e of events) {
    if (e.trigger.type !== 'album_milestone') continue;
    const n = Number(e.trigger.params?.species);
    if (Number.isInteger(n) && n > 0 && n <= count) thresholds.add(n);
  }
  return [...thresholds].sort((a, b) => a - b).map((n) => ({ type: 'album_milestone', params: { species: String(n) } }));
}
