import type { BackupPayload } from './store/tables.js';
import { getAllSources, getSource, getSourceIds } from './scraper/registry.js';
import { FomoStorageService } from './storage-service.js';
import { runDigest, type Summarizer, type DigestOptions, type DigestResult } from './digest/run.js';
import type {
  StoreConnection,
  Update,
  FetchRequest,
  FetchResponse,
  SourceFetchResult,
} from './types.js';

/**
 * Node-side service for the TUI: storage access plus scraping, AI digest and backup.
 * Requires a connection string (or a SAS) with network access to the sources.
 */
export class FomoDirectService extends FomoStorageService {
  constructor(conn: StoreConnection) {
    super(conn);
  }

  async fetchContent(id: string): Promise<Update> {
    await this.ensureInit();
    const update = await this.store.getUpdate(id);
    if (!update) throw new Error(`Update not found: ${id}`);

    const resp = await globalThis.fetch(update.url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'fomo/1.0' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();

    const content = extractText(html);
    if (!content) throw new Error('Could not extract content');

    return this.store.updateContent(id, content);
  }

  async fetch(req: FetchRequest = {}): Promise<FetchResponse> {
    await this.ensureInit();

    const settings = await this.store.getSettings();
    let sources = getAllSources();

    if (req.sources && req.sources.length > 0) {
      // Explicit source list — ignore disabledSources
      sources = req.sources
        .map((id) => getSource(id))
        .filter((s): s is NonNullable<typeof s> => s !== undefined);

      if (sources.length === 0) {
        throw new Error(`None of the requested sources are registered. Available: ${getSourceIds().join(', ')}`);
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
            const inserted = await this.store.insertUpdate({
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
        }

        results[source.id] = result;
        totalAdded += result.added;
      }),
    );

    return { added: totalAdded, results };
  }

  /** Export all updates from remote table storage as a backup payload. */
  async backup(): Promise<BackupPayload> {
    await this.ensureInit();
    return this.store.backup();
  }

  /** Restore updates from a backup payload into remote table storage. */
  async restore(payload: BackupPayload): Promise<number> {
    await this.ensureInit();
    return this.store.restore(payload);
  }

  // ─── Digest ────────────────────────────────────────────────────────────────

  /** Group unread, ungrouped updates into topics with highlights using `summarizer`. */
  async digest(summarizer: Summarizer, options: DigestOptions = {}): Promise<DigestResult> {
    await this.ensureInit();
    return runDigest({ updates: this.store, topics: this.topicStore }, summarizer, options);
  }
}

function extractText(html: string): string {
  const patterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]*class="[^"]*post-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
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

  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 5000);
}
