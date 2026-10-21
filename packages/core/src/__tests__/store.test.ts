import { describe, it, expect } from 'vitest';
import { clampContent, makeId, MAX_CONTENT_CHARS, parseId, UpdateStore } from '../store/tables.js';

describe('clampContent', () => {
  it('keeps content within the limit unchanged', () => {
    const text = 'x'.repeat(MAX_CONTENT_CHARS);
    expect(clampContent(text)).toBe(text);
  });

  it('cuts long content to the limit and marks the cut', () => {
    const out = clampContent('x'.repeat(52_000));
    expect(out).toHaveLength(MAX_CONTENT_CHARS);
    expect(out.endsWith('x…')).toBe(true);
    // 64 KiB of UTF-16 is the Table Storage limit for one string property.
    expect(out.length * 2).toBeLessThanOrEqual(64 * 1024);
  });

  it('never splits a surrogate pair', () => {
    // An emoji straddles the cut point.
    const out = clampContent('x'.repeat(MAX_CONTENT_CHARS - 2) + '😀'.repeat(100));
    expect(out).toBe(`${'x'.repeat(MAX_CONTENT_CHARS - 2)}…`);
  });
});

describe('UpdateStore.insertUpdate', () => {
  it('stores oversized content cut to the Table Storage limit', async () => {
    const conn = 'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=dGVzdA==;TableEndpoint=http://localhost:10002/devstoreaccount1;';
    const store = new UpdateStore(conn as any);
    const created: { content: string }[] = [];
    (store as any).client = { createEntity: async (e: { content: string }) => { created.push(e); } };
    const inserted = await store.insertUpdate({
      source: 'azure-sre-agent',
      title: 'Zero Ops',
      url: 'https://example.com/zero-ops',
      datePublished: '2026-10-18T00:00:00Z',
      content: 'y'.repeat(51_991),
    });
    expect(inserted).toBe(true);
    expect(created[0]!.content).toHaveLength(MAX_CONTENT_CHARS);
  });
});

describe('makeId / parseId', () => {
  it('creates a deterministic id from source + url', async () => {
    const id1 = await makeId('github', 'https://example.com/a');
    const id2 = await makeId('github', 'https://example.com/a');
    expect(id1).toBe(id2);
  });

  it('different urls produce different ids', async () => {
    const id1 = await makeId('github', 'https://example.com/a');
    const id2 = await makeId('github', 'https://example.com/b');
    expect(id1).not.toBe(id2);
  });

  it('id starts with source prefix', async () => {
    const id = await makeId('azure', 'https://example.com/x');
    expect(id.startsWith('azure__')).toBe(true);
  });

  it('parseId round-trips source correctly', async () => {
    const id = await makeId('vscode', 'https://example.com/release');
    const parsed = parseId(id);
    expect(parsed.source).toBe('vscode');
    expect(parsed.rowKey).toHaveLength(32);
  });

  it('matches the legacy sha256(url) row key', async () => {
    const { createHash } = await import('node:crypto');
    const url = 'https://example.com/legacy';
    const legacy = createHash('sha256').update(url).digest('hex').slice(0, 32);
    expect(await makeId('github', url)).toBe(`github__${legacy}`);
  });

  it('parseId throws on invalid id', () => {
    expect(() => parseId('nope')).toThrow('Invalid update id');
  });
});

describe('UpdateStore.listUpdates source filter', () => {
  const conn = 'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=dGVzdA==;TableEndpoint=http://localhost:10002/devstoreaccount1;';
  const storeWith = (seen: string[]) => {
    const store = new UpdateStore(conn as any);
    (store as any).client = {
      listEntities: (opts: { queryOptions: { filter?: string } }) => {
        seen.push(opts.queryOptions.filter ?? '');
        return (async function* () {})();
      },
    };
    return store;
  };

  it('matches any of several sources', async () => {
    const seen: string[] = [];
    await storeWith(seen).listUpdates({ sources: ['github', 'vscode'], status: 'unread' });
    expect(seen[0]).toBe("(PartitionKey eq 'github' or PartitionKey eq 'vscode') and status eq 'unread'");
  });

  it('returns nothing for an empty source list without querying', async () => {
    const seen: string[] = [];
    const resp = await storeWith(seen).listUpdates({ sources: [] });
    expect(resp).toEqual({ updates: [], total: 0, hasMore: false });
    expect(seen).toEqual([]);
  });
});

describe('UpdateStore.listUpdates sort', () => {
  const conn = 'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=dGVzdA==;TableEndpoint=http://localhost:10002/devstoreaccount1;';
  const row = (rowKey: string, partitionKey: string, title: string, datePublished: string) =>
    ({ partitionKey, rowKey, title, url: `https://x/${rowKey}`, datePublished, dateAdded: datePublished, status: 'unread', saved: false });
  const store = () => {
    const s = new UpdateStore(conn as any);
    (s as any).client = {
      listEntities: () => (async function* () {
        yield row('a', 'zeta', 'Banana', '2026-01-03');
        yield row('b', 'alpha', 'cherry', '2026-01-01');
        yield row('c', 'mid', 'apple', '2026-01-02');
      })(),
    };
    return s;
  };

  it('defaults to newest first', async () => {
    const resp = await store().listUpdates();
    expect(resp.updates.map((u) => u.title)).toEqual(['Banana', 'apple', 'cherry']);
  });

  it('sorts every row before applying the limit', async () => {
    const byTitle = await store().listUpdates({ sort: { key: 'title', dir: 'asc' }, limit: 2 });
    expect(byTitle.updates.map((u) => u.title)).toEqual(['apple', 'Banana']);
    expect(byTitle.hasMore).toBe(true);
    const bySource = await store().listUpdates({ sort: { key: 'source', dir: 'desc' }, limit: 1 });
    expect(bySource.updates.map((u) => u.source)).toEqual(['zeta']);
  });
});

describe('UpdateStore fetch history', () => {
  const conn = 'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=dGVzdA==;TableEndpoint=http://localhost:10002/devstoreaccount1;';
  const rows = (items: object[]) => () => (async function* () { yield* items; })();

  it('records each fetch and reports it in stats with the newest added time', async () => {
    const store = new UpdateStore(conn as any);
    const upserts: Record<string, unknown>[] = [];
    (store as any).settingsClient = {
      upsertEntity: async (e: Record<string, unknown>, mode: string) => { upserts.push({ ...e, mode }); },
      listEntities: rows([
        { partitionKey: 'fetch', rowKey: 'github', lastFetchAt: '2026-10-21T10:00:00Z', lastError: '' },
        { partitionKey: 'fetch', rowKey: 'azure', lastFetchAt: '2026-10-21T11:00:00Z', lastError: 'HTTP 500' },
      ]),
    };
    (store as any).client = {
      listEntities: rows([
        { partitionKey: 'github', rowKey: 'a', status: 'unread', saved: false, dateAdded: '2026-10-01T00:00:00Z' },
        { partitionKey: 'github', rowKey: 'b', status: 'read', saved: false, dateAdded: '2026-10-05T00:00:00Z' },
        { partitionKey: 'vscode', rowKey: 'c', status: 'read', saved: false, dateAdded: '2026-09-01T00:00:00Z' },
      ]),
    };

    await store.recordFetch('azure', 'HTTP 500');
    await store.recordFetch('github');
    expect(upserts).toEqual([
      expect.objectContaining({ partitionKey: 'fetch', rowKey: 'azure', lastError: 'HTTP 500', mode: 'Merge' }),
      expect.objectContaining({ partitionKey: 'fetch', rowKey: 'github', lastError: '', mode: 'Merge' }),
    ]);

    const stats = await store.getStats();
    expect(stats.sourceStatus).toEqual({
      github: { lastFetchAt: '2026-10-21T10:00:00Z', lastAddedAt: '2026-10-05T00:00:00Z' },
      azure: { lastFetchAt: '2026-10-21T11:00:00Z', lastError: 'HTTP 500' },
      vscode: { lastAddedAt: '2026-09-01T00:00:00Z' },
    });
  });

  it('still returns stats when the fetch history cannot be read', async () => {
    const store = new UpdateStore(conn as any);
    (store as any).settingsClient = { listEntities: () => { throw Object.assign(new Error('nope'), { statusCode: 403 }); } };
    (store as any).client = { listEntities: rows([{ partitionKey: 'github', rowKey: 'a', status: 'unread', dateAdded: '2026-10-01T00:00:00Z' }]) };
    const stats = await store.getStats();
    expect(stats.total).toBe(1);
    expect(stats.sourceStatus).toEqual({ github: { lastAddedAt: '2026-10-01T00:00:00Z' } });
  });
});
