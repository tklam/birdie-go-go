import { describe, expect, it } from 'vitest';
import type { WeatherParams } from '../core/types.gen';
import { BLEND_CELLS, BLEND_SLOTS, fillChunk, NO_AREA, type ChunkData } from '../world/chunk';
import { blendAt, easeWeather, mixWeather } from './blend';

/** A chunk whose blend cells are given by f(cellX, cellY) → [area, weight255][]. */
function chunk(f: (x: number, y: number) => [number, number][]): ChunkData {
  const c = fillChunk(0, 0, { fill: { ground: 1, collision: 0 } });
  for (let y = 0; y < BLEND_CELLS; y++) {
    for (let x = 0; x < BLEND_CELLS; x++) {
      const i = (y * BLEND_CELLS + x) * BLEND_SLOTS * 2;
      const pairs = f(x, y);
      for (let s = 0; s < BLEND_SLOTS; s++) {
        c.blend[i + s * 2] = pairs[s]?.[0] ?? NO_AREA;
        c.blend[i + s * 2 + 1] = pairs[s]?.[1] ?? 0;
      }
    }
  }
  return c;
}

// Cells x < 4 are area 0, x ≥ 4 are area 1 (a hard boundary at x = 4 cells = 256 px).
const split = chunk((x) => [[x < 4 ? 0 : 1, 255]]);
const at = (cx: number, cy: number) => (cx === 0 && cy === 0 ? split : undefined);

describe('blendAt', () => {
  it('is pure area weather at a cell centre', () => {
    const w = blendAt(at, 32, 32, 16); // centre of cell (0, 0)
    expect([...w]).toEqual([[0, 1]]);
  });

  it('interpolates between cells across a boundary', () => {
    // Halfway between the centres of cells 3 (area 0) and 4 (area 1).
    const w = blendAt(at, 256, 32, 16);
    expect(w.get(0)).toBeCloseTo(0.5);
    expect(w.get(1)).toBeCloseTo(0.5);
  });

  it('weights always sum to 1 and ignore missing chunks', () => {
    const w = blendAt(at, 500, 500, 16); // partly outside the chunk
    const total = [...w.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1);
  });

  it('is empty where nothing is loaded', () => {
    expect(blendAt(() => undefined, 10, 10, 16).size).toBe(0);
  });
});

const sunny: WeatherParams = { cloud: 0, precip: 0, temp: 30, fog: 0, wind: 0.2, windDir: 0, uv: 10 };
const rainy: WeatherParams = { cloud: 1, precip: 0.8, temp: 20, fog: 0.4, wind: 0.6, windDir: Math.PI / 2, uv: 2 };

describe('mixWeather', () => {
  it('mixes by weight, wind direction as a vector', () => {
    const m = mixWeather(new Map([[0, 0.5], [1, 0.5]]), (a) => (a === 0 ? sunny : rainy));
    expect(m?.cloud).toBeCloseTo(0.5);
    expect(m?.temp).toBeCloseTo(25);
    expect(m?.windDir).toBeCloseTo(Math.PI / 4);
  });

  it('skips areas without weather and returns null for none', () => {
    expect(mixWeather(new Map([[0, 0.3], [9, 0.7]]), (a) => (a === 0 ? sunny : undefined))?.temp).toBeCloseTo(30);
    expect(mixWeather(new Map(), () => sunny)).toBeNull();
  });
});

describe('easeWeather', () => {
  it('moves toward the target and converges', () => {
    let w = sunny;
    w = easeWeather(w, rainy, 100);
    expect(w.precip).toBeGreaterThan(0);
    expect(w.precip).toBeLessThan(0.8);
    for (let i = 0; i < 100; i++) w = easeWeather(w, rainy, 100);
    expect(w.precip).toBeCloseTo(0.8);
    expect(w.windDir).toBeCloseTo(Math.PI / 2);
  });
});
