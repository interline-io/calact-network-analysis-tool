#!/bin/bash
# One-shot: restore the tlserver database from the mounted dumps, then exit.
set -e

until pg_isready; do echo "Waiting for postgres..."; sleep 2; done

psql -tc "SELECT 1 FROM pg_database WHERE datname = '$PGDATABASE'" | grep -q 1 || createdb "$PGDATABASE"

HAS_DATA=$(psql -d "$PGDATABASE" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'current_feeds'" 2>/dev/null || echo "")
if [ "$HAS_DATA" != "1" ]; then
  # Base (GTFS) then census/NTD — disjoint table sets, so order is not load-bearing.
  echo "Restoring base database from dump..."
  pg_restore --no-owner -d "$PGDATABASE" /data/calact_tlserver.dump || echo "pg_restore exited with warnings (usually OK)"
  echo "Restoring census database from dump..."
  pg_restore --no-owner -d "$PGDATABASE" /data/calact_tlserver-census.dump || echo "pg_restore exited with warnings (usually OK)"
  echo "Database restored."
else
  echo "Database already restored, skipping."
fi
