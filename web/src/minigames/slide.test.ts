import { describe, expect, it } from 'vitest';
import { rng } from '../encounter/random';
import {
  canSlide,
  gapIndex,
  isSolved,
  neighbours,
  shuffleSlide,
  slide,
  slideSize,
  solvable,
  solvedSlide,
  tileForDir,
  type Dir,
} from './slide';

describe('slideSize', () => {
  it.each([
    { size: undefined, want: 3 },
    { size: 0, want: 3 },
    { size: 2, want: 3 },
    { size: 3, want: 3 },
    { size: 4, want: 4 },
    { size: 9, want: 4 },
  ])('$size → $want', ({ size, want }) => {
    expect(slideSize(size)).toBe(want);
  });
});

describe('neighbours', () => {
  it.each([
    { size: 3, pos: 0, want: [1, 3] },
    { size: 3, pos: 4, want: [1, 3, 5, 7] },
    { size: 3, pos: 8, want: [5, 7] },
    { size: 3, pos: 2, want: [1, 5] },
    { size: 4, pos: 7, want: [3, 6, 11] },
    { size: 4, pos: 12, want: [8, 13] },
  ])('size $size pos $pos', ({ size, pos, want }) => {
    expect([...neighbours(size, pos)].sort((a, b) => a - b)).toEqual(want);
  });
});

describe('slide', () => {
  it('moves a tile next to the gap and counts it', () => {
    const s = solvedSlide(3);
    expect(gapIndex(s)).toBe(8);
    expect(canSlide(s, 7)).toBe(true);
    expect(slide(s, 7)).toBe(true);
    expect(gapIndex(s)).toBe(7);
    expect(s.tiles[8]).toBe(7);
    expect(s.moves).toBe(1);
    expect(isSolved(s)).toBe(false);
    expect(slide(s, 8)).toBe(true);
    expect(isSolved(s)).toBe(true);
  });

  it.each([0, 4, 6, 8])('refuses position %i away from (or at) the gap', (pos) => {
    const s = solvedSlide(3);
    expect(slide(s, pos)).toBe(false);
    expect(s.moves).toBe(0);
    expect(isSolved(s)).toBe(true);
  });
});

describe('tileForDir', () => {
  // Gap in the middle of a 3×3 board.
  const mid = () => {
    const s = solvedSlide(3);
    slide(s, 5);
    slide(s, 4);
    return s;
  };
  it.each<{ dir: Dir; want: number }>([
    { dir: 'up', want: 7 },
    { dir: 'down', want: 1 },
    { dir: 'left', want: 5 },
    { dir: 'right', want: 3 },
  ])('$dir moves the tile at $want', ({ dir, want }) => {
    expect(tileForDir(mid(), dir)).toBe(want);
  });

  it.each<{ dir: Dir; want: number | null }>([
    { dir: 'up', want: null },
    { dir: 'left', want: null },
    { dir: 'down', want: 5 },
    { dir: 'right', want: 7 },
  ])('solved board: $dir → $want', ({ dir, want }) => {
    expect(tileForDir(solvedSlide(3), dir)).toBe(want);
  });
});

describe('shuffleSlide', () => {
  it.each([3, 4])('size %i: shuffled, solvable, a permutation', (size) => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = shuffleSlide(size, rng(seed));
      expect(isSolved(s)).toBe(false);
      expect(s.moves).toBe(0);
      expect([...s.tiles].sort((a, b) => a - b)).toEqual(solvedSlide(size).tiles);
      expect(solvable(size, s.tiles)).toBe(true);
    }
  });

  it('is deterministic for a seed', () => {
    expect(shuffleSlide(4, rng(9)).tiles).toEqual(shuffleSlide(4, rng(9)).tiles);
    expect(shuffleSlide(4, rng(9)).tiles).not.toEqual(shuffleSlide(4, rng(10)).tiles);
  });

  it('never returns a solved board, even with no steps', () => {
    expect(isSolved(shuffleSlide(3, rng(1), 0))).toBe(false);
  });
});

describe('solvable', () => {
  it.each([
    { name: 'solved 3×3', size: 3, tiles: [0, 1, 2, 3, 4, 5, 6, 7, 8], want: true },
    { name: '3×3 two tiles swapped', size: 3, tiles: [1, 0, 2, 3, 4, 5, 6, 7, 8], want: false },
    { name: 'solved 4×4', size: 4, tiles: [...Array(16).keys()], want: true },
    { name: '4×4 14 and 15 swapped', size: 4, tiles: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 13, 15], want: false },
    { name: '4×4 gap moved up one', size: 4, tiles: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 12, 13, 14, 11], want: true },
  ])('$name → $want', ({ size, tiles, want }) => {
    expect(solvable(size, tiles)).toBe(want);
  });
});
