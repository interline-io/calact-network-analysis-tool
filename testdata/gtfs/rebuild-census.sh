#!/bin/bash
# Loads ACS + TIGER reference data into the calact test database via the tlv2 refdata
# loader, then filters to WA/OR/CA for the test snapshot.
#
# Requires `tlv2` on PATH (from interline-io/tlv2: `cd cmd/tlv2 && go install .`) and
# TL_DATABASE_URL pointing at the target DB — it WILL be truncated and rewritten. The
# DB must already have the tl_census_* schema (`tlv2 dbmigrate up`).
#
# Env:
#   CENSUS_YEAR  — ACS/TIGER vintage (default 2021); any year resolves on demand
#   SKIP_FETCH   — "true" to load from previously fetched files instead of downloading
set -ex -o pipefail

: "${TL_DATABASE_URL:?set TL_DATABASE_URL to the target database (it will be truncated)}"
CENSUS_YEAR=${CENSUS_YEAR:-2021}
SKIP_FETCH=${SKIP_FETCH:-false}

# ACS detail tables consumed by src/core/census-columns.ts. Keep in sync with
# REQUIRED_ACS_TABLES (derived from the per-column requiredTables). The loader's table
# set is open: --table names any detail table id, synthesized from one template, with
# field titles/order coming from the dataset's Table Shells file.
ACS_TABLES=(b01001 b01003 b02001 b08301 b19013 b23024 b25002 b25003 b25044 c17002)

# TIGER layers to load. bg (block group) is included so it can be selected alongside
# tract for aggregation and buffer apportionment; the ACS .dat files already carry
# whatever block-group values each table publishes (some tables only go down to tract,
# which the UI renders as insufficient data). uac20 omitted: the loader pins it to the
# 2020 urban areas (TIGER2023) and the tool doesn't use it.
TIGER_LAYERS=(state county place cbsa csa tract bg)

# refdata-load --fetch downloads missing files into the input dir and skips ones already
# present; SKIP_FETCH=true loads straight from that cache without touching the network.
# Files are kept under census-data/<dataset> so they persist between runs.
FETCH=(--fetch)
[ "$SKIP_FETCH" = "true" ] && FETCH=()

# -------- 1. Reset --------
psql "$TL_DATABASE_URL" -c "TRUNCATE TABLE tl_census_datasets RESTART IDENTITY CASCADE;"

# -------- 2. Load ACS values --------
ACS_ARGS=()
for tbl in "${ACS_TABLES[@]}"; do ACS_ARGS+=(--table "$tbl"); done
tlv2 refdata-load \
  --dataset "acsdt5y${CENSUS_YEAR}" \
  --input-dir "census-data/acsdt5y${CENSUS_YEAR}" \
  "${FETCH[@]}" "${ACS_ARGS[@]}"

# -------- 3. Load TIGER geometries --------
TIGER_ARGS=()
for layer in "${TIGER_LAYERS[@]}"; do TIGER_ARGS+=(--table "$layer"); done
tlv2 refdata-load \
  --dataset "tiger${CENSUS_YEAR}" \
  --input-dir "census-data/tiger${CENSUS_YEAR}" \
  "${FETCH[@]}" "${TIGER_ARGS[@]}"

# -------- 4. Filter to WA (53), OR (41), CA (06) --------
# ACS/TIGER geoids carry the state FIPS as US<ff>; keep only these three states.
psql "$TL_DATABASE_URL" -c "DELETE FROM tl_census_values      WHERE geoid !~ '.*US(06|41|53).*';"
psql "$TL_DATABASE_URL" -c "DELETE FROM tl_census_geographies WHERE geoid !~ '.*US(06|41|53).*';"

echo "Census data loaded into $TL_DATABASE_URL"
