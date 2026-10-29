import { describe, expect, it } from 'vitest';
import type { AlbumEntry } from './state';
import { albumMilestones } from './milestones';

const ev = (species: string) => ({ trigger: { type: 'album_milestone', params: { species } } });
const album = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`b${i}`, {} as AlbumEntry]));

describe('albumMilestones', () => {
  it('lists every reached threshold, smallest first', () => {
    const events = [ev('10'), ev('5'), ev('25'), { trigger: { type: 'day_start', params: {} } }];
    expect(albumMilestones({ album: album(4) }, events)).toEqual([]);
    expect(albumMilestones({ album: album(12) }, events).map((t) => t.params?.species)).toEqual(['5', '10']);
  });
});
