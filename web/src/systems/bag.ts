// The bag and the cupboard at home (SPEC.md §4.12): bought supplies (priced
// consumables) take bag space; the rest of Angie's things don't. Pure.
import type { Item } from '../core/types.gen';
import type { GameState } from './state';

type Bag = Pick<GameState, 'items' | 'stored'>;

/** Whether an item takes a place in the bag (bought consumables do). */
export function takesSpace(item: Pick<Item, 'kind' | 'price'>): boolean {
  return item.kind === 'consumable' && item.price > 0;
}

/** Bag places in use. */
export function bagUsed(items: GameState['items'], catalog: readonly Item[]): number {
  return catalog.filter(takesSpace).reduce((n, it) => n + (items[it.id] ?? 0), 0);
}

function move(from: Record<string, number>, to: Record<string, number>, id: string): void {
  from[id] -= 1;
  if (from[id] <= 0) delete from[id];
  to[id] = (to[id] ?? 0) + 1;
}

/** Puts a bought item in the bag, or sends it home when the bag is full. Mutates state. */
export function stow(state: Bag, item: Item, capacity: number, catalog: readonly Item[]): 'bag' | 'home' {
  if (takesSpace(item) && capacity > 0 && bagUsed(state.items, catalog) >= capacity) {
    state.stored[item.id] = (state.stored[item.id] ?? 0) + 1;
    return 'home';
  }
  state.items[item.id] = (state.items[item.id] ?? 0) + 1;
  return 'bag';
}

/** Packs one from the cupboard into the bag; false if none is home or the bag is full. Mutates state. */
export function pack(state: Bag, item: Item, capacity: number, catalog: readonly Item[]): boolean {
  if (!((state.stored[item.id] ?? 0) > 0)) return false;
  if (takesSpace(item) && capacity > 0 && bagUsed(state.items, catalog) >= capacity) return false;
  move(state.stored, state.items, item.id);
  return true;
}

/** Leaves one in the cupboard; false if the bag has none. Mutates state. */
export function unpack(state: Bag, item: Item): boolean {
  if (!((state.items[item.id] ?? 0) > 0)) return false;
  move(state.items, state.stored, item.id);
  return true;
}
