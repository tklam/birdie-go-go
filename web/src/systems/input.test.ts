import { describe, expect, it } from 'vitest';
import { combine, pressedSince, SNEAK_THRESHOLD } from './input';

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

describe('pressedSince', () => {
  it('ignores the key press that closed a dialogue', () => {
    // The press at t=100 closed the window at t=100.4 (same event).
    expect(pressedSince(100, 100.4)).toBe(false);
  });

  it('accepts a later press', () => {
    expect(pressedSince(250, 100.4)).toBe(true);
  });

  it('accepts any press before a window has ever closed', () => {
    expect(pressedSince(0, -Infinity)).toBe(true);
  });
});
