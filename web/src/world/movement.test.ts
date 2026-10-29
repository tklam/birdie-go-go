import { describe, expect, it } from 'vitest';
import { move, type Box } from './movement';

// A 6×6 test grid: '#' solid, 'v' ledge (south only), '.' open.
const grid = [
  '......',
  '......',
  '..#...',
  'vvvvvv',
  '......',
  '......',
];
const at = (tx: number, ty: number) => {
  const c = grid[ty]?.[tx];
  if (c === undefined || c === '#') return 1;
  return c === 'v' ? 2 : 0;
};
const box: Box = { ox: -4, oy: -4, w: 8, h: 4 };

describe('move', () => {
  it('moves freely in open space', () => {
    expect(move({ x: 8, y: 12 }, 3, 2, box, at)).toEqual({ x: 11, y: 14 });
  });

  it('stops at solid tiles', () => {
    // Walking right into the '#' at tile (2, 2) from tile (1, 2).
    expect(move({ x: 26, y: 40 }, 4, 0, box, at)).toEqual({ x: 26, y: 40 });
  });

  it('slides along walls when moving diagonally', () => {
    const p = move({ x: 26, y: 40 }, 4, -3, box, at);
    expect(p).toEqual({ x: 26, y: 37 });
  });

  it('lets you hop down a ledge but not climb it', () => {
    // Standing just above the ledge row (tiles y=3 span 48–63).
    expect(move({ x: 72, y: 47 }, 0, 4, box, at)).toEqual({ x: 72, y: 51 });
    // Standing just below it, moving up.
    expect(move({ x: 72, y: 68 }, 0, -4, box, at)).toEqual({ x: 72, y: 68 });
    // Moving sideways inside the ledge row is blocked too.
    expect(move({ x: 72, y: 60 }, 4, 0, box, at)).toEqual({ x: 72, y: 60 });
  });

  it('treats outside the grid as solid', () => {
    expect(move({ x: 4, y: 8 }, -4, 0, box, at)).toEqual({ x: 4, y: 8 });
  });
});
