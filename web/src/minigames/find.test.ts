import { describe, expect, it } from 'vitest';
import { AREA, findOver, findTarget, findTimeLeft, hintBird, HINT_AFTER, HIT_R, hitTest, layoutFind, MIN_GAP, MISS_PENALTY, startFind, tapFind, type FindConfig, type HiddenBird } from './find';

const ICONS = ['bird:a', 'bird:b', 'bird:c', 'bird:d', 'bird:e'];
const PERCHES: [number, number][] = [
  [30, 60],
  [60, 62],
  [290, 80],
  [0, 0],
];
const cfg = (over: Partial<FindConfig> = {}): FindConfig => ({ icons: ICONS, target: 3, seconds: 30, slower: 1, seed: 9, ...over });

describe('layoutFind', () => {
  it('is deterministic for a seed', () => {
    expect(layoutFind(ICONS, PERCHES, 9)).toEqual(layoutFind(ICONS, PERCHES, 9));
    expect(layoutFind(ICONS, PERCHES, 9)).not.toEqual(layoutFind(ICONS, PERCHES, 10));
  });

  it('places every bird in the area, apart, using perches first', () => {
    const { birds, decoys } = layoutFind(ICONS, PERCHES, 3);
    expect(birds.map((b) => b.icon)).toEqual(ICONS);
    for (const b of birds) {
      expect(b.x).toBeGreaterThanOrEqual(AREA.left);
      expect(b.x).toBeLessThanOrEqual(AREA.right);
      expect(b.y).toBeGreaterThanOrEqual(AREA.top);
      expect(b.y).toBeLessThanOrEqual(AREA.bottom);
      expect(Number.isInteger(b.x) && Number.isInteger(b.y)).toBe(true);
      for (const o of birds) if (o !== b) expect(Math.hypot(o.x - b.x, o.y - b.y)).toBeGreaterThanOrEqual(MIN_GAP);
    }
    const onPerch = birds.filter((b) => PERCHES.some(([x, y]) => x === b.x && y === b.y));
    expect(onPerch.length).toBe(3); // [0, 0] is off the area
    expect(decoys.length).toBeGreaterThan(0);
  });
});

describe('hitTest', () => {
  const birds: HiddenBird[] = [
    { icon: 'bird:a', x: 100, y: 100, scale: 0.5, pose: 'perched', covered: false, found: false },
    { icon: 'bird:b', x: 140, y: 100, scale: 1, pose: 'perched', covered: true, found: false },
  ];
  const cases: { name: string; x: number; y: number; want: number }[] = [
    { name: 'on the bird', x: 100, y: 100, want: 0 },
    { name: 'generous radius', x: 100, y: 100 + HIT_R, want: 0 },
    { name: 'just outside', x: 100, y: 100 + HIT_R + 1, want: -1 },
    { name: 'nearest of two', x: 125, y: 100, want: 1 },
    { name: 'empty scenery', x: 250, y: 40, want: -1 },
  ];
  for (const c of cases) it(c.name, () => expect(hitTest(birds, c.x, c.y)).toBe(c.want));
});

describe('find play', () => {
  it('tracks found birds, ignores repeats and charges misses', () => {
    const layout = layoutFind(ICONS, PERCHES, 1);
    const s = startFind();
    const b = layout.birds[0];
    expect(tapFind(s, layout, b.x, b.y)).toEqual({ kind: 'bird', index: 0 });
    expect(tapFind(s, layout, b.x, b.y)).toEqual({ kind: 'again', index: 0 });
    expect(s.found).toBe(1);
    expect(layout.birds[0].found).toBe(true);
    expect(s.penalty).toBe(0);
    // A point far from every bird.
    let miss: [number, number] | undefined;
    for (let x = 0; x <= 320 && !miss; x += 4) for (let y = 0; y <= 180 && !miss; y += 4) if (hitTest(layout.birds, x, y) < 0) miss = [x, y];
    expect(miss).toBeDefined();
    const [mx, my] = miss ?? [0, 0];
    expect(tapFind(s, layout, mx, my)).toEqual({ kind: 'miss' });
    expect(s.penalty).toBe(MISS_PENALTY);
  });

  it('wins on the target and times out', () => {
    const c = cfg({ target: 2, seconds: 20 });
    const layout = layoutFind(ICONS, PERCHES, 1);
    const s = startFind();
    expect(findOver(s, c, layout)).toEqual({ over: false, won: false });
    s.t = 17;
    s.penalty = MISS_PENALTY * 2;
    expect(findTimeLeft(s, c)).toBe(0);
    expect(findOver(s, c, layout)).toEqual({ over: true, won: false });
    s.found = 2;
    expect(findOver(s, c, layout)).toEqual({ over: true, won: true });
  });

  it('gives more time with Slow prompts and none with seconds 0', () => {
    const s = startFind();
    s.t = 25;
    expect(findTimeLeft(s, cfg({ seconds: 20, slower: 1.5 }))).toBe(5);
    expect(findTimeLeft(s, cfg({ seconds: 0 }))).toBe(Infinity);
  });

  it('clamps the target to the birds placed', () => {
    const layout = layoutFind(ICONS.slice(0, 2), [], 1);
    expect(findTarget({ target: 5 }, layout)).toBe(2);
    expect(findTarget({ target: 0 }, layout)).toBe(2);
    expect(findTarget({ target: 1 }, layout)).toBe(1);
  });

  it('hints the first unfound bird after a while', () => {
    const layout = layoutFind(ICONS, PERCHES, 1);
    const s = startFind();
    expect(hintBird(s, layout)).toBe(-1);
    s.t = HINT_AFTER;
    expect(hintBird(s, layout)).toBe(0);
    layout.birds[0].found = true;
    expect(hintBird(s, layout)).toBe(1);
  });
});
