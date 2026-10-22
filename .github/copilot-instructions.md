# GitHub Copilot Instructions for FOMO

## Repo map
- This is a pnpm/Turbo monorepo.
- Main packages:
  - `packages/core/`: shared types, Azure Table stores, services, scrapers, source registry and the digest engine.
  - `packages/web/`: static React/Vite PWA that talks to Azure Table Storage directly with a SAS token (no server).
  - `packages/tui/`: Ink TUI (`fomo`, no subcommands, one flag: `-p <profile>`); setup, config, fetches, the GitHub Copilot SDK digest, link/backup/restore all live in the UI. A **profile** is one storage account plus its local settings: `~/.fomo/config.json` holds all of them (`packages/tui/src/config.ts`), `w` switches (`ui/hooks/useProfilePicker.ts`, `ui/Root.tsx` owns the session). The web stays one account per PWA.
- Infra/deployment files: `infra/` (storage-only Bicep), `deploy.sh`.

## Architecture
- Azure is a single Storage Account: Table Storage (`updates`, `topics`, `settings`, `todos`, `references`) + static website (`$web`) hosting the PWA.
- There is no compute in Azure. Fetching and the Copilot digest run locally in the TUI (`f`).
- The browser authenticates with an account SAS (`ss=t`, `srt=o`) delivered by the TUI's “Link a device” action (`c`) in the URL fragment; Table CORS is set in Bicep.
- `@fomo/core` main entry (`FomoStorageService`, digest view helpers, connection helpers) must stay browser-safe. Node-only code lives in `FomoDirectService` (`@fomo/core/service`), scrapers, and `@fomo/core/store/sas`.
- `@github/copilot-sdk` is used only in `packages/tui` (`src/copilot.ts`), behind the `Summarizer` interface from `@fomo/core/digest`.

## Where to make changes
- Shared logic, data models, store access, digest and scraper implementations: `packages/core/src/**`.
- UI components and frontend state: `packages/web/src/**`.
- TUI screens, local config, Copilot adapter: `packages/tui/src/**` (config screen rows in `src/ui/settings.ts`).
- New data source: add a `feed`/`github-releases` spec to `BUILTIN_SOURCES` in `packages/core/src/scraper/specs.ts` (users can also add these from the app; they are stored in `userSources`). Only for sites without a feed, add a code module in `packages/core/src/scraper/sources/custom/`, built on the helpers in `scraper/{http,text,feed,github}.ts`, register it in `sources/custom/index.ts`, and point a `custom` spec at it. See `EXTENDING.md`.
- Azure changes: `infra/**`, `deploy.sh`.

## Working conventions
- Keep changes package-scoped; `packages/core` is the shared dependency for web and TUI.
- Prefer reusing shared logic from `@fomo/core` instead of duplicating it in web/cli.
- Keep the web and TUI keyboard behaviour in sync.
- Shortcuts are case-insensitive: never bind different actions to the upper and lower case of one letter (`b`/`B`). Match keys with `shortcutKey()` from `@fomo/core`; keep the raw key only for text input.
- In list views, Shift+↑/↓ jumps `jumpStep(screenLines)` rows (5, or 10 on a tall screen) from `@fomo/core`.
- Do not edit generated `dist/` output manually; rebuild instead.
- If dependencies change, update `pnpm-lock.yaml` via `pnpm install`.

## Build/test flow
- Install once: `pnpm install`
- Build all packages: `pnpm build`
- Run tests: `pnpm test`
- Local web: `pnpm --filter @fomo/web dev`, then open the link from the TUI (`c` → Link a device) (use Azurite with `UseDevelopmentStorage=true` for local data).

## Deployment
- `az login`, then: `bash deploy.sh fomo swedencentral -y`.
- The deploy script builds the web app, deploys the storage Bicep, enables the static website and uploads the PWA.
- The devcontainer uses `.devcontainer/postCreate_pre_hook.sh` to invoke `.devcontainer/install-az-cli.sh`; `az login` is still required before deployment.

## Git policy
- Do not commit, push, reset, rebase, or otherwise rewrite git history unless the user explicitly asks.
