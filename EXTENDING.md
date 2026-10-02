# Adding a New Source

Sources are TypeScript plugins in `@fomo/core`. Adding one requires two files.

## Plugin Interface

```typescript
import type { SourcePlugin, ScrapedItem, SourceCapabilities } from '@fomo/core';
```

### `ScrapedItem`

| Field           | Type     | Notes                                             |
|-----------------|----------|----------------------------------------------------|
| `title`         | `string` | Required                                           |
| `url`           | `string` | Required — used as dedup key (`sha256(url)`)       |
| `datePublished` | `Date`   | Required                                           |
| `content`       | `string` | Optional — set when `capabilities.preview` is true |

### `SourcePlugin`

| Field          | Type                          | Notes                                |
|----------------|-------------------------------|--------------------------------------|
| `id`           | `string`                      | Unique slug, used as PartitionKey    |
| `displayName`  | `string`                      | Human-readable name                  |
| `capabilities` | `{ preview: boolean }`        | Whether source provides body content |
| `fetch()`      | `() => Promise<ScrapedItem[]>`| Return `[]` on failure, never throw  |

## 1. Create the plugin

Create `packages/core/src/scraper/sources/<name>.ts`:

```typescript
import type { SourcePlugin, ScrapedItem } from '../../types.js';

export const mySource: SourcePlugin = {
  id: 'mysource',
  displayName: 'My Source',
  capabilities: { preview: true },

  async fetch(): Promise<ScrapedItem[]> {
    try {
      const res = await fetch('https://example.com/feed', {
        headers: { 'User-Agent': 'fomo-release-tracker/1.0' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.items.map((item: any) => ({
        title: item.title,
        url: item.url,
        datePublished: new Date(item.publishedAt),
        content: item.summary ?? '',
      }));
    } catch (err) {
      console.error('[mysource] fetch failed:', err instanceof Error ? err.message : err);
      return [];
    }
  },
};
```

## 2. Register the plugin

Add two lines to `packages/core/src/scraper/registry.ts`:

```typescript
import { mySource } from './sources/mysource.js';

const builtins: SourcePlugin[] = [
  githubSource,
  azureSource,
  vscodeSource,
  copilotCliSource,
  mySource,       // ← add here
];
```

That's it. The source is available everywhere — fetching, the Copilot digest, the TUI and the web app.

## 3. Try it

```bash
pnpm build
fomo
```

In the TUI press `c`, move to your source under **Sources**, then:

- `f` fetches just that source (even if it is disabled) and shows `+N new` or the error next to it.
- `v` closes the config and lists only that source's updates (`Esc` clears the filter).

## Common Patterns

### RSS / Atom feed

```typescript
async fetch(): Promise<ScrapedItem[]> {
  const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(15_000) });
  const xml = await res.text();
  const items: ScrapedItem[] = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const title = (b.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const link  = (b.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? '').trim();
    const date  = b.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] ?? '';
    if (title && link) items.push({ title, url: link, datePublished: new Date(date), content: '' });
  }
  return items;
}
```

### GitHub Releases API

```typescript
async fetch(): Promise<ScrapedItem[]> {
  const res = await fetch('https://api.github.com/repos/OWNER/REPO/releases?per_page=30', {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'fomo-release-tracker/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  const releases = await res.json() as { name: string; tag_name: string; html_url: string; published_at: string; body: string }[];
  return releases.map(r => ({
    title: r.name || r.tag_name,
    url: r.html_url,
    datePublished: new Date(r.published_at),
    content: (r.body ?? '').slice(0, 2000),
  }));
}
```
