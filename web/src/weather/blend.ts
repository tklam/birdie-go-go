// Weather blending at area boundaries (SPEC.md §4.9): sample the blend
// field baked into chunks and mix the areas' weather.
import type { WeatherParams } from '../core/types.gen';
import { BLEND_CELL, BLEND_CELLS, BLEND_SLOTS, NO_AREA, type ChunkData } from '../world/chunk';

export type ChunkAt = (cx: number, cy: number) => ChunkData | undefined;

/** Area index → weight (summing to 1) at a world position, bilinear between cells. */
export function blendAt(chunkAt: ChunkAt, x: number, y: number, tileSize: number): Map<number, number> {
  const cellPx = tileSize * BLEND_CELL;
  // Cell coordinates measured from cell centres.
  const fx = x / cellPx - 0.5;
  const fy = y / cellPx - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const out = new Map<number, number>();
  const corners: [number, number, number][] = [
    [x0, y0, (1 - tx) * (1 - ty)],
    [x0 + 1, y0, tx * (1 - ty)],
    [x0, y0 + 1, (1 - tx) * ty],
    [x0 + 1, y0 + 1, tx * ty],
  ];
  for (const [cx, cy, k] of corners) {
    if (k <= 0) continue;
    const cell = cellAt(chunkAt, Math.max(0, cx), Math.max(0, cy));
    if (!cell) continue;
    for (const [area, w] of cell) out.set(area, (out.get(area) ?? 0) + w * k);
  }
  let total = 0;
  for (const w of out.values()) total += w;
  if (total > 0) for (const [a, w] of out) out.set(a, w / total);
  return out;
}

function cellAt(chunkAt: ChunkAt, gx: number, gy: number): [number, number][] | null {
  const chunk = chunkAt(Math.floor(gx / BLEND_CELLS), Math.floor(gy / BLEND_CELLS));
  if (!chunk) return null;
  const i = ((gy % BLEND_CELLS) * BLEND_CELLS + (gx % BLEND_CELLS)) * BLEND_SLOTS * 2;
  const out: [number, number][] = [];
  for (let s = 0; s < BLEND_SLOTS; s++) {
    const area = chunk.blend[i + s * 2];
    if (area !== NO_AREA) out.push([area, chunk.blend[i + s * 2 + 1] / 255]);
  }
  return out;
}

/**
 * Mixes the areas' weather by weight. Wind direction is mixed as a vector.
 * Returns null if no weighted area has weather.
 */
export function mixWeather(weights: Map<number, number>, weatherOf: (area: number) => WeatherParams | undefined): WeatherParams | null {
  let total = 0;
  const m = { cloud: 0, precip: 0, temp: 0, fog: 0, wind: 0, uv: 0 };
  let wx = 0;
  let wy = 0;
  for (const [area, w] of weights) {
    const p = weatherOf(area);
    if (!p || w <= 0) continue;
    total += w;
    m.cloud += p.cloud * w;
    m.precip += p.precip * w;
    m.temp += p.temp * w;
    m.fog += p.fog * w;
    m.wind += p.wind * w;
    m.uv += p.uv * w;
    wx += Math.cos(p.windDir) * w;
    wy += Math.sin(p.windDir) * w;
  }
  if (total === 0) return null;
  return {
    cloud: m.cloud / total,
    precip: m.precip / total,
    temp: m.temp / total,
    fog: m.fog / total,
    wind: m.wind / total,
    uv: m.uv / total,
    windDir: Math.atan2(wy, wx),
  };
}

/** Moves `current` toward `target` by a fraction (1 − e^(−dt/tau)) for smooth transitions. */
export function easeWeather(current: WeatherParams, target: WeatherParams, dtMs: number, tauMs = 1000): WeatherParams {
  const k = 1 - Math.exp(-dtMs / tauMs);
  const lerp = (a: number, b: number) => a + (b - a) * k;
  const dir = Math.atan2(lerp(Math.sin(current.windDir), Math.sin(target.windDir)), lerp(Math.cos(current.windDir), Math.cos(target.windDir)));
  return {
    cloud: lerp(current.cloud, target.cloud),
    precip: lerp(current.precip, target.precip),
    temp: lerp(current.temp, target.temp),
    fog: lerp(current.fog, target.fog),
    wind: lerp(current.wind, target.wind),
    uv: lerp(current.uv, target.uv),
    windDir: dir,
  };
}
