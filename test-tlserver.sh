#!/bin/sh
rm -rf tmp; mkdir tmp; rm -rf testdata/gtfs; mkdir -p testdata/gtfs
cat fvs.txt | parallel --colsep '\s+' 'curl -H "apikey: $TRANSITLAND_API_KEY" -SLo testdata/gtfs/{2}.zip https://api.transit.land/api/v2/rest/feed_versions/{3}/download'
tlreset calact && tlrebuild testdata/gtfs
psql -c "update feed_states set public = true"
tls && TL_LOG=trace tlserver server
