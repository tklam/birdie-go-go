import { describe, expect, it } from 'vitest';
import {
  BUTTONS,
  DIRECTIONS,
  checkTimeout,
  comboParams,
  generateCombo,
  inputSymbol,
  keySymbol,
  startAttempt,
  swipeDirection,
  timeLeft,
  type ComboSymbol,
} from './combo';
import { rng } from './random';

const dog = { comboLength: [2, 3], windowMs: [2000, 1400] };
const zombie = { comboLength: [3, 5], windowMs: [1900, 1100] };

describe('comboParams', () => {
  it('is easy at full resolve and hard at none', () => {
    expect(comboParams(zombie, 1)).toEqual({ length: 3, windowMs: 1900 * 3 });
    expect(comboParams(zombie, 0)).toEqual({ length: 5, windowMs: 1100 * 5 });
  });
  it('interpolates in between and clamps', () => {
    expect(comboParams(zombie, 0.5)).toEqual({ length: 4, windowMs: 1500 * 4 });
    expect(comboParams(zombie, 2)).toEqual(comboParams(zombie, 1));
    expect(comboParams(zombie, -1)).toEqual(comboParams(zombie, 0));
  });
  it('gets longer or equal as resolve drops', () => {
    let prev = 0;
    for (let f = 1; f >= 0; f -= 0.1) {
      const p = comboParams(dog, f);
      expect(p.length).toBeGreaterThanOrEqual(prev);
      prev = p.length;
    }
  });
  it('slower prompts multiply the window by 1.5', () => {
    expect(comboParams(dog, 1, true).windowMs).toBe(Math.round(2000 * 1.5) * 2);
  });
});

describe('generateCombo', () => {
  it('is deterministic for a seed', () => {
    expect(generateCombo(5, rng(42))).toEqual(generateCombo(5, rng(42)));
  });
  it('has the requested length, allowed symbols and ends with a button', () => {
    const allowed = new Set<string>([...DIRECTIONS, ...BUTTONS]);
    const random = rng(7);
    for (let i = 0; i < 200; i++) {
      const len = 1 + (i % 6);
      const c = generateCombo(len, random);
      expect(c).toHaveLength(len);
      for (const s of c) expect(allowed.has(s)).toBe(true);
      expect(BUTTONS as readonly string[]).toContain(c[c.length - 1]);
      for (let j = 2; j < c.length; j++) expect(c[j] === c[j - 1] && c[j] === c[j - 2]).toBe(false);
    }
  });
  it('never returns an empty combo', () => {
    expect(generateCombo(0, rng(1))).toHaveLength(1);
  });
});

describe('combo input', () => {
  const combo: ComboSymbol[] = ['left', 'right', 'A'];
  it('tracks prefix progress to completion', () => {
    let a = startAttempt(combo, 3000, 0);
    let r = inputSymbol(a, 'left', 100);
    expect(r.status).toBe('pending');
    a = r.attempt;
    expect(a.index).toBe(1);
    r = inputSymbol(a, 'right', 200);
    r = inputSymbol(r.attempt, 'A', 300);
    expect(r.status).toBe('complete');
    expect(r.attempt.index).toBe(3);
  });
  it('fails on a wrong input', () => {
    const a = startAttempt(combo, 3000, 0);
    expect(inputSymbol(a, 'B', 10).status).toBe('wrong');
    const one = inputSymbol(a, 'left', 10).attempt;
    expect(inputSymbol(one, 'left', 20).status).toBe('wrong');
  });
  it('times out after the window', () => {
    const a = startAttempt(combo, 1000, 0);
    expect(checkTimeout(a, 999)).toBe('pending');
    expect(checkTimeout(a, 1001)).toBe('timeout');
    expect(inputSymbol(a, 'left', 1500).status).toBe('timeout');
    expect(timeLeft(a, 500)).toBeCloseTo(0.5);
    expect(timeLeft(a, 5000)).toBe(0);
  });
});

describe('input mapping', () => {
  it('maps swipes by dominant axis with a minimum length', () => {
    expect(swipeDirection(5, 3)).toBeNull();
    expect(swipeDirection(-20, 5)).toBe('left');
    expect(swipeDirection(20, -5)).toBe('right');
    expect(swipeDirection(3, -30)).toBe('up');
    expect(swipeDirection(3, 30)).toBe('down');
  });
  it('maps keys', () => {
    expect(keySymbol('ArrowUp')).toBe('up');
    expect(keySymbol('KeyA')).toBe('left');
    expect(keySymbol('KeyZ')).toBe('A');
    expect(keySymbol('KeyJ')).toBe('A');
    expect(keySymbol('KeyX')).toBe('B');
    expect(keySymbol('KeyK')).toBe('B');
    expect(keySymbol('Space')).toBeNull();
  });
});
