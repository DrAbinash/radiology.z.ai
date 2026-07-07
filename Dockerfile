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

# Build with pnpm because the scripts use pnpm.
RUN pnpm run build

# Keep only production dependencies for runtime.
RUN pnpm prune --prod

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV SERVER_PORT=3000
ENV TZ=Asia/Kolkata

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
COPY --from=base /app/package.json ./package.json

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=10s --start-period=20s --retries=5 \
  CMD curl -fsS http://localhost:3000/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "./dist/server/index.mjs"]
