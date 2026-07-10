# Radiology Workstation — standalone Dockerfile
# Builds the Vite frontend + Express server into one image.

FROM node:22-bookworm-slim AS base
WORKDIR /app

# package.json build script calls pnpm, so install/activate pnpm inside Docker.
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy dependency manifests first.
COPY package.json pnpm-lock.yaml* package-lock.json* ./

# Use pnpm if lockfile exists, otherwise npm fallback.
RUN if [ -f pnpm-lock.yaml ]; then \
      pnpm install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then \
      npm ci; \
    else \
      npm install; \
    fi

COPY . .

# Build using the same package manager that was installed. node_modules is
# intentionally NOT pruned to production-only here: drizzle-kit + tsx (used by
# the runtime entrypoint below for migration/seeding) are devDependencies, and
# re-installing just those two into a separately-pruned runtime node_modules
# proved unreliable across environments (missing .bin symlinks on some Docker
# storage backends, missing entry files on others). Shipping the already-built
# full node_modules is simpler and avoids a second install entirely.
RUN if [ -f pnpm-lock.yaml ]; then \
      pnpm run build; \
    else \
      npm run build; \
    fi

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV SERVER_PORT=3000
ENV TZ=Asia/Kolkata

# Runtime: full node_modules (see note above) + built artifacts + migration/
# seed toolchain source (drizzle.config.ts, server/db, scripts) so the
# entrypoint can run drizzle-kit push + seed-defaults.ts out of the box.
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=base /app/tsconfig.json ./tsconfig.json
COPY --from=base /app/server/db ./server/db
COPY --from=base /app/scripts ./scripts

COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=10s --start-period=20s --retries=5 \
  CMD curl -fsS http://localhost:3000/health || exit 1

# Auto-migrates + seeds on every start (both steps are idempotent), then
# starts the server. See docker-entrypoint.sh.
ENTRYPOINT ["/usr/bin/tini", "--", "./docker-entrypoint.sh"]
