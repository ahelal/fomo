import type { SourcePlugin, ScrapedItem } from '../../types.js';

const FEED_URL = 'https://www.microsoft.com/releasecommunications/api/v2/azure/rss';

export const azureSource: SourcePlugin = {
  id: 'azure',
  displayName: 'Azure Updates',
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
      throw new Error(`[azure] fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

function parseRss(xml: string): ScrapedItem[] {
  const items: ScrapedItem[] = [];

  // Split on <item> boundaries — avoids regex exec loop quirks
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

    const datePublished = pubDate ? parseRfcDate(pubDate) : new Date();

    items.push({ title, url, datePublished, content: stripHtml(description) });
  }

  return items;
}

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i');
  return (xml.match(re)?.[1] ?? '').trim();
}

function parseRfcDate(raw: string): Date {
  const d = new Date(raw);
  return isNaN(d.getTime()) ? new Date() : d;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}
