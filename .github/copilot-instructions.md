# GitHub Copilot Instructions for FOMO

## Repo map
- This is a pnpm/Turbo monorepo.
- Main packages:
  - `packages/core/`: shared types, storage client, service layer, scrapers, and source registry.
  - `packages/web/`: Hono server + React/Vite frontend.
  - `packages/cli/`: Commander CLI + Ink TUI.
- Infra/deployment files: `infra/`, `Dockerfile`, `deploy.sh`, `.env*`, `.allowed_users.txt`.

## Where to make changes
- Shared logic, data models, store access, and scraper implementations: `packages/core/src/**`.
- API routes, auth, and server-side behavior: `packages/web/server/**`.
- UI components and frontend state: `packages/web/src/**`.
- CLI commands, config, and TUI: `packages/cli/src/**`.
- New data source/plugin: add `packages/core/src/scraper/sources/<name>.ts` and register it in `packages/core/src/scraper/registry.ts`.
- Azure/container changes: `infra/**`, `Dockerfile`, `deploy.sh`.

## Working conventions
- Keep changes package-scoped; `packages/core` is the shared dependency for web and CLI.
- Prefer reusing shared logic from `@fomo/core` instead of duplicating it in web/cli.
- Do not edit generated `dist/` output manually; rebuild instead.
- If dependencies change, update `pnpm-lock.yaml` via `pnpm install`.

## Build/test flow
- Install once: `pnpm install`
- Build all packages: `pnpm build`
- Run tests: `pnpm test`
- For local web run, ensure `.env` (or exported env vars) contains `AZURE_STORAGE_CONNECTION_STRING`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `SESSION_SECRET`, then run the built server: `node packages/web/dist/server/index.js`.

## Deployment
- Source local env first: `source .env`
- Deploy with: `bash deploy.sh fomo swedencentral -y`
- Required deployment env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` (and optional `ALLOWED_USERS`).
- The devcontainer uses `.devcontainer/postCreate_pre_hook.sh` to invoke `.devcontainer/install-az-cli.sh`; `az login` is still required before deployment.
- The deploy script provisions Azure resources, builds/pushes the container image, and updates the Container App.

## Git policy
- Do not commit, push, reset, rebase, or otherwise rewrite git history unless the user explicitly asks.
