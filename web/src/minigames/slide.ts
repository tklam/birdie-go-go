// The slide puzzle's rules (pure): a size×size grid of picture tiles with
// one gap. tiles[position] is the tile there; tile n-1 is the gap. Solved
// when every tile is at its own position.

export interface SlideState {
  size: number;
  tiles: number[];
  moves: number;
}

export type Dir = 'up' | 'down' | 'left' | 'right';

/** The grid size to play: `size` clamped to 3–4 (3 by default). */
export function slideSize(size: number | undefined): number {
  return Math.min(4, Math.max(3, Math.round(size || 3)));
}

export function solvedSlide(size: number): SlideState {
  return { size, tiles: Array.from({ length: size * size }, (_, i) => i), moves: 0 };
}

export function gapTile(size: number): number {
  return size * size - 1;
}

export function gapIndex(state: SlideState): number {
  return state.tiles.indexOf(gapTile(state.size));
}

/** Positions next to `pos` (up, down, left, right; inside the grid). */
export function neighbours(size: number, pos: number): number[] {
  const r = Math.floor(pos / size);
  const c = pos % size;
  const out: number[] = [];
  if (r > 0) out.push(pos - size);
  if (r < size - 1) out.push(pos + size);
  if (c > 0) out.push(pos - 1);
  if (c < size - 1) out.push(pos + 1);
  return out;
}

export function canSlide(state: SlideState, pos: number): boolean {
  return neighbours(state.size, gapIndex(state)).includes(pos);
}

/** Slides the tile at `pos` into the gap when it is next to it. Mutates state. */
export function slide(state: SlideState, pos: number): boolean {
  if (!canSlide(state, pos)) return false;
  const gap = gapIndex(state);
  [state.tiles[gap], state.tiles[pos]] = [state.tiles[pos], state.tiles[gap]];
  state.moves++;
  return true;
}

/**
 * The position of the tile an arrow key moves: the tile on the far side of
 * the gap travels in the arrow's direction (null when there is none).
 */
export function tileForDir(state: SlideState, dir: Dir): number | null {
  const { size } = state;
  const gap = gapIndex(state);
  const r = Math.floor(gap / size);
  const c = gap % size;
  switch (dir) {
    case 'up':
      return r < size - 1 ? gap + size : null;
    case 'down':
      return r > 0 ? gap - size : null;
    case 'left':
      return c < size - 1 ? gap + 1 : null;
    case 'right':
      return c > 0 ? gap - 1 : null;
  }
}

export function isSolved(state: SlideState): boolean {
  return state.tiles.every((t, i) => t === i);
}

/**
 * A shuffled puzzle: `steps` random legal moves from the solved state
 * (never undoing the last one), so it can always be solved. Never returns
 * a solved board. Moves start at 0.
 */
export function shuffleSlide(size: number, random: () => number, steps = size * size * 20): SlideState {
  const state = solvedSlide(size);
  let prev = -1;
  for (let i = 0; i < steps || isSolved(state); i++) {
    const gap = gapIndex(state);
    const options = neighbours(size, gap).filter((p) => p !== prev);
    const pick = options[Math.min(options.length - 1, Math.floor(random() * options.length))];
    slide(state, pick);
    prev = gap;
  }
  state.moves = 0;
  return state;
}

/** Whether a board can reach the solved state (permutation parity check). */
export function solvable(size: number, tiles: readonly number[]): boolean {
  const gap = gapTile(size);
  const rest = tiles.filter((t) => t !== gap);
  let inversions = 0;
  for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) if (rest[i] > rest[j]) inversions++;
  if (size % 2 === 1) return inversions % 2 === 0;
  const gapRowFromBottom = size - Math.floor(tiles.indexOf(gap) / size);
  return (inversions + gapRowFromBottom) % 2 === 1;
}
