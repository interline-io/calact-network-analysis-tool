#!/bin/sh

# fix gtfs
rm -rf tmp-fixed; mkdir tmp-fixed
transitland extract --allow-entity-errors --allow-reference-errors monday-3.zip tmp-fixed/monday-3.zip
transitland extract --allow-entity-errors --allow-reference-errors sunday-3.zip tmp-fixed/sunday-3.zip

# migrate
createdb tlv2
transitland dbmigrate up
transitland dbmigrate natural-earth

# tlfetch && tlrebuild
mkdir -p tmp && rm tmp/*.* || true
find tmp-fixed -name "*.zip" | parallel --lb transitland fetch --allow-local-fetch --storage="tmp" --create-feed --feed-url="{}" \$\(basename {} \| sed s/.zip//\)
transitland import --activate --storage="tmp" --activate --workers=8
psql -c "update feed_states set public = true"
TL_LOG=trace tlserver server --max-radius=100_000_000  --loader-stop-time-batch-size=1000
