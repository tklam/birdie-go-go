import { describe, expect, it } from 'vitest';
import type { Item, Spot } from '../core/types.gen';
import { emptyContent } from '../test/content';
import { build, buildStatus, placeTrailCamera, runTrailCameras, trailCamFlag } from './gadgets';
import { newGame } from './state';

const gadget = (id: string, parts: number, keiStage: string): Item => ({
  id,
  name: id,
  kind: 'gadget',
  price: 0,
  counters: [],
  description: '',
  build: { parts, keiStage },
});
const trail = gadget('trail_camera', 2, 'dating');
const af = gadget('af_module', 3, 'engaged');
const spot: Spot = { id: 'park', name: 'Park', area: 'a', background: 'bg', shots: 12, birds: [{ species: 'egret', weight: 1 }] };

describe('workshop', () => {
  it('needs the right Kei stage and enough parts', () => {
    const s = newGame(emptyContent(), 1);
    s.keiStage = 'friends';
    expect(buildStatus(s, trail)).toBe('stage');
    s.keiStage = 'dating';
    expect(buildStatus(s, trail)).toBe('parts');
    s.items.camera_part = 5;
    expect(build(s, trail)).toBe(true);
    expect(s.items.camera_part).toBe(3);
    expect(s.items.trail_camera).toBe(1);
    expect(buildStatus(s, af)).toBe('stage');
    s.keiStage = 'engaged';
    expect(build(s, af)).toBe(true);
    expect(s.items.camera_part).toBeUndefined();
    expect(buildStatus(s, af)).toBe('owned');
  });
});

describe('trail cameras', () => {
  it('are placed once per spot and photograph a bird each morning', () => {
    const s = newGame(emptyContent(), 7);
    expect(placeTrailCamera(s, 'park')).toBe(false); // none owned
    s.items.trail_camera = 1;
    expect(placeTrailCamera(s, 'park')).toBe(true);
    expect(s.flags[trailCamFlag('park')]).toBe(true);
    expect(placeTrailCamera(s, 'park')).toBe(false);
    const caught = runTrailCameras(s, { spots: [spot] });
    expect(caught).toHaveLength(1);
    expect(caught[0].species).toBe('egret');
    expect(caught[0].score).toBeGreaterThanOrEqual(55);
    expect(caught[0].isNew).toBe(true);
    expect(s.album.egret).toBeDefined();
    // Deterministic for the same day.
    const again = newGame(emptyContent(), 7);
    again.flags[trailCamFlag('park')] = true;
    expect(runTrailCameras(again, { spots: [spot] })[0].score).toBe(caught[0].score);
  });
});
