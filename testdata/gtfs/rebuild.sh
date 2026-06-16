#!/bin/bash
set -ex -o pipefail
rm -rf data tmp || true; mkdir -p data tmp

# Migrate. The target DB is created externally; everything here connects via
# $TL_DATABASE_URL (defaulting to a local calact_tlserver).
: "${TL_DATABASE_URL:=postgres://localhost/calact_tlserver}"; export TL_DATABASE_URL
transitland dbmigrate up
transitland dbmigrate-natural-earth

# Fetch
cat fvs.txt | parallel --colsep ' ' 'curl -H "apikey:$TRANSITLAND_API_KEY" -SLo data/{1}.zip https://api.transit.land/api/v2/rest/feed_versions/{2}/download'
find ./data -name "*.zip" | parallel --lb transitland fetch --allow-local-fetch --storage="tmp" --create-feed --feed-url="{}" \$\(basename {} \| sed s/.zip//\)

# Import
transitland import --activate --storage="tmp" --activate --workers=8

# Set feeds to public
psql "$TL_DATABASE_URL" -c "update feed_states set public = true"

# Dump the base (GTFS/etc.) tables by allowlist. -T 'tl_census_*' still excludes the
# census/NTD tables and their sequences (which the 'tl_*' pattern would otherwise match),
# keeping the base and census dumps disjoint. Census/NTD: run ./rebuild-census.sh.
pg_dump -Fc -f calact_tlserver.dump \
  -t 'gtfs_*' -t 'tl_*' -t 'feed_*' -t 'ne_*' -t 'schema_migrations' -t 'current_*' \
  -T 'tl_census_*' \
  "$TL_DATABASE_URL"
