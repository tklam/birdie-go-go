import { describe, expect, it } from 'vitest';
import { cacheKey, entryUrl, precachePlan, runPool } from './precache';

const base = 'https://example.org/game/';

describe('cacheKey', () => {
  it('puts the revision in the query and keeps hashed bundles as they are', () => {
    expect(cacheKey({ url: 'assets/chars/oboy.png', revision: 'abc' }, base)).toBe('https://example.org/game/assets/chars/oboy.png?__rev=abc');
    expect(cacheKey({ url: 'assets/index-DzCdYHiX.js', revision: null }, base)).toBe('https://example.org/game/assets/index-DzCdYHiX.js');
    expect(entryUrl({ url: 'assets/chars/oboy.png', revision: 'abc' }, base)).toBe('https://example.org/game/assets/chars/oboy.png');
  });
});

describe('precachePlan', () => {
  it('downloads only new or changed files and marks leftovers stale', () => {
    const old = [
      { url: 'index.html', revision: '1' },
      { url: 'assets/a.png', revision: 'x' },
      { url: 'assets/gone.png', revision: 'g' },
    ];
    const cached = old.map((e) => cacheKey(e, base));
    const next = [
      { url: 'index.html', revision: '2' },
      { url: 'assets/a.png', revision: 'x' },
      { url: 'assets/new.png', revision: 'n' },
    ];
    const plan = precachePlan(next, cached, base);
    expect(plan.download.map((e) => e.url)).toEqual(['index.html', 'assets/new.png']);
    expect(plan.stale).toEqual([cacheKey(old[0], base), cacheKey(old[2], base)]);
  });
});

describe('runPool', () => {
  it('keeps at most `limit` tasks running and finishes them all', async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      done.push(n);
      running--;
    });
    expect(peak).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('rejects with the first failure after the others finish', async () => {
    const done: number[] = [];
    await expect(
      runPool([1, 2, 3], 2, async (n) => {
        if (n === 1) throw new Error('nope');
        await new Promise((r) => setTimeout(r, 5));
        done.push(n);
      }),
    ).rejects.toThrow('nope');
    expect(done.sort()).toEqual([2, 3]);
  });
});
