import { describe, expect, it } from 'vitest';
import { fogPixels } from './minimap';

describe('fogPixels', () => {
  it('darkens undiscovered areas only', () => {
    const rgba = new Uint8ClampedArray([200, 200, 200, 255, 200, 200, 200, 255]);
    fogPixels(rgba, [0, 1], (a) => a === 0);
    expect([...rgba.slice(0, 4)]).toEqual([200, 200, 200, 255]);
    expect(rgba[4]).toBeLessThan(80);
    expect(rgba[7]).toBe(255);
  });
});
