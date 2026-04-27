#!/bin/bash
# Loads ACS + TIGER data into calact_tlserver for the test snapshot.
# Filtered to WA/OR/CA. Assumes `tlv2` is on PATH.
#
# Env:
#   CENSUS_YEAR  — vintage (default 2021)
#   SKIP_FETCH   — "true" to reuse existing ./census-data instead of wget
set -ex -o pipefail

CENSUS_YEAR=${CENSUS_YEAR:-2021}
SKIP_FETCH=${SKIP_FETCH:-false}

# bg omitted: table-based SF doesn't publish block-group values for every
# table we need. uac20 omitted: not published in TIGER before 2023.
CENSUS_LAYERS="state county place cbsa csa tract"

# ACS tables consumed by src/core/census-columns.ts. Keep in sync with
# `REQUIRED_ACS_TABLES` (derived from the per-column `requiredTables`).
ACS_TABLES=(b01001 b01003 b02001 b08301 b19013 b23024 b25002 b25003 b25044 c17002)

CENSUS_BASE="ftp://ftp.census.gov/programs-surveys/acs/summary_file/${CENSUS_YEAR}/table-based-SF"
TIGER_BASE="ftp://ftp.census.gov/geo/tiger/TIGER${CENSUS_YEAR}"

mkdir -p census-data
cd census-data

# -------- 1. Fetch --------
if [ "$SKIP_FETCH" != "true" ]; then
  wget -cr "${CENSUS_BASE}/documentation/Geos${CENSUS_YEAR}5YR.txt"
  wget -cr "${CENSUS_BASE}/documentation/ACS${CENSUS_YEAR}1YR_Table_Shells.txt"
  # Exact filename (no `*`) skips race/ethnicity sub-tables we don't use.
  for tbl in "${ACS_TABLES[@]}"; do
    wget -cr -A "acsdt5y${CENSUS_YEAR}-${tbl}.dat" "${CENSUS_BASE}/data/5YRData/"
  done
  for layer in $CENSUS_LAYERS; do
    wget -cr "${TIGER_BASE}/$(echo "$layer" | tr a-z A-Z)/"
  done
else
  echo "SKIP_FETCH=true — using existing files under census-data/"
fi

# -------- 2. Reset --------
psql -c "TRUNCATE TABLE tl_census_datasets RESTART IDENTITY CASCADE;"

# -------- 3. Load ACS values --------
# Single invocation across all layers — per-layer invocations are
# incompatible with --truncate-source (it would wipe the prior layer).
TABLE_ARGS=()
for tbl in "${ACS_TABLES[@]}"; do
  TABLE_ARGS+=(--table="$(echo "$tbl" | tr a-z A-Z)")
done
tlv2 geodata-us-census-acs-table-load \
  --truncate-source \
  --dataset-name="acsdt5y${CENSUS_YEAR}" \
  "${TABLE_ARGS[@]}" \
  "ftp.census.gov/programs-surveys/acs/summary_file/${CENSUS_YEAR}/table-based-SF/documentation/ACS${CENSUS_YEAR}1YR_Table_Shells.txt" \
  "ftp.census.gov/programs-surveys/acs/summary_file/${CENSUS_YEAR}/table-based-SF/data"

# -------- 4. Load TIGER geometries --------
for layer in $CENSUS_LAYERS; do
  layerup=$(echo "$layer" | tr a-z A-Z)
  tlv2 geodata-us-census-tiger-load \
    --dataset-name="tiger${CENSUS_YEAR}" \
    --layer-name "$layer" \
    --layer-level "$layer" \
    --layer-desc "Layer: ${layer}" \
    --dir "./ftp.census.gov/geo/tiger/TIGER${CENSUS_YEAR}/${layerup}/"
done

# -------- 5. Filter to WA (53), OR (41), CA (06) --------
psql -c "delete from tl_census_values    where geoid !~ '.*US(06|41|53).*';"
psql -c "delete from tl_census_geographies where geoid !~ '.*US(06|41|53).*';"

echo "Census data loaded into $TL_DATABASE_URL"
