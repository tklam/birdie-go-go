// Web Worker that hosts the Go core (core.wasm). It loads Go's (or TinyGo's)
// wasm_exec.js glue from the site root, starts the core, and forwards each
// request to the core's birdieCoreCall function.
import type { Request, Response } from './types.gen';

interface GoRuntime {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}

interface CoreGlobals {
  Go: new () => GoRuntime;
  birdieCoreCall(requestJSON: string): string;
  birdieCoreReady?: () => void;
}

interface WorkerScope {
  postMessage(message: Response): void;
  onmessage: ((event: MessageEvent<Request>) => void) | null;
}

const globals = globalThis as unknown as CoreGlobals;
const scope = self as unknown as WorkerScope;
const base = import.meta.env.BASE_URL;

async function boot(): Promise<void> {
  await import(/* @vite-ignore */ `${base}wasm_exec.js`);
  const go = new globals.Go();
  const ready = new Promise<void>((resolve) => {
    globals.birdieCoreReady = resolve;
  });
  const { instance } = await WebAssembly.instantiateStreaming(fetch(`${base}core.wasm`), go.importObject);
  void go.run(instance);
  await ready;
}

const booted = boot();

scope.onmessage = async (event) => {
  const request = event.data;
  try {
    await booted;
  } catch (err) {
    scope.postMessage({ id: request.id, ok: false, error: `core failed to start: ${String(err)}` });
    return;
  }
  scope.postMessage(JSON.parse(globals.birdieCoreCall(JSON.stringify(request))) as Response);
};
