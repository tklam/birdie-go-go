import { describe, expect, it } from 'vitest';
import { BLEND_CELLS, BLEND_SLOTS, CHUNK_AREA, decodeChunk, fillChunk, NO_AREA } from './chunk';

/** Encodes a chunk the way tools/worldbuild does (before gzip). */
export function encodeChunk(cx: number, cy: number, fill: { ground?: number; collision?: number; area?: number }, objects: unknown[] = []): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(objects));
  const blendBytes = BLEND_CELLS * BLEND_CELLS * BLEND_SLOTS * 2;
  const size = 4 + 4 + CHUNK_AREA * 2 * 3 + CHUNK_AREA * 2 + blendBytes + 4 + json.length;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  'BGC2'.split('').forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
  v.setUint16(4, cx, true);
  v.setUint16(6, cy, true);
  let o = 8;
  for (let layer = 0; layer < 3; layer++) {
    for (let i = 0; i < CHUNK_AREA; i++) v.setUint16(o + i * 2, layer === 0 ? (fill.ground ?? 0) : 0, true);
    o += CHUNK_AREA * 2;
  }
  for (let i = 0; i < CHUNK_AREA; i++) v.setUint8(o + i, fill.collision ?? 0);
  o += CHUNK_AREA;
  for (let i = 0; i < CHUNK_AREA; i++) v.setUint8(o + i, fill.area ?? NO_AREA);
  o += CHUNK_AREA;
  // Every blend cell: the fill area at full weight (or none).
  for (let i = 0; i < blendBytes; i += BLEND_SLOTS * 2) {
    v.setUint8(o + i, fill.area ?? NO_AREA);
    v.setUint8(o + i + 1, fill.area === undefined ? 0 : 255);
    for (let s = 1; s < BLEND_SLOTS; s++) v.setUint8(o + i + s * 2, NO_AREA);
  }
  o += blendBytes;
  v.setUint32(o, json.length, true);
  new Uint8Array(buf, o + 4).set(json);
  return buf;
}

describe('decodeChunk', () => {
  it('round-trips the worldbuild format', () => {
    const objects = [{ name: 'p', type: 'spot', x: 24, y: 8, props: { spot_id: 'park' } }];
    const c = decodeChunk(encodeChunk(2, 3, { ground: 5, collision: 1, area: 0 }, objects));
    expect([c.cx, c.cy]).toEqual([2, 3]);
    expect(c.ground[0]).toBe(5);
    expect(c.ground[CHUNK_AREA - 1]).toBe(5);
    expect(c.detail[0]).toBe(0);
    expect(c.collision[10]).toBe(1);
    expect(c.area[10]).toBe(0);
    expect([c.blend[0], c.blend[1], c.blend[2]]).toEqual([0, 255, NO_AREA]);
    expect(c.objects).toEqual(objects);
  });

  it('rejects other data', () => {
    expect(() => decodeChunk(new TextEncoder().encode('nope....').buffer)).toThrow('bad chunk magic');
  });
});

describe('fillChunk', () => {
  it('fills with the index fill and no area', () => {
    const c = fillChunk(1, 1, { fill: { ground: 7, collision: 1 } });
    expect(c.ground[123]).toBe(7);
    expect(c.collision[123]).toBe(1);
    expect(c.area[123]).toBe(NO_AREA);
    expect(c.objects).toEqual([]);
    expect(c.blend[0]).toBe(NO_AREA);
  });
});
