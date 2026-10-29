// Kei's workshop and gadgets (SPEC.md §7.2). Pure; the map scene shows the menus.
import type { ContentBundle, Item } from '../core/types.gen';
import { available, pickSpecies, rng } from '../photo/birds';
import { addToAlbum, ratingFor } from './photoScore';
import { KEI_STAGES, season, type GameState } from './state';

export const CAMERA_PART = 'camera_part';
export const TRAIL_CAMERA = 'trail_camera';
export const trailCamFlag = (spotId: string) => `trailcam:${spotId}`;

/** Why Kei can or can't build an item right now. */
export function buildStatus(state: GameState, item: Item): 'ok' | 'stage' | 'parts' | 'owned' | 'not-buildable' {
  if (!item.build) return 'not-buildable';
  if (KEI_STAGES.indexOf(state.keiStage) < KEI_STAGES.indexOf(item.build.keiStage as GameState['keiStage'])) return 'stage';
  // Mods are one-offs; trail cameras can be built again.
  if (item.id !== TRAIL_CAMERA && (state.items[item.id] ?? 0) > 0) return 'owned';
  if ((state.items[CAMERA_PART] ?? 0) < item.build.parts) return 'parts';
  return 'ok';
}

/** Kei builds the item from camera parts. Mutates state. */
export function build(state: GameState, item: Item): boolean {
  if (buildStatus(state, item) !== 'ok' || !item.build) return false;
  state.items[CAMERA_PART] -= item.build.parts;
  if (state.items[CAMERA_PART] <= 0) delete state.items[CAMERA_PART];
  state.items[item.id] = (state.items[item.id] ?? 0) + 1;
  return true;
}

/** Leaves a trail camera at a spot (one per spot). Mutates state. */
export function placeTrailCamera(state: GameState, spotId: string): boolean {
  if ((state.items[TRAIL_CAMERA] ?? 0) <= 0 || state.flags[trailCamFlag(spotId)]) return false;
  state.items[TRAIL_CAMERA] -= 1;
  if (state.items[TRAIL_CAMERA] <= 0) delete state.items[TRAIL_CAMERA];
  state.flags[trailCamFlag(spotId)] = true;
  return true;
}

export interface TrailCatch {
  spot: string;
  species: string;
  score: number;
  isNew: boolean;
}

/**
 * Each placed trail camera photographs one bird from its spot's morning
 * table, with a decent but rarely perfect score, deterministically per day.
 * Adds the shots to the album. Mutates state.
 */
export function runTrailCameras(state: GameState, content: Pick<ContentBundle, 'spots'>): TrailCatch[] {
  const out: TrailCatch[] = [];
  for (const spot of content.spots) {
    if (!state.flags[trailCamFlag(spot.id)]) continue;
    const random = rng((state.worldSeed ^ (state.day * 2654435761) ^ spot.id.length * 97) >>> 0);
    const table = available(spot, { slot: 'morning', season: season(state.day), flags: state.flags });
    const [species] = pickSpecies(table, 1, random);
    if (!species) continue;
    const score = Math.round(55 + random() * 37); // trail cameras are good, not great artists
    const result = addToAlbum(state, {
      species,
      score,
      rating: ratingFor(score),
      day: state.day,
      slot: 'morning',
      area: spot.area,
      spot: spot.id,
      companions: [],
    });
    out.push({ spot: spot.id, species, score, isNew: result.newSpecies });
  }
  return out;
}
