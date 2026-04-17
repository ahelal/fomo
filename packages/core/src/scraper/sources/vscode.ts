import type { SourcePlugin, ScrapedItem } from '../../types.js';

const FEED_URL = 'https://code.visualstudio.com/feed.xml';

export const vscodeSource: SourcePlugin = {
  id: 'vscode',
  displayName: 'VS Code Updates',
  capabilities: { preview: true },

  async fetch(): Promise<ScrapedItem[]> {
    try {
      const res = await globalThis.fetch(FEED_URL, {
        headers: { 'User-Agent': 'fomo-release-tracker/1.0' },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const xml = await res.text();
      return parseAtomFeed(xml);
    } catch (err) {
      console.error('[vscode] fetch failed:', err instanceof Error ? err.message : err);
      return [];
    }
  },
};

/** Parse Atom feed XML and return only release entries (not blog posts). */
function parseAtomFeed(xml: string): ScrapedItem[] {
  const items: ScrapedItem[] = [];

  // Split into <entry>...</entry> blocks
  const entryPattern = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;

  while ((match = entryPattern.exec(xml)) !== null) {
    const entry = match[1];

    // Only include release entries (skip blog posts)
    if (!/<category\s+term="release"\s*\/>/.test(entry)) continue;

    const title = extractTag(entry, 'title') ?? '';
    const url = extractAttr(entry, 'link', 'href') ?? '';
    const updated = extractTag(entry, 'updated') ?? '';
    const content = extractTag(entry, 'content') ?? '';

    if (!title || !url) continue;

    // Decode HTML entities in content and strip tags
    const plainContent = content
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    items.push({
      title,
      url,
      datePublished: updated ? new Date(updated) : new Date(),
      content: plainContent.slice(0, 2000),
    });
  }

  return items;
}

function extractTag(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m?.[1]?.trim();
}

function extractAttr(xml: string, tag: string, attr: string): string | undefined {
  const m = new RegExp(`<${tag}\\s+${attr}="([^"]*)"`, 'i').exec(xml);
  return m?.[1];
}
