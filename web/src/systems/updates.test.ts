import { describe, expect, it } from 'vitest';
import { emptyContent } from '../test/content';
import { compareVersions, mergeContent, sha256Hex } from './updates';

describe('compareVersions', () => {
  it('orders semver numerically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0);
  });
});

describe('mergeContent', () => {
  it('replaces entries by id and adds new ones', () => {
    const base = emptyContent({
      missions: [{ id: 'a', giver: 'x', title: 'Old', description: 'd', objective: { type: 'lesson', student: 's', minScore: 1 }, reward: { money: 1, items: [] } }],
      transit: { lines: [], stops: [{ id: 'p', name: 'Plaza' }] },
      sounds: { cues: [{ id: 'bell', notes: [] }], soundscapes: [] },
    });
    const merged = mergeContent(base, {
      missions: [
        { id: 'a', giver: 'x', title: 'New', description: 'd', objective: { type: 'lesson', student: 's', minScore: 1 }, reward: { money: 2, items: [] } },
        { id: 'b', giver: 'y', title: 'Live', description: 'd', objective: { type: 'lesson', student: 's', minScore: 1 }, reward: { money: 3, items: [] } },
      ],
      transit: { lines: [], stops: [{ id: 'q', name: 'Pier' }] },
      sounds: { cues: [{ id: 'bell', caption: 'Ding', notes: [] }], soundscapes: [{ id: 'city', beds: [], cues: [] }] },
      game: { title: 'ignored', contentVersion: '1.1.0', startMap: 'x', startSpawn: 'y' },
    });
    expect(merged.missions.map((m) => `${m.id}:${m.title}`)).toEqual(['a:New', 'b:Live']);
    expect(merged.transit.stops.map((s) => s.id)).toEqual(['p', 'q']);
    expect(merged.sounds.cues.map((c) => c.caption)).toEqual(['Ding']);
    expect(merged.sounds.soundscapes.map((x) => x.id)).toEqual(['city']);
    expect(merged.game.contentVersion).toBe('1.1.0');
    expect(merged.game.title).toBe('Test');
    expect(base.missions[0].title).toBe('Old'); // base untouched
  });
});

describe('sha256Hex', () => {
  it('hashes bytes', async () => {
    const hex = await sha256Hex(new TextEncoder().encode('abc').buffer);
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
