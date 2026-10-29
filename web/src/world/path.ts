// Polyline helpers for on-map rides (SPEC.md §4.11). Pure.

export type Pt = [number, number];

export function pathLength(path: readonly Pt[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return total;
}

/** The point `distance` px along the path (clamped to its ends) and the direction of travel there. */
export function pointAt(path: readonly Pt[], distance: number): { x: number; y: number; dx: number; dy: number } {
  if (path.length === 0) return { x: 0, y: 0, dx: 0, dy: 0 };
  let left = Math.max(0, distance);
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const seg = Math.hypot(bx - ax, by - ay);
    if (seg === 0) continue;
    if (left <= seg || i === path.length - 1) {
      const t = Math.min(1, left / seg);
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, dx: (bx - ax) / seg, dy: (by - ay) / seg };
    }
    left -= seg;
  }
  const [x, y] = path[path.length - 1];
  return { x, y, dx: 0, dy: 0 };
}

/**
 * The part of a line's path from one stop to another. Stops are the path's
 * end points in the line's stop order (first stop = first point, last stop =
 * last point); riding against that order reverses the path.
 */
export function ridePath(path: readonly Pt[], stops: readonly string[], from: string, to: string): Pt[] | null {
  const a = stops.indexOf(from);
  const b = stops.indexOf(to);
  if (a < 0 || b < 0 || a === b) return null;
  return a < b ? [...path] : [...path].reverse();
}
