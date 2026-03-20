#!/bin/bash
set -ex -o pipefail

# Drop and recreate database
dropdb --if-exists calact_tlserver
createdb calact_tlserver

# Restore snapshot
pg_restore -d calact_tlserver calact_tlserver.dump || true

# Run server
export TL_DATABASE_URL=postgres://localhost/calact_tlserver
TL_LOG=trace transitland server --max-radius=100_000_000  --loader-stop-time-batch-size=1000 --long-query=0
