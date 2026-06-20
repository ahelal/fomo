import type { SourcePlugin, ScrapedItem } from '../../types.js';

const BASE_URL = 'https://www.anthropic.com';
const ENG_URL = `${BASE_URL}/engineering`;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 fomo-release-tracker/1.0',
  'Accept': 'text/html',
};

export const anthropicEngineeringSource: SourcePlugin = {
  id: 'anthropic-engineering',
  displayName: 'Anthropic Engineering',
  capabilities: { preview: false },

  async fetch(): Promise<ScrapedItem[]> {
    try {
      const res = await globalThis.fetch(ENG_URL, {
        headers: HEADERS,
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const html = await res.text();
      return parsePosts(html);
    } catch (err) {
      console.error('[anthropic-engineering] fetch failed:', err instanceof Error ? err.message : err);
      return [];
    }
  },
};

function parsePosts(html: string): ScrapedItem[] {
  const items: ScrapedItem[] = [];

  const linkRe = /<a\s[^>]*href="(\/engineering\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
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
  // fallback: strip tags and take meaningful text
  const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  // skip very short or date-only strings
  if (text.length < 10) return '';
  return text.split(/\s{2,}/)[0]?.trim() ?? '';
}

function extractTime(body: string): string {
  const m = body.match(/<time[^>]*>([^<]+)<\/time>/i);
  if (m) return m[1].trim();
  // Engineering page often has "Mar 25, 2026" inline text
  const dm = body.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\b/);
  return dm ? dm[0] : '';
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
