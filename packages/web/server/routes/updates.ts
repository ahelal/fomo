import { Hono } from 'hono';
import type { UpdateStore } from '@fomo/core/store';
import { parseId } from '@fomo/core/store';
import type { Status } from '@fomo/core';

const VALID_STATUSES: Status[] = ['unread', 'read'];

export function updatesRouter(store: UpdateStore) {
  const router = new Hono();

  // GET /updates
  router.get('/', async (c) => {
    const status = c.req.query('status') as Status | 'all' | undefined;
    const source = c.req.query('source');
    const savedParam = c.req.query('saved');
    const limit = Number(c.req.query('limit') ?? 50);
    const offset = Number(c.req.query('offset') ?? 0);

    if (status && status !== 'all' && !VALID_STATUSES.includes(status as Status)) {
      return c.json({ error: `Invalid status. Must be one of: all, ${VALID_STATUSES.join(', ')}` }, 400);
    }

    const saved = savedParam === 'true' ? true : savedParam === 'false' ? false : undefined;
    const result = await store.listUpdates({ status, source, saved, limit, offset });
    return c.json(result);
  });

  // GET /updates/:id
  router.get('/:id', async (c) => {
    const id = c.req.param('id');

    try {
      parseId(id);
    } catch {
      return c.json({ error: 'Invalid update id' }, 400);
    }

    const update = await store.getUpdate(id);
    if (!update) return c.json({ error: 'Not found' }, 404);
    return c.json(update);
  });

  // PATCH /updates/:id/status
  router.patch('/:id/status', async (c) => {
    const id = c.req.param('id');

    try {
      parseId(id);
    } catch {
      return c.json({ error: 'Invalid update id' }, 400);
    }

    let body: { status?: unknown };
    try {
      body = await c.req.json<{ status?: unknown }>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { status } = body;
    if (!status || !VALID_STATUSES.includes(status as Status)) {
      return c.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
    }

    const updated = await store.setStatus(id, status as Status);
    return c.json(updated);
  });

  // PATCH /updates/:id/saved
  router.patch('/:id/saved', async (c) => {
    const id = c.req.param('id');

    try {
      parseId(id);
    } catch {
      return c.json({ error: 'Invalid update id' }, 400);
    }

    let body: { saved?: unknown };
    try {
      body = await c.req.json<{ saved?: unknown }>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (typeof body.saved !== 'boolean') {
      return c.json({ error: 'saved must be a boolean' }, 400);
    }

    const updated = await store.setSaved(id, body.saved);
    return c.json(updated);
  });

  // POST /updates/:id/fetch-content
  router.post('/:id/fetch-content', async (c) => {
    const id = c.req.param('id');

    try {
      parseId(id);
    } catch {
      return c.json({ error: 'Invalid update id' }, 400);
    }

    const update = await store.getUpdate(id);
    if (!update) return c.json({ error: 'Not found' }, 404);

    try {
      const resp = await fetch(update.url, {
        signal: AbortSignal.timeout(15_000),
        headers: { 'User-Agent': 'fomo/1.0' },
      });
      if (!resp.ok) {
        return c.json({ error: `Failed to fetch URL: ${resp.status}` }, 502);
      }
      const html = await resp.text();

      const content = extractTextContent(html);
      if (!content) {
        return c.json({ error: 'Could not extract content from page' }, 422);
      }

      const updated = await store.updateContent(id, content);
      return c.json(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Fetch failed: ${msg}` }, 502);
    }
  });

  return router;
}

/** Extract readable text from an HTML page. */
function extractTextContent(html: string): string {
  const patterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]*class="[^"]*post-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*article-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
  ];

  let raw = '';
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m) { raw = m[1]; break; }
  }
  if (!raw) {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    raw = bodyMatch ? bodyMatch[1] : html;
  }

  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text.slice(0, 5000);
}
