import { describe, it, expect } from 'vitest';
import { FolderColorStore } from '../store/folder-colors.js';

const conn = 'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=dGVzdA==;TableEndpoint=http://localhost:10002/devstoreaccount1;';
const tableError = (statusCode: number) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });

/** A FolderColorStore over an in-memory colors row; `beforeWrite` runs ahead of every write. */
function storeWith(data?: string, beforeWrite?: (attempt: number) => void) {
  const store = new FolderColorStore(conn as any, 'todos');
  let row = data === undefined ? undefined : { data, etag: 'v1' };
  let version = 1;
  const calls: string[] = [];
  (store as any).client = {
    getEntity: async (pk: string, rk: string) => {
      calls.push(`get:${pk}/${rk}`);
      if (!row) throw tableError(404);
      return { partitionKey: pk, rowKey: rk, ...row };
    },
    createEntity: async (e: { data: string }) => {
      calls.push('create');
      beforeWrite?.(calls.filter((c) => !c.startsWith('get')).length);
      if (row) throw tableError(409);
      row = { data: e.data, etag: `v${++version}` };
    },
    updateEntity: async (e: { data: string }, mode: string, opts: { etag: string }) => {
      calls.push(`update:${mode}:${opts.etag}`);
      beforeWrite?.(calls.filter((c) => !c.startsWith('get')).length);
      if (!row || opts.etag !== row.etag) throw tableError(412);
      row = { data: e.data, etag: `v${++version}` };
    },
  };
  return {
    store,
    calls,
    stored: () => (row ? JSON.parse(row.data) : undefined),
    change: (colors: Record<string, string>) => { row = { data: JSON.stringify(colors), etag: `v${++version}` }; },
  };
}

describe('FolderColorStore', () => {
  it('reads no colors before any were set', async () => {
    const { store, calls } = storeWith();
    expect(await store.get()).toEqual({});
    expect(calls).toEqual(['get:folder/colors']);
  });

  it('creates the colors row on the first color, then replaces it', async () => {
    const { store, calls, stored } = storeWith();
    expect(await store.set(' work ', '#F00')).toEqual({ work: '#ff0000' });
    expect(await store.set('home', '#00ff00')).toEqual({ work: '#ff0000', home: '#00ff00' });
    expect(stored()).toEqual({ work: '#ff0000', home: '#00ff00' });
    expect(calls.filter((c) => !c.startsWith('get'))).toEqual(['create', 'update:Replace:v2']);
  });

  it('clears a color and skips writes that change nothing', async () => {
    const { store, calls, stored } = storeWith(JSON.stringify({ work: '#ff0000' }));
    expect(await store.set('work', '#ff0000')).toEqual({ work: '#ff0000' });
    expect(await store.set('home', '')).toEqual({ work: '#ff0000' });
    expect(calls.some((c) => !c.startsWith('get'))).toBe(false);
    expect(await store.set('work', '')).toEqual({});
    expect(stored()).toEqual({});
  });

  it('moves colors with a renamed folder', async () => {
    const { store, stored } = storeWith(JSON.stringify({ work: '#000001', 'work/eng': '#000002', home: '#000003' }));
    expect(await store.move('work', 'job')).toEqual({ job: '#000001', 'job/eng': '#000002', home: '#000003' });
    expect(stored()).toEqual({ job: '#000001', 'job/eng': '#000002', home: '#000003' });
  });

  it('keeps a color another device set meanwhile', async () => {
    const t = storeWith(JSON.stringify({ work: '#000001' }), (attempt) => {
      if (attempt === 1) t.change({ work: '#000001', other: '#000009' });
    });
    expect(await t.store.set('home', '#000003')).toEqual({ work: '#000001', other: '#000009', home: '#000003' });
    expect(t.stored()).toEqual({ work: '#000001', other: '#000009', home: '#000003' });
  });

  it('retries when another device created the row first', async () => {
    const t = storeWith(undefined, (attempt) => {
      if (attempt === 1) t.change({ other: '#000009' });
    });
    expect(await t.store.set('home', '#000003')).toEqual({ other: '#000009', home: '#000003' });
    expect(t.calls.filter((c) => !c.startsWith('get'))).toEqual(['create', 'update:Replace:v2']);
  });

  it('gives up after repeated conflicts', async () => {
    const t = storeWith(JSON.stringify({}), () => t.change({ other: '#000009' }));
    await expect(t.store.set('home', '#000003')).rejects.toThrow('HTTP 412');
    expect(t.calls.filter((c) => c.startsWith('update'))).toHaveLength(4);
  });

  it('ignores a damaged colors row and bad entries', async () => {
    expect(await storeWith('not json').store.get()).toEqual({});
    expect(await storeWith('[1,2]').store.get()).toEqual({});
    expect(await storeWith(JSON.stringify({ a: '#ABC', b: 'red', c: 7, '': '#ffffff' })).store.get()).toEqual({ a: '#aabbcc' });
  });

  it('rejects a color that is not hex', async () => {
    const { store, calls } = storeWith();
    await expect(store.set('work', 'red')).rejects.toThrow(/Not a color/);
    await expect(store.set('', '#ffffff')).rejects.toThrow(/top level/);
    expect(calls.some((c) => !c.startsWith('get'))).toBe(false);
  });
});
