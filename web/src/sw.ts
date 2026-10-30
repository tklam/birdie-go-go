// The service worker (SPEC.md §9.1): keeps every file of the build in one
// cache so the game starts and plays offline, and installs a new version by
// downloading only the files that changed, several at a time (Workbox's own
// precache downloads one file at a time, which made a first update on a
// phone take minutes). A new version waits until the page asks it to take
// over ({type: 'SKIP_WAITING'}, sent by "Update now") or every tab has closed.
import { cacheKey, entryUrl, precachePlan, runPool, type PrecacheEntry } from './systems/precache';

// Just the worker APIs used here: the DOM lib types `self` as a window.
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(response: Response | Promise<Response>): void;
}
interface WorkerScope {
  readonly location: Location;
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (e: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (e: FetchEvent) => void): void;
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
}

const sw = self as unknown as WorkerScope;
/** Filled in at build time by vite-plugin-pwa (injectManifest). */
const ENTRIES: PrecacheEntry[] = (self as unknown as { __WB_MANIFEST: PrecacheEntry[] }).__WB_MANIFEST;
const CACHE = 'birdie-precache';
/** Files downloaded at once while installing. */
const PARALLEL = 8;
const base = new URL('./', sw.location.href).href;
/** Request URL (without query) → cache key. */
const keys = new Map(ENTRIES.map((e) => [entryUrl(e, base), cacheKey(e, base)]));
const indexKey = keys.get(new URL('index.html', base).href);

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = (await cache.keys()).map((r) => r.url);
      // Files already here from an earlier attempt or version are kept, so an
      // install cut short (the app closed) picks up where it stopped.
      const { download } = precachePlan(ENTRIES, cached, base);
      await runPool(download, PARALLEL, async (entry) => {
        // Revisioned files keep their names, so skip the HTTP cache for them.
        const response = await fetch(new Request(entryUrl(entry, base), { cache: entry.revision ? 'reload' : 'default', credentials: 'same-origin' }));
        if (!response.ok) throw new Error(`precache: ${entry.url} answered ${response.status}`);
        await cache.put(cacheKey(entry, base), response);
      });
    })(),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const { stale } = precachePlan(ENTRIES, (await cache.keys()).map((r) => r.url), base);
      await Promise.all(stale.map((k) => cache.delete(k)));
      // Caches of the Workbox-generated worker this one replaced.
      for (const name of await caches.keys()) {
        if (name.startsWith('workbox-precache')) await caches.delete(name);
      }
    })(),
  );
});

sw.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;
  // Page loads get the app shell; everything else its own precached file.
  const key = request.mode === 'navigate' ? indexKey : keys.get(url.origin + url.pathname);
  if (!key) return;
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(key))
      .then((hit) => hit ?? fetch(request)),
  );
});

sw.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void sw.skipWaiting();
});
