import { describe, expect, it } from 'vitest';
import type { GameState } from './state';
import { clockLabel, clockMinutes, discoverStop, lineFlag, openLines, payFare, topUp } from './transit';

describe('transit client', () => {
  it('runs a clock per slot', () => {
    expect(clockMinutes(2, 'morning', 0)).toBe(2 * 1440 + 420);
    expect(clockMinutes(2, 'afternoon', 42)).toBe(2 * 1440 + 762);
    expect(clockMinutes(1, 'evening', 9999)).toBe(1440 + 1020 + 299);
    expect(clockLabel(clockMinutes(3, 'morning', 42))).toBe('07:42');
    expect(clockLabel(1440 + 25)).toBe('00:25');
  });

  it('discovers stops once and opens locked lines by flag', () => {
    const s: Pick<GameState, 'flags'> = { flags: {} };
    expect(discoverStop(s, 'pier')).toBe(true);
    expect(discoverStop(s, 'pier')).toBe(false);
    const lines = [{ id: 'bus' }, { id: 'tram', locked: true }];
    expect(openLines(lines, s)).toEqual(['bus']);
    s.flags[lineFlag('tram')] = true;
    expect(openLines(lines, s)).toEqual(['bus', 'tram']);
  });
});

describe('transit card', () => {
  const card = { name: 'Pass', startBalance: 50, topUp: 50 };
  it('pays fares from the card, or cash without one', () => {
    const s = { money: 100, card: 10 };
    expect(payFare(s, 15, card)).toBe(false);
    expect(s).toEqual({ money: 100, card: 10 });
    expect(payFare(s, 8, card)).toBe(true);
    expect(s).toEqual({ money: 100, card: 2 });
    expect(payFare(s, 8, undefined)).toBe(true);
    expect(s.money).toBe(92);
  });
  it('tops up from cash', () => {
    const s = { money: 60, card: 0 };
    expect(topUp(s, card)).toBe(true);
    expect(s).toEqual({ money: 10, card: 50 });
    expect(topUp(s, card)).toBe(false);
  });
});
