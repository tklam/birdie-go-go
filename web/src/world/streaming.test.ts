import { describe, expect, it } from 'vitest';
import type { WorldIndex } from '../core/types.gen';
import { CHUNK_TILES, fillChunk, type ChunkData } from './chunk';
import { ChunkStore, chunkKey, wantedChunks } from './streaming';

const index: WorldIndex = {
  tileSize: 16,
  chunkTiles: 32,
  widthChunks: 4,
  heightChunks: 3,
  regions: [],
  tileset: 'tiles_tko',
  areas: ['town'],
  fill: { ground: 7, collision: 1 },
  chunks: { '0,0': 'a.bin', '1,0': 'b.bin', '1,1': 'c.bin' },
  spawns: {},
};

const keys = (cs: { cx: number; cy: number }[]) => cs.map((c) => chunkKey(c.cx, c.cy)).sort();

describe('wantedChunks', () => {
  it('covers the view plus a margin, clamped to the world', () => {
    expect(keys(wantedChunks({ x: 0, y: 0, w: 320, h: 180 }, 512, index, 1))).toEqual(['0,0', '0,1', '1,0', '1,1']);
  });

  it('adds a ring ahead in the direction of travel', () => {
    const still = wantedChunks({ x: 520, y: 520, w: 320, h: 180 }, 512, index, 0);
    expect(keys(still)).toEqual(['1,1']);
    const moving = wantedChunks({ x: 520, y: 520, w: 320, h: 180 }, 512, index, 0, { x: 1, y: 0 });
    expect(keys(moving)).toEqual(['1,1', '2,1']);
  });
});

/** A loader whose promises resolve when the test says so. */
function fakeLoader() {
  const calls: { file: string; resolve: (c: ChunkData) => void; reject: (e: Error) => void }[] = [];
  const load = (file: string) => new Promise<ChunkData>((resolve, reject) => calls.push({ file, resolve, reject }));
  return { calls, load };
}

function chunkWith(cx: number, cy: number, collision: number, area: number): ChunkData {
  const c = fillChunk(cx, cy, { fill: { ground: 1, collision } });
  c.area.fill(area);
  return c;
}

describe('ChunkStore', () => {
  it('loads each wanted chunk once and fills chunks without files', async () => {
    const { calls, load } = fakeLoader();
    const loaded: string[] = [];
    const store = new ChunkStore(index, load, { loaded: (c) => loaded.push(chunkKey(c.cx, c.cy)) });
    store.update([{ cx: 0, cy: 0 }, { cx: 0, cy: 1 }]);
    store.update([{ cx: 0, cy: 0 }, { cx: 0, cy: 1 }]);
    expect(calls.map((c) => c.file)).toEqual(['a.bin']);
    expect(loaded).toEqual(['0,1']); // filled immediately
    expect(store.ready).toBe(false);
    calls[0].resolve(chunkWith(0, 0, 0, 0));
    await Promise.resolve();
    expect(store.ready).toBe(true);
    expect(loaded).toEqual(['0,1', '0,0']);
  });

  it('treats unloaded and out-of-world tiles as solid', async () => {
    const { calls, load } = fakeLoader();
    const store = new ChunkStore(index, load);
    expect(store.collisionAt(0, 0)).toBe(1);
    expect(store.collisionAt(-1, 0)).toBe(1);
    store.update([{ cx: 0, cy: 0 }]);
    calls[0].resolve(chunkWith(0, 0, 0, 0));
    await Promise.resolve();
    expect(store.collisionAt(5, 5)).toBe(0);
    expect(store.areaAt(5, 5)).toBe('town');
    expect(store.collisionAt(CHUNK_TILES, 0)).toBe(1); // chunk 1,0 not loaded
    expect(store.areaAt(CHUNK_TILES, 0)).toBeNull();
  });

  it('evicts least recently used chunks beyond capacity, never wanted ones', () => {
    const evicted: string[] = [];
    const store = new ChunkStore(index, () => new Promise(() => {}), { evicted: (c) => evicted.push(chunkKey(c.cx, c.cy)) }, 2);
    // Chunks without files are filled synchronously.
    store.update([{ cx: 2, cy: 0 }]);
    store.update([{ cx: 3, cy: 0 }]);
    store.update([{ cx: 2, cy: 2 }]);
    expect(evicted).toEqual(['2,0']);
    store.update([{ cx: 3, cy: 0 }, { cx: 2, cy: 2 }, { cx: 3, cy: 2 }]);
    expect(evicted).toEqual(['2,0']); // all three are wanted
  });

  it('reports failed loads and retries on the next update', async () => {
    const { calls, load } = fakeLoader();
    const failed: string[] = [];
    const store = new ChunkStore(index, load, { failed: (k) => failed.push(k) });
    store.update([{ cx: 0, cy: 0 }]);
    calls[0].reject(new Error('offline'));
    await Promise.resolve();
    await Promise.resolve();
    expect(failed).toEqual(['0,0']);
    store.update([{ cx: 0, cy: 0 }]);
    expect(calls).toHaveLength(2);
  });
});
