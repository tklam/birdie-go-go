import { describe, expect, it } from 'vitest';
import { cloudDownload, cloudUpload, formatCode, normalizeCode } from './cloud';
import { serialize } from './save';
import { newGame } from './state';
import { emptyContent } from '../test/content';

const fakeServer = () => {
  const store = new Map<string, string>();
  let next = 0;
  const fetcher = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const code = path.split('/')[3];
    if (init?.method === 'POST') {
      const c = ['ABCDEFGHJKMN', 'PQRSTUVWXYZ2'][next++];
      store.set(c, String(init.body));
      return new Response(JSON.stringify({ code: c }));
    }
    if (init?.method === 'PUT') {
      if (!store.has(code)) return new Response('', { status: 404 });
      store.set(code, String(init.body));
      return new Response(null, { status: 204 });
    }
    const s = store.get(code);
    return s ? new Response(s) : new Response('', { status: 404 });
  }) as typeof fetch;
  return { store, fetcher };
};

describe('cloud saves', () => {
  it('formats and reads codes', () => {
    expect(formatCode('ABCDEFGHJKMN')).toBe('ABCD-EFGH-JKMN');
    expect(normalizeCode(' abcd-efgh-jkmn ')).toBe('ABCDEFGHJKMN');
    expect(normalizeCode('ABCD-EFGH-JKM0')).toBeNull();
  });

  it('uploads to a new code, updates it, and downloads', async () => {
    const { store, fetcher } = fakeServer();
    const state = newGame(emptyContent(), 7);
    const code = await cloudUpload('http://s', state, '', fetcher);
    expect(code).toBe('ABCDEFGHJKMN');
    state.day = 5;
    expect(await cloudUpload('http://s', state, code, fetcher)).toBe(code);
    expect(store.get(code)).toBe(serialize(state));
    expect((await cloudDownload('http://s', code, fetcher)).day).toBe(5);
    // An unknown code gets a fresh one rather than failing.
    expect(await cloudUpload('http://s', state, 'ZZZZZZZZZZZZ', fetcher)).toBe('PQRSTUVWXYZ2');
    await expect(cloudDownload('http://s', 'ZZZZZZZZZZZZ', fetcher)).rejects.toThrow(/No save/);
  });
});
