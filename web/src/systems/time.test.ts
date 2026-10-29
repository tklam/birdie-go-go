import { describe, expect, it } from 'vitest';
import type { ContentBundle } from '../core/types.gen';
import { newGame } from './state';
import { advanceSlot } from './time';

const content: ContentBundle = {
  game: { title: 'T', contentVersion: '0', startMap: 'tko', startSpawn: 'estate_plaza' },
  areas: [], birds: [], spots: [], students: [], songs: [], events: [], dialogue: [], music: [], items: [], hazards: [], enemies: [], missions: [],
};

describe('advanceSlot', () => {
  it('walks through the slots of a day', () => {
    const s = newGame(content, 1);
    expect(advanceSlot(s)).toEqual([{ type: 'time_slot_start', params: { slot: 'afternoon' } }]);
    expect(s).toMatchObject({ day: 1, slot: 'afternoon' });
    expect(advanceSlot(s)).toEqual([{ type: 'time_slot_start', params: { slot: 'evening' } }]);
    expect(s).toMatchObject({ day: 1, slot: 'evening' });
  });

  it('starts the next day after the evening', () => {
    const s = newGame(content, 1);
    s.slot = 'evening';
    expect(advanceSlot(s)).toEqual([
      { type: 'day_start', params: { day: '2', season: 'spring' } },
      { type: 'time_slot_start', params: { slot: 'morning' } },
    ]);
    expect(s).toMatchObject({ day: 2, slot: 'morning' });
  });

  it('reports the new season on day_start', () => {
    const s = newGame(content, 1);
    s.day = 28;
    s.slot = 'evening';
    expect(advanceSlot(s)[0].params?.season).toBe('summer');
  });

  it('recovers from an invalid slot by starting the next day', () => {
    const s = newGame(content, 1);
    (s as { slot: string }).slot = 'midnight';
    advanceSlot(s);
    expect(s).toMatchObject({ day: 2, slot: 'morning' });
  });
});
