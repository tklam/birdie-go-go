import { describe, expect, it } from 'vitest';
import { fitZoom, GAME_HEIGHT, GAME_WIDTH } from './display';

describe('fitZoom', () => {
  it('uses the largest whole multiple that fits', () => {
    expect(fitZoom(1920, 1080)).toBe(6);
    expect(fitZoom(1280, 720)).toBe(4);
    expect(fitZoom(1366, 768)).toBe(4);
  });

  it('is limited by the tighter axis', () => {
    expect(fitZoom(1920, 400)).toBe(2);
  });

  it('never goes below 1 device pixel per game pixel', () => {
    expect(fitZoom(100, 100)).toBe(1);
  });

  it('scales in whole device pixels on high-DPI screens', () => {
    // An 844×390 CSS-px phone at 3× has 2532×1170 device pixels → 6 device px per game px.
    const zoom = fitZoom(844, 390, 3);
    expect(zoom).toBeCloseTo(2);
    expect(Number.isInteger(zoom * 3)).toBe(true);
    // A 2.75× phone: whole device pixels, fractional CSS zoom.
    const z = fitZoom(800, 400, 2.75);
    expect(Math.abs(z * 2.75 - Math.round(z * 2.75))).toBeLessThan(1e-9);
    expect(GAME_WIDTH * z).toBeLessThanOrEqual(800);
    expect(GAME_HEIGHT * z).toBeLessThanOrEqual(400);
  });

  it('treats an invalid device pixel ratio as 1', () => {
    expect(fitZoom(1280, 720, 0)).toBe(4);
  });
});
