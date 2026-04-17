import type { SourcePlugin, ScrapedItem } from '../../types.js';

const RSS_URL = 'https://github.blog/changelog/feed/';
const FETCH_HEADERS = { 'User-Agent': 'fomo-release-tracker/1.0' };

export const githubSource: SourcePlugin = {
  id: 'github',
  displayName: 'GitHub Changelog',
  capabilities: { preview: true },

  async fetch(): Promise<ScrapedItem[]> {
    try {
      const res = await globalThis.fetch(RSS_URL, {
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const xml = await res.text();
      return parseRss(xml);
    } catch (err) {
      console.error('[github] fetch failed:', err instanceof Error ? err.message : err);
      return [];
    }
  },
};

function parseRss(xml: string): ScrapedItem[] {
  const items: ScrapedItem[] = [];
  const itemPattern = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemPattern.exec(xml)) !== null) {
    const block = match[1];

    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate');

    if (!title || !link) continue;

    // Prefer <content:encoded> (full article), fall back to <description>
    const content = extractCdata(block, 'content:encoded')
      || extractCdata(block, 'description')
      || '';

    const cleaned = stripHtml(content);

    items.push({
      title,
      url: link,
      datePublished: pubDate ? new Date(pubDate) : new Date(),
      content: cleaned.slice(0, 3000),
    });
  }

  return items;
}

function extractTag(block: string, tag: string): string {
  // Handle both plain text and CDATA
  const cdataMatch = block.match(new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i'));
  if (cdataMatch) return cdataMatch[1].trim();

  const plainMatch = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return plainMatch ? plainMatch[1].trim() : '';
}

function extractCdata(block: string, tag: string): string {
  const cdataMatch = block.match(new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i'));
  if (cdataMatch) return cdataMatch[1].trim();

  const plainMatch = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return plainMatch ? plainMatch[1].trim() : '';
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&hellip;/g, '…')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
