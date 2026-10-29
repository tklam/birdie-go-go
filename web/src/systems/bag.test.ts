import { describe, expect, it } from 'vitest';
import type { Item } from '../core/types.gen';
import { bagUsed, pack, stow, unpack } from './bag';

const item = (id: string, kind: string, price: number): Item => ({ id, name: id, kind, price, counters: [], description: '' });
const tea = item('tea', 'consumable', 18);
const part = item('part', 'consumable', 0);
const hat = item('hat', 'gear', 80);
const catalog = [tea, part, hat];

describe('bag', () => {
  it('counts only bought consumables', () => {
    expect(bagUsed({ tea: 2, part: 5, hat: 1 }, catalog)).toBe(2);
  });

  it('sends purchases home when full, and packs and unpacks', () => {
    const s = { items: { tea: 2 } as Record<string, number>, stored: {} as Record<string, number> };
    expect(stow(s, tea, 2, catalog)).toBe('home');
    expect(stow(s, hat, 2, catalog)).toBe('bag');
    expect(s.stored).toEqual({ tea: 1 });
    expect(pack(s, tea, 2, catalog)).toBe(false);
    expect(unpack(s, tea)).toBe(true);
    expect(s.items.tea).toBe(1);
    expect(pack(s, tea, 2, catalog)).toBe(true);
    expect(pack(s, tea, 3, catalog)).toBe(true);
    expect(s.items.tea).toBe(3);
    expect(s.stored).toEqual({});
  });
});
