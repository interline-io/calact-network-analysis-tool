#!/bin/bash
# Wait for and verify the test services are healthy.
#
# Targets are env-overridable so the SAME script works from the host (defaults,
# via published ports) or from inside the compose network (service names):
#   from host (default):  TLSERVER_URL=http://localhost:28080
#   from in-network:      TLSERVER_URL=http://tlserver:8080 ./check-test-services.sh
#
# Set any target to EMPTY to skip that service.
#
# Requires: curl, pg_isready
# On macOS: brew install coreutils (for gtimeout)
#
set -e

# `-` (not `:-`) so an explicitly-empty value is preserved (= skip that service),
# while an UNSET value falls back to the host default.
export TL_DB_URL="${TL_DB_URL-postgres://postgres:postgres@localhost:25432/calact_tlserver?sslmode=disable}"
export TLSERVER_URL="${TLSERVER_URL-http://localhost:28080}"

# Ensure ^C kills the whole process tree
trap 'kill 0; exit 130' INT TERM

# Use gtimeout on macOS, timeout on Linux
if command -v gtimeout &>/dev/null; then
  TIMEOUT="gtimeout --foreground"
elif command -v timeout &>/dev/null; then
  TIMEOUT="timeout --foreground"
else
  echo "ERROR: timeout (or gtimeout) not found. On macOS: brew install coreutils"
  exit 1
fi

if [ -n "$TL_DB_URL" ]; then
  echo "Waiting for postgres..."
  $TIMEOUT 30 bash -c 'until pg_isready -d "$TL_DB_URL" 2>/dev/null; do sleep 2; done'
  echo "Postgres ready."
fi

if [ -n "$TLSERVER_URL" ]; then
  # The restore runs before the port binds, so a successful query means the
  # fixture data is loaded.
  echo "Waiting for tlserver ($TLSERVER_URL)..."
  $TIMEOUT 300 bash -c '
    until curl -sf -H "content-type: application/json" \
      "$TLSERVER_URL/query" \
      -d "{\"query\":\"{feeds(limit:1){onestop_id}}\"}" | grep -q "onestop_id"
    do sleep 5; done
  '
  echo "tlserver ready (feed data loaded)."

  echo "Verifying census data is loaded..."
  $TIMEOUT 60 bash -c '
    until curl -sf -H "content-type: application/json" \
      "$TLSERVER_URL/query" \
      -d "{\"query\":\"{census_datasets(limit:1){name}}\"}" | grep -q "name"
    do sleep 5; done
  '
  echo "Census data ready."
fi

echo "Requested test services ready."
