import { describe, expect, it } from 'vitest';
import { arrowToward, edgePoint, nearby } from './nearby';

describe('nearby', () => {
  it('lists places within the radius, nearest first', () => {
    const places = [
      { id: 'far', x: 1000, y: 0 },
      { id: 'b', x: 30, y: 40 },
      { id: 'a', x: 3, y: 4 },
    ];
    expect(nearby(places, 0, 0, 100).map((p) => [p.id, p.d])).toEqual([
      ['a', 5],
      ['b', 50],
    ]);
  });
});

describe('arrowToward', () => {
  it('points in screen directions', () => {
    expect(arrowToward(0, 0, 10, 0)).toBe('→');
    expect(arrowToward(0, 0, 0, 10)).toBe('↓');
    expect(arrowToward(0, 0, -10, -10)).toBe('↖');
  });
});

describe('edgePoint', () => {
  const view = { x: 100, y: 100, w: 320, h: 180 };
  it('is null for targets inside the view', () => {
    expect(edgePoint(view, 200, 150, 10)).toBeNull();
  });
  it('clamps to the inset edge toward the target, in screen space', () => {
    expect(edgePoint(view, 1000, 190, 10)).toEqual({ x: 310, y: 90 });
    expect(edgePoint(view, 260, -500, 10)).toEqual({ x: 160, y: 10 });
  });
});
