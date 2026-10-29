import type { WorldIndex, WorldObject } from '../core/types.gen';

/** Tiles per chunk side and per chunk (tools/worldbuild). */
export const CHUNK_TILES = 32;
export const CHUNK_AREA = CHUNK_TILES * CHUNK_TILES;
/** Area byte meaning "no area". */
export const NO_AREA = 255;

/** A decoded chunk. Tile values are atlas frame + 1 (0 = empty). */
export interface ChunkData {
  cx: number;
  cy: number;
  ground: Uint16Array;
  detail: Uint16Array;
  overhead: Uint16Array;
  collision: Uint8Array;
  area: Uint8Array;
  objects: WorldObject[];
}

const MAGIC = 'BGC1';

/** Decodes an (already gunzipped) chunk file; see tools/worldbuild/main.go. */
export function decodeChunk(raw: ArrayBuffer): ChunkData {
  const view = new DataView(raw);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== MAGIC) throw new Error(`bad chunk magic ${JSON.stringify(magic)}`);
  let o = 4;
  const cx = view.getUint16(o, true);
  const cy = view.getUint16(o + 2, true);
  o += 4;
  const u16 = () => {
    const a = new Uint16Array(CHUNK_AREA);
    for (let i = 0; i < CHUNK_AREA; i++) a[i] = view.getUint16(o + i * 2, true);
    o += CHUNK_AREA * 2;
    return a;
  };
  const u8 = () => {
    const a = new Uint8Array(raw.slice(o, o + CHUNK_AREA));
    o += CHUNK_AREA;
    return a;
  };
  const ground = u16();
  const detail = u16();
  const overhead = u16();
  const collision = u8();
  const area = u8();
  const n = view.getUint32(o, true);
  o += 4;
  const objects = JSON.parse(new TextDecoder().decode(new Uint8Array(raw, o, n))) as WorldObject[];
  return { cx, cy, ground, detail, overhead, collision, area, objects };
}

/** The contents of a chunk that has no file (open sea, map edge). */
export function fillChunk(cx: number, cy: number, index: Pick<WorldIndex, 'fill'>): ChunkData {
  return {
    cx,
    cy,
    ground: new Uint16Array(CHUNK_AREA).fill(index.fill.ground),
    detail: new Uint16Array(CHUNK_AREA),
    overhead: new Uint16Array(CHUNK_AREA),
    collision: new Uint8Array(CHUNK_AREA).fill(index.fill.collision),
    area: new Uint8Array(CHUNK_AREA).fill(NO_AREA),
    objects: [],
  };
}
