// Deterministic randomness for encounters (AGENTS.md rule 9).

/** A seeded random source in [0, 1) (mulberry32). */
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

/** FNV-1a hash of a string (uint32). */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The seed of one encounter: the same world, day and enemy give the same rolls. */
export function encounterSeed(worldSeed: number, day: number, enemyId: string, salt = ''): number {
  return hashString(`${worldSeed >>> 0}:${day}:${enemyId}:${salt}`);
}
