#!/bin/sh
# Runs schema migration + user seeding on every container start, then hands off
# to the server. Both steps are idempotent (drizzle-kit push is a no-op on an
# up-to-date schema; seed-defaults.ts upserts by username), so it's safe to run
# on every restart, not just the first one.
set -e

cd /app

echo "==> Applying database schema (drizzle-kit push)..."
./node_modules/.bin/drizzle-kit push --config drizzle.config.ts

echo "==> Seeding default users + protocols..."
./node_modules/.bin/tsx scripts/seed-defaults.ts

echo "==> Starting server..."
exec node --enable-source-maps ./dist/server/index.mjs
