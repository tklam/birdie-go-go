import { describe, expect, it } from 'vitest';
import {
  DODGE_BURST,
  DODGE_GAP_MS,
  HOLD_FACTOR,
  RACE_SECONDS,
  RETRY_HEAD_START,
  dodgeDirection,
  nextDodgeDelay,
  raceParams,
  startRace,
  stepRace,
  type RaceStatus,
} from './race';
import { rng } from './random';

/** Simulates tapping at `tapsPerSec` (evenly) until the race ends. */
function simulate(mashRate: number, tapsPerSec: number, holding = false): { status: RaceStatus; ms: number } {
  const p = raceParams(mashRate);
  let s = startRace(0);
  let acc = 0;
  for (let ms = 0; ms < 60_000; ms += 16) {
    acc += (tapsPerSec * 16) / 1000;
    const taps = Math.floor(acc);
    acc -= taps;
    const r = stepRace(s, p, { dtMs: 16, taps, holding });
    s = r.state;
    if (r.status !== 'running') return { status: r.status, ms };
  }
  return { status: 'running', ms: 60_000 };
}

describe('mash race', () => {
  it('the chase fills in RACE_SECONDS', () => {
    const r = simulate(6.5, 0);
    expect(r.status).toBe('caught');
    expect(r.ms).toBeGreaterThan(RACE_SECONDS * 1000 - 50);
    expect(r.ms).toBeLessThan(RACE_SECONDS * 1000 + 50);
  });
  it('tapping faster than mashRate escapes, slower gets caught', () => {
    expect(simulate(6.5, 8).status).toBe('escaped');
    expect(simulate(6.5, 5).status).toBe('caught');
    expect(simulate(5, 6).status).toBe('escaped');
  });
  it('holding fills at the needed rate × 1.15 and escapes', () => {
    const p = raceParams(5);
    expect(p.holdPerSec).toBeCloseTo(p.chasePerSec * HOLD_FACTOR);
    expect(simulate(5, 0, true).status).toBe('escaped');
    expect(simulate(9, 0, true).status).toBe('escaped');
  });
  it('dodge hits and misses burst the meters', () => {
    const p = raceParams(5);
    const s = { run: 10, chase: 10 };
    expect(stepRace(s, p, { dtMs: 0, taps: 0, holding: false, dodge: 'hit' }).state).toEqual({ run: 10 + DODGE_BURST, chase: 10 });
    expect(stepRace(s, p, { dtMs: 0, taps: 0, holding: false, dodge: 'miss' }).state).toEqual({ run: 10, chase: 10 + DODGE_BURST });
  });
  it('a tie goes to Angie and meters cap at 100', () => {
    const r = stepRace({ run: 99, chase: 99 }, raceParams(5), { dtMs: 1000, taps: 10, holding: false });
    expect(r.status).toBe('escaped');
    expect(r.state).toEqual({ run: 100, chase: 100 });
  });
  it('a retry starts closer', () => {
    expect(startRace(0)).toEqual({ run: 0, chase: 0 });
    expect(startRace(1).chase).toBe(RETRY_HEAD_START);
  });
  it('dodge prompts are spaced 1.5–2.5 s and deterministic', () => {
    const random = rng(3);
    for (let i = 0; i < 100; i++) {
      const d = nextDodgeDelay(random);
      expect(d).toBeGreaterThanOrEqual(DODGE_GAP_MS[0]);
      expect(d).toBeLessThanOrEqual(DODGE_GAP_MS[1]);
    }
    expect(dodgeDirection(rng(9))).toBe(dodgeDirection(rng(9)));
  });
});
