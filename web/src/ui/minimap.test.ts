import { describe, expect, it } from 'vitest';
import { fogPixels, landmarkShown } from './minimap';

describe('fogPixels', () => {
  it('darkens undiscovered areas only', () => {
    const rgba = new Uint8ClampedArray([200, 200, 200, 255, 200, 200, 200, 255]);
    fogPixels(rgba, [0, 1], (a) => a === 0);
    expect([...rgba.slice(0, 4)]).toEqual([200, 200, 200, 255]);
    expect(rgba[4]).toBeLessThan(80);
    expect(rgba[7]).toBe(255);
  });
});

describe('landmarkShown', () => {
  const flags = { 'area:bay': true, 'stop:pier': true, 'gateway:north': true };

  it('hides spots, shops and doors in areas not yet visited', () => {
    expect(landmarkShown({ type: 'spot', id: 'a', area: 'bay' }, flags)).toBe(true);
    expect(landmarkShown({ type: 'spot', id: 'b', area: 'hills' }, flags)).toBe(false);
    expect(landmarkShown({ type: 'shop', id: 'c', area: 'hills' }, flags)).toBe(false);
    expect(landmarkShown({ type: 'door', id: 'd' }, flags)).toBe(true);
  });

  it('shows stops once discovered and gateways once open', () => {
    expect(landmarkShown({ type: 'stop', id: 'pier', area: 'hills' }, flags)).toBe(true);
    expect(landmarkShown({ type: 'stop', id: 'quay', area: 'bay' }, flags)).toBe(false);
    expect(landmarkShown({ type: 'gateway', id: 'north', area: 'hills' }, flags)).toBe(true);
    expect(landmarkShown({ type: 'gateway', id: 'south', area: 'bay' }, flags)).toBe(false);
  });
});
