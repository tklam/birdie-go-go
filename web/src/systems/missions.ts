// Missions (SPEC.md §9.5). Progress lives in story flags so saves need no
// new fields: "mission:<id>" while active, "mission_done:<id>" when done.
import type { ContentBundle, Mission } from '../core/types.gen';
import { checkAll } from './events';
import type { GameState, PhotoRating } from './state';

const RANK: Record<string, number> = { blurry: 0, good: 1, great: 2, perfect: 3 };

export const activeFlag = (id: string) => `mission:${id}`;
export const doneFlag = (id: string) => `mission_done:${id}`;

/**
 * The mission to mention in the next reminder: active missions take turns.
 * Null when there are none.
 */
export function reminderMission(state: GameState, content: Pick<ContentBundle, 'missions'>, turn: number): Mission | null {
  const active = activeMissions(state, content);
  return active.length ? active[turn % active.length] : null;
}

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

/** Active ride missions met by riding `line` to `stop`. */
export function rideMissionsMet(state: GameState, content: Pick<ContentBundle, 'missions'>, line: string, stop: string): Mission[] {
  return activeMissions(state, content).filter(
    (m) => m.objective.type === 'ride' && (!m.objective.line || m.objective.line === line) && (!m.objective.stop || m.objective.stop === stop),
  );
}

/** Active visit missions met by entering `area`. */
export function visitMissionsMet(state: GameState, content: Pick<ContentBundle, 'missions'>, area: string): Mission[] {
  return activeMissions(state, content).filter((m) => m.objective.type === 'visit' && m.objective.area === area);
}

/** A local date as "YYYY-MM-DD". */
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const expiredFlag = (id: string) => `mission_expired:${id}`;

/**
 * Starts the self-offered missions (with `available` or a `window`) whose
 * conditions hold today and whose window includes `today`. Returns them.
 * Mutates state.
 */
export function offerMissions(state: GameState, content: Pick<ContentBundle, 'missions'>, today: string): Mission[] {
  return content.missions.filter((m) => {
    if (!m.available?.length && !m.window) return false;
    if (state.flags[expiredFlag(m.id)]) return false;
    if (m.window && (today < m.window.from || today > m.window.to)) return false;
    if (!checkAll(m.available, state)) return false;
    return startMission(state, m.id);
  });
}

/** Ends active live missions whose window has passed. Returns them. Mutates state. */
export function expireMissions(state: GameState, content: Pick<ContentBundle, 'missions'>, today: string): Mission[] {
  return activeMissions(state, content).filter((m) => {
    if (!m.window || today <= m.window.to) return false;
    delete state.flags[activeFlag(m.id)];
    state.flags[expiredFlag(m.id)] = true;
    return true;
  });
}
