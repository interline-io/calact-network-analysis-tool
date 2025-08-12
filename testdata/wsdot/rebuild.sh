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
    --set "agency.txt,*,agency_timezone,America/Los_Angeles" \
    --normalize-service-ids \
    --prefix "$day:" \
    --prefix-files-exclude agency.txt \
    --prefix-files-exclude stops.txt \
    --prefix-files-exclude routes.txt \
    $day.zip tmp-fixed/$day
done

# merge results together
transitland merge tmp-fixed/wsdot-merged.zip tmp-fixed/monday-3 tmp-fixed/sunday-3

# # migrate
createdb tlv2
transitland dbmigrate up
transitland dbmigrate natural-earth

# tlfetch && tlrebuild
mkdir -p tmp && rm tmp/*.* || true
find tmp-fixed -name "*.zip" | parallel --lb transitland fetch --allow-local-fetch --storage="tmp" --create-feed --feed-url="{}" \$\(basename {} \| sed s/.zip//\)
transitland import --activate --storage="tmp" --activate --workers=8
psql -c "update feed_states set public = true"
TL_LOG=trace tlserver server --max-radius=100_000_000  --loader-stop-time-batch-size=1000
