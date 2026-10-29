import { describe, expect, it } from 'vitest';
import type { ContentBundle } from '../core/types.gen';
import {
  addToAlbum,
  ALERT_DECAY_PER_SEC,
  ALERT_SHOT_BUMP,
  ALERT_SPEED_THRESHOLD,
  focusFactor,
  fractionInside,
  framingFactor,
  OBOY_ALERT_SLOWDOWN,
  pickSubject,
  poseFactor,
  ratingFor,
  scoreShot,
  sharpnessFactor,
  shouldFlee,
  sizeFactor,
  updateAlert,
  type Rect,
  type ShotInput,
} from './photoScore';
import { newGame, type AlbumEntry } from './state';

const content: ContentBundle = {
  game: { title: 'T', contentVersion: '0', startMap: 'tko', startSpawn: 'estate_plaza' },
  areas: [], birds: [], spots: [], students: [], songs: [], events: [], dialogue: [], music: [], items: [], hazards: [], enemies: [],
};

const frame: Rect = { x: 0, y: 0, w: 120, h: 90 };

/** A square bbox of side `size` centered at (cx, cy). */
function box(cx: number, cy: number, size: number): Rect {
  return { x: cx - size / 2, y: cy - size / 2, w: size, h: size };
}

const species = {
  sizeBand: [0.08, 0.3],
  poses: { wings_spread: 1.0, perched_alert: 0.9, perched: 0.8, back_turned: 0.3 },
};

function shot(overrides: Partial<ShotInput> = {}): ShotInput {
  // 50×50 bird in a 120×90 frame → ratio ≈ 0.23, inside the band.
  return {
    frame,
    bird: { bbox: box(60, 45, 50), pose: 'wings_spread', speed: 0 },
    species,
    heldMs: 600,
    focusTimeMs: 500,
    shutterThreshold: 100,
    ...overrides,
  };
}

describe('pickSubject', () => {
  it('picks the in-frame bird closest to the center', () => {
    const near = { id: 'near', bbox: box(70, 50, 10) };
    const far = { id: 'far', bbox: box(10, 10, 10) };
    expect(pickSubject(frame, [far, near])?.id).toBe('near');
  });

  it('counts birds that are only partly in frame', () => {
    const edge = { id: 'edge', bbox: box(-2, 45, 10) };
    expect(pickSubject(frame, [edge])?.id).toBe('edge');
  });

  it('ignores birds outside the frame', () => {
    const outside = { id: 'out', bbox: box(200, 45, 10) };
    const touching = { id: 'touch', bbox: { x: 120, y: 40, w: 10, h: 10 } };
    expect(pickSubject(frame, [outside, touching])).toBeNull();
    expect(pickSubject(frame, [])).toBeNull();
  });
});

describe('factors', () => {
  it('framing is full at the center and at the thirds points', () => {
    expect(framingFactor(frame, box(60, 45, 10))).toBeCloseTo(1);
    expect(framingFactor(frame, box(40, 30, 10))).toBeCloseTo(1);
    expect(framingFactor(frame, box(80, 60, 10))).toBeCloseTo(1);
  });

  it('framing falls off with distance and is 0 at half the diagonal', () => {
    const between = framingFactor(frame, box(50, 45, 10));
    expect(between).toBeGreaterThan(0.8);
    expect(between).toBeLessThan(1);
    const corner = framingFactor(frame, box(5, 5, 10));
    expect(corner).toBeLessThan(between);
    // Far outside a frame's points: 0 even though the frame is large.
    const wide: Rect = { x: 0, y: 0, w: 300, h: 10 };
    expect(framingFactor(wide, { x: 0, y: 0, w: 1, h: 1 })).toBeLessThan(0.3);
  });

  it('framing is multiplied by the fraction of the bird in frame', () => {
    const half = { x: -10, y: 25, w: 20, h: 20 };
    expect(fractionInside(half, frame)).toBeCloseTo(0.5);
    const full = framingFactor(frame, half) / 0.5;
    expect(full).toBeLessThanOrEqual(1);
    expect(framingFactor(frame, half)).toBeLessThanOrEqual(0.5);
  });

  it('size is 1 inside the band and linear to 0 at min/2 and 2·max', () => {
    expect(sizeFactor(0.08, species.sizeBand)).toBe(1);
    expect(sizeFactor(0.2, species.sizeBand)).toBe(1);
    expect(sizeFactor(0.3, species.sizeBand)).toBe(1);
    expect(sizeFactor(0.06, species.sizeBand)).toBeCloseTo(0.5);
    expect(sizeFactor(0.04, species.sizeBand)).toBe(0);
    expect(sizeFactor(0.01, species.sizeBand)).toBe(0);
    expect(sizeFactor(0.45, species.sizeBand)).toBeCloseTo(0.5);
    expect(sizeFactor(0.6, species.sizeBand)).toBe(0);
    expect(sizeFactor(0.9, species.sizeBand)).toBe(0);
  });

  it('focus is proportional to hold time up to the lens focus time', () => {
    expect(focusFactor(0, 500)).toBe(0);
    expect(focusFactor(250, 500)).toBe(0.5);
    expect(focusFactor(900, 500)).toBe(1);
    expect(focusFactor(0, 0)).toBe(1);
  });

  it('pose comes from the species table with 0.5 for unknown poses', () => {
    expect(poseFactor(species.poses, 'perched')).toBe(0.8);
    expect(poseFactor(species.poses, 'dancing')).toBe(0.5);
  });

  it('sharpness is 1 up to the threshold and 0 at 3×', () => {
    expect(sharpnessFactor(50, 100)).toBe(1);
    expect(sharpnessFactor(100, 100)).toBe(1);
    expect(sharpnessFactor(200, 100)).toBeCloseTo(0.5);
    expect(sharpnessFactor(300, 100)).toBe(0);
    expect(sharpnessFactor(1000, 100)).toBe(0);
  });

  it('rates scores per SPEC §5.3', () => {
    expect(ratingFor(100)).toBe('perfect');
    expect(ratingFor(90)).toBe('perfect');
    expect(ratingFor(89)).toBe('great');
    expect(ratingFor(75)).toBe('great');
    expect(ratingFor(74)).toBe('good');
    expect(ratingFor(50)).toBe('good');
    expect(ratingFor(49)).toBe('blurry');
  });
});

describe('scoreShot', () => {
  it('scores an ideal shot 100 / perfect', () => {
    const r = scoreShot(shot());
    expect(r.score).toBe(100);
    expect(r.rating).toBe('perfect');
    expect(r.factors).toEqual({ framing: 1, size: 1, focus: 1, pose: 1, sharpness: 1 });
  });

  it('weights the factors 25/20/20/20/15', () => {
    expect(scoreShot(shot({ heldMs: 0 })).score).toBe(80);
    expect(scoreShot(shot({ bird: { bbox: box(60, 45, 50), pose: 'unknown', speed: 0 } })).score).toBe(90);
    expect(scoreShot(shot({ bird: { bbox: box(60, 45, 50), pose: 'wings_spread', speed: 1000 } })).score).toBe(85);
    expect(scoreShot(shot({ bird: { bbox: box(60, 45, 5), pose: 'wings_spread', speed: 0 } })).score).toBe(80);
  });

  it('combines several weaknesses into a lower rating', () => {
    const r = scoreShot(shot({ heldMs: 250, bird: { bbox: box(60, 45, 50), pose: 'back_turned', speed: 200 } }));
    // 25 + 20 + 10 + 6 + 7.5 = 68.5 → 69
    expect(r.score).toBe(69);
    expect(r.rating).toBe('good');
  });

  it('returns integers in 0–100', () => {
    const r = scoreShot(shot({ heldMs: 0, bird: { bbox: { x: 119, y: 89, w: 30, h: 30 }, pose: 'back_turned', speed: 999 } }));
    expect(Number.isInteger(r.score)).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.rating).toBe('blurry');
  });
});

describe('updateAlert', () => {
  const base = { dtMs: 1000, viewfinderSpeed: 0, shotFired: false, skittishness: 0.5 };

  it('decays slowly when calm and never goes below 0', () => {
    expect(updateAlert(50, base)).toBeCloseTo(50 - ALERT_DECAY_PER_SEC);
    expect(updateAlert(2, base)).toBe(0);
  });

  it('does not rise at or below the speed threshold', () => {
    expect(updateAlert(50, { ...base, viewfinderSpeed: ALERT_SPEED_THRESHOLD })).toBeLessThan(50);
  });

  it('rises in proportion to excess speed and skittishness', () => {
    const slow = updateAlert(0, { ...base, viewfinderSpeed: ALERT_SPEED_THRESHOLD + 20 });
    const fast = updateAlert(0, { ...base, viewfinderSpeed: ALERT_SPEED_THRESHOLD + 40 });
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeCloseTo(slow * 2);
    const skittish = updateAlert(0, { ...base, viewfinderSpeed: ALERT_SPEED_THRESHOLD + 20, skittishness: 1 });
    expect(skittish).toBeGreaterThan(slow);
  });

  it('bumps per shot, even with dt 0', () => {
    const bump = updateAlert(0, { ...base, dtMs: 0, shotFired: true, skittishness: 0.5 });
    expect(bump).toBeCloseTo(ALERT_SHOT_BUMP);
  });

  it('rises 20% slower with O Boy', () => {
    const plain = updateAlert(0, { ...base, shotFired: true });
    const calm = updateAlert(0, { ...base, shotFired: true, slowdown: OBOY_ALERT_SLOWDOWN });
    expect(calm).toBeCloseTo(plain * 0.8);
  });

  it('caps at 100 and then birds flee', () => {
    const a = updateAlert(95, { ...base, shotFired: true });
    expect(a).toBe(100);
    expect(shouldFlee(a)).toBe(true);
    expect(shouldFlee(99.9)).toBe(false);
  });
});

describe('addToAlbum', () => {
  const entry = (score: number, rating: AlbumEntry['rating']): AlbumEntry => ({
    species: 'little_egret', score, rating, day: 3, slot: 'morning', area: 'tko', spot: 'bay', companions: ['oboy'],
  });

  it('adds a new species', () => {
    const s = newGame(content, 1);
    expect(addToAlbum(s, entry(60, 'good'))).toEqual({ newSpecies: true, newBest: true });
    expect(s.album.little_egret.score).toBe(60);
  });

  it('keeps only the best score', () => {
    const s = newGame(content, 1);
    addToAlbum(s, entry(80, 'great'));
    expect(addToAlbum(s, entry(70, 'good'))).toEqual({ newSpecies: false, newBest: false });
    expect(addToAlbum(s, entry(80, 'great'))).toEqual({ newSpecies: false, newBest: false });
    expect(s.album.little_egret.score).toBe(80);
    expect(addToAlbum(s, entry(95, 'perfect'))).toEqual({ newSpecies: false, newBest: true });
    expect(s.album.little_egret.rating).toBe('perfect');
  });

  it('never saves blurry shots', () => {
    const s = newGame(content, 1);
    expect(addToAlbum(s, entry(40, 'blurry'))).toEqual({ newSpecies: false, newBest: false });
    expect(s.album).toEqual({});
  });

  it('copies the entry', () => {
    const s = newGame(content, 1);
    const e = entry(60, 'good');
    addToAlbum(s, e);
    e.companions.push('kei');
    expect(s.album.little_egret.companions).toEqual(['oboy']);
  });
});
