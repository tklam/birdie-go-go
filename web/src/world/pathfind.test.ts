import { describe, expect, it } from 'vitest';
import { findPath } from './pathfind';

// 0 = open, 1 = wall; outside the grid is blocked.
const grid = ['00000', '01110', '00010', '11010', '00000'];
const blocked = (x: number, y: number) => grid[y]?.[x] !== '0';

describe('findPath', () => {
  it('finds the shortest way around walls', () => {
    const p = findPath([0, 0], [2, 2], blocked)!;
    expect(p[p.length - 1]).toEqual([2, 2]);
    expect(p).toHaveLength(4);
    for (const [x, y] of p) expect(blocked(x, y)).toBe(false);
  });

  it('walks up to a blocked goal and gives up when unreachable', () => {
    const p = findPath([0, 0], [2, 1], blocked)!;
    expect(p[p.length - 1]).toEqual([2, 0]);
    expect(findPath([0, 0], [0, 4], (x, y) => blocked(x, y) || y === 2)).toBeNull();
    expect(findPath([0, 0], [0, 0], blocked)).toEqual([]);
  });
});
