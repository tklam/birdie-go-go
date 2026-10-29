import type Phaser from 'phaser';
import { CHUNK_TILES, type ChunkData } from './chunk';
import { chunkKey, type ChunkKey } from './streaming';

/** Render depths shared by world scenes. */
export const DEPTH = { ground: 0, entities: 1000, overhead: 1_000_000 } as const;

interface Baked {
  below: Phaser.GameObjects.RenderTexture;
  above: Phaser.GameObjects.RenderTexture | null;
}

/**
 * Bakes each chunk's static layers into pooled render textures — one for
 * ground + detail, one for overhead — so a chunk costs about two draw calls.
 * At most one chunk is baked per frame to avoid hitches (SPEC.md §9.7).
 */
export class ChunkRenderer {
  private readonly queue: ChunkData[] = [];
  private readonly baked = new Map<ChunkKey, Baked>();
  private readonly pool: Phaser.GameObjects.RenderTexture[] = [];
  private readonly chunkPx: number;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly tileset: string,
    private readonly tileSize: number,
  ) {
    this.chunkPx = tileSize * CHUNK_TILES;
  }

  enqueue(chunk: ChunkData): void {
    this.queue.push(chunk);
  }

  remove(chunk: ChunkData): void {
    const key = chunkKey(chunk.cx, chunk.cy);
    const i = this.queue.indexOf(chunk);
    if (i >= 0) this.queue.splice(i, 1);
    const b = this.baked.get(key);
    if (!b) return;
    this.baked.delete(key);
    this.release(b.below);
    if (b.above) this.release(b.above);
  }

  /** Bakes the next queued chunk, if any. Call once per frame. */
  update(): void {
    const chunk = this.queue.shift();
    if (chunk) this.bake(chunk);
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  private bake(chunk: ChunkData): void {
    const key = chunkKey(chunk.cx, chunk.cy);
    const old = this.baked.get(key);
    if (old) {
      this.release(old.below);
      if (old.above) this.release(old.above);
    }
    const x = chunk.cx * this.chunkPx;
    const y = chunk.cy * this.chunkPx;
    const below = this.take(x, y, DEPTH.ground);
    this.draw(below, [chunk.ground, chunk.detail]);
    const above = chunk.overhead.some((v) => v !== 0) ? this.take(x, y, DEPTH.overhead) : null;
    if (above) this.draw(above, [chunk.overhead]);
    this.baked.set(key, { below, above });
  }

  private draw(rt: Phaser.GameObjects.RenderTexture, layers: Uint16Array[]): void {
    rt.clear();
    rt.beginDraw();
    for (const layer of layers) {
      for (let i = 0; i < layer.length; i++) {
        const v = layer[i];
        if (v === 0) continue;
        rt.batchDrawFrame(this.tileset, v - 1, (i % CHUNK_TILES) * this.tileSize, Math.floor(i / CHUNK_TILES) * this.tileSize);
      }
    }
    rt.endDraw();
  }

  private take(x: number, y: number, depth: number): Phaser.GameObjects.RenderTexture {
    const rt = this.pool.pop() ?? this.scene.add.renderTexture(0, 0, this.chunkPx, this.chunkPx).setOrigin(0, 0);
    return rt.setPosition(x, y).setDepth(depth).setVisible(true);
  }

  private release(rt: Phaser.GameObjects.RenderTexture): void {
    rt.setVisible(false);
    this.pool.push(rt);
  }
}
