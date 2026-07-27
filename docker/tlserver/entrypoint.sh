#!/bin/bash
set -e
# Initialize (idempotent DB restore) BEFORE serving, so the server binds its port
# only once the data is loaded — then "accepts a connection" means "ready", with
# no separate init service or compose-level completion gate needed.
/tlserver/test-init.sh

export TL_DATABASE_URL="postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$PGDATABASE?sslmode=disable"

# Bring the restored schema up to date with the pinned server build; idempotent.
transitland dbmigrate up

exec transitland server \
  --dburl "$TL_DATABASE_URL" \
  --max-radius=100000000 \
  --loader-stop-time-batch-size=1000 \
  --long-query=0
