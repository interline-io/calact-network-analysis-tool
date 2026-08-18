# Point this shell at the local test services from docker-compose.services.yaml:
#   source docker/docker-env.sh
#
# Ports match that file, offset into the 2xxxx range so the stack can run
# alongside a manual testdata/gtfs/restore.sh server on 8080.

# GraphQL API. The CLI and the test suite append /query to this; CI sets the
# same value.
export TRANSITLAND_API_BASE=http://localhost:28080

# The dev server proxies the browser's API calls here, so `pnpm dev` reads the
# local fixture data rather than production.
export NUXT_TLV2_PROXY_BASE_DEFAULT=http://localhost:28080

# No Auth0 locally. requireLogin defaults to on when unset, so the server API
# answers 401 without this.
export NUXT_PUBLIC_TLV2_REQUIRE_LOGIN=false
export NUXT_PUBLIC_TLV2_LOGIN_GATE=false

# tlserver's database, and the readiness target check-test-services.sh polls.
export TL_DB_URL=postgres://postgres:postgres@localhost:25432/calact_tlserver?sslmode=disable
export TLSERVER_URL=http://localhost:28080

# Opt-in integration suites, off by default because they are slow.
# export TEST_BUFFER=true
# export TEST_WSDOT=true

# Per GraphQL request: operation, elapsed, full query and variables.
# export TL_LOG=trace
