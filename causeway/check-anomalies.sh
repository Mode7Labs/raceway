#!/bin/bash

# Get all trace IDs
TRACE_IDS=$(curl -s http://localhost:8080/api/traces | jq -r '.data.trace_ids[]')

echo "Checking all traces for anomalies..."
echo ""

i=1
for id in $TRACE_IDS; do
    echo "[$i] Checking $id..."
    count=$(curl -s "http://localhost:8080/api/traces/$id/anomalies" | jq -r '.data.anomaly_count')

    if [ "$count" != "0" ] && [ "$count" != "null" ]; then
        echo "    ✓ Found $count anomalies!"
        curl -s "http://localhost:8080/api/traces/$id/anomalies" | jq -r '.data.anomalies[].description' | sed 's/^/      /'
    fi

    i=$((i + 1))
done

echo ""
echo "Done!"
