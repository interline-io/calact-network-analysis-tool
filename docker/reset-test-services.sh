#!/bin/bash
# Reset and initialize the docker-compose test services.
#
# Usage:
#   cd docker && ./reset-test-services.sh
#
# This script:
#   1. Tears down the test services + their volumes (clean slate — the restore is
#      skipped when the database already has data, so a stale volume is exactly
#      what you want to drop after refreshing the dumps)
#   2. Rebuilds the tlserver image, so Dockerfile / TRANSITLAND_REF changes are
#      picked up
#   3. Brings it back up; tlserver self-initializes in its entrypoint (restores
#      both dumps) before binding its port
#   4. Waits for it to be ready
set -e

cd "$(dirname "$0")"

COMPOSE="docker compose -f docker-compose.services.yaml"

# The dumps are excluded from LFS by default (see .lfsconfig) — bind-mounting a
# pointer file would restore nothing. `-X ""` clears the configured exclude.
echo "=== Fetching test fixture dumps (LFS) ==="
git -C .. lfs pull -I "testdata/gtfs/*.dump" -X ""

echo ""
echo "=== Tearing down existing services and volumes ==="
$COMPOSE down -v --remove-orphans

echo ""
echo "=== Rebuilding tlserver image ==="
$COMPOSE build tlserver

echo ""
echo "=== Starting services (self-initializing) ==="
$COMPOSE up -d "$@"

echo ""
echo "=== Waiting for services ==="
./check-test-services.sh

echo ""
echo "Next steps:"
echo "  cd .."
echo "  pnpm test"
echo "  pnpm test:browser --reporter=list"
