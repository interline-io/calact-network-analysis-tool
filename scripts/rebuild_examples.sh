#!/bin/bash
set -x
export OUTDIR="public/examples"

# Save scenario and WSDOT data
for scenario in downtown-portland downtown-portland-zoomed bend eugene salem portland greater-seattle greater-portland; do
    rm $OUTDIR/$scenario.*
    /usr/bin/time yarn calact wsdot \
        --start-date=2025-08-11 \
        --end-date=2025-08-17 \
        --weekday-date=2025-08-11 \
        --weekend-date=2025-08-17 \
        --bbox-name="$scenario" \
        --save-scenario-data "$OUTDIR/$scenario.json" \
        --save-wsdot-report "$OUTDIR/$scenario.wsdot.json"
done;

