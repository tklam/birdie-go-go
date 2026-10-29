import { describe, expect, it } from 'vitest';
import type { Item } from '../core/types.gen';
import {
  addItems,
  applyResolveHit,
  comboResolveHit,
  halveResolve,
  introLine,
  resultText,
  rollDrops,
  skipCost,
  successText,
  takeDamage,
  usableItems,
  startResolve,
  blockingItem,
} from './rules';
import { encounterSeed, rng } from './random';

const item = (id: string, extra: Partial<Item> = {}): Item => ({ id, name: id, kind: 'consumable', price: 1, counters: [], description: '', ...extra });
const items = [
  item('dog_treat'),
  item('sticky_rice'),
  item('milk_tea', { restores: 25 }),
  item('camera_part'),
  item('umbrella', { kind: 'gear', slot: 'hand' }),
];
const dog = { kind: 'dog', weakness: 'dog_treat', name: 'Stray Dogs', comboLength: [2, 3], damage: 8, drops: [] };
const zombie = {
  kind: 'monster',
  weakness: 'sticky_rice',
  name: 'Hopping Zombie',
  comboLength: [3, 5],
  damage: 12,
  drops: [{ item: 'camera_part', chance: 0.5 }],
};

describe('resolve and damage', () => {
  it('combo hits scale 15–25 by length, with a speed bonus', () => {
    expect(comboResolveHit(zombie, 3)).toBe(15);
    expect(comboResolveHit(zombie, 4)).toBe(20);
    expect(comboResolveHit(zombie, 5)).toBe(25);
    expect(comboResolveHit(zombie, 3, 1)).toBe(18);
    expect(comboResolveHit({ comboLength: [3, 3] }, 3)).toBe(15);
  });
  it('resolve never goes below 0', () => {
    expect(applyResolveHit(10, 25)).toBe(0);
    expect(applyResolveHit(40, 15)).toBe(25);
    expect(halveResolve(25)).toBe(12);
  });
  it('damage is capped by remaining energy', () => {
    const s = { energy: 10 };
    expect(takeDamage(s, 8)).toBe(8);
    expect(takeDamage(s, 8)).toBe(2);
    expect(s.energy).toBe(0);
  });
  it('skip costs half damage', () => {
    expect(skipCost(dog)).toBe(4);
    expect(skipCost({ damage: 11 })).toBe(6);
  });
});

describe('items', () => {
  const owned = { dog_treat: 1, sticky_rice: 2, milk_tea: 1, camera_part: 3, umbrella: 1 };
  it('a dog treat is an instant escape against dogs', () => {
    expect(usableItems(dog, owned, items, false).map((u) => [u.item.id, u.effect])).toEqual([
      ['dog_treat', 'treat'],
      ['milk_tea', 'restore'],
    ]);
  });
  it('the weakness is usable once against its monster', () => {
    expect(usableItems(zombie, owned, items, false).map((u) => [u.item.id, u.effect, u.count])).toEqual([
      ['sticky_rice', 'weakness', 2],
      ['milk_tea', 'restore', 1],
    ]);
    expect(usableItems(zombie, owned, items, true).map((u) => u.item.id)).toEqual(['milk_tea']);
  });
  it('lists nothing without items', () => {
    expect(usableItems(zombie, {}, items, false)).toEqual([]);
  });
});

describe('drops', () => {
  it('are deterministic per world, day and enemy', () => {
    const seed = encounterSeed(123, 4, 'hopping_zombie');
    expect(rollDrops(zombie, seed)).toEqual(rollDrops(zombie, seed));
    expect(encounterSeed(123, 5, 'hopping_zombie')).not.toBe(seed);
  });
  it('follow the chance over many rolls', () => {
    let n = 0;
    for (let i = 0; i < 1000; i++) n += rollDrops(zombie, encounterSeed(1, i, 'hopping_zombie')).length;
    expect(n).toBeGreaterThan(420);
    expect(n).toBeLessThan(580);
    expect(rollDrops(dog, 1)).toEqual([]);
  });
  it('are added to the inventory', () => {
    const s = { items: { camera_part: 1 } as Record<string, number> };
    addItems(s, ['camera_part', 'sea_salt']);
    expect(s.items).toEqual({ camera_part: 2, sea_salt: 1 });
  });
});

describe('text', () => {
  it('uses the right verb for plural names', () => {
    expect(introLine(dog)).toBe('Stray Dogs block the way!');
    expect(introLine(zombie)).toBe('Hopping Zombie blocks the way!');
  });
  it('dog text never hurts the dog', () => {
    const random = rng(1);
    for (let i = 0; i < 50; i++) expect(successText(dog, random)).not.toMatch(/hit|kill|hurt|defeat/i);
    const r = resultText(dog, { outcome: 'won', energyLost: 8, drops: [] }, (id) => id);
    expect(r.lines.join(' ')).toMatch(/back off and trot away/);
    expect(r.lines.join(' ')).not.toMatch(/defeat/);
  });
  it('monsters are defeated and drops listed; lines fit 38 chars', () => {
    const r = resultText(zombie, { outcome: 'won', energyLost: 0, drops: ['camera_part'] }, () => 'Camera Part');
    expect(r.lines).toContain('Hopping Zombie was defeated.');
    expect(r.lines).toContain('Found: Camera Part');
    for (const o of ['won', 'escaped', 'lost', 'skipped'] as const) {
      for (const e of [dog, zombie]) {
        for (const l of resultText(e, { outcome: o, energyLost: 24, drops: [] }, (id) => id).lines) expect(l.length).toBeLessThanOrEqual(38);
      }
    }
  });
});

describe('gear assists', () => {
  const whistle = item('whistle', { kind: 'gadget', assist: { resolveScale: 0.8 } });
  const umbrella = item('umbrella', { kind: 'gear', slot: 'hand', assist: { block: true, blockWindowMs: 1000 } });
  it('a carried whistle lowers starting resolve', () => {
    expect(startResolve(50, {}, [whistle])).toBe(50);
    expect(startResolve(50, { whistle: 1 }, [whistle])).toBe(40);
  });
  it('only a worn umbrella blocks', () => {
    expect(blockingItem({}, [umbrella])).toBeNull();
    expect(blockingItem({ hand: 'umbrella' }, [umbrella])?.id).toBe('umbrella');
  });
});
