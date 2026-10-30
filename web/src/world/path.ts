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

/** How far (px) along the path the point nearest (x, y) lies. */
export function projectOnPath(path: readonly Pt[], x: number, y: number): number {
  let best = 0;
  let bestD = Infinity;
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const seg = Math.hypot(bx - ax, by - ay);
    if (seg === 0) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (seg * seg)));
    const d = Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y);
    if (d < bestD) {
      bestD = d;
      best = walked + seg * t;
    }
    walked += seg;
  }
  return best;
}

/** A stop part-way along a ride and its distance along the ride's path. */
export interface StopOnPath {
  id: string;
  at: number;
}

/**
 * The stops a ride passes before its last one, in order along the path: each
 * placed where the path comes nearest it, keeping only those strictly inside
 * the ride (not at its ends).
 */
export function stopsAlong(path: readonly Pt[], stops: readonly { id: string; x: number; y: number }[], margin = 8): StopOnPath[] {
  const length = pathLength(path);
  return stops
    .map((s) => ({ id: s.id, at: projectOnPath(path, s.x, s.y) }))
    .filter((s) => s.at > margin && s.at < length - margin)
    .sort((a, b) => a.at - b.at);
}

/** The first stop still ahead of `distance` (with room to stop), if any. */
export function nextStopAhead(stops: readonly StopOnPath[], distance: number, room = 24): StopOnPath | undefined {
  return stops.find((s) => s.at > distance + room);
}
