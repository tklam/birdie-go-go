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

  it('sends lesson.generate and lesson.grade with typed payloads', async () => {
    const worker = new FakeWorker();
    const core = new CoreClient(worker);
    const song = { id: 's', title: 'S', tempo: 120, timeSignature: [4, 4], difficulty: 1, notes: [] };
    const generated = core.generateLesson({ song, tendencies: { rush: 1 }, difficulty: 2, seed: 7 });
    expect(worker.sent[0]).toEqual({
      id: 1,
      op: 'lesson.generate',
      payload: { song, tendencies: { rush: 1 }, difficulty: 2, seed: 7 },
    });
    const performance = { notes: [], durationMs: 0 };
    worker.reply({ id: 1, ok: true, result: { lessonId: 'l1', performance } });
    await expect(generated).resolves.toEqual({ lessonId: 'l1', performance });

    const graded = core.gradeLesson({ lessonId: 'l1', flagsMs: [100], latencyOffsetMs: 20 });
    expect(worker.sent[1]).toEqual({
      id: 2,
      op: 'lesson.grade',
      payload: { lessonId: 'l1', flagsMs: [100], latencyOffsetMs: 20 },
    });
    const result = { score: 0, hits: 0, misses: 0, falseAlarms: 1, mistakes: [] };
    worker.reply({ id: 2, ok: true, result });
    await expect(graded).resolves.toEqual(result);
  });

  it('sends weather.day with a typed payload', async () => {
    const worker = new FakeWorker();
    const core = new CoreClient(worker);
    const range = [0.5, 0.1] as [number, number];
    const climate = { cloud: range, precip: range, temp: [22, 3] as [number, number], fog: range, wind: range };
    const payload = {
      seed: 3,
      day: 40,
      areas: [{ id: 'tko_town', climate: { summer: climate }, center: { x: 760, y: 520 }, altitude: 0.05 }],
    };
    const day = core.weatherDay(payload);
    expect(worker.sent[0]).toEqual({ id: 1, op: 'weather.day', payload });
    const slot = { cloud: 0.4, precip: 0, temp: 30, fog: 0, wind: 0.3, windDir: 3.1, uv: 9 };
    const area = { area: 'tko_town', slots: [slot, slot, slot], named: ['hazy', 'hazy', 'hazy'] };
    const result = { day: 40, areas: [area], typhoonSignal: [0, 0, 1], forecast: [area] };
    worker.reply({ id: 1, ok: true, result });
    await expect(day).resolves.toEqual(result);
  });

  it('sends transit.load, transit.plan and transit.vehicles with typed payloads', async () => {
    const worker = new FakeWorker();
    const core = new CoreClient(worker);
    const transit = {
      stops: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      lines: [{ id: 'bus', name: 'Bus', mode: 'bus', fare: 8, stops: ['a', 'b'], path: [[0, 0], [600, 0]] as [number, number][], speed: 60, headway: 10 }],
    };
    const loaded = core.transitLoad({ transit, stopPositions: { a: { x: 0, y: 0 } } });
    expect(worker.sent[0]).toEqual({ id: 1, op: 'transit.load', payload: { transit, stopPositions: { a: { x: 0, y: 0 } } } });
    worker.reply({ id: 1, ok: true, result: { lines: 1, stops: 2 } });
    await expect(loaded).resolves.toEqual({ lines: 1, stops: 2 });

    const plan = core.transitPlan({ from: 'a', to: 'b', time: 360, excludeModes: ['ferry'] });
    expect(worker.sent[1]).toEqual({ id: 2, op: 'transit.plan', payload: { from: 'a', to: 'b', time: 360, excludeModes: ['ferry'] } });
    const leg = { line: 'bus', mode: 'bus', from: 'a', to: 'b', direction: 1, wait: 0, depart: 360, arrive: 370, ride: 10, fare: 8, path: [[0, 0], [600, 0]] };
    const itinerary = { from: 'a', to: 'b', depart: 360, arrive: 370, duration: 10, fare: 8, transfers: 0, legs: [leg] };
    worker.reply({ id: 2, ok: true, result: itinerary });
    await expect(plan).resolves.toEqual(itinerary);

    const vehicles = core.transitVehicles({ lines: ['bus'], time: 363 });
    expect(worker.sent[2]).toEqual({ id: 3, op: 'transit.vehicles', payload: { lines: ['bus'], time: 363 } });
    const result = { vehicles: [{ line: 'bus', direction: 1, depart: 360, x: 180, y: 0, dx: 1, dy: 0, progress: 0.3 }] };
    worker.reply({ id: 3, ok: true, result });
    await expect(vehicles).resolves.toEqual(result);
  });
});
