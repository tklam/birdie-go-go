// Save storage, versioning and export/import (SPEC.md §9.8). Saves are kept
// as serialized JSON strings so every load goes through the same migration
// and validation path, whatever the store.
import { CURRENT_SAVE_VERSION, defaultSettings, type GameState } from './state';

export { CURRENT_SAVE_VERSION };

export const EXPORT_GAME_ID = 'birdie-go-go';

type RawSave = Record<string, unknown>;

/** Upgrades a raw save of version v to version v + 1 (it must set saveVersion). */
export type Migration = (save: RawSave) => RawSave;

/**
 * Migrations keyed by the version they upgrade *from*. Add an entry here
 * whenever CURRENT_SAVE_VERSION is bumped.
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // v2 adds Energy, worn gear and active consumables (SPEC.md §4.12).
  1: (save) => ({ ...save, saveVersion: 2, energy: 100, equipped: {}, active: {} }),
  // v3 adds the transit card balance (SPEC.md §4.11), starting with a little on it.
  2: (save) => ({ ...save, saveVersion: 3, card: 50 }),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Applies migrations in order until the save reaches `target`. Throws for
 * a newer save, a bad version or a missing migration step.
 */
export function migrate(
  save: RawSave,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  target: number = CURRENT_SAVE_VERSION,
): RawSave {
  const start = save.saveVersion;
  if (typeof start !== 'number' || !Number.isInteger(start) || start < 1) {
    throw new Error(`invalid save: bad saveVersion ${JSON.stringify(start)}`);
  }
  let version: number = start;
  if (version > target) {
    throw new Error(`save version ${version} is newer than this game supports (${target}); please update the game`);
  }
  let out = save;
  while (version < target) {
    const step = migrations[version];
    if (!step) throw new Error(`no save migration from version ${version}`);
    out = step(out);
    if (out.saveVersion !== version + 1) {
      throw new Error(`save migration from version ${version} did not produce version ${version + 1}`);
    }
    version += 1;
  }
  return out;
}

const RECORD_FIELDS = ['flags', 'firedEvents', 'items', 'album', 'students', 'bond', 'equipped', 'active'] as const;
const NUMBER_FIELDS = ['worldSeed', 'chapter', 'day', 'money', 'energy', 'card'] as const;
const ARRAY_FIELDS = ['party', 'joined'] as const;

/** Checks the basic shape of a (migrated) save; throws a clear Error otherwise. */
function validate(save: RawSave): GameState {
  const fail = (what: string): never => {
    throw new Error(`invalid save: ${what}`);
  };
  for (const k of NUMBER_FIELDS) {
    if (typeof save[k] !== 'number' || !Number.isFinite(save[k])) fail(`${k} must be a number`);
  }
  for (const k of RECORD_FIELDS) if (!isRecord(save[k])) fail(`${k} must be an object`);
  for (const k of ARRAY_FIELDS) {
    const v = save[k];
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) fail(`${k} must be a list of ids`);
  }
  if (!['morning', 'afternoon', 'evening'].includes(save.slot as string)) fail('slot is unknown');
  if (typeof save.keiStage !== 'string') fail('keiStage must be a string');
  const pos = save.position;
  if (!isRecord(pos) || typeof pos.map !== 'string') fail('position.map must be a string');
  // Settings added later or partially missing fall back to defaults.
  const settings = isRecord(save.settings) ? save.settings : {};
  return { ...save, settings: { ...defaultSettings(), ...settings } } as unknown as GameState;
}

/** Validates and migrates an already-parsed save object. */
export function fromRaw(raw: unknown): GameState {
  if (!isRecord(raw)) throw new Error('invalid save: not an object');
  return validate(migrate(raw));
}

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

/** Parses, migrates and validates a save. Throws a clear Error on garbage or a newer version. */
export function deserialize(json: string): GameState {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('invalid save: not valid JSON');
  }
  return fromRaw(raw);
}

/** A pretty-printed backup file for Settings → Export. */
export function exportSave(state: GameState, now: Date = new Date()): string {
  return JSON.stringify({ game: EXPORT_GAME_ID, exportedAt: now.toISOString(), save: state }, null, 2);
}

/** Reads a file written by exportSave. */
export function importSave(text: string): GameState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('invalid save file: not valid JSON');
  }
  if (!isRecord(raw) || raw.game !== EXPORT_GAME_ID) {
    throw new Error('invalid save file: not a Birdie Go Go save');
  }
  return fromRaw(raw.save);
}

/** Where saves live. Slots are free-form names (e.g. "auto", "slot1"). */
export interface SaveStore {
  load(slot: string): Promise<GameState | null>;
  save(slot: string, state: GameState): Promise<void>;
  list(): Promise<string[]>;
  remove(slot: string): Promise<void>;
}

/** In-memory store for tests and as a fallback when IndexedDB is unavailable. */
export class MemorySaveStore implements SaveStore {
  private readonly data = new Map<string, string>();

  async load(slot: string): Promise<GameState | null> {
    const json = this.data.get(slot);
    return json === undefined ? null : deserialize(json);
  }

  async save(slot: string, state: GameState): Promise<void> {
    this.data.set(slot, serialize(state));
  }

  async list(): Promise<string[]> {
    return [...this.data.keys()].sort();
  }

  async remove(slot: string): Promise<void> {
    this.data.delete(slot);
  }
}

export const DB_NAME = 'birdie-go-go';
export const DB_STORE = 'saves';
const DB_VERSION = 1;

/** Runs one request in its own transaction; resolves once the transaction completes. */
function inTransaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, mode);
    const req = run(tx.objectStore(DB_STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** Saves in the browser's IndexedDB (db 'birdie-go-go', object store 'saves', key = slot). */
export class IndexedDBSaveStore implements SaveStore {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory | undefined = globalThis.indexedDB) {}

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise<IDBDatabase>((resolve, reject) => {
        if (!this.factory) throw new Error('IndexedDB is not available in this browser');
        const req = this.factory.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('could not open IndexedDB'));
        req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
      }).catch((err: unknown) => {
        this.db = null; // allow a retry later
        throw new Error(`save storage unavailable: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
      });
    }
    return this.db;
  }

  private async request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    try {
      return await inTransaction(db, mode, run);
    } catch (err) {
      throw new Error(`save storage error: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
  }

  async load(slot: string): Promise<GameState | null> {
    const value: unknown = await this.request('readonly', (s) => s.get(slot));
    return typeof value === 'string' ? deserialize(value) : null;
  }

  async save(slot: string, state: GameState): Promise<void> {
    await this.request('readwrite', (s) => s.put(serialize(state), slot));
  }

  async list(): Promise<string[]> {
    const keys = await this.request('readonly', (s) => s.getAllKeys());
    return keys.map(String).sort();
  }

  async remove(slot: string): Promise<void> {
    await this.request('readwrite', (s) => s.delete(slot));
  }
}
