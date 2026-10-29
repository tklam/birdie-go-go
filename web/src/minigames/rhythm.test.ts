import { describe, expect, it } from 'vitest';
import {
  beatTimesMs,
  endMs,
  hits,
  judgeDelta,
  msPerBeat,
  points,
  rhythmOver,
  rhythmTarget,
  startRhythm,
  sweepMisses,
  tap,
  windows,
} from './rhythm';

const W = windows();

describe('beat → time', () => {
  it.each([
    { tempo: 120, expected: 500 },
    { tempo: 60, expected: 1000 },
    { tempo: 0, expected: 600 },
    { tempo: -5, expected: 600 },
  ])('msPerBeat($tempo) = $expected', ({ tempo, expected }) => {
    expect(msPerBeat(tempo)).toBe(expected);
  });

  it('sorts, dedupes and drops negative beats', () => {
    expect(beatTimesMs([2, 0, 1, 4.5, 1, -1], 120)).toEqual([0, 500, 1000, 2250]);
  });
});

describe('windows', () => {
  it('widens with the slower factor', () => {
    expect(windows()).toEqual({ perfect: 90, good: 160 });
    expect(windows(1.5)).toEqual({ perfect: 135, good: 240 });
  });

  it.each([
    { delta: 0, expected: 'perfect' },
    { delta: -90, expected: 'perfect' },
    { delta: 91, expected: 'good' },
    { delta: -160, expected: 'good' },
    { delta: 161, expected: null },
  ])('judgeDelta($delta) = $expected', ({ delta, expected }) => {
    expect(judgeDelta(delta, W)).toBe(expected);
  });
});

describe('tap', () => {
  it.each([
    { name: 'on the beat', at: 1000, judgement: 'perfect', note: 2 },
    { name: 'a bit early', at: 880, judgement: 'good', note: 2 },
    { name: 'a bit late', at: 1130, judgement: 'good', note: 2 },
    { name: 'far from any beat', at: 1250, judgement: null, note: -1 },
  ])('$name', ({ at, judgement, note }) => {
    const s = startRhythm([0, 1, 2, 3], 120);
    // Clear the first two so only beats 2 and 3 are open.
    tap(s, 0, W);
    tap(s, 500, W);
    const r = tap(s, at, W);
    expect(r?.judgement ?? null).toBe(judgement);
    expect(r?.note ?? -1).toBe(note);
  });

  it('never hits a note twice', () => {
    const s = startRhythm([0, 1], 60);
    expect(tap(s, 0, W)?.note).toBe(0);
    expect(tap(s, 20, W)).toBeNull();
    expect(hits(s)).toBe(1);
  });

  it('takes the nearest open note for close beats', () => {
    const s = startRhythm([0, 0.25], 120); // 0 ms and 125 ms
    expect(tap(s, 110, W)?.note).toBe(1);
    expect(tap(s, 20, W)?.note).toBe(0);
  });

  it('stray taps cost nothing', () => {
    const s = startRhythm([4], 60);
    expect(tap(s, 1000, W)).toBeNull();
    expect(s.miss).toBe(0);
    expect(s.combo).toBe(0);
  });

  it('scores with a combo bonus and tracks the best combo', () => {
    const s = startRhythm([0, 1, 2, 3], 60);
    tap(s, 0, W); // perfect, 100
    tap(s, 1120, W); // good, 50 + 10
    sweepMisses(s, 2500, W); // miss beat 2, combo breaks
    tap(s, 3000, W); // perfect, 100
    expect(s.score).toBe(260);
    expect(s.bestCombo).toBe(2);
    expect(s.combo).toBe(1);
    expect([s.perfect, s.good, s.miss]).toEqual([2, 1, 1]);
    expect(rhythmOver(s)).toBe(true);
  });
});

describe('misses', () => {
  it('marks only notes whose window has closed', () => {
    const s = startRhythm([0, 1, 2], 60);
    expect(sweepMisses(s, 160, W)).toBe(0);
    expect(sweepMisses(s, 161, W)).toBe(1);
    expect(sweepMisses(s, 1500, W)).toBe(1);
    expect(s.notes.map((n) => n.result)).toEqual(['miss', 'miss', null]);
    expect(rhythmOver(s)).toBe(false);
  });

  it('a late tap sweeps passed notes first', () => {
    const s = startRhythm([0, 1], 60);
    expect(tap(s, 1000, W)?.note).toBe(1);
    expect(s.miss).toBe(1);
  });

  it('ends when the last window closes', () => {
    expect(endMs(startRhythm([0, 2], 60), W)).toBe(2160);
    expect(endMs(startRhythm([], 60), W)).toBe(160);
  });
});

describe('points and target', () => {
  it.each([
    { j: 'perfect', combo: 0, expected: 100 },
    { j: 'good', combo: 3, expected: 80 },
    { j: 'perfect', combo: 25, expected: 200 },
    { j: 'miss', combo: 5, expected: 0 },
  ] as const)('points($j, $combo) = $expected', ({ j, combo, expected }) => {
    expect(points(j, combo)).toBe(expected);
  });

  it.each([
    { target: 10, notes: 16, expected: 10 },
    { target: 40, notes: 16, expected: 16 },
    { target: undefined, notes: 16, expected: 12 },
    { target: 0, notes: 0, expected: 1 },
  ])('rhythmTarget($target, $notes) = $expected', ({ target, notes, expected }) => {
    expect(rhythmTarget(target, notes)).toBe(expected);
  });
});
