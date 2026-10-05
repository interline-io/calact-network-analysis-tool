#!/bin/bash
set -e
# Restore before serving, so the port binds only once the data is loaded and
# "accepts a connection" means "ready". Idempotent.
/tlserver/test-init.sh

export TL_DATABASE_URL="postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$PGDATABASE?sslmode=disable"

# Bring the restored schema up to date with the pinned server build; idempotent.
transitland dbmigrate up

exec transitland server \
  --dburl "$TL_DATABASE_URL" \
  --max-radius=100000000 \
  --loader-stop-time-batch-size=1000 \
  --long-query=0
