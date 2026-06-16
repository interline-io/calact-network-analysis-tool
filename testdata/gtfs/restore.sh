#!/bin/bash
set -ex -o pipefail

# Restore both snapshots into the $TL_DATABASE_URL database (defaulting to a local
# calact_tlserver). No dropdb/createdb: pg_restore --clean --if-exists drops and recreates
# each object in place, so this refreshes an existing DB and works against a managed one
# you can't drop. Base tables first, then the census/NTD reference tables (disjoint sets
# with no cross-FK, so order is not load-bearing).
: "${TL_DATABASE_URL:=postgres://localhost/calact_tlserver}"
export TL_DATABASE_URL

pg_restore --clean --if-exists --no-owner -d "$TL_DATABASE_URL" calact_tlserver.dump || true
pg_restore --clean --if-exists --no-owner -d "$TL_DATABASE_URL" calact_tlserver-census.dump || true

# Run server
TL_LOG=trace transitland server --max-radius=100_000_000  --loader-stop-time-batch-size=1000 --long-query=0
