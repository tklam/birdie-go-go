// Web Worker that fetches, gunzips and decodes world chunks off the main
// thread (SPEC.md §9.7). Request: {id, url}. Reply: {id, chunk} or {id, error}.
import { decodeChunk, type ChunkData } from './chunk';

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<{ id: number; url: string }>) => void) | null;
}

const scope = self as unknown as WorkerScope;

async function load(url: string): Promise<ChunkData> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
  const raw = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return decodeChunk(raw);
}

scope.onmessage = (event) => {
  const { id, url } = event.data;
  load(url).then(
    (chunk) =>
      scope.postMessage({ id, chunk }, [
        chunk.ground.buffer,
        chunk.detail.buffer,
        chunk.overhead.buffer,
        chunk.collision.buffer,
        chunk.area.buffer,
      ]),
    (err: unknown) => scope.postMessage({ id, error: String(err) }),
  );
};
