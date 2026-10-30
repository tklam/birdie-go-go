import { describe, expect, it } from 'vitest';
import { nextStopAhead, pathLength, pointAt, projectOnPath, stopsAlong, type Pt } from './path';

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

describe('stops along a ride', () => {
  const route: Pt[] = [
    [0, 0],
    [100, 0],
    [100, 100],
  ];

  it('projects points onto the path', () => {
    expect(projectOnPath(route, 50, 20)).toBe(50);
    expect(projectOnPath(route, 130, 60)).toBe(160);
    expect(projectOnPath(route, -40, 0)).toBe(0);
  });

  it('orders the stops strictly inside the ride', () => {
    const stops = [
      { id: 'corner', x: 104, y: 4 },
      { id: 'mid', x: 50, y: 30 },
      { id: 'end', x: 100, y: 100 },
      { id: 'start', x: 0, y: 2 },
    ];
    expect(stopsAlong(route, stops).map((s) => s.id)).toEqual(['mid', 'corner']);
  });

  it('finds the next stop with room to pull in', () => {
    const stops = [
      { id: 'a', at: 50 },
      { id: 'b', at: 120 },
    ];
    expect(nextStopAhead(stops, 0)?.id).toBe('a');
    expect(nextStopAhead(stops, 40)?.id).toBe('b');
    expect(nextStopAhead(stops, 110)).toBeUndefined();
  });
});
