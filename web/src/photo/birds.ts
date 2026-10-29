import type { Bird, Spot, SpotBird } from '../core/types.gen';
import type { GameState, Season, TimeSlot } from '../systems/state';

/** A deterministic random source (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bird-table entries available now (slot, season, flags; weight > 0). */
export function available(spot: Spot, ctx: { slot: TimeSlot; season: Season; flags: GameState['flags']; weather?: string }): SpotBird[] {
  return spot.birds.filter(
    (b) =>
      b.weight > 0 &&
      (!b.slots?.length || b.slots.includes(ctx.slot)) &&
      (!b.seasons?.length || b.seasons.includes(ctx.season)) &&
      (!b.requiresFlag || ctx.flags[b.requiresFlag] === true) &&
      (!b.unlessFlag || ctx.flags[b.unlessFlag] !== true) &&
      (!b.weather?.length || (!!ctx.weather && b.weather.includes(ctx.weather))),
  );
}

const SHELTER: Record<string, number> = { rain: 1, rainstorm: 2, thunderstorm: 2, typhoon: 2 };

/** Birds shelter from rain: fewer visitors in rain (1 fewer) and storms (2 fewer). */
export function shelterPenalty(weather: string | undefined): number {
  return SHELTER[weather ?? ''] ?? 0;
}

/**
 * The session's visitors: `count` species by weight, plus one of each
 * `always` entry (story birds), which arrives second so it isn't first in.
 */
export function visitors(table: SpotBird[], count: number, random: () => number): string[] {
  const out = pickSpecies(table, count, random);
  for (const b of table) {
    if (b.always && !out.includes(b.species)) out.splice(Math.min(1, out.length), 0, b.species);
  }
  return out;
}

/** Picks `count` species ids by weight (with replacement). */
export function pickSpecies(table: SpotBird[], count: number, random: () => number): string[] {
  const total = table.reduce((s, b) => s + b.weight, 0);
  if (total <= 0) return [];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let r = random() * total;
    for (const b of table) {
      r -= b.weight;
      if (r < 0) {
        out.push(b.species);
        break;
      }
    }
    if (out.length <= i) out.push(table[table.length - 1].species);
  }
  return out;
}

export type Pose = 'perched' | 'perched_alert' | 'wings_spread' | 'flying1' | 'flying2' | 'back_turned';

/** Where a bird can land: perches, or the ground band for waders/foragers. */
export function landingSpots(
  bird: Pick<Bird, 'behaviors'>,
  perches: [number, number][],
  ground: [number, number] | undefined,
  random: () => number,
  groundX: [number, number] = [20, 300],
): [number, number] {
  const groundy = bird.behaviors.includes('wade') || bird.behaviors.includes('forage');
  if (ground && ground[1] > ground[0] && (groundy && (perches.length === 0 || random() < 0.7))) {
    return [Math.round(groundX[0] + random() * (groundX[1] - groundX[0])), Math.round(ground[0] + random() * (ground[1] - ground[0]))];
  }
  if (perches.length === 0) return [160, 120];
  return perches[Math.floor(random() * perches.length)];
}

/** The next idle pose while perched (mostly calm, sometimes alert/display). */
export function idlePose(random: () => number, alert: number): Pose {
  const r = random();
  if (alert > 50 && r < 0.6) return 'perched_alert';
  if (r < 0.55) return 'perched';
  if (r < 0.8) return 'perched_alert';
  if (r < 0.9) return 'back_turned';
  return 'wings_spread';
}

/**
 * The O Boy + Kei combo (SPEC.md §7.2): a species from the table that isn't
 * coming this session, preferring ones missing from the album; null if none.
 */
export function hiddenBird(table: SpotBird[], coming: readonly string[], album: Readonly<Record<string, unknown>>, random: () => number): string | null {
  const absent = table.filter((b) => !coming.includes(b.species) && !b.always);
  const fresh = absent.filter((b) => !album[b.species]);
  const pool = fresh.length ? fresh : absent;
  return pool.length ? pickSpecies(pool, 1, random)[0] ?? null : null;
}
