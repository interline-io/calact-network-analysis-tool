#!/bin/bash
set -x
export OUTDIR="public/examples"

# Save scenario and WSDOT data
for scenario in downtown-portland downtown-portland-zoomed bend eugene salem portland greater-seattle greater-portland; do
    rm $OUTDIR/$scenario.*
    /usr/bin/time yarn calact scenario \
        --bbox-name="$scenario" \
        --save-scenario-data "$OUTDIR/$scenario.json"
done;

# Save scenario and WSDOT data
for scenario in downtown-portland downtown-portland-zoomed bend eugene salem portland greater-seattle greater-portland; do
    rm $OUTDIR/$scenario.*
    /usr/bin/time yarn calact wsdot \
        --bbox-name="$scenario" \
        --save-scenario-data "$OUTDIR/$scenario.wsdot.json"
done;
