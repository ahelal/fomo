# GitHub Copilot Instructions for FOMO

## Repo map
- This is a pnpm/Turbo monorepo.
- Main packages:
  - `packages/core/`: shared types, Azure Table stores, services, scrapers, source registry and the digest engine.
  - `packages/extensions/`: bundled ESM fetchers (Anthropic, Copilot CLI and Teams), manifests and release hashes.
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
- New data source: prefer a `feed`/`github-releases`/`youtube` spec in `BUILTIN_SOURCES`. For code-backed sources, add a bundled ESM extension under `packages/extensions/src/`, register its build and host adapter, and point a `custom` spec at its stable `extension` ID. Use the narrow `@fomo/core/extension-api` entry; never add an in-process fallback. See `EXTENDING.md`.
- Experimental source (personal data behind a local sign-in, TUI only, off by default per profile): add its info to `EXPERIMENTAL_SOURCE_INFOS` in `packages/core/src/experimental.ts` and its provider + sign-in to `EXPERIMENTAL_SETUPS` in `packages/tui/src/experimental/index.ts`. Never make the web app fetch it.
- Azure changes: `infra/**`, `deploy.sh`.

## Working conventions
- Keep changes package-scoped; `packages/core` is the shared dependency for web and TUI.
- Prefer reusing shared logic from `@fomo/core` instead of duplicating it in web/cli.
- Keep the web and TUI keyboard behaviour in sync.
- Shortcuts are case-insensitive: never bind different actions to the upper and lower case of one letter (`b`/`B`). Match keys with `shortcutKey()` from `@fomo/core`; keep the raw key only for text input.
- In list views, Shift+↑/↓ jumps `jumpStep(screenLines)` rows (5, or 10 on a tall screen) from `@fomo/core`.
- Do not edit generated `dist/` output manually; rebuild instead.
- If dependencies change, update `pnpm-lock.yaml` via `pnpm install`.
- Code extensions require the verified MXC policy (currently macOS only). Teams WorkIQ is an explicit exception: it runs unsandboxed with the host account and host filesystem/network access, clearly labelled in the TUI; keep its MCP broker scope read-only and bounded, and never silently broaden that access. Third-party trust/folder grants and hard total-memory containment are not yet implemented.

## Build/test flow
- Use Node 24+ and the pinned pnpm 11.7.0. Install once: `pnpm install`
- Build all packages: `pnpm build`
- Run tests: `pnpm test`
- Local web: `pnpm --filter @fomo/web dev`, then open the link from the TUI (`c` → Link a device) (use Azurite with `UseDevelopmentStorage=true` for local data).

## Deployment
- `az login`, then: `bash deploy.sh fomo swedencentral -y`.
- The deploy script builds the web app, deploys the storage Bicep, enables the static website and uploads the PWA.
- The devcontainer uses `.devcontainer/postCreate_pre_hook.sh` to invoke `.devcontainer/install-az-cli.sh`; `az login` is still required before deployment.

## Git policy
- Do not commit, push, reset, rebase, or otherwise rewrite git history unless the user explicitly asks.
