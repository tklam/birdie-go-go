// A* over tiles for tap-to-move (SPEC.md §4.4). Pure: the caller says which
// tiles are blocked (unloaded chunks count as blocked, so paths stay inside
// the loaded window).

export type Tile = [number, number];

const DIRS: readonly Tile[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * The shortest 4-way path from `start` to `goal` (excluding `start`), or null
 * if there is none within `maxNodes` expansions. A blocked goal is replaced by
 * its nearest open neighbour, so tapping a wall or an NPC walks up to it.
 */
export function findPath(start: Tile, goal: Tile, blocked: (tx: number, ty: number) => boolean, maxNodes = 4000): Tile[] | null {
  let target = goal;
  if (blocked(goal[0], goal[1])) {
    const open = DIRS.map(([dx, dy]): Tile => [goal[0] + dx, goal[1] + dy]).filter(([x, y]) => !blocked(x, y));
    if (open.length === 0) return null;
    open.sort((a, b) => dist(a, start) - dist(b, start));
    target = open[0];
  }
  const key = (t: Tile) => `${t[0]},${t[1]}`;
  if (key(target) === key(start)) return [];
  const came = new Map<string, Tile>();
  const g = new Map<string, number>([[key(start), 0]]);
  const open: { t: Tile; f: number }[] = [{ t: start, f: dist(start, target) }];
  let expanded = 0;
  while (open.length && expanded < maxNodes) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[best].f) best = i;
    const { t } = open.splice(best, 1)[0];
    const k = key(t);
    if (k === key(target)) {
      const path: Tile[] = [t];
      for (let c = came.get(k); c && key(c) !== key(start); c = came.get(key(c))) path.unshift(c);
      return path;
    }
    expanded++;
    for (const [dx, dy] of DIRS) {
      const n: Tile = [t[0] + dx, t[1] + dy];
      if (blocked(n[0], n[1])) continue;
      const nk = key(n);
      const cost = (g.get(k) ?? 0) + 1;
      if (cost >= (g.get(nk) ?? Infinity)) continue;
      g.set(nk, cost);
      came.set(nk, t);
      open.push({ t: n, f: cost + dist(n, target) });
    }
  }
  return null;
}

function dist(a: Tile, b: Tile): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}
