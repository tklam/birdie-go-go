import { describe, expect, it } from 'vitest';
import { pathLength, pointAt, type Pt } from './path';

const path: Pt[] = [
  [0, 0],
  [100, 0],
  [100, 50],
];

describe('path', () => {
  it('measures length', () => {
    expect(pathLength(path)).toBe(150);
    expect(pathLength([])).toBe(0);
  });

  it('finds points and directions along the path, clamped', () => {
    expect(pointAt(path, 50)).toEqual({ x: 50, y: 0, dx: 1, dy: 0 });
    expect(pointAt(path, 125)).toEqual({ x: 100, y: 25, dx: 0, dy: 1 });
    expect(pointAt(path, -5)).toMatchObject({ x: 0, y: 0 });
    expect(pointAt(path, 999)).toMatchObject({ x: 100, y: 50 });
  });
});
