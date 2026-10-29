import { describe, expect, it } from 'vitest';
import type { ContentBundle } from '../core/types.gen';
import { collect, isCollected, sheetSongs } from './collectibles';
import type { GameState } from './state';

const content = {
  items: [{ id: 'feather', name: 'Feather', kind: 'gadget', price: 0, counters: [], description: '' }],
  songs: [{ id: 'tune', title: 'Tune' }],
} as unknown as Pick<ContentBundle, 'items' | 'songs'>;

describe('collectibles', () => {
  it('picks each up once', () => {
    const s: Pick<GameState, 'flags' | 'items'> = { flags: {}, items: {} };
    expect(collect(s, 'f1', { item: 'feather' }, content)).toBe('a Feather');
    expect(collect(s, 'f1', { item: 'feather' }, content)).toBeNull();
    expect(s.items.feather).toBe(1);
    expect(isCollected(s, 'f1')).toBe(true);
  });

  it('sheet music teaches a song; unknown things are ignored', () => {
    const s: Pick<GameState, 'flags' | 'items'> = { flags: {}, items: {} };
    expect(collect(s, 'm1', { song: 'tune' }, content)).toBe('sheet music: Tune');
    expect(sheetSongs(s, content)).toEqual(['tune']);
    expect(collect(s, 'x', { item: 'nope' }, content)).toBeNull();
    expect(isCollected(s, 'x')).toBe(false);
  });
});
