#!/bin/sh
rm -rf tmp; mkdir tmp
cat fvs.txt | parallel --colsep '\s+' 'echo curl -H "apikey: $TRANSITLAND_API_KEY" -SLo tmp/{2}.zip https://api.transit.land/api/v2/rest/feed_versions/{3}/download'
tlreset calact && tlrebuild calact
psql -c "update feed_states set public = true"
tls && TL_LOG=trace tlserver server
