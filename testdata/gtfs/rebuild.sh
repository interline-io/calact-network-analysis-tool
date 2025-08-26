#!/bin/bash
set -ex -o pipefail

rm -rf data tmp || true; mkdir -p data tmp

cat fvs.txt | parallel --colsep ' ' 'curl -H "apikey:$TRANSITLAND_API_KEY" -SLo data/{1}.zip https://api.transit.land/api/v2/rest/feed_versions/{2}/download'

find ./data -name "*.zip" | parallel --lb tlserver fetch --allow-local-fetch --storage="tmp" --create-feed --feed-url="{}" \$\(basename {} \| sed s/.zip//\)

tlserver import --activate --storage="tmp" --activate --workers=8

psql -c "update feed_states set public = true"

TL_LOG=trace tlserver server --max-radius 100_000_000 --loader-stop-time-batch-size 1000

