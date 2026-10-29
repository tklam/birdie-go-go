// App (service worker) updates (SPEC.md §9.1). A new version waits in the
// background instead of replacing files under a running game; it's applied
// from the title screen ("Update now") or simply on the next launch.

let apply: (() => void) | null = null;
const listeners: (() => void)[] = [];

/** Called by the service-worker registration when a new version is ready to apply. */
export function setAppUpdate(applyNow: () => void): void {
  apply = applyNow;
  for (const l of listeners.splice(0)) l();
}

/** Whether a new version is waiting. */
export function appUpdateReady(): boolean {
  return apply !== null;
}

/** Runs `cb` once when a new version becomes ready (at once if it already is). */
export function onAppUpdate(cb: () => void): void {
  if (apply) cb();
  else listeners.push(cb);
}

/** Switches to the new version (reloads the page). Only call where nothing unsaved can be lost. */
export function applyAppUpdate(): void {
  apply?.();
}
