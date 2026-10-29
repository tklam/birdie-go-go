import type { ContentBundle } from '../core/types.gen';

/**
 * An empty content bundle for tests; spread it and override what a test
 * needs, so adding a content type only touches this file.
 */
export function emptyContent(overrides: Partial<ContentBundle> = {}): ContentBundle {
  return {
    game: { title: 'Test', contentVersion: '0.0.0', startMap: 'world', startSpawn: 'start' },
    areas: [],
    birds: [],
    spots: [],
    students: [],
    songs: [],
    events: [],
    dialogue: [],
    music: [],
    items: [],
    hazards: [],
    enemies: [],
    missions: [],
    ambient: [],
    transit: { lines: [], stops: [] },
    ...overrides,
  };
}
