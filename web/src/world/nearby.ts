// Nearby birding spots for the map indicators and the minimap (pure).

export interface Place {
  id: string;
  x: number;
  y: number;
}

/** Places within `radius` px of (x, y), nearest first, with their distance. */
export function nearby<T extends Place>(places: readonly T[], x: number, y: number, radius: number): (T & { d: number })[] {
  return places
    .map((p) => ({ ...p, d: Math.hypot(p.x - x, p.y - y) }))
    .filter((p) => p.d <= radius)
    .sort((a, b) => a.d - b.d);
}

const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];

/** An 8-way arrow from (x, y) toward (tx, ty) (screen coordinates: y down). */
export function arrowToward(x: number, y: number, tx: number, ty: number): string {
  const a = Math.atan2(ty - y, tx - x);
  const i = Math.round(a / (Math.PI / 4));
  return ARROWS[(i + 8) % 8];
}

/**
 * Where to put an edge indicator for an off-screen point: the point where the
 * line from the view centre to the target leaves the view, inset by `margin`.
 * Returns null if the target is inside the inset view.
 */
export function edgePoint(
  view: { x: number; y: number; w: number; h: number },
  tx: number,
  ty: number,
  margin: number,
): { x: number; y: number } | null {
  const cx = view.x + view.w / 2;
  const cy = view.y + view.h / 2;
  const hw = view.w / 2 - margin;
  const hh = view.h / 2 - margin;
  const dx = tx - cx;
  const dy = ty - cy;
  if (Math.abs(dx) <= hw && Math.abs(dy) <= hh) return null;
  const k = Math.min(hw / Math.max(Math.abs(dx), 1e-6), hh / Math.max(Math.abs(dy), 1e-6));
  return { x: cx + dx * k - view.x, y: cy + dy * k - view.y };
}
