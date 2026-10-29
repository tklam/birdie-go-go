import type { WeatherParams } from '../core/types.gen';

/** The default lens and body (SPEC.md §5); gear upgrades change these later. */
export const FOCUS_TIME_MS = 600;
export const SHUTTER_THRESHOLD = 140;

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
