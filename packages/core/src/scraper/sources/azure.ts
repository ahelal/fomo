import type { SourcePlugin, ScrapedItem } from '../../types.js';
import { parseRss } from '../rss.js';

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
