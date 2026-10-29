// Hidden collectibles (SPEC.md §4.5): feathers for the album, camera parts
// for Kei, and sheet music that students can learn. Pure: the map scene
// shows and picks them up.
import type { ContentBundle } from '../core/types.gen';
import type { GameState } from './state';

/** A collectible world object's properties: `item` (feather, camera_part) or `song` (sheet music). */
export interface CollectibleProps {
  item?: string;
  song?: string;
}

export const collectedFlag = (name: string) => `collected:${name}`;
export const sheetFlag = (song: string) => `sheet:${song}`;

export function isCollected(state: Pick<GameState, 'flags'>, name: string): boolean {
  return state.flags[collectedFlag(name)] === true;
}

/**
 * Picks up a collectible (once per save). Returns what Angie found, e.g.
 * "a Feather" or "sheet music: Harbour Lights", or null if it was already
 * taken or names nothing known. Mutates state.
 */
export function collect(
  state: Pick<GameState, 'flags' | 'items'>,
  name: string,
  props: CollectibleProps,
  content: Pick<ContentBundle, 'items' | 'songs'>,
): string | null {
  if (isCollected(state, name)) return null;
  let found: string | null = null;
  if (props.song) {
    const song = content.songs.find((s) => s.id === props.song);
    if (song) {
      state.flags[sheetFlag(song.id)] = true;
      found = `sheet music: ${song.title}`;
    }
  } else if (props.item) {
    const item = content.items.find((i) => i.id === props.item);
    if (item) {
      state.items[item.id] = (state.items[item.id] ?? 0) + 1;
      found = `a ${item.name}`;
    }
  }
  if (found) state.flags[collectedFlag(name)] = true;
  return found;
}

/** Song ids from found sheet music, in content order. */
export function sheetSongs(state: Pick<GameState, 'flags'>, content: Pick<ContentBundle, 'songs'>): string[] {
  return content.songs.filter((s) => state.flags[sheetFlag(s.id)]).map((s) => s.id);
}
