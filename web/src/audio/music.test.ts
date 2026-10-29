import { describe, expect, it } from 'vitest';
import { notesBetween } from './music';

const tune = {
  loopBeats: 4,
  tracks: [
    { instrument: 'square', volume: 0.5, notes: [{ pitch: 60, start: 0, dur: 1, vel: 90 }, { pitch: 64, start: 2, dur: 1, vel: 90 }] },
    { instrument: 'noise', volume: 0.3, notes: [{ pitch: 60, start: 0.5, dur: 0.1, vel: 40 }] },
  ],
};

describe('notesBetween', () => {
  it('returns notes in the window, sorted', () => {
    expect(notesBetween(tune, 0, 2).map((n) => [n.track, n.beat])).toEqual([
      [0, 0],
      [1, 0.5],
    ]);
  });

  it('wraps across loop boundaries with absolute beats', () => {
    expect(notesBetween(tune, 3, 6.6).map((n) => [n.pitch, n.beat])).toEqual([
      [60, 4],
      [60, 4.5],
      [64, 6],
    ]);
    expect(notesBetween(tune, 9.9, 12.1).map((n) => n.beat)).toEqual([10, 12]);
  });

  it('is empty for an empty or reversed window', () => {
    expect(notesBetween(tune, 2, 2)).toEqual([]);
    expect(notesBetween({ loopBeats: 0, tracks: [] }, 0, 10)).toEqual([]);
  });

  it('never returns a note twice across consecutive windows', () => {
    const seen = [...notesBetween(tune, 0, 3.3), ...notesBetween(tune, 3.3, 8.7), ...notesBetween(tune, 8.7, 12)];
    expect(seen.map((n) => `${n.track}@${n.beat}`)).toHaveLength(new Set(seen.map((n) => `${n.track}@${n.beat}`)).size);
    expect(seen).toHaveLength(9);
  });
});
