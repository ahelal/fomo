import type { ScrapedItem, SourcePlugin, SourceSpec } from '../types.js';
import { parseFeed } from './feed.js';
import { fetchText } from './http.js';
import { fetchGithubReleases, releaseItems } from './github.js';
import { sourceInfo } from './specs.js';
import { dedupByUrl } from './text.js';
import { CUSTOM_MODULES } from './sources/custom/index.js';

/** Turn a source spec into a plugin; fetch errors are prefixed with the source id. */
export function createSource(spec: SourceSpec): SourcePlugin {
  const { id, displayName, capabilities } = sourceInfo(spec);
  const load = loader(spec);
  return {
    id,
    displayName,
    capabilities,
    async fetch() {
      try {
        return await load();
      } catch (err) {
        throw new Error(`[${id}] fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}

function loader(spec: SourceSpec): () => Promise<ScrapedItem[]> {
  switch (spec.kind) {
    case 'feed':
      return async () => {
        const many = spec.urls.length > 1;
        const lists = await Promise.all(spec.urls.map(async (url) => {
          try {
            return parseFeed(await fetchText(url), spec);
          } catch (err) {
            // Say which feed failed when there are several
            if (!many) throw err;
            throw new Error(`${new URL(url).hostname}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }));
        return dedupByUrl(lists.flat());
      };
    case 'github-releases':
      return async () => releaseItems(await fetchGithubReleases(spec.repo));
    case 'custom': {
      const fetcher = CUSTOM_MODULES[spec.module];
      return async () => {
        if (!fetcher) throw new Error(`unknown custom module “${spec.module}”`);
        return fetcher(spec.options ?? {});
      };
    }
  }
}
