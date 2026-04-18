# ─── Build stage ─────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace manifests first (layer caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/core/package.json   packages/core/
COPY packages/web/package.json    packages/web/

RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/core   packages/core
COPY packages/web    packages/web

# Build: core → web (server via tsc + client via Vite)
RUN pnpm --filter @fomo/core build && \
    pnpm --filter @fomo/web  build

# ─── Runtime stage ───────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Production deps only
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/core/package.json   packages/core/
COPY packages/web/package.json    packages/web/

RUN pnpm install --frozen-lockfile --prod

# Copy compiled output
COPY --from=builder /app/packages/core/dist   packages/core/dist
COPY --from=builder /app/packages/web/dist/server    packages/web/dist/server

# Copy Vite web build — served as static files by Hono at /
COPY --from=builder /app/packages/web/dist/client    public/

# Copy allowed-users file for Google SSO email allowlist (optional — if absent, all users allowed)
COPY .allowed_users.tx[t] .

USER node
EXPOSE 3000

CMD ["node", "packages/web/dist/server/index.js"]
