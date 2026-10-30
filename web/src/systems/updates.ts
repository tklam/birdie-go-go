// Content updates from the optional server (SPEC.md §9.6). The game never
// depends on the server: packs are fetched in the background, verified
// (SHA-256), validated by the Go core, stored on the device and merged over
// the base content at the next start.
import type { CoreClient } from '../core/client';
import type { ContentBundle, ContentValidateResult, UpdateManifest } from '../core/types.gen';

/** This client's version, compared with a pack's minClient. */
export const CLIENT_VERSION = '0.1.0';

export interface Pack {
  id: string;
  version: string;
  minClient: string;
  content: Partial<ContentBundle>;
}

/** Compares MAJOR.MINOR.PATCH versions: negative if a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

type Listed = { [K in keyof ContentBundle]: ContentBundle[K] extends readonly { id: string }[] ? K : never }[keyof ContentBundle];

const LISTS: Listed[] = ['areas', 'birds', 'spots', 'students', 'songs', 'events', 'dialogue', 'music', 'items', 'hazards', 'enemies', 'missions', 'ambient'];

function byId<T extends { id: string }>(base: readonly T[], extra: readonly T[] | undefined): T[] {
  if (!extra?.length) return [...base];
  const out = [...base];
  for (const item of extra) {
    const i = out.findIndex((x) => x.id === item.id);
    if (i >= 0) out[i] = item;
    else out.push(item);
  }
  return out;
}

/** Merges a pack over content: entries with the same id are replaced, new ones added. */
export function mergeContent(base: ContentBundle, pack: Partial<ContentBundle>): ContentBundle {
  const out: ContentBundle = { ...base };
  for (const key of LISTS) {
    (out[key] as { id: string }[]) = byId(base[key] as { id: string }[], pack[key] as { id: string }[] | undefined);
  }
  out.transit = {
    lines: byId(base.transit.lines, pack.transit?.lines),
    stops: byId(base.transit.stops, pack.transit?.stops),
  };
  out.sounds = {
    cues: byId(base.sounds.cues, pack.sounds?.cues),
    soundscapes: byId(base.sounds.soundscapes, pack.sounds?.soundscapes),
  };
  if (pack.game?.contentVersion) out.game = { ...base.game, contentVersion: pack.game.contentVersion };
  return out;
}

/** Hex SHA-256 of bytes (Web Crypto). */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Where installed packs live on the device. */
export interface PackStore {
  all(): Promise<Pack[]>;
  put(pack: Pack): Promise<void>;
}

/** IndexedDB-backed pack storage (its own database, separate from saves). */
export class IndexedDBPackStore implements PackStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('birdie-go-go-packs', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('packs', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('pack storage unavailable'));
    });
    return this.db;
  }

  async all(): Promise<Pack[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction('packs').objectStore('packs').getAll();
      req.onsuccess = () => resolve(req.result as Pack[]);
      req.onerror = () => reject(req.error ?? new Error('pack read failed'));
    });
  }

  async put(pack: Pack): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('packs', 'readwrite');
      tx.objectStore('packs').put(pack);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('pack write failed'));
    });
  }
}

/** Base content with installed packs merged on top (packs in id order), if the result is valid. */
export async function applyPacks(base: ContentBundle, store: PackStore, core: CoreClient): Promise<{ content: ContentBundle; applied: string[] }> {
  let packs: Pack[];
  try {
    packs = (await store.all()).filter((p) => compareVersions(CLIENT_VERSION, p.minClient) >= 0);
  } catch {
    return { content: base, applied: [] };
  }
  if (packs.length === 0) return { content: base, applied: [] };
  packs.sort((a, b) => a.id.localeCompare(b.id));
  const merged = packs.reduce((c, p) => mergeContent(c, p.content), base);
  const result = await core.call<ContentValidateResult>('content.validate', merged);
  if (result.errors.length) {
    console.warn('installed content packs are invalid together; using the base content', result.errors);
    return { content: base, applied: [] };
  }
  return { content: merged, applied: packs.map((p) => `${p.id} ${p.version}`) };
}

/**
 * Checks the server for newer packs and installs them (verified and
 * validated). Returns the ids installed. Never throws: offline is normal.
 */
export async function checkForUpdates(server: string, store: PackStore, core: CoreClient): Promise<string[]> {
  const installed: string[] = [];
  try {
    const base = server.endsWith('/') ? server : `${server}/`;
    const manifest = (await (await fetch(`${base}updates/manifest.json`)).json()) as UpdateManifest;
    const have = new Map((await store.all()).map((p) => [p.id, p.version]));
    for (const info of manifest.packs) {
      const current = have.get(info.id);
      if (current && compareVersions(info.version, current) <= 0) continue;
      if (compareVersions(CLIENT_VERSION, info.minClient) < 0) continue;
      const res = await fetch(new URL(info.url, `${base}updates/`).href);
      if (!res.ok) continue;
      const data = await res.arrayBuffer();
      if ((await sha256Hex(data)) !== info.sha256) {
        console.warn(`update ${info.id} ${info.version}: checksum mismatch, skipped`);
        continue;
      }
      const pack = JSON.parse(new TextDecoder().decode(data)) as Pack;
      const result = await core.call<ContentValidateResult>('content.validate', pack.content);
      if (result.errors.length) {
        console.warn(`update ${info.id} ${info.version} is invalid, skipped`, result.errors);
        continue;
      }
      await store.put(pack);
      installed.push(`${pack.id} ${pack.version}`);
    }
  } catch (err) {
    console.info('no content updates', err);
  }
  return installed;
}

/** The update server, if configured (build-time VITE_UPDATE_SERVER or ?updates=). */
export function updateServer(): string | null {
  return new URLSearchParams(location.search).get('updates') ?? ((import.meta.env.VITE_UPDATE_SERVER as string | undefined) || null);
}
