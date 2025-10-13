#!/bin/sh
set -ex

# fix gtfs
rm -rf tmp-fixed; mkdir tmp-fixed
for day in monday-3 sunday-3; do
  mkdir -p tmp-fixed/$day
  transitland extract \
    --allow-entity-errors \
    --allow-reference-errors \
    --set "stops.txt,*,parent_station," \
    --set "routes.txt,*,route_color," \
    --set "routes.txt,*,route_text_color," \
    --set "routes.txt,*,agency_id,40" \
    --set "agency.txt,*,agency_timezone,America/Los_Angeles" \
    --set "trips.txt,*,shape_id," \
    --set "calendar.txt,monday-3:1,tuesday,1" \
    --set "calendar.txt,monday-3:1,wednesday,1" \
    --set "calendar.txt,monday-3:1,thursday,1" \
    --set "calendar.txt,monday-3:1,friday,1" \
    --normalize-service-ids \
    --prefix "$day:" \
    --prefix-files-exclude agency.txt \
    --prefix-files-exclude stops.txt \
    --prefix-files-exclude routes.txt \
    $day.zip tmp-fixed/$day
done

# merge results together
transitland merge tmp-fixed/wsdot-merged.zip tmp-fixed/monday-3 tmp-fixed/sunday-3

# tlfetch && tlrebuild
mkdir -p tmp && rm tmp/*.* || true
find tmp-fixed -name "*.zip" | parallel --lb transitland fetch --allow-local-fetch --storage="tmp" --create-feed --feed-url="{}" \$\(basename {} \| sed s/.zip//\)
transitland import --activate --storage="tmp" --activate --workers=8
psql -c "update feed_states set public = true"

TL_LOG=trace transitland server --max-radius=100_000_000  --loader-stop-time-batch-size=1000 --long-query=0

# irees@alt (db:localhost/tlv2) (k8:mtc) wsdot-python % python3 ./summary.py frequent_stops_24_20241023.csv
# level1: 548
# level2: 3027
# level3: 10348
# level4: 18564
# level5: 20972
# level6: 22245
# levelNights: 722

#  TRANSITLAND_API_BASE=http://localhost:8080 yarn run calact wsdot --start-date=2024-08-19 --end-date=2024-08-25 --weekday-date=2024-08-19 --weekend-date=2024-08-25 --stop-buffer-radius=805 --bbox-name wa --table-dataset-name acsdt5y2021 --geo-dataset-name tiger2021 --geo-dataset-layer tract --save-scenario-data public/examples/wsdot/wa-2024.wsdot.json --report-name "Washington (2024 merged data; 2021 ACS)"

# TRANSITLAND_API_BASE=http://localhost:8080 yarn run calact wsdot --start-date 2025-10-13 --end-date 2025-10-19 --weekday-date 2025-10-14 --weekend-date 2025-10-19 --stop-buffer-radius 805 --bbox-name wa --table-dataset-name acsdt5y2021 --geo-dataset-name tiger2021 --geo-dataset-layer tract  --save-scenario-data public/examples/wsdot/wa-2025.wsdot.json --report-name "Washington (2025 Transitland data; 2021 ACS)"

# TRANSITLAND_API_BASE=http://localhost:8080 yarn run calact wsdot --start-date 2025-10-13 --end-date 2025-10-19 --weekday-date 2025-10-14 --weekend-date 2025-10-19 --stop-buffer-radius 805 --bbox-name wa --table-dataset-name acsdt5y2023 --geo-dataset-name tiger2023 --geo-dataset-layer tract  --save-scenario-data public/examples/wsdot/wa-2025-acs2023.wsdot.json --report-name "Washington (2025 Transitland data; 2023 ACS)"
