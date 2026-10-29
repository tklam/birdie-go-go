import type { ChunkData } from './chunk';
import type { ChunkLoader } from './streaming';

type Reply = { id: number; chunk?: ChunkData; error?: string };

const loaders = new Map<string, ChunkLoader>();

/**
 * A ChunkLoader for the chunk directory at `base` (relative to the site
 * root, e.g. "world/chunks/"), decoding in a worker. Loaders are cached so
 * re-entering a map reuses its worker.
 */
export function workerChunkLoader(base: string): ChunkLoader {
  let loader = loaders.get(base);
  if (!loader) {
    loader = createWorkerChunkLoader(`${import.meta.env.BASE_URL}${base}`);
    loaders.set(base, loader);
  }
  return loader;
}

function createWorkerChunkLoader(base: string): ChunkLoader {
  const worker = new Worker(new URL('./chunk.worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, { resolve: (c: ChunkData) => void; reject: (e: Error) => void }>();
  let nextId = 1;
  worker.onmessage = (event: MessageEvent<Reply>) => {
    const p = pending.get(event.data.id);
    if (!p) return;
    pending.delete(event.data.id);
    if (event.data.chunk) p.resolve(event.data.chunk);
    else p.reject(new Error(event.data.error ?? 'chunk load failed'));
  };
  return (file) =>
    new Promise<ChunkData>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, url: new URL(base + file, location.href).href });
    });
}
