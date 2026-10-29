// Missions (SPEC.md §9.5). Progress lives in story flags so saves need no
// new fields: "mission:<id>" while active, "mission_done:<id>" when done.
import type { ContentBundle, Mission } from '../core/types.gen';
import type { GameState, PhotoRating } from './state';

const RANK: Record<string, number> = { blurry: 0, good: 1, great: 2, perfect: 3 };

export const activeFlag = (id: string) => `mission:${id}`;
export const doneFlag = (id: string) => `mission_done:${id}`;

/** Starts a mission unless it's already active or done. Mutates state. */
export function startMission(state: GameState, id: string): boolean {
  if (state.flags[activeFlag(id)] || state.flags[doneFlag(id)]) return false;
  state.flags[activeFlag(id)] = true;
  return true;
}

export function activeMissions(state: GameState, content: Pick<ContentBundle, 'missions'>): Mission[] {
  return content.missions.filter((m) => state.flags[activeFlag(m.id)]);
}

export function doneMissions(state: GameState, content: Pick<ContentBundle, 'missions'>): Mission[] {
  return content.missions.filter((m) => state.flags[doneFlag(m.id)]);
}

export interface PhotoResult {
  species: string;
  rating: PhotoRating;
  area: string;
}

/** Active photograph missions satisfied by any of the photos. */
export function photoMissionsMet(state: GameState, content: Pick<ContentBundle, 'missions'>, photos: readonly PhotoResult[]): Mission[] {
  return activeMissions(state, content).filter((m) => {
    const o = m.objective;
    if (o.type !== 'photograph') return false;
    return photos.some(
      (p) =>
        p.species === o.species &&
        RANK[p.rating] >= RANK[o.minRating || 'good'] &&
        (!o.area || p.area === o.area),
    );
  });
}

/** Active lesson missions satisfied by a lesson result. */
export function lessonMissionsMet(state: GameState, content: Pick<ContentBundle, 'missions'>, studentId: string, score: number): Mission[] {
  return activeMissions(state, content).filter(
    (m) => m.objective.type === 'lesson' && m.objective.student === studentId && score >= (m.objective.minScore ?? 0),
  );
}

/** Completes a mission: rewards and flags. Mutates state. */
export function completeMission(state: GameState, m: Mission): void {
  delete state.flags[activeFlag(m.id)];
  state.flags[doneFlag(m.id)] = true;
  state.money += m.reward.money;
  for (const it of m.reward.items) state.items[it] = (state.items[it] ?? 0) + 1;
}
