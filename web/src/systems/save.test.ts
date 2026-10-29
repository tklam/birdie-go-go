import { describe, expect, it } from 'vitest';
import type { ContentBundle } from '../core/types.gen';
import {
  CURRENT_SAVE_VERSION,
  deserialize,
  exportSave,
  importSave,
  MemorySaveStore,
  migrate,
  serialize,
  type Migration,
} from './save';
import { newGame, type GameState } from './state';
import { emptyContent } from '../test/content';

const content: ContentBundle = {
  ...emptyContent(),
  game: { title: 'T', contentVersion: '0', startMap: 'tko', startSpawn: 'estate_plaza' },
};

function sample(): GameState {
  const s = newGame(content, 1234);
  s.flags.prologue_arrived = true;
  s.firedEvents.prologue_arrival = true;
  s.items.lens_part = 2;
  s.party = ['oboy'];
  s.joined = ['oboy'];
  s.bond.oboy = 15;
  s.album.little_egret = {
    species: 'little_egret', score: 88, rating: 'great', day: 2, slot: 'afternoon',
    area: 'tko', spot: 'bay', companions: ['oboy'],
  };
  s.students.mei = { progress: 30, lessons: 2 };
  s.position = { map: 'tko', x: 100, y: 200 };
  return s;
}

describe('serialize / deserialize', () => {
  it('round-trips a game state', () => {
    const s = sample();
    expect(deserialize(serialize(s))).toEqual(s);
  });

  it('rejects garbage with a clear error', () => {
    expect(() => deserialize('not json')).toThrow('invalid save: not valid JSON');
    expect(() => deserialize('[]')).toThrow('invalid save: not an object');
    expect(() => deserialize('null')).toThrow('invalid save: not an object');
    expect(() => deserialize('{}')).toThrow(/saveVersion/);
  });

  it('rejects saves with a broken shape', () => {
    const broken = (patch: Record<string, unknown>) => JSON.stringify({ ...sample(), ...patch });
    expect(() => deserialize(broken({ money: 'lots' }))).toThrow('invalid save: money must be a number');
    expect(() => deserialize(broken({ flags: [] }))).toThrow('invalid save: flags must be an object');
    expect(() => deserialize(broken({ party: [1] }))).toThrow('invalid save: party must be a list of ids');
    expect(() => deserialize(broken({ slot: 'noon' }))).toThrow('invalid save: slot is unknown');
    expect(() => deserialize(broken({ position: {} }))).toThrow('invalid save: position.map must be a string');
  });

  it('rejects saves from a newer game version', () => {
    const json = JSON.stringify({ ...sample(), saveVersion: CURRENT_SAVE_VERSION + 1 });
    expect(() => deserialize(json)).toThrow(/newer than this game supports/);
  });

  it('fills missing settings with defaults', () => {
    const raw: Record<string, unknown> = { ...sample() };
    raw.settings = { musicVolume: 0.2 };
    const s = deserialize(JSON.stringify(raw));
    expect(s.settings.musicVolume).toBe(0.2);
    expect(s.settings.tapToMove).toBe(true);
    expect(s.settings.latencyOffsetMs).toBe(0);
  });
});

describe('migrate', () => {
  const migrations: Record<number, Migration> = {
    1: (s) => ({ ...s, saveVersion: 2, renamed: s.old, old: undefined }),
    2: (s) => ({ ...s, saveVersion: 3, extra: true }),
  };

  it('applies migrations in order up to the target', () => {
    expect(migrate({ saveVersion: 1, old: 'x' }, migrations, 3)).toEqual({
      saveVersion: 3, renamed: 'x', old: undefined, extra: true,
    });
    expect(migrate({ saveVersion: 2 }, migrations, 3)).toEqual({ saveVersion: 3, extra: true });
  });

  it('leaves current saves alone', () => {
    const s = { saveVersion: 3 };
    expect(migrate(s, migrations, 3)).toBe(s);
  });

  it('throws on a gap or a migration that forgets to bump the version', () => {
    expect(() => migrate({ saveVersion: 1 }, { 1: (s) => ({ ...s, saveVersion: 2 }) }, 3)).toThrow(
      'no save migration from version 2',
    );
    expect(() => migrate({ saveVersion: 1 }, { 1: (s) => s }, 2)).toThrow(/did not produce version 2/);
  });

  it('throws on a bad version', () => {
    expect(() => migrate({ saveVersion: 0 })).toThrow(/bad saveVersion/);
    expect(() => migrate({ saveVersion: 1.5 })).toThrow(/bad saveVersion/);
  });
});

describe('export / import', () => {
  it('writes a pretty file with a header and reads it back', () => {
    const s = sample();
    const text = exportSave(s, new Date('2026-10-29T12:00:00Z'));
    expect(text).toContain('\n  "game": "birdie-go-go"');
    const parsed = JSON.parse(text) as { game: string; exportedAt: string };
    expect(parsed.exportedAt).toBe('2026-10-29T12:00:00.000Z');
    expect(importSave(text)).toEqual(s);
  });

  it('rejects files that are not Birdie Go Go saves', () => {
    expect(() => importSave('???')).toThrow('invalid save file: not valid JSON');
    expect(() => importSave(JSON.stringify({ game: 'other', save: sample() }))).toThrow(/not a Birdie Go Go save/);
    expect(() => importSave(JSON.stringify(sample()))).toThrow(/not a Birdie Go Go save/);
    expect(() => importSave(JSON.stringify({ game: 'birdie-go-go', save: 3 }))).toThrow('invalid save: not an object');
  });
});

describe('MemorySaveStore', () => {
  it('saves, lists, loads and removes slots', async () => {
    const store = new MemorySaveStore();
    expect(await store.load('auto')).toBeNull();
    await store.save('slot2', sample());
    await store.save('auto', newGame(content, 1));
    expect(await store.list()).toEqual(['auto', 'slot2']);
    expect(await store.load('slot2')).toEqual(sample());
    await store.remove('slot2');
    expect(await store.list()).toEqual(['auto']);
    expect(await store.load('slot2')).toBeNull();
  });

  it('stores a snapshot, not a live reference', async () => {
    const store = new MemorySaveStore();
    const s = sample();
    await store.save('auto', s);
    s.money = 1;
    expect((await store.load('auto'))?.money).toBe(500);
  });
});

describe('save version 2 migration', () => {
  it('adds Energy, gear and active consumables to a version 1 save', () => {
    const v1 = { ...sample() } as Record<string, unknown>;
    v1.saveVersion = 1;
    delete v1.energy;
    delete v1.equipped;
    delete v1.active;
    delete v1.card;
    delete v1.stored;
    const state = deserialize(JSON.stringify(v1));
    expect(state.saveVersion).toBe(CURRENT_SAVE_VERSION);
    expect(state.energy).toBe(100);
    expect(state.equipped).toEqual({});
    expect(state.active).toEqual({});
  });
});

describe('save version 3 migration', () => {
  it('adds a transit card with a little on it', () => {
    const v2 = { ...sample() } as Record<string, unknown>;
    v2.saveVersion = 2;
    delete v2.card;
    delete v2.stored;
    const state = deserialize(JSON.stringify(v2));
    expect(state.saveVersion).toBe(CURRENT_SAVE_VERSION);
    expect(state.card).toBe(50);
  });
});

describe('save version 4 migration', () => {
  it('adds an empty cupboard', () => {
    const v3 = { ...sample() } as Record<string, unknown>;
    v3.saveVersion = 3;
    delete v3.stored;
    expect(deserialize(JSON.stringify(v3)).stored).toEqual({});
  });
});
