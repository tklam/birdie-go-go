// Weather warnings and what they close (SPEC.md §4.9). Pure: the core works
// out the typhoon signal and rainstorm warning; this reads them.
import type { AreaWeather, Hazard, WeatherDay } from '../core/types.gen';
import { triggered } from './hazards';
import { TIME_SLOTS, type TimeSlot } from './state';

export interface Warnings {
  /** Typhoon signal: 0 (none), 1, 3, 8 or 10. */
  signal: number;
  /** Rainstorm warning: '', 'amber', 'red' or 'black'. */
  rainstorm: string;
}

/** The typhoon signal from which, and the rainstorm warning at which, ferries, spots and lessons stop. */
export const CLOSURE_SIGNAL = 8;
export const CLOSURE_RAINSTORM = 'black';

export function warningsAt(day: WeatherDay | null | undefined, slot: TimeSlot): Warnings {
  const i = TIME_SLOTS.indexOf(slot);
  return { signal: day?.typhoonSignal[i] ?? 0, rainstorm: day?.rainstorm?.[i] ?? '' };
}

/** Whether ferries stop, outdoor spots close and lessons are cancelled. */
export function closures(w: Warnings): boolean {
  return w.signal >= CLOSURE_SIGNAL || w.rainstorm === CLOSURE_RAINSTORM;
}

/** Why things are closed, e.g. "Typhoon signal No. 8" (or ""). */
export function closureReason(w: Warnings): string {
  if (w.signal >= CLOSURE_SIGNAL) return `Typhoon signal No. ${w.signal}`;
  if (w.rainstorm === CLOSURE_RAINSTORM) return 'Black rainstorm warning';
  return '';
}

/** A short HUD tag: "T8", "Amber rain", "T3 Red rain" or "". */
export function warningTag(w: Warnings): string {
  const parts: string[] = [];
  if (w.signal) parts.push(`T${w.signal}`);
  if (w.rainstorm) parts.push(`${w.rainstorm.charAt(0).toUpperCase()}${w.rainstorm.slice(1)} rain`);
  return parts.join(' ');
}

/** A one-line announcement when a warning is raised, or "" for none. */
export function warningAnnouncement(w: Warnings): string {
  const parts: string[] = [];
  if (w.signal) parts.push(`Typhoon signal No. ${w.signal}`);
  if (w.rainstorm) parts.push(`${w.rainstorm.charAt(0).toUpperCase()}${w.rainstorm.slice(1)} rainstorm warning`);
  if (!parts.length) return '';
  return `${parts.join(' and ')}!${closures(w) ? ' Ferries, birding spots and lessons are off.' : ''}`;
}

/**
 * Radio warnings for tomorrow: each weather hazard (UV, heat, wind, …)
 * expected in the afternoon somewhere, with the areas it affects.
 */
export function hazardForecast(hazards: readonly Hazard[], forecast: readonly AreaWeather[], areaName: (id: string) => string): string[] {
  const out: string[] = [];
  for (const h of hazards) {
    if (h.when.param === 'signal') continue;
    const where = forecast.filter((f) => triggered(h, { ...f.slots[1], signal: 0 })).map((f) => areaName(f.area));
    if (where.length) out.push(`${h.name} warning: ${where.join(', ')}.`);
  }
  return out;
}
