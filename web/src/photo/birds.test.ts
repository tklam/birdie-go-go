import { describe, expect, it } from 'vitest';
import type { Spot } from '../core/types.gen';
import { available, idlePose, landingSpots, pickSpecies, rng } from './birds';

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
    { species: 'parrotlet', weight: 1, requiresFlag: 'chapter1' },
    { species: 'ghost', weight: 0 },
  ],
};

describe('available', () => {
  it('filters by slot, season, flags and weight', () => {
    const now = available(spot, { slot: 'afternoon', season: 'spring', flags: {} }).map((b) => b.species);
    expect(now).toEqual(['egret']);
    const later = available(spot, { slot: 'morning', season: 'winter', flags: { chapter1: true } }).map((b) => b.species);
    expect(later).toEqual(['egret', 'robin', 'gull', 'parrotlet']);
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
