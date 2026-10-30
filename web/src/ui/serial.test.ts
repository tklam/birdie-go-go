import { describe, expect, it } from 'vitest';
import { serial } from './serial';

describe('serial', () => {
  it('runs one task at a time, in order', async () => {
    const queue = serial();
    const log: string[] = [];
    let release = () => {};
    const first = queue(async () => {
      log.push('a start');
      await new Promise<void>((r) => (release = r));
      log.push('a end');
    });
    const second = queue(async () => {
      log.push('b start');
      return 2;
    });
    await Promise.resolve();
    expect(log).toEqual(['a start']);
    release();
    await first;
    expect(await second).toBe(2);
    expect(log).toEqual(['a start', 'a end', 'b start']);
  });

  it('carries on after a failed task', async () => {
    const queue = serial();
    const failed = queue(async () => {
      throw new Error('boom');
    });
    await expect(failed).rejects.toThrow('boom');
    expect(await queue(async () => 'ok')).toBe('ok');
  });
});
