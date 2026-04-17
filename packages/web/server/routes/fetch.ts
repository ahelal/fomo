import { Hono } from 'hono';
import type { UpdateStore } from '@fomo/core/store';
import { getAllSources, getSource, getSourceIds } from '@fomo/core/scrapers';
import type { FetchResponse, SourceFetchResult } from '@fomo/core';

export function fetchRouter(store: UpdateStore) {
  const router = new Hono();

  // POST /fetch
  router.post('/', async (c) => {
    let body: { sources?: unknown } = {};
    try {
      body = await c.req.json<{ sources?: unknown }>();
    } catch {
      // empty body is fine — defaults to all sources
    }

    const settings = await store.getSettings();

    // Resolve which sources to run
    let sources = getAllSources();
    if (Array.isArray(body.sources) && body.sources.length > 0) {
      // Explicit list — ignore disabledSources
      const ids = body.sources as string[];
      sources = ids
        .map((id) => getSource(id))
        .filter((s): s is NonNullable<typeof s> => s !== undefined);

      if (sources.length === 0) {
        return c.json(
          { error: `None of the requested sources are registered. Available: ${getSourceIds().join(', ')}` },
          400,
        );
      }
    } else {
      // No explicit list — respect disabledSources setting
      const disabled = new Set(settings.disabledSources);
      if (disabled.size > 0) {
        sources = sources.filter((s) => !disabled.has(s.id));
      }
    }

    let totalAdded = 0;
    const results: Record<string, SourceFetchResult> = {};

    await Promise.all(
      sources.map(async (source) => {
        const result: SourceFetchResult = { fetched: 0, added: 0 };

        try {
          const items = await source.fetch();
          result.fetched = items.length;

          for (const item of items) {
            const inserted = await store.insertUpdate({
              source: source.id,
              title: item.title,
              url: item.url,
              datePublished: item.datePublished.toISOString(),
              content: item.content ?? '',
            });
            if (inserted) result.added++;
          }
        } catch (err) {
          result.error = err instanceof Error ? err.message : String(err);
          console.error(`[fetch] source=${source.id} error:`, err);
        }

        results[source.id] = result;
        totalAdded += result.added;
      }),
    );

    const response: FetchResponse = { added: totalAdded, results };
    return c.json(response);
  });

  return router;
}
