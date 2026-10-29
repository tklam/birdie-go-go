import type { WorldIndex } from '../core/types.gen';
import { CHUNK_TILES, fillChunk, NO_AREA, type ChunkData } from './chunk';

export type ChunkKey = string;
export const chunkKey = (cx: number, cy: number): ChunkKey => `${cx},${cy}`;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The chunks the client should keep loaded: those overlapping the view plus
 * `margin` chunks around it, and one more ring ahead in the direction of
 * travel (SPEC.md §9.7). Clamped to the world.
 */
export function wantedChunks(
  view: Rect,
  chunkPx: number,
  world: Pick<WorldIndex, 'widthChunks' | 'heightChunks'>,
  margin = 1,
  velocity = { x: 0, y: 0 },
): { cx: number; cy: number }[] {
  let x0 = Math.floor(view.x / chunkPx) - margin;
  let y0 = Math.floor(view.y / chunkPx) - margin;
  let x1 = Math.floor((view.x + view.w - 1) / chunkPx) + margin;
  let y1 = Math.floor((view.y + view.h - 1) / chunkPx) + margin;
  if (velocity.x > 0) x1++;
  if (velocity.x < 0) x0--;
  if (velocity.y > 0) y1++;
  if (velocity.y < 0) y0--;
  const out: { cx: number; cy: number }[] = [];
  for (let cy = Math.max(0, y0); cy <= Math.min(world.heightChunks - 1, y1); cy++) {
    for (let cx = Math.max(0, x0); cx <= Math.min(world.widthChunks - 1, x1); cx++) out.push({ cx, cy });
  }
  return out;
}

/** Loads a chunk file by name (e.g. from a worker). */
export type ChunkLoader = (file: string) => Promise<ChunkData>;

export interface ChunkStoreEvents {
  loaded?(chunk: ChunkData): void;
  evicted?(chunk: ChunkData): void;
  failed?(key: ChunkKey, error: unknown): void;
}

/**
 * Keeps the wanted chunks loaded, caches recently used ones (LRU) and
 * answers tile queries. Tiles in chunks that aren't loaded yet are solid, so
 * nothing can walk into the unknown.
 */
export class ChunkStore {
  private readonly loaded = new Map<ChunkKey, ChunkData>();
  private readonly pending = new Set<ChunkKey>();
  private wanted = new Set<ChunkKey>();

  constructor(
    private readonly index: WorldIndex,
    private readonly load: ChunkLoader,
    private readonly events: ChunkStoreEvents = {},
    private readonly capacity = 64,
  ) {}

  get chunkPx(): number {
    return this.index.tileSize * CHUNK_TILES;
  }

  /** Requests the given chunks and evicts cached chunks beyond capacity. */
  update(chunks: { cx: number; cy: number }[]): void {
    this.wanted = new Set(chunks.map((c) => chunkKey(c.cx, c.cy)));
    for (const { cx, cy } of chunks) {
      const key = chunkKey(cx, cy);
      const cached = this.loaded.get(key);
      if (cached) {
        // Refresh LRU order.
        this.loaded.delete(key);
        this.loaded.set(key, cached);
        continue;
      }
      if (this.pending.has(key)) continue;
      const file = this.index.chunks[key];
      if (!file) {
        this.store(key, fillChunk(cx, cy, this.index));
        continue;
      }
      this.pending.add(key);
      this.load(file).then(
        (chunk) => {
          this.pending.delete(key);
          this.store(key, chunk);
        },
        (err: unknown) => {
          this.pending.delete(key);
          this.events.failed?.(key, err);
        },
      );
    }
    this.evict();
  }

  get(cx: number, cy: number): ChunkData | undefined {
    return this.loaded.get(chunkKey(cx, cy));
  }

  /** Whether every wanted chunk is loaded. */
  get ready(): boolean {
    for (const key of this.wanted) if (!this.loaded.has(key)) return false;
    return true;
  }

  /** Collision code at a tile (solid outside the world or if not loaded). */
  collisionAt(tx: number, ty: number): number {
    const t = this.tile(tx, ty);
    return t ? t.chunk.collision[t.i] : 1;
  }

  /** Ground tile value (atlas frame + 1) at a tile, or 0 if not loaded. */
  groundAt(tx: number, ty: number): number {
    const t = this.tile(tx, ty);
    return t ? t.chunk.ground[t.i] : 0;
  }

  /** Area id at a tile, or null. */
  areaAt(tx: number, ty: number): string | null {
    const t = this.tile(tx, ty);
    if (!t) return null;
    const a = t.chunk.area[t.i];
    return a === NO_AREA ? null : (this.index.areas[a] ?? null);
  }

  /** All loaded chunks (for object queries). */
  chunks(): IterableIterator<ChunkData> {
    return this.loaded.values();
  }

  private tile(tx: number, ty: number): { chunk: ChunkData; i: number } | null {
    if (tx < 0 || ty < 0) return null;
    const chunk = this.get(Math.floor(tx / CHUNK_TILES), Math.floor(ty / CHUNK_TILES));
    if (!chunk) return null;
    return { chunk, i: (ty % CHUNK_TILES) * CHUNK_TILES + (tx % CHUNK_TILES) };
  }

  private store(key: ChunkKey, chunk: ChunkData): void {
    this.loaded.set(key, chunk);
    this.events.loaded?.(chunk);
    this.evict();
  }

  private evict(): void {
    for (const [key, chunk] of this.loaded) {
      if (this.loaded.size <= this.capacity) return;
      if (this.wanted.has(key)) continue;
      this.loaded.delete(key);
      this.events.evicted?.(chunk);
    }
  }
}
