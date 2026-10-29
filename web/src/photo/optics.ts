import type { WeatherParams } from '../core/types.gen';

/** The default lens and body (SPEC.md §5); gear upgrades change these later. */
export const FOCUS_TIME_MS = 600;
export const SHUTTER_THRESHOLD = 140;

/** Kei's camera mods (SPEC.md §7.2): tracking AF focuses 30% faster, the stabilizer tolerates 40% more motion. */
export function withMods(o: { focusTimeMs: number; shutterThreshold: number }, items: Readonly<Record<string, number>>) {
  return {
    focusTimeMs: Math.round(o.focusTimeMs * ((items.af_module ?? 0) > 0 ? 0.7 : 1)),
    shutterThreshold: Math.round(o.shutterThreshold * ((items.stabilizer ?? 0) > 0 ? 1.4 : 1)),
  };
}

/** Focus time and shutter motion threshold under the given weather (SPEC.md §4.9). */
export function weatherOptics(w: WeatherParams | null | undefined): { focusTimeMs: number; shutterThreshold: number } {
  if (!w) return { focusTimeMs: FOCUS_TIME_MS, shutterThreshold: SHUTTER_THRESHOLD };
  return {
    // Low light (cloud, fog) makes focusing slower.
    focusTimeMs: Math.round(FOCUS_TIME_MS * (1 + w.cloud * 0.3 + w.fog * 0.6)),
    // Heavy rain lowers the sharpness ceiling.
    shutterThreshold: Math.round(SHUTTER_THRESHOLD * (1 - Math.min(1, w.precip) * 0.4)),
  };
}
