# Adding a New Source

A source is a **spec**: plain data that says what to fetch. Specs of a few kinds are turned into fetchers by
`packages/core/src/scraper/factory.ts`, so most sources need no code at all.

| Kind              | What it fetches                                          | Who adds it                         |
|-------------------|----------------------------------------------------------|-------------------------------------|
| `feed`            | RSS 2.0, RSS 1.0 (RDF) or Atom; several URLs are merged  | Users in the app, or built-in       |
| `github-releases` | Releases of a GitHub repository                          | Users in the app, or built-in       |
| `youtube`         | A YouTube channel's or playlist's newest videos          | Users in the app, or built-in       |
| `custom`          | Anything else (HTML pages, changelogs, APIs), in code    | Developers only                     |

Built-in specs live in `packages/core/src/scraper/specs.ts` (`BUILTIN_SOURCES`). Sources users add are saved in
the shared settings (`userSources`), and built-ins they remove in `removedSources`, so a fix to a built-in still
reaches everyone who kept it.

## 1. Add a source from the app (no build)

- **TUI:** press `c`, go to **+ Add source** under **Sources**, press `↵` and type:
  1. the feed URL (several feeds: separate them with spaces), `https://github.com/owner/repo`, or a YouTube
     channel (`https://www.youtube.com/@name`, `/channel/UC…`, `/c/…`, `/user/…`) or playlist (`/playlist?list=…`) URL,
  2. a name (`↵` keeps the suggestion),
  3. for feeds and YouTube, an optional keyword regex such as `copilot|agents` (only matching items are kept).

  YouTube needs no API key: it reads YouTube's public feeds, which hold the 15 newest videos. A channel skips
  Shorts by default (it fetches its videos and live streams); turn **Shorts** on in the source's details to get them.
  Only the TUI can fetch YouTube (`@handle`s are resolved to the channel id when fetching); the web app just saves it.

  The source is fetched straight away. `x` on a source removes it (`x` again confirms); removed built-ins come
  back with **Restore removed**.
- **Edit:** `↵` on a source (TUI) or a click on its name (web) opens its details: status, label, color and on/off
  for every source, plus name, URLs, keyword filter and (YouTube channels) Shorts for your own (its id stays the same). `s` / **Save** saves.
  Built-in URLs ship with the app and are read-only.
- **Stored items:** removing a source that has items asks whether to keep them (it then stays greyed out, and its
  items still show) or delete them too. **Delete its items** in the details (`d d` in the TUI) clears a source's
  stored updates: an active source is re-fetched as new, a removed one disappears for good.
- **Web app:** open ⚙️ Config and use the form under **Sources**. The terminal app fetches the new source on its
  next run (the web app has no server to fetch from).

## 2. Add a built-in feed or repository

Add a spec to `BUILTIN_SOURCES` in `packages/core/src/scraper/specs.ts`:

```typescript
{ kind: 'feed', id: 'my-blog', displayName: 'My Blog', urls: ['https://example.com/feed.xml'] },
{ kind: 'feed', id: 'vscode', displayName: 'VS Code Updates', urls: ['https://code.visualstudio.com/feed.xml'], category: 'release' },
{ kind: 'feed', id: 'sre', displayName: 'SRE Agent', urls: [FEED_A, FEED_B], include: '\\bsre\\s+agents?\\b' },
{ kind: 'github-releases', id: 'my-tool', displayName: 'My Tool Releases', repo: 'owner/my-tool' },
{ kind: 'youtube', id: 'github-yt', displayName: 'GitHub on YouTube', channel: '@GitHub' },
```

| Field         | Kinds  | Notes                                                                  |
|---------------|--------|------------------------------------------------------------------------|
| `id`          | all    | Unique slug (`[a-z0-9-]`), the Table PartitionKey. Never change it     |
| `displayName` | all    | Human-readable name                                                    |
| `urls`        | feed   | One or more feeds; items are merged and deduplicated by URL            |
| `include`     | feed, youtube | Case-insensitive regex tested on title + content (YouTube: description) |
| `category`    | feed   | Keep only items with this `<category>` (RSS) or `term` (Atom)          |
| `repo`        | github-releases | `owner/repo`                                                  |
| `channel`     | youtube | `UC…` id, `@handle`, `c/Name` or `user/Name`                         |
| `playlist`    | youtube | `PL…` playlist id (instead of `channel`)                             |
| `shorts`      | youtube | `true` includes Shorts; by default a channel's videos and live streams |

## 3. Add a custom (code) source

For sites without a feed, write a module in `packages/core/src/scraper/sources/custom/<name>.ts` that returns
`ScrapedItem[]` and **throws** on failure (the factory adds the `[id] fetch failed:` prefix). Build it on the shared
helpers instead of copying code:

| Helper                                                     | File        |
|------------------------------------------------------------|-------------|
| `fetchText`, `fetchJson` (user agent, 15 s timeout, HTTP errors) | `scraper/http.ts`   |
| `htmlToText`, `decodeEntities`, `parseDate`, `dedupByUrl`, `MAX_CONTENT` | `scraper/text.ts` |
| `parseFeed(xml, { include, category })`                    | `scraper/feed.ts`   |
| `fetchGithubReleases`, `releaseItems`, `stripMarkdown`     | `scraper/github.ts` |

```typescript
// packages/core/src/scraper/sources/custom/my-site.ts
import type { ScrapedItem } from '../../../types.js';
import { fetchText } from '../../http.js';
import { htmlToText, parseDate } from '../../text.js';

export async function fetchMySite(options: Record<string, string>): Promise<ScrapedItem[]> {
  const html = await fetchText(`https://example.com/${options.section ?? 'news'}`);
  // …parse html into items…
  return [{ title: htmlToText(title), url, datePublished: parseDate(date), content: '' }];
}
```

Register it in `packages/core/src/scraper/sources/custom/index.ts`:

```typescript
export const CUSTOM_MODULES = {
  anthropic: fetchAnthropic,
  'copilot-cli': fetchCopilotCli,
  'my-site': fetchMySite,   // ← add here
};
```

and point a spec at it in `BUILTIN_SOURCES` (`options` are passed to the function; set `preview: false` when the
source has no body text):

```typescript
{ kind: 'custom', id: 'my-site-news', displayName: 'My Site News', module: 'my-site', options: { section: 'news' }, preview: false },
```

Keep fetching code out of `specs.ts`: it is imported by the browser app.

## 4. Try it

```bash
pnpm build
fomo
```

In the TUI press `c`, move to your source under **Sources**, then:

- `f` fetches just that source (even if it is disabled) and shows `+N new` or the error next to it.
- `v` closes the config and lists only that source's updates (`Esc` clears the filter).

### `ScrapedItem`

| Field           | Type     | Notes                                             |
|-----------------|----------|---------------------------------------------------|
| `title`         | `string` | Required                                          |
| `url`           | `string` | Required — used as dedup key (`sha256(url)`)      |
| `datePublished` | `Date`   | Required                                          |
| `content`       | `string` | Optional — body text shown in the preview         |
