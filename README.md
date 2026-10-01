# 📰 FOMO

**Fear Of Missing Out** — a release & update tracker for developer tools.
Track GitHub releases, Azure updates, VS Code changelogs, Copilot CLI versions and tech news in one place,
with a **GitHub Copilot digest** that folds related updates into one topic with a few highlights.

One storage account · No servers · Two interfaces (CLI/TUI + installable web app)

---

## Table of Contents

- [Architecture](#architecture)
- [Copilot Digest](#copilot-digest)
- [Installation](#installation)
  - [Azure Deployment](#azure-deployment)
  - [CLI Setup](#cli-setup)
  - [Connect the Web App](#connect-the-web-app)
  - [Install on Android](#install-on-android)
  - [Local Development](#local-development)
  - [Migrating from Container Apps](#migrating-from-container-apps)
- [Using the Web App](#using-the-web-app)
- [Using the CLI](#using-the-cli)
  - [Commands](#commands)
  - [Interactive TUI](#interactive-tui)
  - [Backup & Restore](#backup--restore)
- [Sources](#sources)
- [Security](#security)
- [Environment Variables](#environment-variables)
- [CI/CD](#cicd)
- [Storage](#storage)
- [License](#license)

---

## Architecture

```mermaid
flowchart LR
  subgraph laptop[Your machine]
    CLI["fomo CLI / TUI<br/>fetch · digest · link"]
    Copilot["GitHub Copilot SDK"]
  end
  subgraph azure[Azure Storage account]
    Tables[("Table Storage<br/>updates · topics · settings · todos")]
    Web["Static website ($web)<br/>PWA"]
  end
  Phone["Browser / Android PWA"]

  CLI -- "connection string" --> Tables
  CLI <--> Copilot
  Web -. "loads app" .-> Phone
  Phone -- "SAS token (CORS)" --> Tables
```

```
packages/
  core/     Shared types · Azure Table stores · scrapers · digest engine · services
  web/      React/Vite PWA — static files, talks to Table Storage directly
  cli/      Commander CLI + Ink TUI — fetches sources and runs the Copilot digest
```

- **No compute in Azure.** Everything lives in one Storage Account: Table Storage for data and the static website for the web app.
- **Fetch and digest run from the CLI** (`fomo fetch`) on your machine, using your GitHub Copilot subscription.
- **The web app is static.** It reads and writes Table Storage from the browser with a SAS token handed over by `fomo link` (magic link / QR code).

---

## Copilot Digest

Instead of reading 200 separate updates, the **Digest** view (the default, key `0`) shows one line per product area,
usually 20–30 topics:

```
▸ ▲ Copilot CLI releases                          6   github, github-blog   2h ago
▸ Copilot code review                             9   github                5h ago
▸ Azure networking                                5   azure                 1d ago
▸ Azure retirements                               4   azure                 1d ago
```

Open a topic to see a one-sentence summary and up to six highlights (most important first). Each update in the topic also gets its own one-line summary, so you can decide which ones to open.
Mark the whole topic read with `x`, which makes skipping a low-value area a single key press.

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

To steer the rating toward what you care about, add an optional interests note. It moves a topic up or down by at most one level and never changes the grouping:

```bash
fomo config set --interests "Copilot CLI and agents, VS Code; not SAP or billing"
fomo config set --interests ""      # clear
```

How it works:

- `fomo fetch` fetches the sources and then runs the digest. `fomo digest` runs it on its own.
- Only **unread updates that don't have a topic yet** are sent to Copilot, in two passes:
  1. **Plan:** one call sees every pending update (title and a short excerpt) plus the currently open topics. It assigns each update to an existing or new topic and rates it. Updates the model skips get one more call; oversized new topics get a split call.
  2. **Write:** one small call per touched topic writes the summary, the highlights and a one-sentence summary of each new update. These run 6 at a time with low reasoning effort, and a failed call is retried once.
- Topics are stored in the `topics` table, and each update points to its topic (`topicId`), so the web app and TUI only read.
- Updates that haven't been digested yet still appear in the digest as single-item entries.
- About 220 updates take roughly 2 minutes. Use `--max-items` (default 300) to cap a run; later runs only process new items.
- The default model is `gpt-5-mini`. Change it with `fomo config set --copilot-model <model>`, `FOMO_COPILOT_MODEL`, or `--model`.
- Existing topics keep their grouping and rating. Run `fomo digest --reset` to regroup and re-rate all unread updates (read and saved status is untouched). This also fills in per-update summaries for updates digested before they existed.
- Authentication uses your logged-in Copilot CLI user, or `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN`.

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

### CLI Setup

```bash
pnpm --filter @fomo/cli... build
node packages/cli/dist/index.js --help     # or put `fomo` on your PATH: (cd packages/cli && npm link)

fomo config set \
  --connection-string "$(az storage account show-connection-string -g fomo -n <account> -o tsv)" \
  --web-url https://<account>.z1.web.core.windows.net/
fomo config show
```

The digest needs GitHub Copilot. If you use the Copilot CLI, you're already signed in; otherwise export `COPILOT_GITHUB_TOKEN`.

```bash
fomo fetch        # fetch all sources + build the digest
fomo ui           # read it in the terminal; press f (or F) to fetch + digest from inside the UI
```

### Connect the Web App

```bash
fomo link             # prints a magic link and a QR code
fomo link --days 30   # shorter-lived link
```

Open the link (or scan the QR code with your phone). It carries a Table Storage SAS token in the URL
fragment (`#…`), which is never sent to any server. The web app saves it in the browser and removes it from the address bar.
You can also paste the link into the app's connect screen.

The status bar warns you when the token has 14 days or less left. Run `fomo link` again to renew it. **Disconnect** removes the token from that browser.

### Install on Android

1. Open the magic link in **Chrome** on your phone. Scanning the QR code from `fomo link` works well.
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
fomo config set --connection-string "UseDevelopmentStorage=true" --web-url http://localhost:5173/
fomo fetch

# Web app dev server
pnpm --filter @fomo/web dev
fomo link          # open the printed link to connect the dev server
```

With Azurite, `fomo link` creates a SAS token that also allows `http`. The `az storage cors add` command lets the browser call Azurite from the dev server; it mirrors the CORS rule that Bicep sets in Azure.

### Migrating from Container Apps

Earlier versions ran a Hono server and an hourly scraper job on Azure Container Apps with Google sign-in. The Storage Account and your data stay the same.

1. Run `bash deploy.sh fomo swedencentral --cleanup-legacy`. This deploys the static site and deletes `fomo-app`, `fomo-scraper`, `fomo-env`, `fomo-env-logs` and the Container Registry.
2. Run `fomo config set --web-url <printed URL>`, then `fomo link`.
3. Run `fomo digest` once to group your existing unread updates.
4. Remove the old secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `ALLOWED_USERS`) from GitHub and your `.env`, and delete the Google OAuth client.

---

## Using the Web App

The web app mirrors the TUI: the same dark text UI and the same keys. On a phone, tap rows, use the action bar, and pull to refresh.

| Key             | Action                                    |
|-----------------|-------------------------------------------|
| `0`             | Digest: unread updates grouped by topic   |
| `1` `2` `3` `4` | Filter: All / Unread / Read / Saved       |
| `5` / `t`       | Todos                                     |
| `j` / `↓`       | Next row                                  |
| `k` / `↑`       | Previous row                              |
| `Enter`         | Digest: expand topic · Lists: toggle detail |
| `→` / `l`, `←`  | Digest: expand / collapse topic           |
| `x`             | Mark read (the whole topic in the digest) & next |
| `r` / `u`       | Mark read / unread                        |
| `n`             | Next topic / next unread                  |
| `s`             | Save / unsave                             |
| `o`             | Open URL in a new tab                     |
| `.`             | Toggle preview position (right / bottom)  |
| `c`             | Config                                    |
| `h`             | Help                                      |

Fetching isn't done in the browser. Run `fomo fetch` from the CLI, then pull to refresh.

---

## Using the CLI

### Commands

| Command                                     | Description                                   |
|---------------------------------------------|-----------------------------------------------|
| `fomo fetch`                                | Fetch all sources, then run the Copilot digest |
| `fomo fetch --source azure vscode`          | Fetch specific sources                        |
| `fomo fetch --no-digest`                    | Fetch only                                    |
| `fomo digest`                               | Group unread updates into topics              |
| `fomo digest --reset`                       | Regroup all unread updates from scratch       |
| `fomo digest --model <m> --max-items <n>`   | Pick the model and cap items per run (default 300) |
| `fomo link [--days 365] [--url <u>] [--no-qr]` | Magic link + QR code for the web app       |
| `fomo list [--status unread] [--source github]` | List updates                              |
| `fomo mark <id> read`                       | Set status (unread / read)                    |
| `fomo stats`                                | Counts by status and source                   |
| `fomo backup [dir]` / `fomo restore <file>` | Backup / restore updates                      |
| `fomo todo add\|list\|set-status\|delete`    | Personal todos                                |
| `fomo ui`                                   | Launch the interactive TUI                    |
| `fomo config set --connection-string <cs> --web-url <u> --copilot-model <m>` | Configure |
| `fomo config set --interests "<text>"`      | Interests note that steers digest importance (`""` clears) |
| `fomo config show`                          | Show current config (secrets masked)          |
| `fomo config remote`                        | View / update shared (remote) settings        |

### Interactive TUI

Launch it with `fomo ui`. It opens on the **Digest**.

| Key             | Action                                    |
|-----------------|-------------------------------------------|
| `0`             | Digest: unread grouped by topic           |
| `1`–`4`         | Filter: All / Unread / Read / Saved       |
| `j`/`↓`, `k`/`↑`| Move                                      |
| `Enter`         | Expand topic and open it / toggle detail  |
| `→`/`l`, `←`    | Expand / collapse topic                   |
| `x` / `r`       | Mark topic (or update) read & next        |
| `u`             | Mark unread (lists)                       |
| `n`             | Next topic / next unread                  |
| `s`             | Save / unsave                             |
| `o`             | Open in browser (newest update of a topic)|
| `p`             | Fetch full content (detail view)          |
| `f` / `F`       | Fetch latest updates + Copilot digest     |
| `c`             | Config                                    |
| `.`             | Toggle preview position                   |
| `h`             | Help                                      |
| `q`             | Quit                                      |

### Backup & Restore

Back up all updates from Azure Table Storage to a local JSON file:

```bash
fomo backup                    # → ./fomo-backup-2026-04-17T12-00-00.json
fomo backup ./backups          # → ./backups/fomo-backup-2026-04-17T12-00-00.json
```

Restore from a backup file. Entities are upserted, so this is safe for both fresh and incremental restores:

```bash
fomo restore ./fomo-backup-2026-04-17T12-00-00.json
```

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
fomo fetch --source mysource
```

The source is automatically available in the CLI (`fomo fetch`), the digest, and the web app.

See [EXTENDING.md](EXTENDING.md) for more patterns (RSS/Atom feeds, GitHub Releases API).

---

## Security

- **CLI:** uses the storage connection string (account key). Keep `~/.fomo/config.json` private.
- **Web app:** uses an **account SAS token** limited to the Table service and entity operations (`ss=t`, `srt=o`, `sp=raud`), HTTPS only, and valid for `--days` (default 365).
  - It can read and update your FOMO tables, but it cannot create or delete tables or touch blobs.
  - It is delivered in the URL fragment, so it never reaches a web server or logs, and it is stored in the browser's `localStorage`.
- **Revoke every link:** rotate the storage key that signed it (`fomo link` signs with the key in your connection string, usually `key1`):
  ```bash
  az storage account keys renew -g fomo -n <account> --key key1
  ```
  Then update the CLI with the new connection string and run `fomo link` again.
- **CORS:** Table Storage only accepts browser calls from the static website origin (and localhost dev ports). Add custom domains with the `extraCorsOrigins` Bicep parameter.
- The static website itself is public, but it contains no data.

---

## Environment Variables

All are optional. `fomo config set` stores the same values in `~/.fomo/config.json`.

| Variable                          | Description                                                  |
|-----------------------------------|--------------------------------------------------------------|
| `AZURE_STORAGE_CONNECTION_STRING` | Connection string (fallback when the config file has none)   |
| `FOMO_WEB_URL`                    | Web app URL for `fomo link` (overrides config)               |
| `FOMO_COPILOT_MODEL`              | Copilot model for the digest (overrides config)              |
| `FOMO_INTERESTS`                  | Interests note for digest importance (overrides config)      |
| `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN` | Token for the Copilot SDK (default: logged-in Copilot CLI user) |

---

## CI/CD

The GitHub Actions workflow (`.github/workflows/deploy.yml`) builds and tests every push to `main`, then runs `deploy.sh` to update the storage account and static website.
It signs in to Azure with OIDC (Workload Identity Federation), so it needs no Azure secrets beyond these IDs:

| Secret                  | Value                                   |
|-------------------------|-----------------------------------------|
| `AZURE_CLIENT_ID`       | Client ID of the federated identity     |
| `AZURE_TENANT_ID`       | Tenant ID                               |
| `AZURE_SUBSCRIPTION_ID` | Subscription ID                         |

The identity needs **Contributor** on the resource group. `deploy.sh` lists the storage key to upload the site.
See [docs/workload-identity-federation.md](docs/workload-identity-federation.md) for the setup.

Fetching isn't scheduled in CI. Run `fomo fetch` whenever you want fresh updates.

---

## Storage

| Table      | PartitionKey                       | RowKey                       | Contents                              |
|------------|------------------------------------|------------------------------|---------------------------------------|
| `updates`  | Source ID (e.g. `azure`, `github`) | `sha256(url).slice(0, 32)`   | Updates, status, saved, `topicId`, Copilot `summary` |
| `topics`   | `topic`                            | Topic id                     | Copilot title, summary, highlights    |
| `settings` | —                                  | —                            | Shared UI/source settings             |
| `todos`    | —                                  | —                            | Personal todos                        |

Status updates use ETag-based optimistic concurrency.

---

## License

MIT
