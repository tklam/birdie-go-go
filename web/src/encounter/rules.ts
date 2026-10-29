// Encounter rules (SPEC.md §4.13): resolve, Energy, items, drops, outcomes.
// Pure; mutating helpers say so.
import type { Enemy, Item } from '../core/types.gen';
import type { GameState } from '../systems/state';
import { clamp01 } from './combo';
import { rng } from './random';

export type Outcome = 'won' | 'escaped' | 'lost' | 'skipped';

/** What the encounter hands back to the map (registry 'lastEncounter'). */
export interface EncounterResult {
  enemyId: string;
  outcome: Outcome;
  /** Total Energy lost to the enemy (before any snacks). */
  energyLost: number;
  /** Item ids added to state.items (won monsters only). */
  drops: string[];
}

/** Resolve taken by one successful combo. */
export const COMBO_RESOLVE_HIT: readonly [number, number] = [15, 25];
/** Being caught this many times ends the encounter as 'lost'. */
export const MAX_CATCHES = 2;

export function isDog(enemy: Pick<Enemy, 'kind'>): boolean {
  return enemy.kind === 'dog';
}

/**
 * Resolve removed by a completed combo: 15 for the shortest combo of the
 * enemy, 25 for its longest, plus up to 20% for finishing fast.
 */
export function comboResolveHit(enemy: Pick<Enemy, 'comboLength'>, length: number, timeLeftFraction = 0): number {
  const [l0, l1] = [enemy.comboLength[0] ?? 1, enemy.comboLength[1] ?? enemy.comboLength[0] ?? 1];
  const t = l1 > l0 ? clamp01((length - l0) / (l1 - l0)) : 0;
  const [lo, hi] = COMBO_RESOLVE_HIT;
  return Math.round((lo + (hi - lo) * t) * (1 + 0.2 * clamp01(timeLeftFraction)));
}

export function applyResolveHit(resolve: number, hit: number): number {
  return Math.max(0, resolve - Math.max(0, hit));
}

/** The weakness item halves the remaining resolve (rounded down). */
export function halveResolve(resolve: number): number {
  return Math.floor(Math.max(0, resolve) / 2);
}

/** Energy lost to the enemy. Mutates state; returns the amount actually lost. */
export function takeDamage(state: Pick<GameState, 'energy'>, damage: number): number {
  const lost = Math.min(state.energy, Math.max(0, damage));
  state.energy -= lost;
  return lost;
}

/** Energy cost of the "Skip encounter" accessibility option: half damage. */
export function skipCost(enemy: Pick<Enemy, 'damage'>): number {
  return Math.ceil(enemy.damage / 2);
}

export type ItemEffect = 'weakness' | 'treat' | 'restore';

export interface UsableItem {
  item: Item;
  count: number;
  effect: ItemEffect;
}

/**
 * Consumables Angie can use in this encounter: the enemy's weakness (once),
 * a dog treat against a dog (instant escape) and Energy-restoring snacks.
 */
export function usableItems(
  enemy: Pick<Enemy, 'kind' | 'weakness'>,
  owned: Readonly<Record<string, number>>,
  items: readonly Item[],
  weaknessUsed: boolean,
): UsableItem[] {
  const out: UsableItem[] = [];
  for (const item of items) {
    const count = owned[item.id] ?? 0;
    if (count <= 0 || item.kind !== 'consumable') continue;
    const effect = itemEffect(enemy, item, weaknessUsed);
    if (effect) out.push({ item, count, effect });
  }
  return out;
}

export function itemEffect(enemy: Pick<Enemy, 'kind' | 'weakness'>, item: Item, weaknessUsed: boolean): ItemEffect | null {
  if (item.id === 'dog_treat' && isDog(enemy)) return 'treat';
  if (enemy.weakness && item.id === enemy.weakness && !weaknessUsed) return 'weakness';
  if ((item.restores ?? 0) > 0) return 'restore';
  return null;
}

/** Rolls a monster's drops deterministically from a seed. */
export function rollDrops(enemy: Pick<Enemy, 'drops'>, seed: number): string[] {
  const random = rng(seed);
  return (enemy.drops ?? []).filter((d) => random() < d.chance).map((d) => d.item);
}

/** Adds item ids to the inventory. Mutates state. */
export function addItems(state: Pick<GameState, 'items'>, ids: readonly string[]): void {
  for (const id of ids) state.items[id] = (state.items[id] ?? 0) + 1;
}

/** "Stray Dogs block the way!" / "Hopping Zombie blocks the way!" */
export function introLine(enemy: Pick<Enemy, 'name'>): string {
  const plural = /s$/i.test(enemy.name);
  return `${enemy.name} ${plural ? 'block' : 'blocks'} the way!`;
}

const DOG_SUCCESS = ['Stand tall!', 'Stomp!', 'Open umbrella!', 'Shout "Go home!"', 'Stay calm...', 'Arms wide!'];
const MONSTER_SUCCESS = ['Hold your breath!', 'Flash!', 'Stand firm!', 'Dodge and push!', 'Clap it away!'];

/** Flavor text for a successful combo; dogs are only ever driven off. */
export function successText(enemy: Pick<Enemy, 'kind'>, random: () => number): string {
  const list = isDog(enemy) ? DOG_SUCCESS : MONSTER_SUCCESS;
  return list[Math.floor(random() * list.length)];
}

/** Result panel title and lines for an outcome. Lines stay ≤ 38 chars. */
export function resultText(
  enemy: Pick<Enemy, 'kind' | 'name'>,
  r: Pick<EncounterResult, 'outcome' | 'energyLost' | 'drops'>,
  itemName: (id: string) => string,
): { title: string; lines: string[] } {
  const plural = /s$/i.test(enemy.name);
  const lines: string[] = [];
  let title: string;
  switch (r.outcome) {
    case 'won':
      title = isDog(enemy) ? 'They backed off!' : 'Victory!';
      lines.push(
        isDog(enemy)
          ? `${enemy.name} ${plural ? 'back' : 'backs'} off and trot${plural ? '' : 's'} away.`
          : `${enemy.name} was defeated.`,
      );
      if (!isDog(enemy)) lines.push('It dissipates into the air.');
      break;
    case 'escaped':
      title = 'Got away!';
      lines.push(`You lost ${enemy.name}.`);
      break;
    case 'skipped':
      title = 'Slipped past';
      lines.push(`You slipped past ${enemy.name}.`);
      break;
    case 'lost':
      title = 'Too tired...';
      lines.push('Angie has to get away and rest.');
      break;
  }
  if (r.energyLost > 0) lines.push(`Energy -${r.energyLost}`);
  for (const id of r.drops) lines.push(`Found: ${itemName(id)}`);
  return { title, lines };
}
