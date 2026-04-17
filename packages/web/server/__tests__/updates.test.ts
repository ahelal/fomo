import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { updatesRouter } from '../routes/updates.js';

// Minimal mock store
function createMockStore() {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    listUpdates: vi.fn().mockResolvedValue({
      updates: [
        {
          id: 'github__abc123',
          source: 'github',
          title: 'Test Update',
          url: 'https://example.com',
          datePublished: '2025-01-01T00:00:00Z',
          dateAdded: '2025-01-01T00:00:00Z',
          status: 'unread',
          saved: false,
          content: '',
        },
      ],
      total: 1,
      hasMore: false,
    }),
    getUpdate: vi.fn().mockResolvedValue({
      id: 'github__abc123',
      source: 'github',
      title: 'Test Update',
      url: 'https://example.com',
      datePublished: '2025-01-01T00:00:00Z',
      dateAdded: '2025-01-01T00:00:00Z',
      status: 'unread',
      saved: false,
      content: '',
    }),
    setStatus: vi.fn().mockImplementation((id: string, status: string) =>
      Promise.resolve({
        id,
        source: 'github',
        title: 'Test Update',
        url: 'https://example.com',
        datePublished: '2025-01-01T00:00:00Z',
        dateAdded: '2025-01-01T00:00:00Z',
        status,
        saved: false,
        content: '',
      }),
    ),
    setSaved: vi.fn().mockImplementation((id: string, saved: boolean) =>
      Promise.resolve({
        id,
        source: 'github',
        title: 'Test Update',
        url: 'https://example.com',
        datePublished: '2025-01-01T00:00:00Z',
        dateAdded: '2025-01-01T00:00:00Z',
        status: 'unread',
        saved,
        content: '',
      }),
    ),
    updateContent: vi.fn(),
    insertUpdate: vi.fn().mockResolvedValue(true),
    getStats: vi.fn().mockResolvedValue({
      total: 1,
      byStatus: { unread: 1, read: 0 },
      bySource: { github: 1 },
      saved: 0,
    }),
  };
}

describe('updates router', () => {
  let app: Hono;
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
    app = new Hono();
    app.route('/updates', updatesRouter(store as any));
  });

  it('GET /updates returns list', async () => {
    const res = await app.request('/updates');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updates).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it('GET /updates with status filter', async () => {
    await app.request('/updates?status=unread');
    expect(store.listUpdates).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'unread' }),
    );
  });

  it('GET /updates rejects invalid status', async () => {
    const res = await app.request('/updates?status=bogus');
    expect(res.status).toBe(400);
  });

  it('GET /updates/:id returns update', async () => {
    const res = await app.request('/updates/github__abc123');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('github__abc123');
  });

  it('GET /updates/:id returns 400 on invalid id', async () => {
    const res = await app.request('/updates/nope');
    expect(res.status).toBe(400);
  });

  it('GET /updates/:id returns 404 on missing', async () => {
    store.getUpdate.mockResolvedValue(null);
    const res = await app.request('/updates/github__missing');
    expect(res.status).toBe(404);
  });

  it('PATCH /updates/:id/status updates status', async () => {
    const res = await app.request('/updates/github__abc123/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'read' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('read');
  });

  it('PATCH /updates/:id/status rejects invalid status', async () => {
    const res = await app.request('/updates/github__abc123/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'bogus' }),
    });
    expect(res.status).toBe(400);
  });

  it('PATCH /updates/:id/saved toggles saved', async () => {
    const res = await app.request('/updates/github__abc123/saved', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saved: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(true);
  });

  it('PATCH /updates/:id/saved rejects non-boolean', async () => {
    const res = await app.request('/updates/github__abc123/saved', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saved: 'yes' }),
    });
    expect(res.status).toBe(400);
  });
});
