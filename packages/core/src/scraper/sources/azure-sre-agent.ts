import type { SourcePlugin, ScrapedItem } from '../../types.js';
import { azureSource } from './azure.js';
import { parseRss } from '../rss.js';

const BLOG_FEED_URL = 'https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=AppsonAzureBlog&count=100';

export const azureSreAgentSource: SourcePlugin = {
  id: 'azure-sre-agent',
  displayName: 'Azure SRE Agent Updates',
  capabilities: { preview: true },

  async fetch(): Promise<ScrapedItem[]> {
    try {
      const [updates, posts] = await Promise.all([azureSource.fetch(), fetchBlogPosts()]);
      const items = [...updates, ...posts].filter(
        (item) => /\bsre\s+agents?\b/i.test(`${item.title} ${item.content ?? ''}`),
      );
      return [...new Map(items.map((item) => [item.url, item])).values()];
    } catch (err) {
      throw new Error(`[azure-sre-agent] fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

async function fetchBlogPosts(): Promise<ScrapedItem[]> {
  const res = await globalThis.fetch(BLOG_FEED_URL, {
    headers: { 'User-Agent': 'fomo-release-tracker/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Tech Community fetch failed: HTTP ${res.status}`);
  return parseRss(await res.text());
}
