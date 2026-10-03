import type { SourcePlugin, ScrapedItem } from '../../types.js';

const FEED_URL = 'https://aztty.azurewebsites.net/rss/updates?service=166';

export const azureSreAgentSource: SourcePlugin = {
  id: 'azure-sre-agent',
  displayName: 'Azure SRE Agent Updates',
  capabilities: { preview: true },

  async fetch(): Promise<ScrapedItem[]> {
    try {
      const res = await globalThis.fetch(FEED_URL, {
        headers: { 'User-Agent': 'fomo-release-tracker/1.0' },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const xml = await res.text();
      return parseRss(xml);
    } catch (err) {
      throw new Error(`[azure-sre-agent] fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

function parseRss(xml: string): ScrapedItem[] {
  const items: ScrapedItem[] = [];

  const parts = xml.split('<item>');
  for (let i = 1; i < parts.length; i++) {
    const end = parts[i].indexOf('</item>');
    const block = end === -1 ? parts[i] : parts[i].slice(0, end);

    const title = extractTag(block, 'title');
    const url = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate');
    const description = extractTag(block, 'description')
      .replace(/<!\[CDATA\[|\]\]>/g, '')
      .trim();

    if (!title || !url) continue;

    const datePublished = pubDate ? new Date(pubDate) : new Date();

    items.push({ title, url, datePublished, content: stripHtml(description) });
  }

  return items;
}

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i');
  return (xml.match(re)?.[1] ?? '').trim();
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
