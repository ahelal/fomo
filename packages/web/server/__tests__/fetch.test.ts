import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { fetchRouter } from '../routes/fetch.js';

vi.mock('@fomo/core/scrapers', () => {
  const mockSource = {
    id: 'mock-source',
    displayName: 'Mock Source',
    capabilities: { preview: false },
    fetch: vi.fn().mockResolvedValue([
      {
        title: 'Scraped Item',
        url: 'https://example.com/item',
        datePublished: new Date('2025-01-01'),
        content: 'Test content',
      },
    ]),
  };

  return {
    getAllSources: vi.fn(() => [mockSource]),
    getSource: vi.fn((id: string) => (id === 'mock-source' ? mockSource : undefined)),
    getSourceIds: vi.fn(() => ['mock-source']),
  };
});

function createMockStore() {
  return {
    insertUpdate: vi.fn().mockResolvedValue(true),
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
}

describe('fetch router', () => {
  let app: Hono;
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createMockStore();
    app = new Hono();
    app.route('/fetch', fetchRouter(store as any));
  });

  it('POST /fetch runs all sources', async () => {
    const res = await app.request('/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.added).toBe(1);
    expect(body.results['mock-source'].fetched).toBe(1);
    expect(body.results['mock-source'].added).toBe(1);
  });

  it('POST /fetch with specific sources', async () => {
    const res = await app.request('/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources: ['mock-source'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.added).toBe(1);
  });

  it('POST /fetch with unknown source returns 400', async () => {
    const res = await app.request('/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources: ['nonexistent'] }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /fetch with empty body works (defaults to all)', async () => {
    const res = await app.request('/fetch', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});
