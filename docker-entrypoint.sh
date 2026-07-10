#!/bin/sh
# Runs schema migration + user seeding on every container start, then hands off
# to the server. Both steps are idempotent (drizzle-kit push is a no-op on an
# up-to-date schema; seed-defaults.ts upserts by username), so it's safe to run
# on every restart, not just the first one.
set -e

cd /app

# Invoke the packages' JS entry points directly instead of node_modules/.bin/*
# — some Docker storage backends (seen on Synology overlay2/network volumes)
# silently fail to create npm's .bin symlinks, which otherwise crash-loops
# the whole container with a misleading "not found" error.
echo "==> Applying database schema (drizzle-kit push)..."
node node_modules/drizzle-kit/bin.cjs push --config drizzle.config.ts

echo "==> Seeding default users + protocols..."
node node_modules/tsx/dist/cli.mjs scripts/seed-defaults.ts

echo "==> Starting server..."
exec node --enable-source-maps ./dist/server/index.mjs
