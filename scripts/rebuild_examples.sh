#!/bin/bash
set -x
export SCENARIO="$1"; 
export NODE_OPTIONS="--max-old-space-size=16384"
rm public/examples/$SCENARIO.*
yarn calact wsdot \
    --endpoint http://localhost:8080/query \
    --no-schedule \
    --start-date=2025-08-11 \
    --end-date=2025-08-17 \
    --weekday-date=2025-08-11 \
    --weekend-date=2025-08-17 \
    --bbox-name="$SCENARIO" \
    --save-wsdot-report "public/examples/$SCENARIO.wsdot.json" \
    --save-scenario-data "public/examples/$SCENARIO.json"

