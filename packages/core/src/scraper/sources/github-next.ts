import type { SourcePlugin, ScrapedItem } from '../../types.js';

const RSS_URL = 'https://githubnext.com/rss.xml';
const FETCH_HEADERS = { 'User-Agent': 'fomo-release-tracker/1.0' };

export const githubNextSource: SourcePlugin = {
  id: 'github-next',
  displayName: 'GitHub Next',
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
      console.error('[github-next] fetch failed:', err instanceof Error ? err.message : err);
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

    const description = extractTag(block, 'description');

    items.push({
      title: stripHtml(title),
      url: link,
      datePublished: pubDate ? new Date(pubDate) : new Date(),
      content: stripHtml(description).slice(0, 3000),
    });
  }

  return items;
}

function extractTag(block: string, tag: string): string {
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
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"').replace(/&mdash;/g, '—').replace(/&hellip;/g, '…')
    .replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
}
