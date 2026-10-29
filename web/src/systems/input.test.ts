import { describe, expect, it } from 'vitest';
import { combine, SNEAK_THRESHOLD } from './input';

const none = { left: false, right: false, up: false, down: false, sneak: false };

describe('combine', () => {
  it('normalizes keyboard diagonals', () => {
    const d = combine({ ...none, right: true, down: true }, { x: 0, y: 0 });
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
    expect(d.sneak).toBe(false);
  });

  it('sneaks with Shift', () => {
    expect(combine({ ...none, left: true, sneak: true }, { x: 0, y: 0 })).toEqual({ x: -1, y: 0, sneak: true });
  });

  it('keyboard wins over the joystick', () => {
    expect(combine({ ...none, up: true }, { x: 1, y: 0 })).toEqual({ x: 0, y: -1, sneak: false });
  });

  it('uses the joystick with a dead zone and sneak below the threshold', () => {
    expect(combine(none, { x: 0.1, y: 0 })).toEqual({ x: 0, y: 0, sneak: false });
    expect(combine(none, { x: SNEAK_THRESHOLD - 0.1, y: 0 }).sneak).toBe(true);
    expect(combine(none, { x: 0.9, y: 0 })).toEqual({ x: 0.9, y: 0, sneak: false });
  });
});
