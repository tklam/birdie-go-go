import { describe, expect, it } from 'vitest';
import { cueAllowed, cueLength, expandCue, nextWait, placeSound } from './cues';

describe('expandCue', () => {
  it('unrolls repeats, fills defaults and sorts by start', () => {
    const ev = expandCue({
      notes: [
        { wave: 'sine', freq: 1000, at: 0.5, dur: 0.1 },
        { wave: 'triangle', freq: 2000, to: 2400, dur: 0.05, gain: 0.5, env: 'swell', repeat: 2, every: 0.2 },
      ],
    });
    expect(ev.map((e) => [e.wave, e.start])).toEqual([
      ['triangle', 0],
      ['triangle', 0.2],
      ['triangle', 0.4],
      ['sine', 0.5],
    ]);
    expect(ev[0]).toMatchObject({ freq: 2000, to: 2400, gain: 0.5, env: 'swell', q: 1 });
    expect(ev[3]).toMatchObject({ freq: 1000, to: 1000, gain: 0.3, env: 'pluck' });
    expect(cueLength(ev)).toBeCloseTo(0.6);
  });

  it('scales every pitch, glides included', () => {
    const [e] = expandCue({ notes: [{ wave: 'sine', freq: 1000, to: 1500, dur: 0.1 }] }, 1.5);
    expect([e.freq, e.to]).toEqual([1500, 2250]);
  });
});

describe('cueAllowed', () => {
  it.each([
    [{}, 'evening', 'winter', 0.9, true],
    [{ slots: ['evening'] }, 'morning', 'summer', 0, false],
    [{ slots: ['evening'] }, 'evening', 'summer', 0, true],
    [{ seasons: ['summer'] }, 'morning', 'winter', 0, false],
    [{ dry: true }, 'morning', 'summer', 0.2, true],
    [{ dry: true }, 'morning', 'summer', 0.5, false],
  ])('%j in %s %s rain %s → %s', (c, slot, season, rain, want) => {
    expect(cueAllowed(c, slot, season, rain)).toBe(want);
  });
});

describe('nextWait and placeSound', () => {
  it('spreads waits over the range', () => {
    expect(nextWait([4, 10], 0)).toBe(4);
    expect(nextWait([4, 10], 0.5)).toBe(7);
  });

  it('fades with distance and pans by side', () => {
    expect(placeSound(0, 0, 0, 0, 100)).toEqual({ gain: 1, pan: 0 });
    expect(placeSound(150, 0, 0, 0, 100)).toEqual({ gain: 0, pan: 1 });
    const left = placeSound(-50, 0, 0, 0, 100);
    expect(left.gain).toBeCloseTo(0.25);
    expect(left.pan).toBe(-0.5);
  });
});
