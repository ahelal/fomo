# Adding a New Source

A source is a **spec**: plain data that says what to fetch. Specs of a few kinds are turned into fetchers by
`packages/core/src/scraper/factory.ts`, so most sources need no code at all.

| Kind              | What it fetches                                          | Who adds it                         |
|-------------------|----------------------------------------------------------|-------------------------------------|
| `feed`            | RSS 2.0, RSS 1.0 (RDF) or Atom; several URLs are merged  | Users in the app, or built-in       |
| `github-releases` | Releases of a GitHub repository                          | Users in the app, or built-in       |
| `youtube`         | A YouTube channel's or playlist's newest videos          | Users in the app, or built-in       |
| `custom`          | Sandboxed ESM extension (HTML pages, changelogs, APIs)   | Bundled by developers for now       |

Built-in specs live in `packages/core/src/scraper/specs.ts` (`BUILTIN_SOURCES`). Sources users add are saved in
the shared settings (`userSources`), and built-ins they remove in `removedSources`, so a fix to a built-in still
reaches everyone who kept it.

## 1. Add a source from the app (no build)

- **TUI:** press `c`, go to **+ Add source** under **Sources**, press `↵` and type:
  1. the feed URL (several feeds: separate them with spaces), `https://github.com/owner/repo`, or a YouTube
     channel (`https://www.youtube.com/@name`, `/channel/UC…`, `/c/…`, `/user/…`) or playlist (`/playlist?list=…`) URL,
  2. a name (`↵` keeps the suggestion),
  3. for feeds and YouTube, an optional keyword regex such as `copilot|agents` (only matching items are kept).

  YouTube works without an API key, from YouTube's public feeds (the 15 newest videos, no video lengths). With a
  **YouTube API key** (`c` → **YouTube API key** or `FOMO_YOUTUBE_API_KEY`; see [README → YouTube](README.md#youtube))
  it uses the YouTube Data API v3 instead, which adds full descriptions and video lengths. A channel skips Shorts by
  default (it fetches its videos and live streams); turn **Shorts** on in the source's details to get them. Only the
  TUI can fetch YouTube (`@handle`s are resolved to the channel id when fetching); the web app just saves it.

  The source is fetched straight away. `x` on a source removes it (`x` again confirms); removed built-ins come
  back with **Restore removed**.
- **Edit:** `↵` on a source (TUI) or a click on its name (web) opens its details: status, name, label, color and on/off
  for every source, plus URLs, keyword filter and (YouTube channels) Shorts for your own. Extension-backed sources
  also have a separate extension display name, shown as `C/<name>`. IDs stay fixed; labels have a 10-character limit. `s` / **Save** saves.
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

## 3. Add a bundled code extension

For sites without a feed, put the fetcher in `packages/extensions/src/<id>/index.ts`. It exports `fetch(ctx)`,
returns `ScrapedItem[]`, and throws on failure. It runs in a separate OS sandbox, never in the core engine.
Use the narrow `@fomo/core/extension-api` entry for types and pure helpers; importing runtime values from the
main core entry can pull Azure and other host-only dependencies into the bundle.

```typescript
import { htmlToText, parseDate, type ExtensionContext, type ScrapedItem } from '@fomo/core/extension-api';

export async function fetch(ctx: ExtensionContext): Promise<ScrapedItem[]> {
  const posts = await ctx.http.json<{ title: string; url: string; date: string }[]>('https://example.com/posts.json');
  return posts.map((post) => ({
    title: htmlToText(post.title), url: post.url, datePublished: parseDate(post.date),
  }));
}
```

Alongside it, add `extension.json`:

```json
{
  "apiVersion": 1,
  "id": "my-site",
  "name": "My Site",
  "version": "1.0.0",
  "entry": "index.mjs",
  "permissions": {
    "http": ["https://example.com"],
    "mcp": [],
    "filesystem": { "readOnly": [], "readWrite": [] }
  }
}
```

Add the ID to the build list in `packages/extensions/build.mjs` and the public adapter list in
`packages/tui/src/extensions/host.ts`. Point a spec in `BUILTIN_SOURCES` at it (`options` become `ctx.options`;
use `preview: false` for sources without body text):

```typescript
{ kind: 'custom', id: 'my-site-news', displayName: 'My Site News', extension: 'my-site', extensionName: 'My Site', options: { section: 'news' }, preview: false },
```

The build bundles ESM into `dist/<id>/index.mjs` and hashes both it and the manifest into `dist/catalog.json`.
The host rejects changed bundles, unexpected files and symlinks, then snapshots the verified bytes for execution.
Release hashes belong to the trusted FOMO installation; they are not a third-party publisher signature.
Keep code out of browser-safe `specs.ts`. The old `module` spec field is recognized for compatibility but resolves
only through an injected extension adapter; there is no in-process fallback.

| API | Permission and limits |
|-----|-----------------------|
| `ctx.http.text/json(url)` | HTTPS GET only, exact granted origins, public DNS addresses pinned per hop, redirects revalidated, 4 MiB responses |
| `ctx.mcp.call(binding, tool, args)` | Only the bundled `workiq` binding; host-approved read-only meeting/file operations, no arbitrary MCP servers |
| `ctx.state.get/set(key, value)` | In-memory state scoped to this profile, source and bundle digest; bounded JSON, no token storage |
| `ctx.log(message)` | Bounded, sanitized diagnostics |
| `ctx.options`, `ctx.signal` | Source options and invocation context; revocation terminates the process and its broker requests |

No subprocess/exec capability or general filesystem access is exposed. Empty filesystem declarations are
currently required; user-selected folder grants and arbitrary third-party discovery/hash reapproval UI are
not implemented. All three bundled extensions (Anthropic, Copilot CLI and Teams) use this same worker path.

### Runtime and isolation status

Use Node 24+ and pnpm 11.7.0. MXC 1.0.1 is pinned; the hardened policy is currently available only on macOS.
Missing/unsupported containment reports a source error, never an unrestricted fallback. OS CPU and wall-clock
limits, bounded RPC and the worker's V8 heap cap provide resource defenses, but **hard total/native-memory
containment is not established**. Only trusted bundled artifacts are accepted pending the remaining trust and
resource-limit work. The FOMO host and declarative feed/GitHub-release/YouTube implementations are not sandboxed.

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
| `key`           | `string` | Optional — row identity instead of `url` (`sha256(key)`); a keyed item fetched again updates its row |

## 5. Experimental sources (terminal app only)

Some sources read **your own** data with a local sign-in, so they can't be specs: the web app and other machines
must never run them. These are *experimental sources*:

- **Registry:** `EXPERIMENTAL_SOURCE_INFOS` in `packages/core/src/experimental.ts` (id, name, where the data comes
  from; browser-safe, so the web app can name and color their items). Their items are stored like any other update.
- **Provider:** extension fetch and merge code lives in `packages/extensions/src/<id>/`; trusted local setup
  and sign-in live in `packages/tui/src/experimental/`. `experimentalSetups(host)` binds each setup to the active
  profile. `ExperimentalProvider.open()` keeps an operation-scoped worker alive through asynchronous merges and
  `close()` tears it down, including on failure.
- **Turning it on:** per profile, in `~/.fomo/config.json` (`experimentalSources: ["teams-meetings"]`), from
  **Config → Experimental sources · this computer** (`space` twice signs in and turns it on, `space` turns it off, `l` signs in again;
  while it signs in or fetches, the row shows it and `space` twice cancels the sign-in or stops the fetch and turns it off;
  `↵` details, `e` label, `d` color and `f`/`v`/`x` as for other sources). Its label, color and names are shared settings like any
  source's; only on/off and the sign-in stay on this computer. Only the profiles that turned one on fetch it; `FomoDirectService.setExperimentalProviders` gets the list.
  A fetch stopped by turning a source off reports `stopped` (not `error`) and leaves the source's last fetch record as it was.
- **Keyed items:** give each item a stable `key` when its URL is shared or changes (a recurring meeting has one
  chat), and a `merge(existing, fetched)` that says what a fetch changes on the stored row (status, saved and topic
  are always kept). Experimental items are left out of duplicate detection.

The first one is **Teams meetings** (`teams-meetings`, `packages/extensions/src/teams-meetings/meetings.ts`): the meetings of the last 7 days
you missed, or that have a recording or a transcript, one item per occurrence, linking to the Teams recap (or the
meeting chat). It reads Microsoft Graph through [WorkIQ](https://www.npmjs.com/package/@microsoft/workiq)
(`@microsoft/workiq`, pinned in the TUI). The host starts `workiq mcp` directly, outside FOMO's sandbox, using the
host WorkIQ sign-in and filesystem/network permissions. The TUI labels this **UNSANDBOXED** and requires explicit
consent. The MCP broker verifies `/me` and permits only read-only calendar/meeting requests bounded to the
seven-day window, chats found through those calendar results, and read-only OneDrive/SharePoint search used to
locate recording files; tokens never enter the extension.

Profile-specific approval is kept under `~/.fomo/extension-state/<profile-name-hash>/workiq`. A profile rename
requires consent again; WorkIQ's host sign-in remains in its normal host account store.

For recorded or transcribed meetings, build the Recap URL the way Teams' own "share recap" links do, encoding each
query value separately. These formats were verified in Teams but are not a documented Microsoft deep-link contract:
- With the recording file: `https://teams.microsoft.com/l/meetingrecap?driveId=<…>&driveItemId=<…>&iCalUid=<occurrence iCalUId>&threadId=<threadId>`.
- Without it: `…?iCalUid=<occurrence iCalUId>&masterICalUid=<series iCalUId>&threadId=<threadId>`.
  `masterICalUid` (lower case, recurring meetings only) is the series id: the same id with its date (bytes 16–19, hex
  characters 32–39) zeroed (`seriesICalUId`). It opens that occurrence, with a list of the others; leave it out when
  the file is known (the file picks the occurrence). The series id alone opens the latest recap or says you lack
  permission.
- Some meetings (often large ones whose chat is closed to you) only open with the file. `driveId`/`driveItemId` come
  from the meeting chat's recording event (`callRecordingUrl`) via `/shares/u!<base64url>/driveItem`. When the chat
  is closed (403) or has no link, search the file with WorkIQ's `retrieve` tool (Microsoft Search,
  `OneDriveAndSharePoint`): query `"<subject>" <yyyymmdd>`, then take the hit named
  `<subject>-<yyyyMMdd>_<HHmmss>[UTC]-<kind>` whose stamp, in the organizer's local time (a quarter-hour offset) or
  UTC, is within 45 s of one of the occurrence's recordings (else transcripts). Teams drops `|` and `:` and turns `&`
  into `_` in the name and writes the kind in the organizer's language, so compare only letters and digits. A failed
  search answers like an empty one with `stoppedReason: "error"`: don't take it for "not found". Searches take ~10 s:
  run a few at once, remember found files, search a miss again after an hour, and pause after failures. Some
  recordings are not in the search index; their links go without the file.

Without an artifact or `iCalUId`, link to the meeting chat; keep the chat link in the item preview as well. On
refresh, replace older links with the new Recap link, but never downgrade a Recap link to a chat link, or one with a
recording file to the same link without it (it is rebuilt in the current format; a link of an older format is
replaced).
