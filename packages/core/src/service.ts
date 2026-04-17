import { UpdateStore, type BackupPayload } from './store/tables.js';
import { getAllSources, getSource, getSourceIds } from './scraper/registry.js';
import type {
  FomoService,
} from './client.js';
import type {
  Update,
  ListOptions,
  ListResponse,
  FetchRequest,
  FetchResponse,
  StatsResponse,
  Status,
  SourceInfo,
  SourceFetchResult,
  AppSettings,
} from './types.js';

/**
 * Direct implementation of FomoService — calls store + scrapers locally
 * without going through an HTTP API server.
 */
export class FomoDirectService implements FomoService {
  private readonly store: UpdateStore;
  private initPromise: Promise<void> | undefined;

  constructor(connectionString: string) {
    this.store = new UpdateStore(connectionString);
  }

  private async ensureInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.store.init();
    }
    await this.initPromise;
  }

  async listUpdates(options: ListOptions = {}): Promise<ListResponse> {
    await this.ensureInit();
    return this.store.listUpdates(options);
  }

  async getUpdate(id: string): Promise<Update> {
    await this.ensureInit();
    const update = await this.store.getUpdate(id);
    if (!update) throw new Error(`Update not found: ${id}`);
    return update;
  }

  async setStatus(id: string, status: Status): Promise<Update> {
    await this.ensureInit();
    return this.store.setStatus(id, status);
  }

  async setSaved(id: string, saved: boolean): Promise<Update> {
    await this.ensureInit();
    return this.store.setSaved(id, saved);
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

  async getStats(): Promise<StatsResponse> {
    await this.ensureInit();
    return this.store.getStats();
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

  async getSources(): Promise<SourceInfo[]> {
    return getAllSources().map((s) => ({
      id: s.id,
      displayName: s.displayName,
      capabilities: s.capabilities,
    }));
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

  // ─── Settings ──────────────────────────────────────────────────────────────

  async getSettings(): Promise<AppSettings> {
    await this.ensureInit();
    return this.store.getSettings();
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    await this.ensureInit();
    return this.store.updateSettings(patch);
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
