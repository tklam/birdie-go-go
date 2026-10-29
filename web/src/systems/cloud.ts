// Cloud saves on the optional server (SPEC.md §9.6): a save lives under a
// sync code; uploading the first time creates one. Nothing here is needed to
// play, and every failure leaves the local save untouched.
import { deserialize, serialize } from './save';
import type { GameState } from './state';

export const SYNC_CODE = /^[2-9A-HJKMNP-Z]{12}$/;

/** Normalizes a typed code ("abcd-efgh-jkmn" → "ABCDEFGHJKMN"), or null if it can't be one. */
export function normalizeCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  return SYNC_CODE.test(code) ? code : null;
}

/** "ABCD-EFGH-JKMN", easier to read and copy. */
export function formatCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1-');
}

/**
 * Uploads the save: to its existing code, or to a new one if `code` is empty
 * or unknown to the server. Returns the code it's stored under.
 */
export async function cloudUpload(server: string, state: GameState, code: string, fetcher: typeof fetch = fetch): Promise<string> {
  const body = serialize(state);
  const headers = { 'Content-Type': 'application/json' };
  if (code) {
    const r = await fetcher(`${server}/api/save/${code}`, { method: 'PUT', headers, body });
    if (r.ok) return code;
    if (r.status !== 404) throw new Error(`upload failed (${r.status})`);
  }
  const r = await fetcher(`${server}/api/save`, { method: 'POST', headers, body });
  if (!r.ok) throw new Error(`upload failed (${r.status})`);
  const out = (await r.json()) as { code?: unknown };
  if (typeof out.code !== 'string' || !SYNC_CODE.test(out.code)) throw new Error('upload failed (bad reply)');
  return out.code;
}

/** Downloads the save stored under `code`, migrated and checked like any save. */
export async function cloudDownload(server: string, code: string, fetcher: typeof fetch = fetch): Promise<GameState> {
  const r = await fetcher(`${server}/api/save/${code}`);
  if (r.status === 404) throw new Error('No save with that code.');
  if (!r.ok) throw new Error(`download failed (${r.status})`);
  return deserialize(await r.text());
}
