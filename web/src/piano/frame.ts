// Classic JRPG window colours: a vertical gradient quantized into whole-pixel
// bands, the way 16-bit hardware drew it (per-scanline colour changes).

export interface Band {
  y: number;
  h: number;
  color: number;
}

export const WINDOW_TOP = 0x3050b0;
export const WINDOW_BOTTOM = 0x101a48;

/** Linear blend of two 0xRRGGBB colours, t in 0–1. */
export function lerpColor(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const ch = (shift: number) => {
    const x = (a >> shift) & 0xff;
    const y = (b >> shift) & 0xff;
    return Math.round(x + (y - x) * k) << shift;
  };
  return ch(16) | ch(8) | ch(0);
}

/** Splits `height` px into bands of `bandH` px blending from `from` to `to`. */
export function gradientBands(height: number, from = WINDOW_TOP, to = WINDOW_BOTTOM, bandH = 2): Band[] {
  const bands: Band[] = [];
  const h = Math.max(0, Math.floor(height));
  const step = Math.max(1, Math.floor(bandH));
  const n = Math.ceil(h / step);
  for (let i = 0; i < n; i++) {
    const y = i * step;
    bands.push({ y, h: Math.min(step, h - y), color: lerpColor(from, to, n > 1 ? i / (n - 1) : 0) });
  }
  return bands;
}
