#!/bin/bash
set -x
export OUTDIR="public/examples"
export NODE_OPTIONS="--max-old-space-size=16384"
for scenario in downtown-portland downtown-portland-zoomed bend eugene salem; do
    rm $OUTDIR/$scenario.*
    /usr/bin/time yarn calact wsdot \
        --endpoint http://localhost:8080/query \
        --start-date=2025-08-11 \
        --end-date=2025-08-17 \
        --weekday-date=2025-08-11 \
        --weekend-date=2025-08-17 \
        --bbox-name="$scenario" \
        --save-scenario-data "$OUTDIR/$scenario.json" \
        --save-wsdot-report "$OUTDIR/$scenario.wsdot.json"
done;

for scenario in portland greater-seattle; do
    rm $OUTDIR/$scenario.*
    /usr/bin/time yarn calact wsdot \
        --endpoint http://localhost:8080/query \
        --start-date=2025-08-11 \
        --end-date=2025-08-17 \
        --weekday-date=2025-08-11 \
        --weekend-date=2025-08-17 \
        --bbox-name="$scenario" \
        --save-wsdot-report "$OUTDIR/$scenario.wsdot.json"
done;