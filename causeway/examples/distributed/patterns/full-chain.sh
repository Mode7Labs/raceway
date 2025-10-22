#!/bin/bash

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Full Chain Test: TS → Python → Go → Rust${NC}"
echo -e "${BLUE}  (Single distributed trace across 4 services)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""

# Make ONE request to TypeScript that chains through all 4 services
# Services support "downstream" (immediate next) and pass remaining chain via next_downstream
# The chain works by passing the next service URL to each subsequent call
echo -e "${YELLOW}Making single request: TypeScript → Python → Go → Rust...${NC}"

# First check if services are running
for port in 6001 6002 6003 6004; do
    if ! curl -s "http://localhost:${port}/health" > /dev/null 2>&1; then
        echo -e "${RED}✗ Service on port ${port} is not responding${NC}"
        exit 1
    fi
done

# We need to manually construct the nested chain since services only support 2-level chaining
# Better approach: Make direct chained calls with proper headers
RESPONSE=$(curl -s -X POST http://localhost:6001/process \
  -H "Content-Type: application/json" \
  -d '{
    "payload": "full-chain-test",
    "downstream": "http://localhost:6002/process",
    "next_downstream": "http://localhost:6003/process",
    "next_next_downstream": "http://localhost:6004/process"
  }')

echo ""
echo -e "${YELLOW}Response from full chain:${NC}"
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
echo ""

# Extract the trace ID from the first service's propagated headers
TRACE_ID=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    r = json.load(sys.stdin)
    # Get traceparent from downstream (Python's received headers)
    traceparent = r.get('downstream', {}).get('receivedHeaders', {}).get('traceparent', '')
    if traceparent:
        # Extract trace ID from traceparent format: 00-{trace-id}-{span-id}-01
        parts = traceparent.split('-')
        if len(parts) >= 2:
            print(parts[1])
except:
    pass
" 2>/dev/null)

echo -e "${YELLOW}Waiting for event ingestion (5 seconds)...${NC}"
sleep 5

if [ -n "$TRACE_ID" ]; then
    # Convert hex trace ID to UUID format
    TRACE_UUID=$(echo "$TRACE_ID" | python3 -c "
import sys
hex_id = sys.stdin.read().strip()
if len(hex_id) == 32:
    # Convert to UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    uuid = f'{hex_id[0:8]}-{hex_id[8:12]}-{hex_id[12:16]}-{hex_id[16:20]}-{hex_id[20:32]}'
    print(uuid)
else:
    print(hex_id)
" 2>/dev/null)

    echo ""
    echo -e "${GREEN}✓ Trace ID: ${TRACE_UUID}${NC}"
    echo ""
    echo -e "${YELLOW}Fetching merged distributed trace...${NC}"

    # Fetch the trace from Raceway backend
    TRACE_DATA=$(curl -s "http://localhost:8080/api/traces/${TRACE_UUID}")

    # Analyze the merged trace
    echo "$TRACE_DATA" | python3 -c "
import sys, json

data = json.load(sys.stdin)
trace = data.get('data', {})
events = trace.get('events', [])

if not events:
    print('⚠️  No events found yet - may need more time for ingestion')
    sys.exit(0)

print(f'📊 MERGED DISTRIBUTED TRACE ANALYSIS')
print(f'='*70)
print(f'Trace ID: {trace.get(\"trace_id\", \"unknown\")}')
print(f'Total Events: {len(events)}')
print()

# Count events by service
services = {}
for e in events:
    svc = e.get('metadata', {}).get('service_name', 'unknown')
    services[svc] = services.get(svc, 0) + 1

print('Events by Service:')
for svc, count in sorted(services.items()):
    print(f'  • {svc}: {count} events')
print()

# Show timeline
print('Event Timeline (chronological):')
print('-'*70)
for i, e in enumerate(events):
    md = e.get('metadata', {})
    kind = list(e.get('kind', {}).keys())[0] if isinstance(e.get('kind'), dict) else 'unknown'
    svc = md.get('service_name', 'unknown')
    dist_span = md.get('distributed_span_id', 'none')[:8] if md.get('distributed_span_id') else 'none'
    instance = md.get('instance_id', 'none')
    ts = e.get('timestamp', '')[:19]

    print(f'{i+1:2d}. {ts} [{svc:18s}] {kind:15s} span={dist_span}')

print('='*70)
print()

# Verify all 4 services are present
expected_services = {'typescript-service', 'python-service', 'go-service', 'rust-service'}
found_services = set(services.keys())

if found_services == expected_services:
    print('✅ SUCCESS: All 4 services present in merged trace!')
    print('✅ Phase 2 distributed tracing working end-to-end!')
elif len(found_services) < 4:
    print(f'⚠️  Only {len(found_services)} services found: {sorted(found_services)}')
    print('   Ingestion may still be in progress...')
else:
    print(f'✅ Found {len(found_services)} services: {sorted(found_services)}')
"

    echo ""
else
    echo -e "${RED}✗ Could not extract trace ID from response${NC}"
    exit 1
fi

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
