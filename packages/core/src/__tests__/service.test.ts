import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FomoDirectService, extractText, extractTitle } from '../service.js';

// Mock the store and scrapers
vi.mock('../store/tables.js', () => {
  const store = {
    init: vi.fn().mockResolvedValue(undefined),
    listUpdates: vi.fn().mockResolvedValue({ updates: [], total: 0, hasMore: false }),
    getUpdate: vi.fn(),
    setStatus: vi.fn(),
    setStatusMany: vi.fn().mockResolvedValue(undefined),
    setTopicId: vi.fn().mockResolvedValue(undefined),
    setGist: vi.fn().mockResolvedValue(undefined),
    setSaved: vi.fn(),
    setPageInfo: vi.fn().mockResolvedValue(undefined),
    insertUpdate: vi.fn().mockResolvedValue(true),
    listDuplicateRows: vi.fn().mockResolvedValue([]),
    listDuplicateCopies: vi.fn().mockResolvedValue([]),
    setDuplicateOf: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockResolvedValue({
      total: 0,
      byStatus: { unread: 0, read: 0 },
      bySource: {},
      saved: 0,
    }),
    backup: vi.fn().mockResolvedValue({
      version: 1,
      exportedAt: '2026-04-17T00:00:00.000Z',
      count: 0,
      entities: [],
    }),
    restore: vi.fn().mockResolvedValue(0),
    getSettings: vi.fn().mockResolvedValue({
      disabledSources: [],
      previewPosition: 'right',
      pageSize: 50,
    }),
    updateSettings: vi.fn().mockImplementation(async (patch: Record<string, unknown>) => ({
      disabledSources: [],
      previewPosition: 'right',
      pageSize: 50,
      ...patch,
    })),
  };

  const todoStore = {
    init: vi.fn().mockResolvedValue(undefined),
    createTodo: vi.fn(),
    getTodo: vi.fn(),
    listTodos: vi.fn().mockResolvedValue({ todos: [] }),
    updateTodo: vi.fn(),
    deleteTodo: vi.fn().mockResolvedValue(undefined),
    moveFolder: vi.fn().mockResolvedValue(2),
  };

  return {
    UpdateStore: vi.fn().mockImplementation(() => store),
    TodoStore: vi.fn().mockImplementation(() => todoStore),
    makeId: vi.fn((source: string, url: string) => `${source}__hash`),
    parseId: vi.fn((id: string) => {
      const sep = id.indexOf('__');
      return { source: id.slice(0, sep), rowKey: id.slice(sep + 2) };
    }),
    __mockStore: store,
    __mockTodoStore: todoStore,
  };
});

vi.mock('../store/topics.js', () => {
  const topicStore = {
    init: vi.fn().mockResolvedValue(undefined),
    getTopics: vi.fn().mockResolvedValue(new Map()),
    upsertTopic: vi.fn().mockResolvedValue(undefined),
    deleteTopic: vi.fn().mockResolvedValue(undefined),
  };
  return {
    TopicStore: vi.fn().mockImplementation(() => topicStore),
    __mockTopicStore: topicStore,
  };
});

vi.mock('../store/references.js', () => {
  const referenceStore = {
    init: vi.fn().mockResolvedValue(undefined),
    listReferences: vi.fn().mockResolvedValue([]),
    moveFolder: vi.fn().mockResolvedValue(3),
  };
  return {
    ReferenceStore: vi.fn().mockImplementation(() => referenceStore),
    __mockReferenceStore: referenceStore,
  };
});

vi.mock('../store/folder-colors.js', () => {
  const colorStore = () => ({
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue({}),
    move: vi.fn().mockResolvedValue({}),
  });
  const byTable: Record<string, ReturnType<typeof colorStore>> = { todos: colorStore(), references: colorStore() };
  return {
    FolderColorStore: vi.fn().mockImplementation((_conn: unknown, table: string) => byTable[table]),
    __mockColorStores: byTable,
  };
});

vi.mock('../scraper/registry.js', () => {
  const mockSource = {
    id: 'mock-source',
    displayName: 'Mock Source',
    capabilities: { preview: false },
    fetch: vi.fn().mockResolvedValue([
      {
        title: 'Test Item',
        url: 'https://example.com/item',
        datePublished: new Date('2025-01-01'),
        content: 'Test content',
      },
    ]),
  };

  return {
    getAllSources: vi.fn(() => [mockSource]),
    getSource: vi.fn((id: string) => id === 'mock-source' ? mockSource : undefined),
    getSourceIds: vi.fn(() => ['mock-source']),
    __mockSource: mockSource,
  };
});

describe('FomoDirectService', () => {
  let svc: FomoDirectService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new FomoDirectService('DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=test;TableEndpoint=http://localhost:10002/devstoreaccount1;');
  });

  it('listUpdates delegates to store', async () => {
    const result = await svc.listUpdates();
    expect(result).toEqual({ updates: [], total: 0, hasMore: false });
  });

  it('getStats delegates to store', async () => {
    const result = await svc.getStats();
    expect(result.total).toBe(0);
    expect(result.byStatus).toEqual({ unread: 0, read: 0 });
  });

  it('fetch runs all scrapers and inserts results', async () => {
    const result = await svc.fetch();
    expect(result.added).toBe(1);
    expect(result.results['mock-source']).toBeDefined();
    expect(result.results['mock-source'].fetched).toBe(1);
    expect(result.results['mock-source'].added).toBe(1);
  });

  it('hands sources a YouTube Data API client only while a key is set', async () => {
    const { getAllSources, getSource } = await import('../scraper/registry.js') as any;
    await svc.fetch();
    expect(getAllSources.mock.calls.at(-1)[1]).toEqual({ youtube: undefined });

    const keyed = new FomoDirectService('UseDevelopmentStorage=true', { youtubeApiKey: 'k' });
    await keyed.fetch({ sources: ['mock-source'] });
    expect(getSource.mock.calls.at(-1)[2].youtube).toMatchObject({ videos: expect.any(Function) });

    keyed.setYoutubeApiKey('  ');
    await keyed.fetch();
    expect(getAllSources.mock.calls.at(-1)[1]).toEqual({ youtube: undefined });
  });

  it('persists reading time and video duration from scraped items', async () => {
    const { __mockStore } = await import('../store/tables.js') as any;
    const { __mockSource } = await import('../scraper/registry.js') as any;
    __mockSource.fetch.mockResolvedValueOnce([{
      title: 'Timed item',
      url: 'https://example.com/timed',
      datePublished: new Date('2025-01-01'),
      readingTimeMinutes: 3,
      durationSeconds: 849,
    }]);

    await svc.fetch();

    expect(__mockStore.insertUpdate).toHaveBeenCalledWith(expect.objectContaining({
      readingTimeMinutes: 3,
      durationSeconds: 849,
    }));
  });

  it('fetch with specific sources filters to those sources', async () => {
    const result = await svc.fetch({ sources: ['mock-source'] });
    expect(result.added).toBe(1);
  });

  it('fetch skips a page already stored under another source and fixes stored duplicates', async () => {
    const { __mockStore } = await import('../store/tables.js') as any;
    __mockStore.listDuplicateRows.mockResolvedValueOnce([
      { id: 'azure__a', url: 'https://www.example.com/item/', title: 'Test Item', datePublished: '2025-01-01', dateAdded: '2025-01-01' },
      { id: 'other__b', url: 'https://example.com/item?utm_source=x', title: 'Test Item', datePublished: '2025-01-01', dateAdded: '2025-02-01' },
    ]);

    const result = await svc.fetch();

    expect(result.results['mock-source']).toEqual({ fetched: 1, added: 0, duplicates: 1 });
    expect(__mockStore.insertUpdate).not.toHaveBeenCalled();
    expect(__mockStore.setDuplicateOf).toHaveBeenCalledWith('other__b', 'azure__a');
  });

  it('fetch flags a new update whose title repeats a recent one', async () => {
    const { __mockStore } = await import('../store/tables.js') as any;
    const { __mockSource } = await import('../scraper/registry.js') as any;
    __mockStore.listDuplicateRows.mockResolvedValueOnce([
      { id: 'azure__a', url: 'https://example.com/old', title: 'Generally available: the new thing', datePublished: '2025-01-01', dateAdded: '2025-01-01' },
    ]);
    __mockSource.fetch.mockResolvedValueOnce([
      { title: 'Generally Available — the NEW thing', url: 'https://example.com/new', datePublished: new Date('2025-01-10') },
    ]);

    const result = await svc.fetch();

    expect(result.results['mock-source'].added).toBe(1);
    expect(__mockStore.insertUpdate).toHaveBeenCalledWith(expect.objectContaining({ duplicateOf: 'azure__a' }));
  });

  describe('getDuplicates', () => {
    const upd = (id: string, over: Record<string, unknown> = {}) => ({
      id,
      source: id.split('__')[0],
      title: `Title ${id}`,
      url: `https://example.com/${id}`,
      datePublished: '2025-01-01T00:00:00Z',
      dateAdded: '2025-01-01T00:00:00Z',
      status: 'unread',
      saved: false,
      content: '',
      ...over,
    });

    it('lists the original and the other copies of a copy, oldest first', async () => {
      const { __mockStore } = await import('../store/tables.js') as any;
      __mockStore.listDuplicateCopies.mockResolvedValueOnce([
        upd('c__3', { duplicateOf: 'a__1', dateAdded: '2025-03-01T00:00:00Z' }),
        upd('d__4', { duplicateOf: 'a__1', dateAdded: '2025-02-01T00:00:00Z' }),
        upd('y__1', { duplicateOf: 'x__1' }),
      ]);
      __mockStore.getUpdate.mockResolvedValue(upd('a__1', { content: '<p>long body</p>' }));

      const related = await svc.getDuplicates('c__3');

      expect(related.map((u) => u.id)).toEqual(['a__1', 'd__4']);
      expect(related[0]!.content).toBe('');
      expect(__mockStore.getUpdate).toHaveBeenCalledWith('a__1');
    });

    it('lists the copies of an original without reading it again', async () => {
      const { __mockStore } = await import('../store/tables.js') as any;
      __mockStore.listDuplicateCopies.mockResolvedValueOnce([
        upd('c__3', { duplicateOf: 'a__1', dateAdded: '2025-03-01T00:00:00Z' }),
        upd('b__2', { duplicateOf: 'a__1', dateAdded: '2025-02-01T00:00:00Z' }),
      ]);

      const related = await svc.getDuplicates('a__1');

      expect(related.map((u) => u.id)).toEqual(['b__2', 'c__3']);
      expect(__mockStore.getUpdate).not.toHaveBeenCalled();
    });

    it('is empty for an update that is in no duplicate group', async () => {
      const { __mockStore } = await import('../store/tables.js') as any;
      __mockStore.listDuplicateCopies.mockResolvedValueOnce([upd('b__2', { duplicateOf: 'a__1' })]);

      expect(await svc.getDuplicates('z__1')).toEqual([]);
      expect(__mockStore.getUpdate).not.toHaveBeenCalled();
    });

    it('leaves out an original that is gone', async () => {
      const { __mockStore } = await import('../store/tables.js') as any;
      __mockStore.listDuplicateCopies.mockResolvedValueOnce([
        upd('b__2', { duplicateOf: 'a__1' }),
        upd('c__3', { duplicateOf: 'a__1' }),
      ]);
      __mockStore.getUpdate.mockResolvedValue(null);

      expect((await svc.getDuplicates('b__2')).map((u) => u.id)).toEqual(['c__3']);
    });

    it('reuses the list of copies for a while, and reads it again after a fetch', async () => {
      const { __mockStore } = await import('../store/tables.js') as any;
      const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
      try {
        __mockStore.listDuplicateCopies.mockResolvedValueOnce([upd('b__2', { duplicateOf: 'a__1' })]);
        __mockStore.getUpdate.mockResolvedValue(upd('a__1'));

        expect((await svc.getDuplicates('b__2')).map((u) => u.id)).toEqual(['a__1']);
        await svc.getDuplicates('b__2');
        await svc.getDuplicates('a__1');
        expect(__mockStore.listDuplicateCopies).toHaveBeenCalledTimes(1);

        await svc.fetch();
        __mockStore.listDuplicateCopies.mockResolvedValueOnce([upd('c__3', { duplicateOf: 'a__1' })]);
        expect((await svc.getDuplicates('a__1')).map((u) => u.id)).toEqual(['c__3']);
        expect(__mockStore.listDuplicateCopies).toHaveBeenCalledTimes(2);

        now.mockReturnValue(1_000_000 + 60_000);
        __mockStore.listDuplicateCopies.mockResolvedValueOnce([]);
        expect(await svc.getDuplicates('a__1')).toEqual([]);
        expect(__mockStore.listDuplicateCopies).toHaveBeenCalledTimes(3);
      } finally {
        now.mockRestore();
      }
    });

    it('does not keep a failed read', async () => {
      const { __mockStore } = await import('../store/tables.js') as any;
      __mockStore.listDuplicateCopies.mockRejectedValueOnce(new Error('offline'));
      await expect(svc.getDuplicates('b__2')).rejects.toThrow('offline');

      __mockStore.listDuplicateCopies.mockResolvedValueOnce([upd('b__2', { duplicateOf: 'a__1' })]);
      __mockStore.getUpdate.mockResolvedValue(upd('a__1'));
      expect((await svc.getDuplicates('b__2')).map((u) => u.id)).toEqual(['a__1']);
    });
  });

  it('returns per-source fetch failures instead of treating them as empty results', async () => {
    const { __mockSource } = await import('../scraper/registry.js') as any;
    __mockSource.fetch.mockRejectedValueOnce(new Error('[mock-source] fetch failed: HTTP 503'));

    const result = await svc.fetch();

    expect(result.results['mock-source']).toEqual({
      fetched: 0,
      added: 0,
      error: '[mock-source] fetch failed: HTTP 503',
    });
  });

  it('fetch with unknown sources throws', async () => {
    await expect(svc.fetch({ sources: ['nonexistent'] })).rejects.toThrow(
      /None of the requested sources/,
    );
  });

  it('getUpdate throws on missing update', async () => {
    const { __mockStore } = await import('../store/tables.js') as any;
    __mockStore.getUpdate.mockResolvedValue(null);

    await expect(svc.getUpdate('test__abc')).rejects.toThrow('Update not found');
  });

  it('setStatus delegates to store', async () => {
    const mockUpdate = { id: 'test__abc', status: 'read', title: 'Test' };
    const { __mockStore } = await import('../store/tables.js') as any;
    __mockStore.setStatus.mockResolvedValue(mockUpdate);

    const result = await svc.setStatus('test__abc', 'read');
    expect(result).toEqual(mockUpdate);
  });

  it('setSaved delegates to store', async () => {
    const mockUpdate = { id: 'test__abc', saved: true, title: 'Test' };
    const { __mockStore } = await import('../store/tables.js') as any;
    __mockStore.setSaved.mockResolvedValue(mockUpdate);

    const result = await svc.setSaved('test__abc', true);
    expect(result).toEqual(mockUpdate);
  });

  it('getSources lists built-ins and user sources from the settings', async () => {
    const { __mockStore } = await import('../store/tables.js') as any;
    __mockStore.getSettings.mockResolvedValueOnce({
      disabledSources: [],
      removedSources: ['github'],
      userSources: [{ kind: 'feed', id: 'mine', displayName: 'Mine', urls: ['https://example.com/rss'] }],
    });
    const sources = await svc.getSources();
    const ids = sources.map((s) => s.id);
    expect(ids).toContain('azure');
    expect(ids).not.toContain('github');
    expect(sources.find((s) => s.id === 'mine')).toMatchObject({ displayName: 'Mine', kind: 'feed', builtin: false });
  });

  it('backup delegates to store', async () => {
    const result = await svc.backup();
    expect(result.version).toBe(1);
    expect(result.count).toBe(0);
    expect(result.entities).toEqual([]);
  });

  it('restore delegates to store', async () => {
    const payload = {
      version: 1 as const,
      exportedAt: '2026-04-17T00:00:00.000Z',
      count: 2,
      entities: [
        {
          partitionKey: 'github',
          rowKey: 'abc123',
          title: 'Test',
          url: 'https://example.com',
          datePublished: '2026-01-01T00:00:00Z',
          dateAdded: '2026-01-01T00:00:00Z',
          status: 'unread',
          saved: false,
          content: '',
        },
      ],
    };

    const { __mockStore } = await import('../store/tables.js') as any;
    __mockStore.restore.mockResolvedValue(1);

    const restored = await svc.restore(payload);
    expect(restored).toBe(1);
    expect(__mockStore.restore).toHaveBeenCalledWith(payload);
  });

  it('getSettings delegates to store', async () => {
    const result = await svc.getSettings();
    expect(result.previewPosition).toBe('right');
    expect(result.disabledSources).toEqual([]);
    expect(result.pageSize).toBe(50);
  });

  it('updateSettings delegates to store', async () => {
    const result = await svc.updateSettings({ previewPosition: 'bottom' });
    expect(result.previewPosition).toBe('bottom');
  });

  it('fetch skips disabled sources', async () => {
    const { __mockStore } = await import('../store/tables.js') as any;
    __mockStore.getSettings.mockResolvedValue({
      disabledSources: ['mock-source'],
      previewPosition: 'right',
      pageSize: 50,
    });

    const result = await svc.fetch();
    // mock-source is disabled, so nothing should be fetched
    expect(result.added).toBe(0);
    expect(Object.keys(result.results)).toHaveLength(0);
  });

  it('fetch ignores disabled when explicit sources given', async () => {
    const { __mockStore } = await import('../store/tables.js') as any;
    __mockStore.getSettings.mockResolvedValue({
      disabledSources: ['mock-source'],
      previewPosition: 'right',
      pageSize: 50,
    });

    const result = await svc.fetch({ sources: ['mock-source'] });
    // Explicit request overrides disabled
    expect(result.added).toBe(1);
  });

  it('setStatusMany delegates to store', async () => {
    const { __mockStore } = await import('../store/tables.js') as any;
    await svc.setStatusMany(['a__1', 'b__2'], 'read');
    expect(__mockStore.setStatusMany).toHaveBeenCalledWith(['a__1', 'b__2'], 'read');
  });

  it('getDigest groups unread updates by known topic', async () => {
    const { __mockStore } = await import('../store/tables.js') as any;
    const { __mockTopicStore } = await import('../store/topics.js') as any;
    const base = { url: 'u', dateAdded: '2026-01-01', status: 'unread', saved: false, content: '' };
    __mockStore.listUpdates.mockResolvedValueOnce({
      updates: [
        { ...base, id: 'a__1', source: 'a', title: 'A1', datePublished: '2026-01-02', topicId: 't1' },
        { ...base, id: 'b__2', source: 'b', title: 'B2', datePublished: '2026-01-03', topicId: 't1' },
        { ...base, id: 'c__3', source: 'c', title: 'C3', datePublished: '2026-01-01' },
      ],
      total: 3,
      hasMore: false,
    });
    __mockTopicStore.getTopics.mockResolvedValueOnce(new Map([
      ['t1', { id: 't1', title: 'Topic', summary: 's', highlights: ['h'], createdAt: 'x', updatedAt: 'x' }],
    ]));

    const digest = await svc.getDigest();
    expect(__mockStore.listUpdates).toHaveBeenCalledWith(expect.objectContaining({ status: 'unread', includeContent: false }));
    expect(__mockTopicStore.getTopics).toHaveBeenCalledWith(['t1', 't1']);
    expect(digest.pending).toBe(1);
    expect(digest.entries.map((e) => e.topic.id)).toEqual(['t1', 'item:c__3']);
    expect(digest.entries[0].items.map((u) => u.id)).toEqual(['b__2', 'a__1']);
  });

  it('getDigest searches unread updates with their content and returns them without it', async () => {
    const { __mockStore } = await import('../store/tables.js') as any;
    const { __mockTopicStore } = await import('../store/topics.js') as any;
    const base = { url: 'u', dateAdded: '2026-01-01', status: 'unread', saved: false };
    __mockStore.listUpdates.mockResolvedValueOnce({
      updates: [
        { ...base, id: 'a__1', source: 'a', title: 'A1', datePublished: '2026-01-02', topicId: 't1', content: 'mentions agents' },
        { ...base, id: 'b__2', source: 'b', title: 'B2', datePublished: '2026-01-03', topicId: 't1', content: '' },
        { ...base, id: 'c__3', source: 'c', title: 'Agents C3', datePublished: '2026-01-01', content: '' },
        { ...base, id: 'd__4', source: 'd', title: 'D4', datePublished: '2026-01-04', content: '' },
      ],
      total: 4,
      hasMore: false,
    });
    __mockTopicStore.getTopics.mockResolvedValueOnce(new Map([
      ['t1', { id: 't1', title: 'Topic', summary: 's', highlights: [], createdAt: 'x', updatedAt: 'x' }],
    ]));

    const digest = await svc.getDigest({ search: 'AGENTS' });
    expect(__mockStore.listUpdates).toHaveBeenCalledWith(expect.objectContaining({ status: 'unread', includeContent: true }));
    expect(digest.entries.map((e) => e.topic.id)).toEqual(['t1', 'item:c__3']);
    expect(digest.entries[0].items.map((u) => u.id)).toEqual(['a__1']);
    expect(digest.entries[0].items[0].content).toBe('');
    expect(digest.pending).toBe(1);
  });

  it('getDigest limits the view to the chosen sources', async () => {
    const { __mockStore } = await import('../store/tables.js') as any;
    await svc.getDigest({ sources: ['a', 'b'] });
    expect(__mockStore.listUpdates).toHaveBeenCalledWith(expect.objectContaining({ status: 'unread', sources: ['a', 'b'] }));
  });

  it('countSources counts a list view per source, ignoring any source filter', async () => {
    const { __mockStore } = await import('../store/tables.js') as any;
    const base = { url: 'u', dateAdded: '2026-01-01', datePublished: '2026-01-01', status: 'read', saved: false, content: '', title: 'T' };
    __mockStore.listUpdates.mockResolvedValueOnce({
      updates: [{ ...base, id: 'a__1', source: 'a' }, { ...base, id: 'a__2', source: 'a' }, { ...base, id: 'b__3', source: 'b' }],
      total: 3,
      hasMore: false,
    });
    const counts = await svc.countSources({ status: 'read', search: 'x' });
    expect(__mockStore.listUpdates).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'read', search: 'x', includeContent: false }));
    expect(__mockStore.listUpdates.mock.lastCall[0].sources).toBeUndefined();
    expect(counts).toEqual({ a: 2, b: 1 });
  });

  it('countSources counts the grouped view through the digest', async () => {
    const { __mockStore } = await import('../store/tables.js') as any;
    const { __mockTopicStore } = await import('../store/topics.js') as any;
    const base = { url: 'u', dateAdded: '2026-01-01', status: 'unread', saved: true, content: '' };
    __mockStore.listUpdates.mockResolvedValueOnce({
      updates: [
        { ...base, id: 'a__1', source: 'a', title: 'A1', datePublished: '2026-01-02', topicId: 't1' },
        { ...base, id: 'b__2', source: 'b', title: 'B2', datePublished: '2026-01-03', topicId: 't1' },
        { ...base, id: 'b__3', source: 'b', title: 'B3', datePublished: '2026-01-01' },
      ],
      total: 3,
      hasMore: false,
    });
    __mockTopicStore.getTopics.mockResolvedValueOnce(new Map([['t1', { id: 't1', title: 'T1', summary: '', highlights: [], createdAt: '', updatedAt: '' }]]));
    const counts = await svc.countSources({ saved: true, grouped: true });
    expect(__mockStore.listUpdates).toHaveBeenLastCalledWith(expect.objectContaining({ saved: true }));
    expect(counts).toEqual({ a: 1, b: 2 });
  });

  it('digest runs the summarizer over pending updates', async () => {
    const { __mockStore } = await import('../store/tables.js') as any;
    const { __mockTopicStore } = await import('../store/topics.js') as any;
    __mockStore.listUpdates.mockResolvedValueOnce({
      updates: [
        { id: 'a__1', source: 'a', title: 'A1', url: 'u', datePublished: '2026-01-02', dateAdded: 'x', status: 'unread', saved: false, content: '' },
      ],
      total: 1,
      hasMore: false,
    });
    const summarizer = {
      generateJson: vi.fn().mockResolvedValue({
        topics: [{ topic: null, title: 'T', summary: 'S', highlights: ['H'], items: ['i1'] }],
      }),
    };

    const result = await svc.digest(summarizer, { newId: () => 'new-topic' });
    expect(result).toMatchObject({ processed: 1, created: 1, updated: 0, remaining: 0, errors: [] });
    expect(__mockTopicStore.upsertTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-topic', title: 'T' }));
    expect(__mockStore.setTopicId).toHaveBeenCalledWith('a__1', 'new-topic');
  });

  describe('summarizePost', () => {
    const post = {
      id: 'github__1',
      source: 'github',
      title: 'Copilot code review gets agentic tools',
      url: 'https://example.com/post',
      datePublished: '2026-10-01T00:00:00Z',
      dateAdded: 'x',
      status: 'unread',
      saved: false,
      content: '<p>Short preview.</p>',
    };
    const page = (body: string) =>
      `<html><body><nav>Menu</nav><article><h1>Copilot code review gets agentic tools</h1><p>${body}</p></article></body></html>`;
    const gistJson = { summary: 'Code review can now call tools.', points: ['- Pro+ plans', 'Preview'] };

    afterEach(() => vi.unstubAllGlobals());

    async function mockStore(update: Record<string, unknown>) {
      const { __mockStore } = await import('../store/tables.js') as any;
      __mockStore.getUpdate.mockResolvedValue(update);
      return __mockStore;
    }

    it('returns a saved gist without fetching or calling the model', async () => {
      await mockStore({ ...post, gist: { summary: 'Saved', points: [] } });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const summarizer = { generateJson: vi.fn() };
      const result = await svc.summarizePost('github__1', summarizer);
      expect(result.outcome).toBe('cached');
      expect(result.update.gist).toEqual({ summary: 'Saved', points: [] });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(summarizer.generateJson).not.toHaveBeenCalled();
    });

    it('summarises the fetched page when it says more than the preview, and saves the gist', async () => {
      const store = await mockStore(post);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(page('Agentic tools. '.repeat(100)))));
      const summarizer = { generateJson: vi.fn().mockResolvedValue(gistJson) };
      const result = await svc.summarizePost('github__1', summarizer);
      const expected = { summary: 'Code review can now call tools.', points: ['Pro+ plans', 'Preview'] };
      expect(result).toMatchObject({ outcome: 'created', from: 'page', update: { gist: expected } });
      expect(store.setGist).toHaveBeenCalledWith('github__1', expected);
      const req = summarizer.generateJson.mock.calls[0][0];
      expect(req.prompt).toContain('TITLE: Copilot code review gets agentic tools');
      expect(req.prompt).toContain('Agentic tools.');
      expect(req.prompt).not.toContain('Menu');
      expect(req.effort).toBe('low');
    });

    it('regenerates a saved gist when forced', async () => {
      await mockStore({ ...post, gist: { summary: 'Old', points: [] } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(page('Agentic tools. '.repeat(100)))));
      const summarizer = { generateJson: vi.fn().mockResolvedValue(gistJson) };
      const result = await svc.summarizePost('github__1', summarizer, { force: true });
      expect(result.outcome).toBe('created');
      expect(summarizer.generateJson).toHaveBeenCalledTimes(1);
    });

    it('skips posts too short to condense', async () => {
      const store = await mockStore(post);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(page('Just a little more.'))));
      const summarizer = { generateJson: vi.fn() };
      const result = await svc.summarizePost('github__1', summarizer);
      expect(result.outcome).toBe('short');
      expect(summarizer.generateJson).not.toHaveBeenCalled();
      expect(store.setGist).not.toHaveBeenCalled();
    });

    it('falls back to a long preview when the page is unrelated or fails', async () => {
      const long = { ...post, content: `<p>${'Preview text. '.repeat(100)}</p>` };
      await mockStore(long);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`<main>${'Generic updates shell. '.repeat(200)}</main>`)));
      const summarizer = { generateJson: vi.fn().mockResolvedValue(gistJson) };
      expect((await svc.summarizePost('github__1', summarizer)).from).toBe('preview');

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 403 })));
      expect((await svc.summarizePost('github__1', summarizer)).from).toBe('preview');
    });

    it('reads Azure Updates posts from the release communications API', async () => {
      await mockStore({ ...post, source: 'azure', title: 'Public Preview: Live Reports for Azure SRE Agent', url: 'https://azure.microsoft.com/updates?id=569690' });
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        title: 'Public Preview: Live Reports for Azure SRE Agent',
        status: 'In preview',
        previewAvailabilityDate: '2026-08',
        generalAvailabilityDate: null,
        description: `Live Reports <br>${'keep views up to date. '.repeat(60)}`,
      })));
      vi.stubGlobal('fetch', fetchMock);
      const summarizer = { generateJson: vi.fn().mockResolvedValue(gistJson) };
      const result = await svc.summarizePost('github__1', summarizer);
      expect(fetchMock.mock.calls[0][0]).toBe('https://www.microsoft.com/releasecommunications/api/v2/azure/569690');
      expect(result).toMatchObject({ outcome: 'created', from: 'page' });
      const prompt: string = summarizer.generateJson.mock.calls[0][0].prompt;
      expect(prompt).toContain('Status: In preview. Preview: 2026-08 Live Reports keep views');
      expect(prompt).not.toContain('General availability');
      expect(prompt).not.toContain('<br>');
    });

    it('reports the fetch error when the preview is too short to summarise', async () => {
      await mockStore(post);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 403 })));
      await expect(svc.summarizePost('github__1', { generateJson: vi.fn() })).rejects.toThrow(/HTTP 403/);
    });
  });

  describe('refreshUpdate', () => {
    const post = {
      id: 'blog__1',
      source: 'blog',
      title: 'Copilot code review gets agentic tools',
      url: 'https://example.com/post',
      datePublished: '2026-10-01T00:00:00Z',
      dateAdded: 'x',
      status: 'read',
      saved: false,
      content: 'Short preview.',
      readingTimeMinutes: 1,
    };
    const page = (body: string) =>
      `<html><body><nav>Menu</nav><article><h1>Copilot code review gets agentic tools</h1><p>${body}</p></article></body></html>`;

    afterEach(() => vi.unstubAllGlobals());

    async function mockStore(update: Record<string, unknown>) {
      const { __mockStore } = await import('../store/tables.js') as any;
      __mockStore.getUpdate.mockResolvedValue(update);
      __mockStore.setPageInfo.mockClear();
      return __mockStore;
    }

    it('recomputes the reading time from the whole page and keeps a fuller preview', async () => {
      const store = await mockStore(post);
      // 2,000 words: ~9 minutes at 230 wpm, far past the 5,000-character preview
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(page('word '.repeat(2000)))));
      const { previous, update } = await svc.refreshUpdate('blog__1');
      expect(previous.readingTimeMinutes).toBe(1);
      expect(update).toMatchObject({ readingTimeMinutes: 9, status: 'read' });
      expect(update.content).toHaveLength(5000);
      expect(update.content).not.toContain('Menu');
      expect(store.setPageInfo).toHaveBeenCalledWith('blog__1', { readingTimeMinutes: 9, content: update.content });
    });

    it('keeps a stored preview longer than the page', async () => {
      const store = await mockStore({ ...post, content: 'Preview. '.repeat(200) });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(page('A few words.'))));
      await svc.refreshUpdate('blog__1');
      expect(store.setPageInfo).toHaveBeenCalledWith('blog__1', { readingTimeMinutes: 1 });
    });

    it('reads a YouTube video’s length from its watch page, leaving the rest alone', async () => {
      const store = await mockStore({ ...post, source: 'yt', url: 'https://www.youtube.com/watch?v=abc', durationSeconds: 60 });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>"lengthSeconds":"849"</html>')));
      const { previous, update } = await svc.refreshUpdate('blog__1');
      expect(previous.durationSeconds).toBe(60);
      expect(update.durationSeconds).toBe(849);
      expect(store.setPageInfo).toHaveBeenCalledWith('blog__1', { durationSeconds: 849 });
    });

    it('reads a YouTube video’s length from the YouTube Data API when a key is set', async () => {
      const store = await mockStore({ ...post, source: 'yt', url: 'https://www.youtube.com/watch?v=abc' });
      const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        items: [{ id: 'abc', contentDetails: { duration: 'PT2M' }, snippet: { liveBroadcastContent: 'none' } }],
      })));
      vi.stubGlobal('fetch', fetch);
      svc.setYoutubeApiKey('test-key');
      try {
        const { update } = await svc.refreshUpdate('blog__1');
        expect(update.durationSeconds).toBe(120);
        expect(store.setPageInfo).toHaveBeenCalledWith('blog__1', { durationSeconds: 120 });
        const [url, init] = fetch.mock.calls[0]!;
        expect(String(url)).toMatch(/^https:\/\/www\.googleapis\.com\/youtube\/v3\/videos\?.*id=abc/);
        expect(init.headers['X-Goog-Api-Key']).toBe('test-key');
      } finally {
        svc.setYoutubeApiKey(undefined);
      }
    });

    it('changes nothing when the page is not the post or cannot be read', async () => {
      const store = await mockStore(post);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`<main>${'Please sign in to continue. '.repeat(50)}</main>`)));
      await expect(svc.refreshUpdate('blog__1')).rejects.toThrow(/does not show the post/);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 403 })));
      await expect(svc.refreshUpdate('blog__1')).rejects.toThrow(/HTTP 403/);

      store.getUpdate.mockResolvedValue({ ...post, url: 'https://youtu.be/abc' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>no player</html>')));
      await expect(svc.refreshUpdate('blog__1')).rejects.toThrow(/video length/);
      expect(store.setPageInfo).not.toHaveBeenCalled();
    });
  });

  describe('suggestReference', () => {
    const suggestion = { title: 'Agentic code review', folder: ' ai / Code review/ ', description: 'How Copilot review calls tools.' };

    afterEach(() => vi.unstubAllGlobals());

    it('uses what is stored for a feed item and offers the existing folders', async () => {
      const { __mockStore } = await import('../store/tables.js') as any;
      const { __mockReferenceStore } = await import('../store/references.js') as any;
      __mockStore.getUpdate.mockResolvedValue({
        id: 'github__1', source: 'github', title: 'Copilot code review gets agentic tools', url: 'https://example.com/post',
        datePublished: '2026-10-01T00:00:00Z', dateAdded: 'x', status: 'unread', saved: false,
        content: `<p>${'Review details. '.repeat(80)}</p>`, gist: { summary: 'Review can call tools.', points: ['Pro+'] },
      });
      __mockReferenceStore.listReferences.mockResolvedValue([{ folder: 'ai/agents' }, { folder: 'azure' }]);
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const summarizer = { generateJson: vi.fn().mockResolvedValue(suggestion) };

      const result = await svc.suggestReference({ updateId: 'github__1' }, summarizer);

      expect(result).toEqual({ title: 'Agentic code review', folder: 'ai/Code review', description: 'How Copilot review calls tools.' });
      expect(fetchMock).not.toHaveBeenCalled();
      const prompt: string = summarizer.generateJson.mock.calls[0][0].prompt;
      expect(prompt).toContain('- ai\n- ai/agents\n- azure');
      expect(prompt).toContain('TITLE: Copilot code review gets agentic tools');
      expect(prompt).toContain('Review can call tools. - Pro+ Review details.');
    });

    it('fetches a manual link for its title and text', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
        `<html><head><title>Tips &amp; tricks</title></head><body><article>${'Useful tip. '.repeat(40)}</article></body></html>`,
      )));
      const summarizer = { generateJson: vi.fn().mockResolvedValue(suggestion) };
      await svc.suggestReference({ url: ' https://example.com/tips ' }, summarizer);
      const prompt: string = summarizer.generateJson.mock.calls[0][0].prompt;
      expect(prompt).toContain('URL: https://example.com/tips');
      expect(prompt).toContain('TITLE: Tips & tricks');
      expect(prompt).toContain('Useful tip.');
    });

    it('rejects links that are not http(s) and reports unreachable ones', async () => {
      const summarizer = { generateJson: vi.fn() };
      await expect(svc.suggestReference({ url: 'notaurl' }, summarizer)).rejects.toThrow(/full URL/);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));
      await expect(svc.suggestReference({ url: 'https://example.com/x' }, summarizer)).rejects.toThrow(/HTTP 404/);
      expect(summarizer.generateJson).not.toHaveBeenCalled();
    });
  });
});

describe('folder colors', () => {
  const svc = () => new FomoDirectService('DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=test;TableEndpoint=http://localhost:10002/devstoreaccount1;');
  const mocks = async () => {
    const { __mockTodoStore } = await import('../store/tables.js') as any;
    const { __mockReferenceStore } = await import('../store/references.js') as any;
    const { __mockColorStores } = await import('../store/folder-colors.js') as any;
    return { todos: __mockTodoStore, refs: __mockReferenceStore, colors: __mockColorStores };
  };

  beforeEach(() => vi.clearAllMocks());

  it('lists each tree with the colors of its own table', async () => {
    const { refs, colors } = await mocks();
    refs.listReferences.mockResolvedValueOnce([]);
    colors.todos.get.mockResolvedValueOnce({ work: '#ff0000' });
    colors.references.get.mockResolvedValueOnce({ ai: '#00ff00' });
    const s = svc();
    expect(await s.listTodos()).toEqual({ todos: [], folderColors: { work: '#ff0000' } });
    expect(await s.listReferences()).toEqual({ references: [], folderColors: { ai: '#00ff00' } });
  });

  it('moves the colors along with a renamed folder', async () => {
    const { todos, refs, colors } = await mocks();
    const s = svc();
    expect(await s.moveTodoFolder('work', 'job')).toBe(2);
    expect(todos.moveFolder).toHaveBeenCalledWith('work', 'job');
    expect(colors.todos.move).toHaveBeenCalledWith('work', 'job');
    expect(await s.moveReferenceFolder('ai', 'ml')).toBe(3);
    expect(refs.moveFolder).toHaveBeenCalledWith('ai', 'ml');
    expect(colors.references.move).toHaveBeenCalledWith('ai', 'ml');
  });

  it('leaves the colors alone when the items could not move', async () => {
    const { todos, colors } = await mocks();
    todos.moveFolder.mockRejectedValueOnce(new Error('A folder cannot move into itself'));
    await expect(svc().moveTodoFolder('a', 'a/b')).rejects.toThrow(/into itself/);
    expect(colors.todos.move).not.toHaveBeenCalled();
  });

  it('sets a folder color in the right table', async () => {
    const { colors } = await mocks();
    colors.todos.set.mockResolvedValueOnce({ work: '#123456' });
    const s = svc();
    expect(await s.setTodoFolderColor('work', '#123456')).toEqual({ work: '#123456' });
    expect(colors.todos.set).toHaveBeenCalledWith('work', '#123456');
    await s.setReferenceFolderColor('ai', '');
    expect(colors.references.set).toHaveBeenCalledWith('ai', '');
    expect(colors.todos.set).toHaveBeenCalledTimes(1);
  });
});

describe('extractTitle', () => {
  it('prefers og:title, then <title>, decoding entities', () => {
    expect(extractTitle('<meta property="og:title" content="OG"><title>Plain</title>')).toBe('OG');
    expect(extractTitle('<meta content="Rev" property="og:title">')).toBe('Rev');
    expect(extractTitle('<title>\n  A &amp; B </title>')).toBe('A & B');
    expect(extractTitle('<p>none</p>')).toBe('');
  });
});

describe('extractText', () => {
  it('prefers the longest article and skips tiny ones like author cards', () => {
    const html = `<body><article>By Jane</article><article class="[&>p]:mt-2"><p>${'Real post. '.repeat(30)}</p></article></body>`;
    expect(extractText(html)).toBe('Real post. '.repeat(30).trim());
  });

  it('falls through to <main> or the body when no container has enough text', () => {
    expect(extractText(`<article>tiny</article><main>${'Main text. '.repeat(30)}</main>`)).toMatch(/^Main text\./);
    expect(extractText('<body><div>Only body</div></body>')).toBe('Only body');
  });

  it('drops scripts and quoted ">" in attributes, decodes entities and caps the length', () => {
    const html = `<body><script>x()</script><div class="a>b">we&#x27;d &amp; &lt;3 &#8212; ok&nbsp;</div></body>`;
    expect(extractText(html)).toBe("we'd & <3 — ok");
    expect(extractText(`<body>${'a'.repeat(50)}</body>`, 10)).toBe('a'.repeat(10));
  });
});
