import { describe, it, expect } from 'vitest';
import type { Topic, Update } from '../types.js';
import { buildDigest } from '../digest/view.js';
import { matchesSearch, searchDigest, searchTerms } from '../search.js';
import { UpdateStore } from '../store/tables.js';

function upd(id: string, over: Partial<Update> = {}): Update {
  return {
    id,
    source: id.split('__')[0]!,
    title: `Title ${id}`,
    url: `https://example.com/${id}`,
    datePublished: '2026-01-01T00:00:00Z',
    dateAdded: '2026-01-01T00:00:00Z',
    status: 'unread',
    saved: false,
    content: '',
    ...over,
  };
}

function topic(id: string, over: Partial<Topic> = {}): Topic {
  return { id, title: `Topic ${id}`, summary: '', highlights: [], createdAt: 'c', updatedAt: 'u', ...over };
}

describe('searchTerms', () => {
  it('lower-cases and splits on whitespace', () => {
    expect(searchTerms('  Copilot   CLI ')).toEqual(['copilot', 'cli']);
    expect(searchTerms('')).toEqual([]);
    expect(searchTerms(undefined)).toEqual([]);
  });
});

describe('matchesSearch', () => {
  const u = upd('a__1', { title: 'Copilot CLI 1.2', summary: 'Adds MCP servers', content: 'Full release notes about agents' });

  it('matches title, summary and content case-insensitively', () => {
    expect(matchesSearch(u, 'copilot')).toBe(true);
    expect(matchesSearch(u, 'mcp')).toBe(true);
    expect(matchesSearch(u, 'AGENTS')).toBe(true);
    expect(matchesSearch(u, 'kubernetes')).toBe(false);
  });

  it('needs every word, in any field and order', () => {
    expect(matchesSearch(u, 'agents copilot')).toBe(true);
    expect(matchesSearch(u, 'copilot kubernetes')).toBe(false);
  });

  it('matches everything for an empty query', () => {
    expect(matchesSearch(u, '   ')).toBe(true);
  });
});

describe('searchDigest', () => {
  const digest = buildDigest(
    [
      upd('a__1', { topicId: 't1', title: 'Copilot code review update' }),
      upd('b__2', { topicId: 't1', title: 'Pull request comments' }),
      upd('c__3', { topicId: 't2', title: 'AKS release' }),
      upd('d__4', { topicId: 't2', title: 'AKS fleet', content: 'Now with Copilot' }),
      upd('e__5', { title: 'Unrelated item' }),
    ],
    new Map([
      ['t1', topic('t1', { title: 'Code review', highlights: ['Faster reviews'] })],
      ['t2', topic('t2', { title: 'Kubernetes' })],
    ]),
  );

  it('keeps a whole topic when the topic text matches', () => {
    const out = searchDigest(digest.entries, 'faster');
    expect(out.map((e) => e.topic.id)).toEqual(['t1']);
    expect(out[0]!.items.map((u) => u.id).sort()).toEqual(['a__1', 'b__2']);
  });

  it('narrows a topic to its matching updates', () => {
    const out = searchDigest(digest.entries, 'copilot');
    expect(out.map((e) => e.topic.id).sort()).toEqual(['t1', 't2']);
    expect(out.find((e) => e.topic.id === 't1')!.items.map((u) => u.id)).toEqual(['a__1']);
    expect(out.find((e) => e.topic.id === 't2')!.items.map((u) => u.id)).toEqual(['d__4']);
  });

  it('lets topic and update text together satisfy all words', () => {
    const out = searchDigest(digest.entries, 'kubernetes fleet');
    expect(out.map((e) => e.topic.id)).toEqual(['t2']);
    expect(out[0]!.items.map((u) => u.id)).toEqual(['d__4']);
  });

  it('returns entries unchanged for an empty query and nothing when no match', () => {
    expect(searchDigest(digest.entries, '')).toBe(digest.entries);
    expect(searchDigest(digest.entries, 'nothing-matches')).toEqual([]);
  });
});

describe('UpdateStore.listUpdates search', () => {
  const entity = (rowKey: string, over: Record<string, unknown> = {}) => ({
    partitionKey: 'github',
    rowKey,
    title: `Title ${rowKey}`,
    url: `https://example.com/${rowKey}`,
    datePublished: `2026-01-0${rowKey}T00:00:00Z`,
    dateAdded: '2026-01-01T00:00:00Z',
    status: 'unread',
    saved: false,
    content: '',
    ...over,
  });

  function storeWith(entities: Record<string, unknown>[]) {
    const store = new UpdateStore('UseDevelopmentStorage=true');
    const calls: unknown[] = [];
    (store as unknown as { client: unknown }).client = {
      listEntities: (opts: unknown) => {
        calls.push(opts);
        return (async function* () { yield* entities; })();
      },
    };
    return { store, calls };
  }

  it('searches content even when listing without it, then strips it', async () => {
    const { store, calls } = storeWith([
      entity('1', { title: 'Copilot' }),
      entity('2', { content: 'about copilot agents' }),
      entity('3', { title: 'Other' }),
    ]);
    const resp = await store.listUpdates({ search: 'copilot', includeContent: false, limit: 1 });
    expect(calls[0]).toMatchObject({ queryOptions: { select: undefined } });
    expect(resp.total).toBe(2);
    expect(resp.hasMore).toBe(true);
    expect(resp.updates.map((u) => u.id)).toEqual(['github__2']);
    expect(resp.updates[0]!.content).toBe('');
  });

  it('keeps the light column list when not searching', async () => {
    const { store, calls } = storeWith([entity('1')]);
    await store.listUpdates({ search: '  ', includeContent: false });
    expect((calls[0] as { queryOptions: { select?: string[] } }).queryOptions.select).toContain('title');
  });
});
