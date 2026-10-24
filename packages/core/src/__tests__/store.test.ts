import { describe, it, expect } from 'vitest';
import { clampContent, hashUrl, makeId, MAX_CONTENT_CHARS, parseId, UpdateStore } from '../store/tables.js';

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
    const created: { content: string; readingTimeMinutes?: number; durationSeconds?: number }[] = [];
    (store as any).client = { createEntity: async (e: { content: string; readingTimeMinutes?: number; durationSeconds?: number }) => { created.push(e); } };
    const inserted = await store.insertUpdate({
      source: 'azure-sre-agent',
      title: 'Zero Ops',
      url: 'https://example.com/zero-ops',
      datePublished: '2026-10-18T00:00:00Z',
      content: 'y'.repeat(51_991),
      readingTimeMinutes: 4,
      durationSeconds: 849,
    });
    expect(inserted).toBe(true);
    expect(created[0]!.content).toHaveLength(MAX_CONTENT_CHARS);
    expect(created[0]).toMatchObject({ readingTimeMinutes: 4, durationSeconds: 849 });
  });

  it('backfills a missing duration on an existing update, keeping its status', async () => {
    const conn = 'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=dGVzdA==;TableEndpoint=http://localhost:10002/devstoreaccount1;';
    const store = new UpdateStore(conn as any);
    const existing = { partitionKey: 'yt', rowKey: 'r', title: 'V', url: 'https://www.youtube.com/watch?v=v1', status: 'read', content: 'About', etag: 'e' };
    const replaced: Record<string, unknown>[] = [];
    (store as any).client = {
      createEntity: async () => { throw Object.assign(new Error('exists'), { statusCode: 409 }); },
      getEntity: async () => ({ ...existing }),
      updateEntity: async (e: Record<string, unknown>) => { replaced.push(e); },
    };
    const update = { source: 'yt', title: 'V', url: existing.url, datePublished: '2026-10-18T00:00:00Z', content: 'About' };
    await expect(store.insertUpdate({ ...update, durationSeconds: 849 })).resolves.toBe(false);
    expect(replaced).toEqual([expect.objectContaining({ status: 'read', content: 'About', durationSeconds: 849 })]);

    replaced.length = 0;
    await store.insertUpdate(update);
    expect(replaced).toEqual([]);
  });

  describe('with a key', () => {
    const conn = 'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=dGVzdA==;TableEndpoint=http://localhost:10002/devstoreaccount1;';
    const meeting = { source: 'teams-meetings', title: 'Planning', url: 'https://teams.microsoft.com/l/meetingrecap?x', datePublished: '2026-10-18T10:00:00.000Z', content: 'Missed · 1 recording' };
    const keyedStore = (stored?: Record<string, unknown>) => {
      const store = new UpdateStore(conn as any);
      const created: Record<string, unknown>[] = [];
      const merged: { entity: Record<string, unknown>; mode: string; etag?: string }[] = [];
      (store as any).client = {
        createEntity: async (e: Record<string, unknown>) => {
          if (stored) throw Object.assign(new Error('exists'), { statusCode: 409 });
          created.push(e);
        },
        getEntity: async () => ({ ...stored }),
        updateEntity: async (entity: Record<string, unknown>, mode: string, opts?: { etag?: string }) => { merged.push({ entity, mode, etag: opts?.etag }); },
      };
      return { store, created, merged };
    };

    it('uses the key, not the URL, as the identity of the row', async () => {
      const { store, created } = keyedStore();
      await expect(store.insertUpdate(meeting, { key: 'teams:t:2026-10-18T10:00:00.000Z' })).resolves.toBe(true);
      expect(created[0]!.rowKey).toBe(await hashUrl('teams:t:2026-10-18T10:00:00.000Z'));
    });

    it('merges what changed into a stored row, keeping its status and saved flag', async () => {
      const stored = { partitionKey: 'teams-meetings', rowKey: 'r', ...meeting, url: 'https://teams.microsoft.com/l/chat/t/conversations', content: 'Missed', status: 'read', saved: true, etag: 'e1' };
      const { store, merged } = keyedStore(stored);

      await expect(store.insertUpdate(meeting, { key: 'k' })).resolves.toBe(false);

      expect(merged).toEqual([{
        entity: { partitionKey: 'teams-meetings', rowKey: await hashUrl('k'), url: meeting.url, content: 'Missed · 1 recording' },
        mode: 'Merge',
        etag: 'e1',
      }]);
    });

    it('lets the caller decide what changes, and writes nothing when nothing does', async () => {
      const stored = { partitionKey: 'teams-meetings', rowKey: 'r', ...meeting, etag: 'e1' };
      const { store, merged } = keyedStore(stored);

      await store.insertUpdate({ ...meeting, content: 'Missed' }, { key: 'k', merge: () => undefined });
      await store.insertUpdate({ ...meeting, content: 'Missed' }, { key: 'k', merge: (existing) => ({ content: existing.content, title: 'Planning' }) });
      expect(merged).toEqual([]);

      await store.insertUpdate(meeting, { key: 'k', merge: () => ({ title: 'Planning (moved)' }) });
      expect(merged.map((m) => m.entity)).toEqual([{ partitionKey: 'teams-meetings', rowKey: await hashUrl('k'), title: 'Planning (moved)' }]);
    });

    it('awaits sandbox merges and propagates failures without writing success-shaped results', async () => {
      const { store, merged } = keyedStore({ partitionKey: 'teams-meetings', rowKey: 'r', ...meeting, etag: 'e1' });
      await store.insertUpdate(meeting, { key: 'k', merge: async () => ({ title: 'From the worker' }) });
      expect(merged[0].entity.title).toBe('From the worker');
      await expect(store.insertUpdate(meeting, { key: 'k', merge: async () => { throw new Error('worker revoked'); } })).rejects.toThrow('worker revoked');
      expect(merged).toHaveLength(1);
      await expect(store.insertUpdate(meeting, { key: 'k', merge: async () => ({ title: 'Unsafe', saved: false }) })).rejects.toThrow('protected field');
      expect(merged).toHaveLength(1);
    });

    it('recomputes a merge after an ETag conflict and reports exhausted conflicts', async () => {
      const store = new UpdateStore(conn);
      let reads = 0;
      let writes = 0;
      let conflict = true;
      Object.defineProperty(store, 'client', { value: {
        createEntity: async () => { throw Object.assign(new Error('exists'), { statusCode: 409 }); },
        getEntity: async () => ({ ...meeting, partitionKey: 'teams-meetings', rowKey: 'r', content: `revision-${++reads}`, etag: `e${reads}` }),
        updateEntity: async () => { if (++writes === 1 || conflict) throw Object.assign(new Error('conflict'), { statusCode: 412 }); },
      } });
      const seen: string[] = [];
      const merge = async (existing: { content: string }) => { seen.push(existing.content); return { title: 'Changed' }; };
      await expect(store.insertUpdate(meeting, { key: 'k', merge })).rejects.toThrow('conflict');
      expect(reads).toBe(3);
      conflict = false;
      await expect(store.insertUpdate(meeting, { key: 'k', merge })).resolves.toBe(false);
      expect(seen).toEqual(['revision-1', 'revision-2', 'revision-3', 'revision-4']);
    });
  });
});

describe('UpdateStore.setPageInfo', () => {
  it('merges only the fields given, cutting the preview to the Table Storage limit', async () => {
    const conn = 'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=dGVzdA==;TableEndpoint=http://localhost:10002/devstoreaccount1;';
    const store = new UpdateStore(conn as any);
    const calls: Array<[Record<string, unknown>, string]> = [];
    (store as any).client = { updateEntity: async (e: Record<string, unknown>, mode: string) => { calls.push([e, mode]); } };

    await store.setPageInfo('yt__r1', { durationSeconds: 849 });
    await store.setPageInfo('blog__r2', { readingTimeMinutes: 7, content: 'z'.repeat(40_000) });
    expect(calls[0]).toEqual([{ partitionKey: 'yt', rowKey: 'r1', durationSeconds: 849 }, 'Merge']);
    expect(calls[1]![0]).toMatchObject({ partitionKey: 'blog', rowKey: 'r2', readingTimeMinutes: 7 });
    expect(calls[1]![0].content).toHaveLength(MAX_CONTENT_CHARS);
  });
});

describe('UpdateStore.listDuplicateCopies', () => {
  it('reads the flagged updates without content, ignoring rows a store returns without the flag', async () => {
    const conn = 'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=dGVzdA==;TableEndpoint=http://localhost:10002/devstoreaccount1;';
    const store = new UpdateStore(conn as any);
    const queries: Array<{ queryOptions?: { filter?: string; select?: string[] } }> = [];
    const entity = (rowKey: string, extra: Record<string, unknown> = {}) => ({
      partitionKey: 'blog', rowKey, title: `T${rowKey}`, url: `https://example.com/${rowKey}`,
      datePublished: '2026-10-18T00:00:00Z', dateAdded: '2026-10-19T00:00:00Z', status: 'unread', saved: false, ...extra,
    });
    (store as any).client = {
      listEntities: (options: (typeof queries)[number]) => {
        queries.push(options);
        return (async function* () {
          yield entity('1', { duplicateOf: 'azure__9', content: 'ignored' });
          yield entity('2');
        })();
      },
    };

    const copies = await store.listDuplicateCopies();
    expect(copies).toEqual([expect.objectContaining({ id: 'blog__1', source: 'blog', duplicateOf: 'azure__9', content: '' })]);
    expect(queries[0]!.queryOptions!.filter).toBe("duplicateOf gt ''");
    expect(queries[0]!.queryOptions!.select).toContain('duplicateOf');
    expect(queries[0]!.queryOptions!.select).not.toContain('content');
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

  it('returns reading time and video duration on listed updates', async () => {
    const s = store();
    (s as any).client = {
      listEntities: () => (async function* () {
        yield {
          partitionKey: 'youtube',
          rowKey: 'video',
          title: 'Video',
          url: 'https://youtube.com/watch?v=1',
          datePublished: '2026-01-01',
          dateAdded: '2026-01-01',
          status: 'unread',
          saved: false,
          readingTimeMinutes: 3,
          durationSeconds: 849,
        };
      })(),
    };
    const result = await s.listUpdates({ includeContent: false });
    expect(result.updates[0]).toMatchObject({ readingTimeMinutes: 3, durationSeconds: 849 });
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
