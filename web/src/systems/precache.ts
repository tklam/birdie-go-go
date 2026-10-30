// The offline precache (SPEC.md §9.1): which files a service-worker version
// must download, which it can keep from earlier versions, and which are left
// over. Pure, so it can be unit-tested; the worker itself is src/sw.ts.

/** One file of the build, as vite-plugin-pwa lists it (`self.__WB_MANIFEST`). */
export interface PrecacheEntry {
  url: string;
  /** Content revision; null for content-hashed bundles, whose names change instead. */
  revision: string | null;
}

/**
 * The cache key of an entry, an absolute URL under `base` (the worker's
 * scope). A revision goes into the query, so a changed file gets a new key
 * and an unchanged one keeps its key across versions.
 */
export function cacheKey(entry: PrecacheEntry, base: string): string {
  const url = new URL(entry.url, base);
  if (entry.revision) url.searchParams.set('__rev', entry.revision);
  return url.href;
}

/** The absolute URL a request for the entry arrives with (no query). */
export function entryUrl(entry: PrecacheEntry, base: string): string {
  return new URL(entry.url, base).href;
}

/**
 * What installing a version means for a cache that already holds `cached`
 * keys: the entries still to download, and the keys no version needs any more
 * (deleted on activation, never during install, while the old version may
 * still be serving them).
 */
export function precachePlan(entries: readonly PrecacheEntry[], cached: readonly string[], base: string): { download: PrecacheEntry[]; stale: string[] } {
  const have = new Set(cached);
  const want = new Set(entries.map((e) => cacheKey(e, base)));
  return {
    download: entries.filter((e) => !have.has(cacheKey(e, base))),
    stale: cached.filter((k) => !want.has(k)),
  };
}

/**
 * Runs `task` over `items` with at most `limit` at once. Rejects with the
 * first failure (the rest still run to the end, so their work isn't lost).
 */
export async function runPool<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: unknown = null;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await task(item);
      } catch (err) {
        failure ??= err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure !== null) throw failure;
}
