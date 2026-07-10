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

# Build using the same package manager that was installed.
RUN if [ -f pnpm-lock.yaml ]; then \
      pnpm run build && pnpm prune --prod; \
    elif [ -f package-lock.json ]; then \
      npm run build && npm ci --only=production; \
    else \
      npm run build && npm install --only=production; \
    fi

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV SERVER_PORT=3000
ENV TZ=Asia/Kolkata

# Runtime: production deps + built artifacts
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
COPY --from=base /app/package.json ./package.json

# Migration/seed toolchain — the README documents running these against the
# running container, so the runtime image must include the source + devDeps.
# drizzle-kit + tsx are devDependencies, pruned during the build stage above;
# we reinstall just those two (no package-lock churn) so `docker compose exec`
# can run drizzle-kit push and tsx scripts/seed-defaults.ts out of the box.
COPY --from=base /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=base /app/tsconfig.json ./tsconfig.json
COPY --from=base /app/server/db ./server/db
COPY --from=base /app/scripts ./scripts
RUN npm install --no-save --no-audit --no-fund drizzle-kit tsx

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=10s --start-period=20s --retries=5 \
  CMD curl -fsS http://localhost:3000/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "./dist/server/index.mjs"]
