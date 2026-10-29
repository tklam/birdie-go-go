import type { WorldIndex, WorldObject } from '../core/types.gen';

/** Tiles per chunk side and per chunk (tools/worldbuild). */
export const CHUNK_TILES = 32;
export const CHUNK_AREA = CHUNK_TILES * CHUNK_TILES;
/** Area byte meaning "no area". */
export const NO_AREA = 255;
/** Weather blend cells: 4×4 tiles each, 3 (area, weight) pairs per cell. */
export const BLEND_CELL = 4;
export const BLEND_CELLS = CHUNK_TILES / BLEND_CELL;
export const BLEND_SLOTS = 3;
const BLEND_BYTES = BLEND_CELLS * BLEND_CELLS * BLEND_SLOTS * 2;

/** A decoded chunk. Tile values are atlas frame + 1 (0 = empty). */
export interface ChunkData {
  cx: number;
  cy: number;
  ground: Uint16Array;
  detail: Uint16Array;
  overhead: Uint16Array;
  collision: Uint8Array;
  area: Uint8Array;
  /** Per blend cell: BLEND_SLOTS × (area index, weight 0–255); area 255 = none. */
  blend: Uint8Array;
  objects: WorldObject[];
}

const MAGIC = 'BGC2';

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
  const blend = new Uint8Array(raw.slice(o, o + BLEND_BYTES));
  o += BLEND_BYTES;
  const n = view.getUint32(o, true);
  o += 4;
  const objects = JSON.parse(new TextDecoder().decode(new Uint8Array(raw, o, n))) as WorldObject[];
  return { cx, cy, ground, detail, overhead, collision, area, blend, objects };
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
    blend: emptyBlend(),
    objects: [],
  };
}

function emptyBlend(): Uint8Array {
  const b = new Uint8Array(BLEND_BYTES);
  for (let i = 0; i < b.length; i += 2) b[i] = NO_AREA;
  return b;
}
