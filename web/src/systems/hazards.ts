// Weather hazards and Energy (SPEC.md §4.12). Pure: the map scene feeds it
// the blended weather and what Angie is wearing or using.
import type { Hazard, Item, WeatherParams } from '../core/types.gen';
import { MAX_ENERGY, type GameState } from './state';

/** Weather plus the typhoon signal, as hazards see it. */
export type HazardWeather = WeatherParams & { signal: number };

export interface Exposure {
  hazard: Hazard;
  severe: boolean;
  /** Energy per in-game minute. */
  drainPerMin: number;
}

export interface HazardReport {
  /** Hazards Angie is exposed to (not countered). */
  exposed: Exposure[];
  /** Hazards present but countered by gear or consumables. */
  countered: Hazard[];
  /** Wind push in px/s (x, y). */
  push: { x: number; y: number };
  /** Worn items that break now (e.g. an umbrella in strong wind). */
  breaks: string[];
}

function value(w: HazardWeather, param: string): number | undefined {
  switch (param) {
    case 'cloud':
    case 'precip':
    case 'temp':
    case 'fog':
    case 'wind':
    case 'uv':
      return w[param];
    case 'signal':
      return w.signal;
  }
  return undefined;
}

/** Whether a hazard's trigger condition holds. */
export function triggered(h: Hazard, w: HazardWeather): boolean {
  const v = value(w, h.when.param);
  if (v === undefined) return false;
  if (h.when.min !== undefined && v < h.when.min) return false;
  if (h.when.max !== undefined && v > h.when.max) return false;
  return true;
}

/** The item ids protecting Angie right now: worn gear and active consumables. */
export function protection(state: Pick<GameState, 'equipped' | 'active'>): Set<string> {
  const out = new Set<string>(Object.values(state.equipped).filter((x): x is string => !!x));
  for (const [id, left] of Object.entries(state.active)) if (left > 0) out.add(id);
  return out;
}

/** Evaluates every hazard against the weather and Angie's protection. */
export function assess(hazards: readonly Hazard[], w: HazardWeather, protectedBy: ReadonlySet<string>, worn: ReadonlySet<string> = protectedBy): HazardReport {
  const report: HazardReport = { exposed: [], countered: [], push: { x: 0, y: 0 }, breaks: [] };
  for (const h of hazards) {
    if (!triggered(h, w)) continue;
    const v = value(w, h.when.param) ?? 0;
    if (h.breaks && v >= h.breaks.min && worn.has(h.breaks.item)) report.breaks.push(h.breaks.item);
    if (h.counteredBy.some((id) => protectedBy.has(id))) {
      report.countered.push(h);
      continue;
    }
    const severe = !!h.severe && v >= h.severe.min;
    report.exposed.push({ hazard: h, severe, drainPerMin: severe && h.severe ? h.severe.drainPerMin : h.drainPerMin });
    if (h.push) {
      report.push.x += Math.cos(w.windDir) * h.push * w.wind;
      report.push.y += Math.sin(w.windDir) * h.push * w.wind;
    }
  }
  return report;
}

/** Energy after `minutes` of exposure (clamped to 0–MAX_ENERGY). */
export function drain(energy: number, exposed: readonly Exposure[], minutes: number): number {
  const loss = exposed.reduce((s, e) => s + e.drainPerMin, 0) * minutes;
  return Math.max(0, Math.min(MAX_ENERGY, energy - loss));
}

/**
 * Uses a consumable: restores Energy and starts its protection. Returns false
 * if Angie has none or it isn't a consumable. Mutates state.
 */
export function useItem(state: GameState, item: Item): boolean {
  if (item.kind !== 'consumable' || (state.items[item.id] ?? 0) <= 0) return false;
  state.items[item.id] -= 1;
  if (state.items[item.id] <= 0) delete state.items[item.id];
  state.energy = Math.min(MAX_ENERGY, state.energy + (item.restores ?? 0));
  if (item.durationSlots) state.active[item.id] = item.durationSlots;
  return true;
}

/** Wears or takes off a piece of gear (it must be owned). Mutates state. */
export function toggleGear(state: GameState, item: Item): 'worn' | 'removed' | 'not-owned' {
  if (item.kind !== 'gear' || !item.slot) return 'not-owned';
  const slot = item.slot as keyof GameState['equipped'];
  if (state.equipped[slot] === item.id) {
    delete state.equipped[slot];
    return 'removed';
  }
  if ((state.items[item.id] ?? 0) <= 0) return 'not-owned';
  state.equipped[slot] = item.id;
  return 'worn';
}

/** Removes a broken worn item from slots and inventory. Mutates state. */
export function breakItem(state: GameState, id: string): void {
  for (const [slot, worn] of Object.entries(state.equipped)) {
    if (worn === id) delete state.equipped[slot as keyof GameState['equipped']];
  }
  if ((state.items[id] ?? 0) > 0) state.items[id] -= 1;
  if (state.items[id] === 0) delete state.items[id];
}

/** Ages active consumables by one time slot. Mutates state. */
export function tickConsumables(state: GameState): void {
  for (const id of Object.keys(state.active)) {
    state.active[id] -= 1;
    if (state.active[id] <= 0) delete state.active[id];
  }
}
