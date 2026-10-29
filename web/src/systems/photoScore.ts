// Photo scoring, stealth and album bookkeeping (SPEC.md §5.3–5.6). Pure
// functions over plain rectangles in screen (game) pixels; no Phaser.
import type { Bird } from '../core/types.gen';
import type { AlbumEntry, GameState, PhotoRating } from './state';

/** Axis-aligned rectangle; (x, y) is the top-left corner. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A bird on screen, as far as subject picking is concerned. */
export interface BirdInFrame {
  bbox: Rect;
}

export const WEIGHTS = { framing: 25, size: 20, focus: 20, pose: 20, sharpness: 15 } as const;

/** Lower bounds of each rating (SPEC.md §5.3); below `good` is blurry. */
export const RATING_THRESHOLDS = { perfect: 90, great: 75, good: 50 } as const;

/** Pose value used when the species has no entry for the bird's pose. */
export const DEFAULT_POSE_VALUE = 0.5;

/** Sharpness reaches 0 at this multiple of the shutter's motion threshold. */
export const SHARPNESS_ZERO_MULTIPLE = 3;

function center(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Area of the intersection of two rectangles (0 if they don't overlap). */
export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Fraction (0–1) of `r`'s area inside `frame`. */
export function fractionInside(r: Rect, frame: Rect): number {
  const area = r.w * r.h;
  return area > 0 ? overlapArea(r, frame) / area : 0;
}

/**
 * The subject of a shot: among birds at least partly inside the frame, the one
 * whose center is closest to the frame center. Null if none is in frame.
 */
export function pickSubject<T extends BirdInFrame>(frame: Rect, birds: readonly T[]): T | null {
  const c = center(frame);
  let best: T | null = null;
  let bestDist = Infinity;
  for (const bird of birds) {
    if (overlapArea(bird.bbox, frame) <= 0) continue;
    const b = center(bird.bbox);
    const d = Math.hypot(b.x - c.x, b.y - c.y);
    if (d < bestDist) {
      best = bird;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Framing factor. Takes the bird center's distance to the nearest of the frame
 * center and the four rule-of-thirds points, normalised by half the frame
 * diagonal (n = 0…1), and maps it through a cosine ease 0.5·(1 + cos πn): flat
 * and forgiving near a point, 0 at n ≥ 1. The result is multiplied by the
 * fraction of the bird's bbox inside the frame.
 */
export function framingFactor(frame: Rect, bbox: Rect): number {
  const halfDiag = Math.hypot(frame.w, frame.h) / 2;
  if (halfDiag <= 0) return 0;
  const b = center(bbox);
  const points = [
    center(frame),
    ...[1, 2].flatMap((i) =>
      [1, 2].map((j) => ({ x: frame.x + (frame.w * i) / 3, y: frame.y + (frame.h * j) / 3 })),
    ),
  ];
  const d = Math.min(...points.map((p) => Math.hypot(b.x - p.x, b.y - p.y)));
  const n = Math.min(1, d / halfDiag);
  return (0.5 * (1 + Math.cos(Math.PI * n))) * fractionInside(bbox, frame);
}

/**
 * Size factor from ratio = bbox area / frame area: 1 inside the species band
 * [min, max], falling linearly to 0 at min/2 and at 2·max.
 */
export function sizeFactor(ratio: number, sizeBand: readonly number[]): number {
  const [min, max] = sizeBand;
  if (!(min > 0) || !(max >= min)) return ratio > 0 ? 1 : 0;
  if (ratio < min) return clamp01((ratio - min / 2) / (min / 2));
  if (ratio > max) return clamp01((2 * max - ratio) / max);
  return 1;
}

/** Focus factor: full once the shutter was held for the lens focus time. */
export function focusFactor(heldMs: number, focusTimeMs: number): number {
  if (focusTimeMs <= 0) return 1;
  return clamp01(heldMs / focusTimeMs);
}

/** Pose factor from the species pose table (missing pose → 0.5). */
export function poseFactor(poses: Readonly<Record<string, number>>, pose: string): number {
  const v = poses[pose];
  return typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : DEFAULT_POSE_VALUE;
}

/** Sharpness factor: 1 up to the shutter threshold, 0 at 3× the threshold. */
export function sharpnessFactor(speed: number, threshold: number): number {
  if (speed <= threshold) return 1;
  if (threshold <= 0) return 0;
  return clamp01(1 - (speed - threshold) / ((SHARPNESS_ZERO_MULTIPLE - 1) * threshold));
}

export function ratingFor(score: number): PhotoRating {
  if (score >= RATING_THRESHOLDS.perfect) return 'perfect';
  if (score >= RATING_THRESHOLDS.great) return 'great';
  if (score >= RATING_THRESHOLDS.good) return 'good';
  return 'blurry';
}

export interface ShotInput {
  frame: Rect;
  /** The subject (see pickSubject). */
  bird: {
    bbox: Rect;
    pose: string;
    /** Screen speed in px/s at the moment of the shot. */
    speed: number;
  };
  species: Pick<Bird, 'sizeBand' | 'poses'>;
  /** How long focus was held before release. */
  heldMs: number;
  /** The lens' focus time. */
  focusTimeMs: number;
  /** The shutter's motion threshold in px/s. */
  shutterThreshold: number;
}

export interface ShotFactors {
  framing: number;
  size: number;
  focus: number;
  pose: number;
  sharpness: number;
}

export interface ShotResult {
  /** 0–100 integer. */
  score: number;
  rating: PhotoRating;
  /** Each factor 0–1, before weighting. */
  factors: ShotFactors;
}

/** Scores one shot of one bird (SPEC.md §5.3). */
export function scoreShot(input: ShotInput): ShotResult {
  const { frame, bird, species } = input;
  const frameArea = frame.w * frame.h;
  const ratio = frameArea > 0 ? (bird.bbox.w * bird.bbox.h) / frameArea : 0;
  const factors: ShotFactors = {
    framing: framingFactor(frame, bird.bbox),
    size: sizeFactor(ratio, species.sizeBand),
    focus: focusFactor(input.heldMs, input.focusTimeMs),
    pose: poseFactor(species.poses, bird.pose),
    sharpness: sharpnessFactor(bird.speed, input.shutterThreshold),
  };
  let total = 0;
  for (const k of Object.keys(WEIGHTS) as (keyof ShotFactors)[]) total += WEIGHTS[k] * factors[k];
  const score = Math.min(100, Math.max(0, Math.round(total)));
  return { score, rating: ratingFor(score), factors };
}

// --- Stealth (SPEC.md §5.4) ---

export const ALERT_MAX = 100;
/** Viewfinder speed (game px/s) above which birds start to notice. */
export const ALERT_SPEED_THRESHOLD = 160;
/** Alert gained per second per px/s of speed above the threshold (before skittishness). */
export const ALERT_SPEED_GAIN = 0.5;
/** Alert gained per shot (before skittishness). */
export const ALERT_SHOT_BUMP = 12;
/** Alert lost per second while nothing is raising it. */
export const ALERT_DECAY_PER_SEC = 8;
/** Skittishness multiplier is ALERT_SKITTISH_BASE + skittishness (0–1 → 0.5–1.5). */
export const ALERT_SKITTISH_BASE = 0.5;
/** O Boy's calming effect on rises (SPEC.md §7.2: 20% slower). */
export const OBOY_ALERT_SLOWDOWN = 0.8;

export interface AlertInput {
  dtMs: number;
  /** Viewfinder speed in game px/s this frame. */
  viewfinderSpeed: number;
  shotFired: boolean;
  /** Species skittishness 0–1 (the most skittish bird present). */
  skittishness: number;
  /** Multiplier on rises (e.g. OBOY_ALERT_SLOWDOWN); default 1. */
  slowdown?: number;
}

/**
 * Next alert value (0–100). Rises in proportion to the viewfinder's speed
 * above ALERT_SPEED_THRESHOLD and by ALERT_SHOT_BUMP per shot, both scaled by
 * skittishness and `slowdown`; otherwise decays by ALERT_DECAY_PER_SEC.
 */
export function updateAlert(alert: number, input: AlertInput): number {
  const dt = Math.max(0, input.dtMs) / 1000;
  const scale = (ALERT_SKITTISH_BASE + clamp01(input.skittishness)) * (input.slowdown ?? 1);
  const excess = Math.max(0, input.viewfinderSpeed - ALERT_SPEED_THRESHOLD);
  let rise = excess * ALERT_SPEED_GAIN * dt;
  if (input.shotFired) rise += ALERT_SHOT_BUMP;
  const next = rise > 0 ? alert + rise * scale : alert - ALERT_DECAY_PER_SEC * dt;
  return Math.min(ALERT_MAX, Math.max(0, next));
}

/** Birds flee once the meter is full. */
export function shouldFlee(alert: number): boolean {
  return alert >= ALERT_MAX;
}

// --- Album (SPEC.md §5.6) ---

export interface AlbumResult {
  /** First photo of this species. */
  newSpecies: boolean;
  /** The entry was stored (new species or a higher score than before). */
  newBest: boolean;
}

/**
 * Keeps the best shot per species in state.album (mutated). Blurry shots are
 * never saved. A tie with the existing best keeps the old entry.
 */
export function addToAlbum(state: GameState, entry: AlbumEntry): AlbumResult {
  if (entry.rating === 'blurry') return { newSpecies: false, newBest: false };
  const old = state.album[entry.species];
  if (old && old.score >= entry.score) return { newSpecies: false, newBest: false };
  state.album[entry.species] = { ...entry, companions: [...entry.companions] };
  return { newSpecies: !old, newBest: true };
}
