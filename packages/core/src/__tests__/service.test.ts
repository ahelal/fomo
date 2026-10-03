import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FomoDirectService, extractText } from '../service.js';

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
    updateContent: vi.fn(),
    insertUpdate: vi.fn().mockResolvedValue(true),
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

  it('fetch with specific sources filters to those sources', async () => {
    const result = await svc.fetch({ sources: ['mock-source'] });
    expect(result.added).toBe(1);
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

  it('getSources returns source metadata', async () => {
    const sources = await svc.getSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe('mock-source');
    expect(sources[0].displayName).toBe('Mock Source');
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
