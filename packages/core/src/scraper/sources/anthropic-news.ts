import type { SourcePlugin, ScrapedItem } from '../../types.js';

const BASE_URL = 'https://www.anthropic.com';
const NEWS_URL = `${BASE_URL}/news`;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 fomo-release-tracker/1.0',
  'Accept': 'text/html',
};

export const anthropicNewsSource: SourcePlugin = {
  id: 'anthropic-news',
  displayName: 'Anthropic News',
  capabilities: { preview: false },

  async fetch(): Promise<ScrapedItem[]> {
    try {
      const res = await globalThis.fetch(NEWS_URL, {
        headers: HEADERS,
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const html = await res.text();
      return parseNews(html);
    } catch (err) {
      console.error('[anthropic-news] fetch failed:', err instanceof Error ? err.message : err);
      return [];
    }
  },
};

function parseNews(html: string): ScrapedItem[] {
  const items: ScrapedItem[] = [];

  // Match each <a href="/news/slug"> block
  const linkRe = /<a\s[^>]*href="(\/news\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRe.exec(html)) !== null) {
    const [, path, body] = match;

    const title = extractTitle(body);
    const date = extractTime(body);

    if (!title) continue;

    items.push({
      title,
      url: `${BASE_URL}${path}`,
      datePublished: date ? parseDate(date) : new Date(),
    });
  }

  return dedup(items);
}

function extractTitle(body: string): string {
  // <span class="...title...">Title text</span>
  const m = body.match(/__title[^>]*>([^<]+)</i);
  if (m) return m[1].trim();
  // fallback: last non-empty text node
  const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = text.split(/\s{2,}/);
  return parts[parts.length - 1]?.trim() ?? '';
}

function extractTime(body: string): string {
  const m = body.match(/<time[^>]*>([^<]+)<\/time>/i);
  return m ? m[1].trim() : '';
}

function parseDate(raw: string): Date {
  const d = new Date(raw);
  return isNaN(d.getTime()) ? new Date() : d;
}

function dedup(items: ScrapedItem[]): ScrapedItem[] {
  const seen = new Set<string>();
  return items.filter(i => {
    if (seen.has(i.url)) return false;
    seen.add(i.url);
    return true;
  });
}
