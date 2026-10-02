import type { BackupPayload } from './store/tables.js';
import { getAllSources, getSource, getSourceIds } from './scraper/registry.js';
import { FomoStorageService } from './storage-service.js';
import { runDigest, type Summarizer, type DigestOptions, type DigestResult } from './digest/run.js';
import { GIST_MAX_INPUT_CHARS, GIST_MIN_CHARS, gistSource, writeGist } from './digest/gist.js';
import type {
  StoreConnection,
  Update,
  FetchRequest,
  FetchResponse,
  SourceFetchResult,
} from './types.js';

/** What `summarizePost` did: wrote a new gist, returned the saved one, or skipped a post too short to condense. */
export type PostGistOutcome = 'created' | 'cached' | 'short';

export interface PostGistResult {
  update: Update;
  outcome: PostGistOutcome;
  /** Where the summarised text came from (set when `outcome` is `created`). */
  from?: 'page' | 'preview';
}

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

    const content = await fetchPageText(update.url);
    if (!content) throw new Error('Could not extract content');

    return this.store.updateContent(id, content);
  }

  /**
   * Summarise a post with `summarizer` and save the gist. The linked page (for Azure Updates, the
   * release API) is fetched and used when it says more than the stored preview. A saved gist is
   * returned as is unless `force` is set; posts shorter than `GIST_MIN_CHARS` are skipped.
   */
  async summarizePost(id: string, summarizer: Summarizer, options: { force?: boolean } = {}): Promise<PostGistResult> {
    await this.ensureInit();
    const update = await this.store.getUpdate(id);
    if (!update) throw new Error(`Update not found: ${id}`);
    if (update.gist && !options.force) return { update, outcome: 'cached' };

    let pageText: string | undefined;
    let fetchError: string | undefined;
    try {
      pageText = await fetchPageText(update.url, GIST_MAX_INPUT_CHARS);
    } catch (err) {
      fetchError = err instanceof Error ? err.message : String(err);
    }
    const source = gistSource(update, pageText);
    if (source.text.length < GIST_MIN_CHARS) {
      if (fetchError) throw new Error(`Could not fetch the post (${fetchError}) and the preview is too short to summarise`);
      return { update, outcome: 'short' };
    }

    const gist = await writeGist(update, source.text, summarizer);
    await this.store.setGist(id, gist);
    return { update: { ...update, gist }, outcome: 'created', from: source.from };
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

const AZURE_UPDATE_API = 'https://www.microsoft.com/releasecommunications/api/v2/azure/';

/** The id of an Azure Updates page (`azure.microsoft.com/updates?id=…`). */
function azureUpdateId(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (u.hostname !== 'azure.microsoft.com' || !/^\/(?:[a-z]{2}-[a-z]{2}\/)?updates\/?$/i.test(u.pathname)) return undefined;
    const id = u.searchParams.get('id');
    return id && /^\d+$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

interface AzureUpdateJson {
  title?: string;
  description?: string;
  status?: string | null;
  privatePreviewAvailabilityDate?: string | null;
  previewAvailabilityDate?: string | null;
  generalAvailabilityDate?: string | null;
  products?: string[];
}

/**
 * Azure Updates pages are rendered by JavaScript and the feed cuts descriptions short, so the full
 * text comes from the release communications API the feed is served from.
 */
async function fetchAzureUpdateText(id: string): Promise<string> {
  const resp = await globalThis.fetch(`${AZURE_UPDATE_API}${id}`, {
    signal: AbortSignal.timeout(15_000),
    headers: { 'User-Agent': 'fomo/1.0', Accept: 'application/json' },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const item = (await resp.json()) as AzureUpdateJson;
  const facts = [
    item.status && `Status: ${item.status}`,
    item.privatePreviewAvailabilityDate && `Private preview: ${item.privatePreviewAvailabilityDate}`,
    item.previewAvailabilityDate && `Preview: ${item.previewAvailabilityDate}`,
    item.generalAvailabilityDate && `General availability: ${item.generalAvailabilityDate}`,
    item.products?.length && `Products: ${item.products.join(', ')}`,
  ].filter(Boolean);
  return [item.title, facts.join('. '), htmlToText(item.description ?? '')].filter(Boolean).join('\n\n');
}

/** Fetch a page and return its main text (empty when nothing could be extracted). */
async function fetchPageText(url: string, maxChars = 5000): Promise<string> {
  const azureId = azureUpdateId(url);
  if (azureId) return (await fetchAzureUpdateText(azureId)).slice(0, maxChars);
  const resp = await globalThis.fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { 'User-Agent': 'fomo/1.0' },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return extractText(await resp.text(), maxChars);
}

/** Opening tag whose attribute values may contain `>` (e.g. Tailwind classes). */
const OPEN = (tag: string) => `<${tag}\\b(?:[^>"']|"[^"]*"|'[^']*')*>`;

/** Main-content containers, most specific first; the longest match of the first useful one wins. */
const CONTENT_PATTERNS = [
  new RegExp(`${OPEN('article')}([\\s\\S]*?)<\\/article>`, 'gi'),
  /<div[^>]*class="[^"]*post-content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  /<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  new RegExp(`${OPEN('main')}([\\s\\S]*?)<\\/main>`, 'gi'),
];

/** Shorter matches are page furniture such as author cards, so the next pattern is tried. */
const MIN_CONTENT_CHARS = 200;

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function codePoint(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
}

function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?[a-z](?:[^>"']|"[^"]*"|'[^']*')*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(Number(dec)))
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, (_, name: string) => ENTITIES[name.toLowerCase()]!)
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Main text of an HTML page: the best content container, else the whole body. */
export function extractText(html: string, maxChars = 5000): string {
  const page = html.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ');
  for (const pattern of CONTENT_PATTERNS) {
    let best = '';
    for (const m of page.matchAll(pattern)) {
      const text = htmlToText(m[1] ?? '');
      if (text.length > best.length) best = text;
    }
    if (best.length >= MIN_CONTENT_CHARS) return best.slice(0, maxChars);
  }
  const body = page.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return htmlToText(body ? body[1]! : page).slice(0, maxChars);
}
