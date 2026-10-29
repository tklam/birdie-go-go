import { describe, expect, it } from 'vitest';
import { CoreClient, type WorkerLike } from './client';
import type { Request, Response } from './types.gen';

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<Response>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly sent: Request[] = [];

  postMessage(message: Request): void {
    this.sent.push(message);
  }

  reply(response: Response): void {
    this.onmessage?.({ data: response } as MessageEvent<Response>);
  }
}

describe('CoreClient', () => {
  it('resolves results by request id, even out of order', async () => {
    const worker = new FakeWorker();
    const core = new CoreClient(worker);
    const first = core.ping('a');
    const second = core.ping('b');
    const [a, b] = worker.sent;
    expect(a).toEqual({ id: 1, op: 'ping', payload: { echo: 'a' } });

    worker.reply({ id: b.id, ok: true, result: { echo: 'b', coreVersion: '0.1.0' } });
    worker.reply({ id: a.id, ok: true, result: { echo: 'a', coreVersion: '0.1.0' } });
    await expect(first).resolves.toEqual({ echo: 'a', coreVersion: '0.1.0' });
    await expect(second).resolves.toEqual({ echo: 'b', coreVersion: '0.1.0' });
  });

  it('rejects with the core error message', async () => {
    const worker = new FakeWorker();
    const core = new CoreClient(worker);
    const result = core.call('fly');
    worker.reply({ id: worker.sent[0].id, ok: false, error: 'unknown op "fly"' });
    await expect(result).rejects.toThrow('unknown op "fly"');
  });

  it('ignores replies to unknown ids', () => {
    const worker = new FakeWorker();
    new CoreClient(worker);
    expect(() => worker.reply({ id: 99, ok: true })).not.toThrow();
  });

  it('rejects everything pending when the worker fails', async () => {
    const worker = new FakeWorker();
    const core = new CoreClient(worker);
    const pending = [core.ping('a'), core.ping('b')];
    worker.onerror?.({ message: 'boom' } as ErrorEvent);
    for (const p of pending) await expect(p).rejects.toThrow('core worker error: boom');
  });
});
