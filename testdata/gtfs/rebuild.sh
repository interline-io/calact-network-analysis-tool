#!/bin/bash
set -ex -o pipefail
rm -rf data tmp || true; mkdir -p data tmp

# Migrate
export PGDATABASE="calact_tlserver"
export PGHOST="localhost"
export TL_DATABASE_URL="postgres://localhost/calact_tlserver"
dropdb --if-exists calact_tlserver; createdb calact_tlserver
transitland dbmigrate up
transitland dbmigrate natural-earth

# Fetch
cat fvs.txt | parallel --colsep ' ' 'curl -H "apikey:$TRANSITLAND_API_KEY" -SLo data/{1}.zip https://api.transit.land/api/v2/rest/feed_versions/{2}/download'
find ./data -name "*.zip" | parallel --lb transitland fetch --allow-local-fetch --storage="tmp" --create-feed --feed-url="{}" \$\(basename {} \| sed s/.zip//\)

# Import
transitland import --activate --storage="tmp" --activate --workers=8

# Set feeds to public
psql -c "update feed_states set public = true"

# Load US Census ACS + TIGER data (for the #302 aggregation demographic
# columns). Idempotent; see rebuild-census.sh for details.
./rebuild-census.sh

# Dump
pg_dump -Fc -f calact_tlserver.dump calact_tlserver
