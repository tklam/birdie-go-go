import { CollisionLedgeSouth, CollisionOpen } from '../core/types.gen';

/** A collision box relative to an entity's feet position. */
export interface Box {
  /** Offset of the box's left/top edge from the position. */
  ox: number;
  oy: number;
  w: number;
  h: number;
}

/** Returns the collision code of a tile (see model.Collision*). */
export type CollisionLookup = (tx: number, ty: number) => number;

/**
 * Moves a position by (dx, dy) against the tile grid, one axis at a time so
 * the entity slides along walls. Ledges can only be crossed going down
 * (south). Returns the new position.
 */
export function move(
  pos: { x: number; y: number },
  dx: number,
  dy: number,
  box: Box,
  collisionAt: CollisionLookup,
  tileSize = 16,
): { x: number; y: number } {
  let { x, y } = pos;
  if (dx !== 0 && !blocked(x + dx, y, box, collisionAt, tileSize, 0)) x += dx;
  if (dy !== 0 && !blocked(x, y + dy, box, collisionAt, tileSize, dy)) y += dy;
  return { x, y };
}

function blocked(x: number, y: number, box: Box, collisionAt: CollisionLookup, tileSize: number, dy: number): boolean {
  const left = Math.floor((x + box.ox) / tileSize);
  const right = Math.floor((x + box.ox + box.w - 1e-6) / tileSize);
  const top = Math.floor((y + box.oy) / tileSize);
  const bottom = Math.floor((y + box.oy + box.h - 1e-6) / tileSize);
  for (let ty = top; ty <= bottom; ty++) {
    for (let tx = left; tx <= right; tx++) {
      const c = collisionAt(tx, ty);
      if (c === CollisionOpen) continue;
      if (c === CollisionLedgeSouth && dy > 0) continue;
      return true;
    }
  }
  return false;
}
