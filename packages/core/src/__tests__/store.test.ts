import { describe, it, expect } from 'vitest';
import { makeId, parseId, UpdateStore } from '../store/tables.js';

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
