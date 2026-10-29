import { describe, expect, it } from 'vitest';
import type { Spot } from '../core/types.gen';
import { available, hiddenBird, idlePose, landingSpots, pickSpecies, rng, shelterPenalty, visitors } from './birds';

const spot: Spot = {
  id: 'park',
  name: 'Park',
  area: 'a',
  background: 'bg',
  shots: 12,
  birds: [
    { species: 'egret', weight: 4 },
    { species: 'robin', weight: 3, slots: ['morning'] },
    { species: 'gull', weight: 2, seasons: ['winter'] },
    { species: 'parrotlet', weight: 1, requiresFlag: 'chapter1', unlessFlag: 'oboy_joined' },
    { species: 'ghost', weight: 0 },
  ],
};

describe('available', () => {
  it('filters by slot, season, flags and weight', () => {
    const now = available(spot, { slot: 'afternoon', season: 'spring', flags: {} }).map((b) => b.species);
    expect(now).toEqual(['egret']);
    const later = available(spot, { slot: 'morning', season: 'winter', flags: { chapter1: true } }).map((b) => b.species);
    expect(later).toEqual(['egret', 'robin', 'gull', 'parrotlet']);
    const after = available(spot, { slot: 'morning', season: 'winter', flags: { chapter1: true, oboy_joined: true } });
    expect(after.map((b) => b.species)).not.toContain('parrotlet');
  });
});

describe('pickSpecies', () => {
  it('is deterministic and follows weights', () => {
    const table = [
      { species: 'a', weight: 9 },
      { species: 'b', weight: 1 },
    ];
    expect(pickSpecies(table, 5, rng(1))).toEqual(pickSpecies(table, 5, rng(1)));
    const many = pickSpecies(table, 1000, rng(2));
    const a = many.filter((s) => s === 'a').length;
    expect(a).toBeGreaterThan(850);
    expect(a).toBeLessThan(950);
  });

  it('returns nothing for an empty table', () => {
    expect(pickSpecies([], 3, rng(1))).toEqual([]);
  });
});

describe('visitors', () => {
  it('always includes story birds, arriving second', () => {
    const table = [
      { species: 'a', weight: 100 },
      { species: 'story', weight: 0.001, always: true },
    ];
    for (let seed = 0; seed < 20; seed++) {
      const v = visitors(table, 3, rng(seed));
      expect(v.filter((s) => s === 'story')).toHaveLength(1);
      expect(v[1]).toBe('story');
    }
  });
});

describe('landingSpots', () => {
  it('perching birds use perches', () => {
    const p = landingSpots({ behaviors: ['perch', 'fly'] }, [[10, 20]], [150, 170], rng(3));
    expect(p).toEqual([10, 20]);
  });

  it('waders land in the ground band', () => {
    const r = rng(4);
    for (let i = 0; i < 20; i++) {
      const [x, y] = landingSpots({ behaviors: ['wade'] }, [], [150, 170], r, [10, 50]);
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThanOrEqual(50);
      expect(y).toBeGreaterThanOrEqual(150);
      expect(y).toBeLessThanOrEqual(170);
    }
  });
});

describe('idlePose', () => {
  it('prefers alert poses when the alert meter is high', () => {
    const r = rng(5);
    const poses = Array.from({ length: 200 }, () => idlePose(r, 80));
    expect(poses.filter((p) => p === 'perched_alert').length).toBeGreaterThan(100);
  });
});

describe('weather', () => {
  it('limits weather birds and shelters from rain', () => {
    const spot = { birds: [{ species: 'a', weight: 1 }, { species: 'storm', weight: 1, weather: ['rain', 'rainstorm'] }] } as unknown as Spot;
    const ids = (weather?: string) => available(spot, { slot: 'morning', season: 'spring', flags: {}, weather }).map((b) => b.species);
    expect(ids()).toEqual(['a']);
    expect(ids('clear')).toEqual(['a']);
    expect(ids('rain')).toEqual(['a', 'storm']);
    expect([shelterPenalty('clear'), shelterPenalty('rain'), shelterPenalty('rainstorm')]).toEqual([0, 1, 2]);
  });
});

describe('hiddenBird', () => {
  it('finds a bird not coming, preferring ones missing from the album', () => {
    const table = [
      { species: 'a', weight: 1 },
      { species: 'b', weight: 1 },
      { species: 'c', weight: 1 },
    ];
    const r = rng(1);
    expect(hiddenBird(table, ['a'], { b: {} }, r)).toBe('c');
    expect(hiddenBird(table, ['a', 'c'], { b: {} }, r)).toBe('b');
    expect(hiddenBird(table, ['a', 'b', 'c'], {}, r)).toBeNull();
  });
});
