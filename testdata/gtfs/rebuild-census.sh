#!/bin/bash
# Loads US Census ACS + TIGER data into the calact_tlserver database used by
# the test snapshot. Scoped to the ACS tables and geography layers that
# `src/core/census-columns.ts` reads, and filtered to WA/OR/CA to keep the
# resulting snapshot small.
#
# Runs after the GTFS import in rebuild.sh (or can be run independently
# against an existing database). Assumes `tlv2` is on PATH — build it from
# ../../tlv2/cmd/tlv2.
#
# Idempotent-ish: wget resumes (-c) and the tlv2 loaders skip already-loaded
# sources by SHA1, so re-running only picks up new/changed files.
set -ex -o pipefail

export TL_DATABASE_URL=${TL_DATABASE_URL:-postgres://localhost/calact_tlserver}

CENSUS_YEAR=${CENSUS_YEAR:-2021}

# Geography layers to fetch + load. `bg` (blockgroup) is intentionally
# omitted — the table-based SF format doesn't publish block-group values for
# every table we need, and the loader commands would have to be wired
# differently. Add it later if we need blockgroup-level aggregation in tests.
CENSUS_LAYERS="state county place uac20 cbsa csa tract"

# The 10 ACS tables used by src/core/census-columns.ts. Add one wget pattern
# per table so we only pull ~hundreds of MB instead of the ~10GB full archive.
ACS_TABLES=(
  b01001  # Sex by age — youth/older-adult buckets
  b01003  # Total population
  b02001  # Race — white alone
  b08301  # Means of transportation to work — public transit
  b19013  # Median household income
  b23024  # Poverty × disability × employment
  b25002  # Occupancy status
  b25008  # Total population in occupied housing by tenure
  b25044  # Tenure by vehicles available
  c17002  # Ratio of income to poverty
)

# Comma-joined wget -A pattern list.
ACS_PATTERN=$(printf "acsdt5y${CENSUS_YEAR}-%s*.dat," "${ACS_TABLES[@]}")
ACS_PATTERN=${ACS_PATTERN%,}

CENSUS_BASE="ftp://ftp.census.gov/programs-surveys/acs/summary_file/${CENSUS_YEAR}/table-based-SF"
TIGER_BASE="ftp://ftp.census.gov/geo/tiger/TIGER${CENSUS_YEAR}"

mkdir -p census-data
cd census-data

# -------- 1. Fetch ACS metadata + selected table .dat files --------
wget -cr "${CENSUS_BASE}/documentation/Geos${CENSUS_YEAR}5YR.txt"
wget -cr "${CENSUS_BASE}/documentation/ACS${CENSUS_YEAR}1YR_Table_Shells.txt"
wget -cr -A "$ACS_PATTERN" "${CENSUS_BASE}/data/5YRData/"

# -------- 2. Load ACS values, one pass per layer (filtered by summary code) --------
for layer in $CENSUS_LAYERS; do
  tlv2 geodata-us-census-acs-table-load \
    --dataset-name="acsdt5y${CENSUS_YEAR}" \
    --layer-name "$layer" \
    "ftp.census.gov/programs-surveys/acs/summary_file/${CENSUS_YEAR}/table-based-SF/documentation/ACS${CENSUS_YEAR}1YR_Table_Shells.txt" \
    "ftp.census.gov/programs-surveys/acs/summary_file/${CENSUS_YEAR}/table-based-SF/data"
done

# -------- 3. Fetch TIGER shapefiles --------
for layer in $CENSUS_LAYERS; do
  layerup=$(echo "$layer" | tr a-z A-Z)
  wget -cr "${TIGER_BASE}/${layerup}/"
done

# -------- 4. Load TIGER geometries --------
for layer in $CENSUS_LAYERS; do
  layerup=$(echo "$layer" | tr a-z A-Z)
  tlv2 geodata-us-census-tiger-load \
    --truncate-source \
    --dataset-name="tiger${CENSUS_YEAR}" \
    --layer-name "$layer" \
    --layer-level "$layer" \
    --layer-desc "Layer: ${layer}" \
    --dir "./ftp.census.gov/geo/tiger/TIGER${CENSUS_YEAR}/${layerup}/"
done

# -------- 5. Filter to Washington (53), Oregon (41), California (06) --------
# Covers every canned bbox and every GTFS feed fixture. Keep this narrow —
# the snapshot size is sensitive to how many tracts are included.
psql -c "delete from tl_census_values    where geoid !~ '.*US(06|41|53).*';"
psql -c "delete from tl_census_geographies where geoid !~ '.*US(06|41|53).*';"

echo "Census data loaded into $TL_DATABASE_URL"
