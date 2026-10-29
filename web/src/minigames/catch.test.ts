import { describe, expect, it } from 'vitest';
import { BASKET_HALF, BASKET_Y, basketHits, catchOver, clampBasket, FIELD, fallSpeed, ITEM_R, spawnGap, startCatch, stepCatch, timeLeft, type CatchConfig, type CatchState } from './catch';

const cfg = (over: Partial<CatchConfig> = {}): CatchConfig => ({
  icons: ['prop:bun'],
  avoid: ['prop:can', 'prop:bag'],
  target: 5,
  seconds: 30,
  slower: 1,
  seed: 42,
  ...over,
});

function run(c: CatchConfig, seconds: number, basket: (s: CatchState) => number = () => 160): { state: CatchState; spawned: string[] } {
  const state = startCatch(c);
  const spawned: string[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    for (const it of stepCatch(state, c, 1 / 60, basket(state)).spawned) spawned.push(`${it.icon}@${it.x}`);
  }
  return { state, spawned };
}

describe('catch spawning', () => {
  it('is deterministic for a seed', () => {
    expect(run(cfg(), 10).spawned).toEqual(run(cfg(), 10).spawned);
    expect(run(cfg(), 10).spawned).not.toEqual(run(cfg({ seed: 7 }), 10).spawned);
  });

  it('spawns inside the field, mostly wanted things', () => {
    const { spawned } = run(cfg(), 30);
    expect(spawned.length).toBeGreaterThan(20);
    for (const s of spawned) {
      const x = Number(s.split('@')[1]);
      expect(x).toBeGreaterThanOrEqual(FIELD.left);
      expect(x).toBeLessThanOrEqual(FIELD.right);
    }
    const bad = spawned.filter((s) => !s.startsWith('prop:bun')).length;
    expect(bad).toBeGreaterThan(0);
    expect(bad).toBeLessThan(spawned.length / 2);
  });

  it('only spawns wanted things without avoid icons', () => {
    expect(run(cfg({ avoid: [] }), 10).spawned.every((s) => s.startsWith('prop:bun'))).toBe(true);
  });

  it('gets gently faster, and slower with Slow prompts', () => {
    expect(fallSpeed(30, 1)).toBeGreaterThan(fallSpeed(0, 1));
    expect(fallSpeed(30, 1.5)).toBeLessThan(fallSpeed(30, 1));
    expect(spawnGap(30, 1)).toBeLessThan(spawnGap(0, 1));
    expect(spawnGap(0, 1.5)).toBeGreaterThan(spawnGap(0, 1));
    expect(fallSpeed(1000, 1)).toBe(fallSpeed(60, 1));
  });
});

describe('basketHits', () => {
  const cases: { name: string; basket: number; x: number; y: number; hit: boolean }[] = [
    { name: 'dead centre', basket: 100, x: 100, y: BASKET_Y, hit: true },
    { name: 'at the rim', basket: 100, x: 100 + BASKET_HALF + ITEM_R - 2, y: BASKET_Y, hit: true },
    { name: 'just wide', basket: 100, x: 100 + BASKET_HALF + ITEM_R, y: BASKET_Y, hit: false },
    { name: 'still high above', basket: 100, x: 100, y: BASKET_Y - 30, hit: false },
    { name: 'already below', basket: 100, x: 100, y: BASKET_Y + 20, hit: false },
  ];
  for (const c of cases) it(c.name, () => expect(basketHits(c.basket, c)).toBe(c.hit));

  it('keeps the basket on the field', () => {
    expect(clampBasket(-50)).toBe(FIELD.left + BASKET_HALF);
    expect(clampBasket(999)).toBe(FIELD.right - BASKET_HALF);
  });
});

describe('catch scoring', () => {
  it('scores a wanted catch and costs a point for an avoided one, never below 0', () => {
    const c = cfg();
    const s = startCatch(c);
    s.nextSpawn = Infinity;
    s.items = [
      { id: 1, icon: 'prop:can', good: false, x: 160, y: BASKET_Y, speed: 0 },
      { id: 2, icon: 'prop:bun', good: true, x: 200, y: BASKET_Y, speed: 0 },
    ];
    let step = stepCatch(s, c, 0.01, 160);
    expect(step.bad.map((i) => i.id)).toEqual([1]);
    expect(s.score).toBe(0);
    step = stepCatch(s, c, 0.01, 200);
    expect(step.caught.map((i) => i.id)).toEqual([2]);
    expect(s.score).toBe(1);
    s.items = [{ id: 3, icon: 'prop:bag', good: false, x: 200, y: BASKET_Y, speed: 0 }];
    stepCatch(s, c, 0.01, 200);
    expect([s.score, s.caught, s.bad]).toEqual([0, 1, 2]);
  });

  it('drops things that fall past the basket', () => {
    const c = cfg();
    const s = startCatch(c);
    s.nextSpawn = Infinity;
    s.items = [{ id: 1, icon: 'prop:bun', good: true, x: 40, y: 190, speed: 50 }];
    const step = stepCatch(s, c, 0.1, 250);
    expect(step.missed.length).toBe(1);
    expect(s.items.length).toBe(0);
  });

  it('catches things by following them', () => {
    const c = cfg({ avoid: [], target: 3 });
    const { state } = run(c, 20, (s) => s.items.reduce((best, it) => (it.y > best.y ? it : best), { x: 160, y: -1 }).x);
    expect(state.caught).toBeGreaterThanOrEqual(3);
  });
});

describe('catch timer', () => {
  it('ends on the target or when time runs out', () => {
    const c = cfg({ seconds: 10, target: 2 });
    const s = startCatch(c);
    expect(catchOver(s, c)).toEqual({ over: false, won: false });
    s.score = 2;
    expect(catchOver(s, c)).toEqual({ over: true, won: true });
    s.score = 1;
    s.t = 10;
    expect(timeLeft(s, c)).toBe(0);
    expect(catchOver(s, c)).toEqual({ over: true, won: false });
  });

  it('has no limit with seconds 0', () => {
    const c = cfg({ seconds: 0 });
    const s = startCatch(c);
    s.t = 1e6;
    expect(timeLeft(s, c)).toBe(Infinity);
    expect(catchOver(s, c).over).toBe(false);
  });
});
