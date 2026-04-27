#!/bin/sh
# NevUp Backend — Docker entrypoint
# Runs migrations, seeds data, then starts the server
# Ensures "docker compose up" with ZERO manual steps

set -e

echo "🔄 Running migrations..."
node dist/db/migrate.js || echo "Migrations may have already been applied"

echo "🌱 Seeding database..."
node dist/db/seed.js || echo "Seed data may have already been loaded"

echo "🚀 Starting API server..."
exec node dist/index.js
