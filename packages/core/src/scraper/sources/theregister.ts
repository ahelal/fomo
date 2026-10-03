import type { SourcePlugin, ScrapedItem } from '../../types.js';

const FEED_URL = 'https://www.theregister.com/headlines.atom';

export const theRegisterSource: SourcePlugin = {
  id: 'theregister',
  displayName: 'The Register',
  capabilities: { preview: true },

  async fetch(): Promise<ScrapedItem[]> {
    try {
      const res = await globalThis.fetch(FEED_URL, {
        headers: { 'User-Agent': 'fomo-release-tracker/1.0' },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const xml = await res.text();
      return parseFeed(xml);
    } catch (err) {
      throw new Error(`[theregister] fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

function parseFeed(xml: string): ScrapedItem[] {
  const items: ScrapedItem[] = [];

  const entries = [...xml.matchAll(/<(entry|item)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  for (const [, type, block] of entries) {
    const rss = type.toLowerCase() === 'item';

    const title = extractTag(block, 'title');
    const url = rss ? extractTag(block, 'link') : extractLink(block);
    const published = extractTag(block, rss ? 'pubDate' : 'published');
    const summary = extractTag(block, rss ? 'content:encoded' : 'summary')
      || extractTag(block, 'description');

    if (!title || !url) continue;

    items.push({
      title: decodeEntities(title),
      url,
      datePublished: published ? new Date(published) : new Date(),
      content: stripHtml(decodeEntities(summary)),
    });
  }

  return items;
}

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  return (xml.match(re)?.[1] ?? '')
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .trim();
}

function extractLink(block: string): string {
  // Atom uses <link rel="alternate" href="..."/>
  const match = block.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i);
  return match?.[1] ?? '';
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'");
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
