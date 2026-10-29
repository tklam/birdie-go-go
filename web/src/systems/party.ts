// Follower movement for the party display (SPEC.md §4.8): Kei walks along
// the path Angie actually took, a fixed path distance behind her.

/** Path distance in px that Kei trails behind Angie. */
export const KEI_FOLLOW_DISTANCE = 12;

export interface Point {
  x: number;
  y: number;
}

export interface FollowerTrailOptions {
  /** Moves shorter than this (px) from the last recorded point are ignored. Default 1. */
  minStep?: number;
  /** Path length (px) kept behind the leader; older points are trimmed. Default 64. */
  maxLength?: number;
}

/**
 * A recorded polyline of leader positions, newest last. Pure: no timers or
 * scene access; call push() once per frame with the leader's position.
 */
export class FollowerTrail {
  private points: Point[] = [];
  private readonly minStep: number;
  private readonly maxLength: number;

  constructor(options: FollowerTrailOptions = {}) {
    this.minStep = options.minStep ?? 1;
    this.maxLength = options.maxLength ?? 64;
  }

  /** Records the leader's position, ignoring sub-step jitter. */
  push(x: number, y: number): void {
    const last = this.points[this.points.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) < this.minStep) return;
    this.points.push({ x, y });
    this.trim();
  }

  /** Forgets the path and starts again at (x, y), e.g. after a teleport or map change. */
  reset(x: number, y: number): void {
    this.points = [{ x, y }];
  }

  /** Recorded points, oldest first (a copy). */
  get path(): Point[] {
    return this.points.map((p) => ({ ...p }));
  }

  /** Total recorded path length in px. */
  get length(): number {
    let total = 0;
    for (let i = 1; i < this.points.length; i++) total += dist(this.points[i - 1], this.points[i]);
    return total;
  }

  /**
   * The point `distance` px of path behind the newest point, interpolated
   * along the polyline. If less path than that exists the follower waits at
   * the oldest point. Null before anything was pushed.
   */
  positionAt(distance: number): Point | null {
    const pts = this.points;
    if (pts.length === 0) return null;
    let remaining = Math.max(0, distance);
    for (let i = pts.length - 1; i > 0; i--) {
      const a = pts[i];
      const b = pts[i - 1];
      const seg = dist(a, b);
      if (remaining <= seg) {
        const t = seg > 0 ? remaining / seg : 0;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
      remaining -= seg;
    }
    return { ...pts[0] };
  }

  /** Drops points that lie wholly beyond maxLength of path. */
  private trim(): void {
    let acc = 0;
    for (let i = this.points.length - 1; i > 0; i--) {
      acc += dist(this.points[i], this.points[i - 1]);
      if (acc >= this.maxLength) {
        // Point i - 1 is the first one at or past maxLength; keep it, drop older.
        if (i - 1 > 0) this.points.splice(0, i - 1);
        return;
      }
    }
  }
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
