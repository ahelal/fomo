# 📰 FOMO

**Fear Of Missing Out** — A release & update tracker for developer tools.  
Track GitHub releases, Azure updates, VS Code changelogs, Copilot CLI versions and The Register tech news in one place.

One container · One storage backend · Two interfaces (Web + CLI)

---

## Table of Contents

- [Architecture](#architecture)
- [Installation](#installation)
  - [Azure Deployment](#azure-deployment)
  - [CLI Setup](#cli-setup)
  - [Local Development](#local-development)
- [Using the Web Interface](#using-the-web-interface)
- [Using the CLI](#using-the-cli)
  - [Commands](#commands)
  - [Interactive TUI](#interactive-tui)
  - [Backup & Restore](#backup--restore)
- [Sources](#sources)
  - [Built-in Sources](#built-in-sources)
  - [Adding a New Source](#adding-a-new-source)
- [Authentication](#authentication)
- [Environment Variables](#environment-variables)
- [CI/CD](#cicd)
- [License](#license)

---

## Architecture

```
packages/
  core/     Shared types · HTTP client · Azure Table Store · scrapers · service
  web/      Hono API server + Vite React SPA  (single Docker container)
  cli/      Commander CLI + Ink TUI  (connects to Azure Storage directly)
```

Both interfaces share `@fomo/core`. The web server exposes an HTTP API consumed
by the browser SPA. The CLI talks to Azure Table Storage directly — no server required.

All data lives in a single Azure Table Storage table (`updates`).

---

## Installation

### Azure Deployment

Deploy the web interface and scraper job to Azure Container Apps.

**Prerequisites:** Azure CLI (`az login`), Google OAuth credentials ([setup](#authentication))

```bash
# 1. Set credentials
export GOOGLE_CLIENT_ID="<from Google Cloud Console>"
export GOOGLE_CLIENT_SECRET="<from Google Cloud Console>"
export SESSION_SECRET="$(openssl rand -hex 32)"

# 2. Edit the email allowlist (one email per line)
nano .allowed_users.txt

# 3. Deploy everything
./deploy.sh <resource-group> [location]
```

The script creates all Azure resources (Container Registry, Storage Account,
Container Apps Environment, Container App, Scraper Job), builds the Docker image
remotely on ACR, and deploys the app.

The Container App scales to zero when idle. The scraper job runs hourly.

### CLI Setup

The CLI connects directly to Azure Table Storage — no server needed.

```bash
# Install globally (from repo root)
pnpm --filter @fomo/cli build
npm link packages/cli

# Configure
fomo config set --connection-string "<Azure Storage connection string>"
fomo config show
```

Or use the environment variable instead of the config file:

```bash
export AZURE_STORAGE_CONNECTION_STRING="<connection string>"
```

### Local Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests (63 tests across core + web)
pnpm test

# Start the server locally
export AZURE_STORAGE_CONNECTION_STRING="<connection string>"
export GOOGLE_CLIENT_ID="<client id>"
export GOOGLE_CLIENT_SECRET="<client secret>"
export SESSION_SECRET="$(openssl rand -hex 32)"
node packages/web/dist/server/index.js
```

Open http://localhost:3000 — you'll be redirected to Google SSO login.

**Docker build (for testing the image locally):**

```bash
docker build -t fomo .
docker run -p 3000:3000 \
  -e AZURE_STORAGE_CONNECTION_STRING="<connection string>" \
  -e GOOGLE_CLIENT_ID="<client id>" \
  -e GOOGLE_CLIENT_SECRET="<client secret>" \
  -e SESSION_SECRET="<secret>" \
  fomo
```

---

## Using the Web Interface

Open the deployed URL (or http://localhost:3000 for local dev). You'll be
prompted to sign in with Google.

**Keyboard shortcuts** (work without clicking):

| Key           | Action                   |
|---------------|--------------------------|
| `1` `2` `3` `4` | Filter: All / Unread / Read / Saved |
| `j` / `↓`    | Next item                |
| `k` / `↑`    | Previous item            |
| `Enter`       | Toggle detail pane       |
| `r`           | Mark read                |
| `u`           | Mark unread              |
| `s`           | Save / unsave            |
| `x`           | Mark read & jump to next unread |
| `o`           | Open URL in new tab      |
| `p`           | Fetch content (detail view) |
| `f`           | Fetch new updates        |
| `.`           | Toggle preview position (right / bottom) |

The status bar shows counts, current filter, your email, and a logout button.

---

## Using the CLI

### Commands

| Command                             | Description                      |
|-------------------------------------|----------------------------------|
| `fomo fetch`                        | Fetch all sources                |
| `fomo fetch --source azure vscode`  | Fetch specific sources           |
| `fomo list`                         | List all updates                 |
| `fomo list --status unread`         | Filter by status                 |
| `fomo list --source github`         | Filter by source                 |
| `fomo mark <id> read`               | Set status (unread / read)       |
| `fomo stats`                        | Counts by status and source      |
| `fomo backup [dir]`                 | Backup all updates to JSON file  |
| `fomo restore <file>`              | Restore updates from backup      |
| `fomo ui`                           | Launch interactive TUI           |
| `fomo config set --connection-string <cs>` | Set Azure connection string |
| `fomo config show`                  | Show current config              |

### Interactive TUI

Launch with `fomo ui`. The TUI mirrors the web interface with the same dark
theme, keyboard shortcuts, and layout.

| Key           | Action                   |
|---------------|--------------------------|
| `j` / `↓`    | Next item                |
| `k` / `↑`    | Previous item            |
| `Enter`       | Toggle detail pane       |
| `r`           | Mark read                |
| `u`           | Mark unread              |
| `s`           | Save / unsave            |
| `x`           | Mark read & jump to next unread |
| `o`           | Open in browser          |
| `f`           | Fetch new updates        |
| `0`–`3`       | Filter: All / Unread / Read / Saved |
| `q`           | Quit                     |

### Backup & Restore

Backup all updates from Azure Table Storage to a local JSON file:

```bash
fomo backup                    # → ./fomo-backup-2026-04-17T12-00-00.json
fomo backup ./backups          # → ./backups/fomo-backup-2026-04-17T12-00-00.json
```

Restore from a backup file (upserts — safe for both fresh and incremental restores):

```bash
fomo restore ./fomo-backup-2026-04-17T12-00-00.json
```

The backup format is `{ version: 1, exportedAt, count, entities: [...] }`.

---

## Sources

### Built-in Sources

| Source        | ID            | What it tracks                          |
|---------------|---------------|-----------------------------------------|
| GitHub        | `github`      | GitHub Releases (Node.js, TypeScript, etc.) |
| Azure         | `azure`       | Azure Updates RSS feed                  |
| VS Code       | `vscode`      | VS Code releases (official Atom feed)   |
| Copilot CLI   | `copilot-cli` | GitHub Copilot CLI releases             |
| The Register  | `theregister` | The Register tech news (Atom feed)      |

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

The source is automatically available in the web UI, CLI, and scraper job.

See [EXTENDING.md](EXTENDING.md) for more patterns (RSS/Atom feeds, GitHub Releases API).

---

## Authentication

The web interface is protected by **Google Sign-In**. No passwords or tokens to manage.

### Setup

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create an **OAuth 2.0 Client ID** (Web application)
3. Add **Authorized redirect URIs**:
   - `http://localhost:3000/auth/callback` (local dev)
   - `https://<your-app-url>/auth/callback` (production)
4. Copy the **Client ID** and **Client Secret**

### Email Allowlist

Edit `.allowed_users.txt` in the repo root (one email per line):

```
alice@example.com
bob@example.com
```

If the file is empty or missing, **all** Google accounts are allowed.
This file is baked into the Docker image — rebuild and redeploy after editing.

### How It Works

1. Browser → `/auth/login` → Google consent screen
2. Google → `/auth/callback` → exchange code for user info
3. Email checked against allowlist → signed HttpOnly cookie set (30-day expiry)
4. Cookie is HMAC-SHA256 signed using `SESSION_SECRET` (zero external dependencies)

The CLI does **not** use authentication — it connects directly to Azure Storage.

---

## Environment Variables

### Server (Web Container)

| Variable                          | Required | Description                                     |
|-----------------------------------|----------|-------------------------------------------------|
| `AZURE_STORAGE_CONNECTION_STRING` | Yes      | Azure Table Storage connection string            |
| `GOOGLE_CLIENT_ID`               | Yes      | Google OAuth 2.0 Client ID                      |
| `GOOGLE_CLIENT_SECRET`           | Yes      | Google OAuth 2.0 Client Secret                  |
| `SESSION_SECRET`                 | Yes      | Cookie signing secret (≥32 chars random string) |
| `ALLOWED_USERS_FILE`             | No       | Path to email allowlist (default: `.allowed_users.txt`) |
| `PORT`                            | No       | HTTP port (default: `3000`)                     |

### CLI

| Variable                          | Description                                    |
|-----------------------------------|------------------------------------------------|
| `AZURE_STORAGE_CONNECTION_STRING` | Connection string (alternative to config file) |

---

## CI/CD

A GitHub Actions workflow (`.github/workflows/deploy.yml`) deploys on every push to `main`.

### Setup

1. **Create a service principal:**

   ```bash
   az ad sp create-for-rbac \
     --name "fomo-deploy" \
     --role Contributor \
     --scopes /subscriptions/<SUBSCRIPTION_ID> \
     --sdk-auth
   ```

2. **Add repository secrets** (Settings → Secrets → Actions):

   | Secret                  | Value                                  |
   |-------------------------|----------------------------------------|
   | `AZURE_CREDENTIALS`     | Service principal JSON from step 1     |
   | `AZURE_RESOURCE_GROUP`  | Target resource group name             |
   | `GOOGLE_CLIENT_ID`      | Google OAuth Client ID                 |
   | `GOOGLE_CLIENT_SECRET`  | Google OAuth Client Secret             |
   | `SESSION_SECRET`        | Random string (`openssl rand -hex 32`) |

3. **Optional variable** (Settings → Variables → Actions):

   | Variable         | Default          |
   |------------------|------------------|
   | `AZURE_LOCATION` | `swedencentral`  |

4. Push to `main` — the workflow builds, tests, deploys infra via Bicep, and updates the container.

---

## Storage

All data lives in Azure Table Storage (`updates` table).

| Field        | Value                                 |
|--------------|---------------------------------------|
| PartitionKey | Source ID (e.g. `azure`, `github`)    |
| RowKey       | `sha256(url).slice(0, 32)`            |

Status updates use ETag-based optimistic concurrency.

---

## License

MIT
