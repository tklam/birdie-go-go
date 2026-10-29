// Gear-gated paths (SPEC.md §4.6). Pure: the map scene keeps the gates of
// loaded chunks and asks here whether a tile is closed to Angie.
import type { Spot, WorldObject } from '../core/types.gen';
import type { GameState } from './state';

/** A rectangle of tiles that only opens with an item. */
export interface Gate {
  /** Top-left tile and size in tiles. */
  tx: number;
  ty: number;
  w: number;
  h: number;
  requires: string;
  hint: string;
}

/** A `gate` world object (its point is the top-left tile's centre; props requires, w, h, hint). */
export function gateFrom(o: Pick<WorldObject, 'x' | 'y' | 'props'>, tileSize: number): Gate | null {
  const requires = o.props.requires;
  if (!requires) return null;
  return {
    tx: Math.floor(o.x / tileSize),
    ty: Math.floor(o.y / tileSize),
    w: Math.max(1, Number(o.props.w) || 1),
    h: Math.max(1, Number(o.props.h) || 1),
    requires,
    hint: o.props.hint ?? '',
  };
}

/** The gate closed to Angie at a tile (she doesn't own its item), if any. */
export function closedGateAt(gates: readonly Gate[], tx: number, ty: number, items: GameState['items']): Gate | null {
  for (const g of gates) {
    if (tx >= g.tx && tx < g.tx + g.w && ty >= g.ty && ty < g.ty + g.h && !((items[g.requires] ?? 0) > 0)) return g;
  }
  return null;
}

/** Why a spot can't be used now ("needs" an item or "closed" at this time), or null. */
export function spotBlocked(spot: Pick<Spot, 'requiresItem' | 'slots'>, state: Pick<GameState, 'items' | 'slot'>): 'needs' | 'closed' | null {
  if (spot.requiresItem && !((state.items[spot.requiresItem] ?? 0) > 0)) return 'needs';
  if (spot.slots?.length && !spot.slots.includes(state.slot)) return 'closed';
  return null;
}
