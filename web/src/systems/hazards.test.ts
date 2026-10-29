import { describe, expect, it } from 'vitest';
import type { ContentBundle, Hazard, Item } from '../core/types.gen';
import { assess, breakItem, drain, protection, tickConsumables, toggleGear, triggered, useItem, type HazardWeather } from './hazards';
import { newGame } from './state';

const n = (x: number) => x;
const hazards: Hazard[] = [
  { id: 'high_uv', name: 'UV', status: 'sunburnt', when: { param: 'uv', min: n(8) }, drainPerMin: 0.25, severe: { min: 11, drainPerMin: 0.5 }, counteredBy: ['sun_hat', 'sunscreen', 'umbrella'] },
  { id: 'strong_wind', name: 'Wind', status: 'windswept', when: { param: 'wind', min: n(0.7) }, drainPerMin: 0.1, push: 20, breaks: { item: 'umbrella', min: 0.8 }, counteredBy: ['windbreaker'] },
  { id: 'cold_snap', name: 'Cold', status: 'chilled', when: { param: 'temp', max: n(8) }, drainPerMin: 0.2, counteredBy: ['jacket'] },
  { id: 'typhoon', name: 'Typhoon', status: 'storm-battered', when: { param: 'signal', min: n(8) }, drainPerMin: 1.5, counteredBy: [] },
];
const calm: HazardWeather = { cloud: 0.2, precip: 0, temp: 24, fog: 0, wind: 0.2, windDir: 0, uv: 5, signal: 0 };
const item = (id: string, kind: string, extra: Partial<Item> = {}): Item => ({ id, name: id, kind, price: 1, counters: [], description: '', ...extra });
const content = { game: { title: '', contentVersion: '0.0.0', startMap: 'world', startSpawn: 's' } } as ContentBundle;

describe('triggered', () => {
  it('checks min and max', () => {
    expect(triggered(hazards[0], { ...calm, uv: 8 })).toBe(true);
    expect(triggered(hazards[0], { ...calm, uv: 7.9 })).toBe(false);
    expect(triggered(hazards[2], { ...calm, temp: 5 })).toBe(true);
    expect(triggered(hazards[2], calm)).toBe(false);
    expect(triggered(hazards[3], { ...calm, signal: 8 })).toBe(true);
  });
});

describe('assess', () => {
  it('reports nothing in calm weather', () => {
    const r = assess(hazards, calm, new Set());
    expect(r.exposed).toEqual([]);
    expect(r.push).toEqual({ x: 0, y: 0 });
  });

  it('uses the severe tier and the right drain', () => {
    const r = assess(hazards, { ...calm, uv: 11.5 }, new Set());
    expect(r.exposed).toHaveLength(1);
    expect(r.exposed[0].severe).toBe(true);
    expect(r.exposed[0].drainPerMin).toBe(0.5);
  });

  it('gear counters hazards', () => {
    const r = assess(hazards, { ...calm, uv: 10 }, new Set(['sun_hat']));
    expect(r.exposed).toEqual([]);
    expect(r.countered.map((h) => h.id)).toEqual(['high_uv']);
  });

  it('wind pushes along its direction and breaks a worn umbrella', () => {
    const r = assess(hazards, { ...calm, wind: 0.9, windDir: Math.PI / 2 }, new Set(['umbrella']));
    expect(r.push.x).toBeCloseTo(0);
    expect(r.push.y).toBeCloseTo(18);
    expect(r.breaks).toEqual(['umbrella']);
    // Below the break threshold the umbrella survives.
    expect(assess(hazards, { ...calm, wind: 0.75 }, new Set(['umbrella'])).breaks).toEqual([]);
  });
});

describe('drain', () => {
  it('sums drains over time and clamps at 0', () => {
    const r = assess(hazards, { ...calm, uv: 9, temp: 5 }, new Set());
    expect(drain(100, r.exposed, 10)).toBeCloseTo(100 - 4.5);
    expect(drain(1, r.exposed, 100)).toBe(0);
  });
});

describe('items', () => {
  it('consumables restore Energy and protect for a while', () => {
    const s = newGame(content, 1);
    s.energy = 50;
    s.items = { sunscreen: 1, milk_tea: 1 };
    expect(useItem(s, item('milk_tea', 'consumable', { restores: 25 }))).toBe(true);
    expect(s.energy).toBe(75);
    expect(s.items.milk_tea).toBeUndefined();
    expect(useItem(s, item('milk_tea', 'consumable', { restores: 25 }))).toBe(false);
    useItem(s, item('sunscreen', 'consumable', { durationSlots: 1 }));
    expect(protection(s).has('sunscreen')).toBe(true);
    tickConsumables(s);
    expect(protection(s).has('sunscreen')).toBe(false);
  });

  it('wears, removes and breaks gear', () => {
    const s = newGame(content, 1);
    const umbrella = item('umbrella', 'gear', { slot: 'hand' });
    expect(toggleGear(s, umbrella)).toBe('not-owned');
    s.items.umbrella = 1;
    expect(toggleGear(s, umbrella)).toBe('worn');
    expect(protection(s).has('umbrella')).toBe(true);
    breakItem(s, 'umbrella');
    expect(s.equipped.hand).toBeUndefined();
    expect(s.items.umbrella).toBeUndefined();
    s.items.umbrella = 1;
    toggleGear(s, umbrella);
    expect(toggleGear(s, umbrella)).toBe('removed');
  });
});
