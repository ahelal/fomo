# 📰 FOMO

**Fear Of Missing Out** — a release & update tracker for developer tools.
Track GitHub releases, Azure updates, VS Code changelogs, Copilot CLI versions and tech news in one place,
with a **GitHub Copilot digest** that folds related updates into one topic with a few highlights.

One storage account · No servers · Two interfaces (terminal UI + installable web app)

---

## Table of Contents

- [Architecture](#architecture)
- [Copilot Digest](#copilot-digest)
  - [Post Summaries](#post-summaries)
- [Installation](#installation)
  - [Azure Deployment](#azure-deployment)
  - [TUI Setup](#tui-setup)
  - [Connect the Web App](#connect-the-web-app)
  - [Install on Android](#install-on-android)
  - [Local Development](#local-development)
- [Using the Web App](#using-the-web-app)
- [Using the TUI](#using-the-tui)
  - [Keys](#keys)
  - [Config Screen](#config-screen)
  - [Backup & Restore](#backup--restore)
- [Sources](#sources)
- [Security](#security)
- [Environment Variables](#environment-variables)
- [Storage](#storage)
- [License](#license)

---

## Architecture

```mermaid
flowchart LR
  subgraph laptop[Your machine]
    TUI["fomo TUI<br/>fetch · digest · link"]
    Copilot["GitHub Copilot SDK"]
  end
  subgraph azure[Azure Storage account]
    Tables[("Table Storage<br/>updates · topics · settings · todos")]
    Web["Static website ($web)<br/>PWA"]
  end
  Phone["Browser / Android PWA"]

  TUI -- "connection string" --> Tables
  TUI <--> Copilot
  Web -. "loads app" .-> Phone
  Phone -- "SAS token (CORS)" --> Tables
```

```
packages/
  core/     Shared types · Azure Table stores · scrapers · digest engine · services
  web/      React/Vite PWA — static files, talks to Table Storage directly
  tui/      Ink terminal UI (`fomo`) — setup, fetch, Copilot digest, device links, backups
```

- **No compute in Azure.** Everything lives in one Storage Account: Table Storage for data and the static website for the web app.
- **Fetch and digest run in the TUI** (`fomo`, then `f`) on your machine, using your GitHub Copilot subscription.
- **The web app is static.** It reads and writes Table Storage from the browser with a SAS token handed over by the TUI's **Link a device** action (magic link / QR code).
- **No command-line arguments.** `fomo` opens the TUI; everything else (setup, config, links, backups) is done from inside it.

---

## Copilot Digest

Instead of reading 200 separate updates, the **Unread** view (the default, key `2`) is grouped by topic: one line per product area,
usually 20–30 topics. Press `2` again to switch to a plain list of unread updates, and once more to go back to topics:

```
▸ ▲ Copilot CLI releases                          6   github, github-blog   2h ago
▸ Copilot code review                             9   github                5h ago
▸ Azure networking                                5   azure                 1d ago
▸ Azure retirements                               4   azure                 1d ago
```

Open a topic to see a one-sentence summary and up to six highlights (most important first). Each update in the topic also gets its own one-line summary, so you can decide which ones to open.
A topic with only one update doesn't expand: its row shows that update's title and summary directly, and `Enter` opens the update.
Mark the whole topic read with `x`, which makes skipping a low-value area a single key press.

The **Saved** view (key `4`) is grouped the same way (press `4` again for a plain list), so saved posts sit together by product area. Reading a saved post
keeps it there: `r` / `u` mark a topic or update read / unread (a blue `●` marks unread ones), `x` marks it read and
moves on, and `s` unsaves an update, which removes it from the view.

**Grouping.** Each topic is one **product or feature area**, such as "Copilot code review", "GitHub Actions", "VS Code releases", "Azure SRE Agent" or "Anthropic news":

- Topics usually hold 3–15 updates. A new topic with more than 15 gets a second call that splits it into narrower areas.
- There are no catch-all topics such as "Azure updates" or "Misc".
- Deprecations and retirements go into one topic per vendor ("Azure retirements"). Titles that mention a retirement or deprecation are flagged to the model.
- Releases of one product stay together. Items whose titles differ only in version numbers are flagged to the model as a release series.
- General essays go into one topic per source ("GitHub blog essays").
- New products and major launches get their own topic so they aren't buried.

**Importance.** Each topic is rated so you can tell what's worth reading:

| Level  | Shown as                        | Typical updates |
|--------|---------------------------------|-----------------|
| High   | `▲` (orange) · sorted first     | New products, major versions or revamps, big features in widely used tools, flagship models |
| Medium | normal                          | Notable features, previews reaching GA, releases with real changes, breaking changes that hit common setups soon |
| Low    | dimmed · sorted last            | Patches, regions, admin settings, SKUs, distant deprecations, research, partnerships, surveys, marketing |

Deprecations and protocol changes (such as an SSH algorithm) are never rated high. The digest is sorted by importance, then newest first.

To steer the rating toward what you care about, add an optional interests note (`c` → **Interests**), for example
`Copilot CLI and agents, VS Code; not SAP or billing`. It moves a topic up or down by at most one level and never changes the grouping.
Save an empty value to clear it.

To steer the **grouping** itself, add **Grouping hints** (`c` → **Grouping hints**, or `FOMO_GROUPING_HINTS`), for example
`one topic per Copilot surface (CLI, VS Code, code review); keep all Azure AI Foundry news together`.
Hints take priority over the built-in grouping rules, but every update still lands in exactly one topic. They apply to new runs; use **Regroup all topics** to apply them to existing topics.

How it works:

- `f` in the TUI fetches the sources and then runs the digest in the background; new updates show up ungrouped right away and the status bar shows Copilot's progress. Turn **Group after fetch** off in the config screen to fetch only.
- Only **unread or saved updates that don't have a topic yet** are sent to Copilot (saved ones even after you've read them, so the Saved view is grouped too), in two passes:
  1. **Plan:** one call sees every pending update (title and a short excerpt, or its [post summary](#post-summaries) when it has one) plus the currently open topics. It assigns each update to an existing or new topic and rates it. Updates the model skips get one more call; oversized new topics get a split call.
  2. **Write:** one small call per touched topic writes the summary, the highlights and a one-sentence summary of each new update. These run 6 at a time with low reasoning effort, and a failed call is retried once.
- Topics are stored in the `topics` table, and each update points to its topic (`topicId`), so the web app and TUI only read.
- Updates that haven't been digested yet still appear in the grouped Unread and Saved views as single-item entries.
- About 220 updates take roughly 2 minutes. **Max items per run** (default 300) caps a run; the rest are grouped next time.
- The default model is `gpt-5-mini`. Change it with **Copilot model** in the config screen or `FOMO_COPILOT_MODEL`.
- Existing topics keep their grouping and rating. **Regroup all topics** in the config screen regroups and re-rates all unread and saved updates (read and saved status is untouched). This also fills in per-update summaries for updates digested before they existed.
- Authentication uses your logged-in Copilot CLI user, or `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN`.

### Post Summaries

Press `g` on an update in the TUI to have Copilot summarise it: one sentence with the gist, then 3–5 short points (what it does, who it's for, how to get or enable it, limits or deadlines).

- FOMO fetches the linked page and summarises whichever is longer: the page text or the stored preview. The page is only used if it mentions the post's title, so sign-in walls and pages that only render with JavaScript fall back to the preview.
- Azure Updates pages render with JavaScript and the feed cuts their descriptions to about 250 characters, so their full text comes from the Azure release communications API instead (with status and preview / GA dates).
- Posts with less than 1,000 characters of text aren't summarised, because a summary wouldn't be any shorter.
- The summary is saved on the update, so pressing `g` again shows it without calling Copilot. `G` regenerates it.
- Summaries appear at the top of the detail pane in the TUI and the web app, and search matches them too. The web app only shows saved summaries; it can't create them.
- When Copilot groups a post or writes its topic, it reads the post's summary instead of the start of the feed preview. Summarise posts before they're grouped (or before **Regroup all topics**) to have it take effect.

---

## Installation

### Azure Deployment

**Prerequisites:** Azure CLI (`az login`), `jq`, Node.js 22+ and pnpm.

```bash
pnpm install
bash deploy.sh fomo swedencentral        # add -y to skip the what-if prompt
```

The script:

1. Builds the web app.
2. Deploys `infra/main.bicep`: one Storage Account with the `updates`, `topics`, `settings` and `todos` tables, plus Table Storage CORS for the static website origin (and `localhost:5173`/`4173` for dev).
3. Enables the static website and uploads the PWA to `$web`.
4. Prints the web app URL and the next steps.

### TUI Setup

```bash
pnpm --filter @fomo/tui... build
node packages/tui/dist/index.js      # or put `fomo` on your PATH: (cd packages/tui && npm link)
```

The first time, `fomo` asks for the storage connection string. Get it with:

```bash
az storage account show-connection-string -g fomo -n <account> -o tsv
```

Paste it and press `Enter`; FOMO checks the connection and saves it to `~/.fomo/config.json`.
Then press `c` and set **Web app URL** (printed by `deploy.sh`, e.g. `https://<account>.z1.web.core.windows.net/`).

The digest needs GitHub Copilot. If you use the Copilot CLI, you're already signed in; otherwise export `COPILOT_GITHUB_TOKEN`.
Press `f` to fetch all sources and build the digest.

### Connect the Web App

In the TUI press `c` → **Link a device**. It shows a magic link and a QR code; `o` opens the link, `y` copies it.
Links are valid for 365 days; change **Link valid (days)** in the config screen for shorter-lived links.

Open the link (or scan the QR code with your phone). It carries a Table Storage SAS token in the URL
fragment (`#…`), which is never sent to any server. The web app saves it in the browser and removes it from the address bar.
You can also paste the link into the app's connect screen.

The status bar warns you when the token has 14 days or less left. Create a new link to renew it. **Disconnect** removes the token from that browser.

### Install on Android

1. Open the magic link in **Chrome** on your phone. Scanning the QR code from **Link a device** works well.
2. Tap **⋮ → Add to Home screen → Install**.

FOMO then runs full-screen from your home screen like a native app. The app shell works offline, and data loads from Table Storage when you're online. Pull down on the list to refresh.
On iOS, use Safari → Share → **Add to Home Screen**.

### Local Development

```bash
pnpm install
pnpm build
pnpm test

# Local storage emulator (optional)
npx azurite --silent --location /tmp/azurite &
az storage cors add --services t --origins http://localhost:5173 http://localhost:4173 \
  --methods GET HEAD POST PUT PATCH MERGE DELETE OPTIONS --allowed-headers '*' --exposed-headers '*' \
  --connection-string "UseDevelopmentStorage=true"

# Web app dev server
pnpm --filter @fomo/web dev

# TUI against Azurite: paste UseDevelopmentStorage=true at setup (or set it under c → Connection string),
# set Web app URL to http://localhost:5173/, press f, then c → Link a device to connect the dev server.
fomo
```

With Azurite, **Link a device** creates a SAS token that also allows `http`. The `az storage cors add` command lets the browser call Azurite from the dev server; it mirrors the CORS rule that Bicep sets in Azure.

---

## Using the Web App

The web app mirrors the TUI: the same dark text UI and the same keys. On a phone, tap rows, use the action bar, and pull to refresh.

| Key             | Action                                    |
|-----------------|-------------------------------------------|
| `1` `2` `3` `4` | All / Unread / Read / Saved               |
| `2` / `4` again | Switch Unread / Saved between topics and a list (or click the active tab) |
| `5` / `t`       | Todos                                     |
| `/`             | Search titles & content in the current view (`Enter` searches, `Esc` clears) |
| `j` / `↓`       | Next row                                  |
| `k` / `↑`       | Previous row                              |
| `Enter`         | Topics: expand topic · Lists: toggle detail |
| `→` / `l`, `←`  | Topics: expand / collapse topic           |
| `x`             | Mark read (the whole topic when grouped) & next |
| `r` / `u`       | Mark read / unread (a whole topic in grouped Saved) |
| `n`             | Next topic / next unread                  |
| `s`             | Save / unsave (unsave in the Saved view)  |
| `o`             | Open URL in a new tab                     |
| `.`             | Toggle preview position (right / bottom)  |
| `c`             | Config                                    |
| `h`             | Help (also shows the version)             |

Fetching isn't done in the browser. Run `fomo` on your computer and press `f`, then pull to refresh.
Post summaries made in the TUI (`g`) show at the top of the detail pane.

**Search** only looks inside the view you're in: searching under Unread only finds unread updates (or unread topics when grouped), and under Saved only saved updates. Every word must appear in the title, summary, [post summary](#post-summaries) or content (case-insensitive). The query stays applied when you switch views until you clear it with `Esc` or ✕. On a phone, tap the search box in the filter bar.

---

## Using the TUI

Run `fomo`. It opens on **Unread**, grouped by topic. There are no subcommands: `fomo --help` and `fomo --version` are the only flags.

### Keys

| Key             | Action                                    |
|-----------------|-------------------------------------------|
| `1`–`4`         | All / Unread / Read / Saved               |
| `2` / `4` again | Switch Unread / Saved between topics and a list |
| `j`/`↓`, `k`/`↑`| Move                                      |
| `Enter`         | Expand topic and open it / toggle detail  |
| `→`/`l`, `←`    | Expand / collapse topic                   |
| `x` / `r`       | Mark topic (or update) read & next (grouped Saved: `r` marks read in place) |
| `u`             | Mark unread (lists, and topics or updates in grouped Saved) |
| `n`             | Next topic / next unread                  |
| `s`             | Save / unsave (unsave in Saved)           |
| `o`             | Open in browser (newest update of a topic)|
| `p`             | Fetch full content (detail view)          |
| `g` / `G`       | [Summarise the update with Copilot](#post-summaries) (saved) / regenerate |
| `f` / `F`       | Fetch latest updates + Copilot digest     |
| `c`             | Config: sources, link a device, backup / restore, local settings |
| `t`             | Todos (`a` add, `Enter` cycle status, `d` delete) |
| `/`             | Search titles & content in the current view (`Enter` searches, `^U` clears the prompt) |
| `Esc`           | Clear the search, then the source filter  |
| `.`             | Show preview / toggle its position        |
| `h`             | Help (also shows the version)             |
| `q`             | Quit                                      |

The status bar shows counts by status; the config screen shows counts per source.
Search (`/`) works like the web app: it's scoped to the current view, matches every word against the title, summary and content, and shows the query and match count in the filter bar until `Esc` clears it.
While a fetch, Copilot digest or restore runs, the status bar shows a spinner, the current step and the elapsed time.
Fetch errors and Copilot runtime logs are written to `~/.fomo/fomo.log` instead of the screen.

### Config Screen

Press `c`. The bottom line shows the keys for the selected row.

| Section | Row | Keys |
|---------|-----|------|
| **Actions** | Link a device | `Enter`: magic link + QR code for the web app (`o` open, `y` copy) |
| | Regroup all topics | `Enter` twice: rerun the Copilot digest on every unread and saved update |
| | Back up updates / Restore from backup | See [Backup & Restore](#backup--restore) |
| **Sources** (shared with the web app) | One row per source, with its item count and last fetch result | `Enter` enable/disable · `e` label · `d` color · `f` fetch just this source (even if disabled) · `v` list only its updates |
| **Display** (shared) | Preview position | `Enter` cycles right / bottom / off |
| **This computer** (`~/.fomo/config.json`) | Connection string, Web app URL, Copilot model, Interests, Grouping hints, Group after fetch, Max items per run, Link valid (days), Backup folder | `Enter` edits (toggles for Group after fetch). Save an empty value to restore the default. Values set by an environment variable are tagged `[env]`. |

### Backup & Restore

**Back up updates** writes every update from Table Storage to `fomo-backup-<timestamp>.json` in the backup folder
(default `~/.fomo/backups`, change it under **Backup folder**).

**Restore from backup** lists the `.json` files in the backup folder, newest first. Pick one and press `Enter` twice.
Entities are upserted, so this is safe for both fresh and incremental restores; nothing is deleted.

The backup format is `{ version: 1, exportedAt, count, entities: [...] }`.

---

## Sources

### Built-in Sources

| Source | ID | What it tracks |
|--------|----|----------------|
| GitHub | `github` | GitHub Releases (Node.js, TypeScript, etc.) |
| GitHub Blog | `github-blog` | GitHub Blog posts |
| Azure | `azure` | Azure Updates RSS feed |
| VS Code | `vscode` | VS Code releases (official Atom feed) |
| Copilot CLI | `copilot-cli` | GitHub Copilot CLI releases |
| The Register | `theregister` | The Register tech news (Atom feed) |
| Anthropic News | `anthropic-news` | Anthropic news |
| Anthropic Engineering | `anthropic-engineering` | Anthropic engineering blog |
| Azure SRE Agent | `azure-sre-agent` | Azure SRE Agent updates |
| GitHub Next | `github-next` | GitHub Next research & prototypes (RSS) |

### Adding a New Source

Create a source plugin in two files:

**1. Create the plugin** (`packages/core/src/scraper/sources/<name>.ts`):

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

**2. Register it** in `packages/core/src/scraper/registry.ts`:

```typescript
import { mySource } from './sources/mysource.js';

const builtins: SourcePlugin[] = [
  githubSource, azureSource, vscodeSource, copilotCliSource,
  mySource,       // ← add here
];
```

**3. Build and test:**

```bash
pnpm build
fomo      # press c, select your source and press f to fetch just it
```

The source is automatically available in the TUI, the digest, and the web app.

See [EXTENDING.md](EXTENDING.md) for more patterns (RSS/Atom feeds, GitHub Releases API).

---

## Security

- **TUI:** uses the storage connection string (account key). Keep `~/.fomo/config.json` private (it is created with mode `600`).
- **Web app:** uses an **account SAS token** limited to the Table service and entity operations (`ss=t`, `srt=o`, `sp=raud`), HTTPS only, and valid for **Link valid (days)** (default 365).
  - It can read and update your FOMO tables, but it cannot create or delete tables or touch blobs.
  - It is delivered in the URL fragment, so it never reaches a web server or logs, and it is stored in the browser's `localStorage`.
- **Revoke every link:** rotate the storage key that signed it (**Link a device** signs with the key in your connection string, usually `key1`):
  ```bash
  az storage account keys renew -g fomo -n <account> --key key1
  ```
  Then set the new connection string in the TUI (`c` → **Connection string**) and link your devices again.
- **CORS:** Table Storage only accepts browser calls from the static website origin (and localhost dev ports). Add custom domains with the `extraCorsOrigins` Bicep parameter.
- The static website itself is public, but it contains no data.

---

## Environment Variables

All are optional. The TUI config screen (`c` → **This computer**) stores the same values in `~/.fomo/config.json`.

| Variable                          | Description                                                  |
|-----------------------------------|--------------------------------------------------------------|
| `AZURE_STORAGE_CONNECTION_STRING` | Connection string (fallback when the config file has none)   |
| `FOMO_WEB_URL`                    | Web app URL for **Link a device** (overrides config)         |
| `FOMO_COPILOT_MODEL`              | Copilot model for the digest (overrides config)              |
| `FOMO_INTERESTS`                  | Interests note for digest importance (overrides config)      |
| `FOMO_GROUPING_HINTS`             | Grouping hints for the digest (overrides config)             |
| `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN` | Token for the Copilot SDK (default: logged-in Copilot CLI user) |

---

---

## Storage

| Table      | PartitionKey                       | RowKey                       | Contents                              |
|------------|------------------------------------|------------------------------|---------------------------------------|
| `updates`  | Source ID (e.g. `azure`, `github`) | `sha256(url).slice(0, 32)`   | Updates, status, saved, `topicId`, Copilot `summary` and `gist` (post summary, JSON) |
| `topics`   | `topic`                            | Topic id                     | Copilot title, summary, highlights    |
| `settings` | —                                  | —                            | Shared UI/source settings             |
| `todos`    | —                                  | —                            | Personal todos                        |

Status updates use ETag-based optimistic concurrency.

---

## License

MIT
