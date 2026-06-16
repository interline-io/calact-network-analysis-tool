#!/bin/bash
# (Re)loads, scopes, and dumps the census/NTD tables (calact_tlserver-census.dump) via the
# tlv2 refdata loader — self-contained, independent of rebuild.sh (the base GTFS dump).
# Scoped to WA/OR/CA for the test fixture; FULL_NATIONAL=true loads every state.
#
# Needs `tlv2` on PATH and TL_DATABASE_URL (externally-created DB; schema applied below).
# Loading is incremental (per-source SHA1 skip); truncate first for a clean reload:
#   psql "$TL_DATABASE_URL" -c "TRUNCATE TABLE tl_census_datasets RESTART IDENTITY CASCADE;"
#
# Env: CENSUS_YEAR (default 2021), NTD_YEAR (default 2024), FULL_NATIONAL (skip scoping).
set -ex -o pipefail

: "${TL_DATABASE_URL:?set TL_DATABASE_URL to the target database}"
CENSUS_YEAR=${CENSUS_YEAR:-2021}
NTD_YEAR=${NTD_YEAR:-2024}

# Schema (idempotent; natural-earth is base GTFS data, not census).
transitland dbmigrate up
transitland dbmigrate-natural-earth

# ACS detail tables; keep in sync with REQUIRED_ACS_TABLES in src/core/census-columns.ts.
ACS_TABLES=(b01001 b01003 b02001 b08301 b19013 b23024 b25002 b25003 b25044 c17002)

# TIGER layers. bg (block group) included for aggregation; uac20 omitted (tool doesn't use it).
TIGER_LAYERS=(state county place cbsa csa tract bg)

# -------- 1. Load ACS values --------
ACS_ARGS=()
for tbl in "${ACS_TABLES[@]}"; do ACS_ARGS+=(--table "$tbl"); done
tlv2 refdata-load \
  --dataset "acsdt5y${CENSUS_YEAR}" \
  --input-dir "census-data/acsdt5y${CENSUS_YEAR}" \
  --fetch "${ACS_ARGS[@]}"

# -------- 2. Load TIGER geometries --------
TIGER_ARGS=()
for layer in "${TIGER_LAYERS[@]}"; do TIGER_ARGS+=(--table "$layer"); done
tlv2 refdata-load \
  --dataset "tiger${CENSUS_YEAR}" \
  --input-dir "census-data/tiger${CENSUS_YEAR}" \
  --fetch "${TIGER_ARGS[@]}"

# -------- 3. Load NTD annual data (all tables) --------
tlv2 refdata-load \
  --dataset "ntd-annual-${NTD_YEAR}" \
  --input-dir "census-data/ntd-annual-${NTD_YEAR}" \
  --fetch

# -------- 4. Scope to WA (53), OR (41), CA (06) --------
# Census geoids carry the state FIPS as US<ff>; NTD (ntd:%) is national and kept whole.
# CBSA/CSA geoids have no state FIPS and are dropped. Skipped when FULL_NATIONAL=true.
if [ "${FULL_NATIONAL:-false}" != "true" ]; then
  psql "$TL_DATABASE_URL" -c "DELETE FROM tl_census_values      WHERE geoid NOT LIKE 'ntd:%' AND geoid !~ '.*US(06|41|53).*';"
  psql "$TL_DATABASE_URL" -c "DELETE FROM tl_census_geographies WHERE geoid !~ '.*US(06|41|53).*';"
fi

# -------- 5. Dump --------
pg_dump -Fc -f calact_tlserver-census.dump -t 'tl_census_*' "$TL_DATABASE_URL"
echo "Census + NTD dumped to calact_tlserver-census.dump"
