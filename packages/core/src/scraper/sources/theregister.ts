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
      return parseAtom(xml);
    } catch (err) {
      console.error('[theregister] fetch failed:', err instanceof Error ? err.message : err);
      return [];
    }
  },
};

function parseAtom(xml: string): ScrapedItem[] {
  const items: ScrapedItem[] = [];

  const parts = xml.split('<entry>');
  for (let i = 1; i < parts.length; i++) {
    const end = parts[i].indexOf('</entry>');
    const block = end === -1 ? parts[i] : parts[i].slice(0, end);

    const title = extractTag(block, 'title');
    const url = extractLink(block);
    const published = extractTag(block, 'published');
    const summary = extractTag(block, 'summary');

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
  return (xml.match(re)?.[1] ?? '').trim();
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
    .replace(/&#39;/g, "'");
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
