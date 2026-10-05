#!/bin/bash
# One-shot: restore the tlserver database from the mounted dumps, then exit.
set -e

until pg_isready; do echo "Waiting for postgres..."; sleep 2; done

psql -tc "SELECT 1 FROM pg_database WHERE datname = '$PGDATABASE'" | grep -q 1 || createdb "$PGDATABASE"

# Row counts, not table existence: a restore that created the schema and then
# failed would otherwise look "already restored" forever.
count_rows() {
  psql -d "$PGDATABASE" -tAc "SELECT count(*) FROM $1" 2>/dev/null || echo 0
}

if [ "$(count_rows current_feeds)" -gt 0 ] && [ "$(count_rows tl_census_geographies)" -gt 0 ]; then
  echo "Database already restored, skipping."
else
  # pg_restore exits nonzero on benign --no-owner role warnings, so the row
  # checks below are what gate success, not its exit status.
  echo "Restoring base database from dump..."
  pg_restore --no-owner -d "$PGDATABASE" /data/calact_tlserver.dump || true
  echo "Restoring census database from dump..."
  pg_restore --no-owner -d "$PGDATABASE" /data/calact_tlserver-census.dump || true

  for t in current_feeds tl_census_geographies; do
    if [ "$(count_rows "$t")" -eq 0 ]; then
      echo "ERROR: restore left $t empty — check the dumps are real files, not LFS pointers." >&2
      exit 1
    fi
  done
  echo "Database restored."
fi
