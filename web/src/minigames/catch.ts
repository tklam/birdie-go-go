// The catch mini game's rules (pure, SPEC.md §4.14): things fall from the
// top; the basket along the bottom catches them. Wanted icons score, avoided
// ones cost a point. Spawns come from a seeded random source.
import { rng } from '../encounter/random';

/** The play field in game pixels (the 320×180 screen). */
export const FIELD = { left: 12, right: 308, top: 24 };
/** The basket's centre line and half width. */
export const BASKET_Y = 160;
export const BASKET_HALF = 14;
/** An item's radius (16×16 icons, a little forgiving). */
export const ITEM_R = 7;
/** Items below this are gone (missed). */
export const FLOOR_Y = 184;
/** The share of avoided items when there are any. */
export const AVOID_SHARE = 0.3;
/** Keyboard basket speed, px/s. */
export const BASKET_SPEED = 160;

export interface CatchConfig {
  icons: readonly string[];
  avoid: readonly string[];
  /** Score that wins. */
  target: number;
  /** Time limit in seconds (0 = none: play until the target). */
  seconds: number;
  /** 1, or 1.5 with Slow prompts: things fall slower and less often. */
  slower: number;
  seed: number;
}

export interface Falling {
  id: number;
  icon: string;
  good: boolean;
  x: number;
  y: number;
  /** px/s. */
  speed: number;
}

export interface CatchState {
  t: number;
  /** Net score: catches minus avoided things caught (never below 0). */
  score: number;
  caught: number;
  bad: number;
  basketX: number;
  items: Falling[];
  nextSpawn: number;
  nextId: number;
  random: () => number;
}

export interface CatchStep {
  caught: Falling[];
  bad: Falling[];
  missed: Falling[];
  spawned: Falling[];
}

export function startCatch(cfg: CatchConfig): CatchState {
  return { t: 0, score: 0, caught: 0, bad: 0, basketX: 160, items: [], nextSpawn: 0.6, nextId: 1, random: rng(cfg.seed) };
}

/** Fall speed at time t, px/s: rises gently, slower with Slow prompts. */
export function fallSpeed(t: number, slower: number): number {
  return (36 + Math.min(t, 60) * 0.9) / slower;
}

/** Seconds between spawns at time t: shrinks gently to a floor. */
export function spawnGap(t: number, slower: number): number {
  return Math.max(0.5, 1.1 - Math.min(t, 60) * 0.012) * slower;
}

/** Whether the basket at x catches the item (it overlaps the basket's mouth). */
export function basketHits(basketX: number, item: Pick<Falling, 'x' | 'y'>): boolean {
  return Math.abs(item.x - basketX) <= BASKET_HALF + ITEM_R - 2 && item.y + ITEM_R >= BASKET_Y - 4 && item.y - ITEM_R <= BASKET_Y + 4;
}

/** Keeps the basket on the field. */
export function clampBasket(x: number): number {
  return Math.min(FIELD.right - BASKET_HALF, Math.max(FIELD.left + BASKET_HALF, x));
}

function spawn(state: CatchState, cfg: CatchConfig): Falling | null {
  const r = state.random;
  const bad = cfg.avoid.length > 0 && (cfg.icons.length === 0 || r() < AVOID_SHARE);
  const pool = bad ? cfg.avoid : cfg.icons;
  if (pool.length === 0) return null;
  const icon = pool[Math.floor(r() * pool.length) % pool.length];
  const x = Math.round(FIELD.left + ITEM_R + r() * (FIELD.right - FIELD.left - 2 * ITEM_R));
  const speed = fallSpeed(state.t, cfg.slower) * (0.85 + r() * 0.3);
  return { id: state.nextId++, icon, good: !bad, x, y: FIELD.top - ITEM_R, speed };
}

/**
 * Advances the game by dt seconds with the basket at basketX: spawns,
 * moves and resolves items. Mutates state; returns what happened.
 */
export function stepCatch(state: CatchState, cfg: CatchConfig, dt: number, basketX: number): CatchStep {
  const out: CatchStep = { caught: [], bad: [], missed: [], spawned: [] };
  state.basketX = clampBasket(basketX);
  state.t += dt;
  while (state.t >= state.nextSpawn) {
    const it = spawn(state, cfg);
    if (it) {
      state.items.push(it);
      out.spawned.push(it);
    }
    state.nextSpawn += spawnGap(state.nextSpawn, cfg.slower);
  }
  const keep: Falling[] = [];
  for (const it of state.items) {
    it.y += it.speed * dt;
    if (basketHits(state.basketX, it)) {
      if (it.good) {
        state.caught++;
        state.score++;
        out.caught.push(it);
      } else {
        state.bad++;
        state.score = Math.max(0, state.score - 1);
        out.bad.push(it);
      }
    } else if (it.y - ITEM_R > FLOOR_Y) out.missed.push(it);
    else keep.push(it);
  }
  state.items = keep;
  return out;
}

/** Seconds left (Infinity without a limit). */
export function timeLeft(state: CatchState, cfg: CatchConfig): number {
  return cfg.seconds > 0 ? Math.max(0, cfg.seconds - state.t) : Infinity;
}

/** Whether the round is over: the target reached, or the time up. */
export function catchOver(state: CatchState, cfg: CatchConfig): { over: boolean; won: boolean } {
  const won = state.score >= Math.max(1, cfg.target);
  return { over: won || timeLeft(state, cfg) <= 0, won };
}
