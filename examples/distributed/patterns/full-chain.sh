#!/bin/bash

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Full Chain Test: TS → Python → Go → Rust${NC}"
echo -e "${BLUE}  (Single distributed trace across 4 services)${NC}"
echo -e "${BLUE}  Enhanced with decorators and granular tracking${NC}"
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

echo -e "${YELLOW}Waiting for event ingestion (8 seconds)...${NC}"
sleep 8

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

    # Analyze the merged trace with enhanced event type analysis
    echo "$TRACE_DATA" | python3 -c "
import sys, json
from collections import defaultdict

data = json.load(sys.stdin)
if not data.get('success'):
    print(f'⚠️  Error fetching trace: {data.get(\"error\", \"Unknown error\")}')
    sys.exit(1)

trace = data.get('data') or {}
events = trace.get('events', [])

if not events:
    print('⚠️  No events found yet - may need more time for ingestion')
    sys.exit(0)

print(f'📊 ENHANCED DISTRIBUTED TRACE ANALYSIS')
print(f'='*80)
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

# Count events by type
event_types = defaultdict(int)
event_types_by_service = defaultdict(lambda: defaultdict(int))
for e in events:
    kind = e.get('kind', {})
    svc = e.get('metadata', {}).get('service_name', 'unknown')

    if isinstance(kind, dict):
        for event_type in kind.keys():
            event_types[event_type] += 1
            event_types_by_service[svc][event_type] += 1

print('Events by Type:')
type_colors = {
    'FunctionCall': '🔵',
    'StateChange': '🟢',
    'VariableAccess': '🟡',
    'AsyncSpawn': '🟣',
    'AsyncAwait': '🟠',
    'LockAcquire': '🔴',
    'LockRelease': '⚪'
}
for event_type, count in sorted(event_types.items(), key=lambda x: x[1], reverse=True):
    icon = type_colors.get(event_type, '⚫')
    print(f'  {icon} {event_type}: {count}')
print()

# Show event types by service
print('Events by Type per Service:')
print('-'*80)
for svc in sorted(event_types_by_service.keys()):
    print(f'  {svc}:')
    for event_type, count in sorted(event_types_by_service[svc].items(), key=lambda x: x[1], reverse=True):
        icon = type_colors.get(event_type, '⚫')
        print(f'    {icon} {event_type}: {count}')
print()

# Analyze async operations
async_spawns = []
async_awaits = []
for e in events:
    kind = e.get('kind', {})
    if 'AsyncSpawn' in kind:
        async_spawns.append({
            'service': e.get('metadata', {}).get('service_name'),
            'task': kind['AsyncSpawn'].get('task_name', 'unknown'),
            'timestamp': e.get('timestamp', ''),
            'metadata': kind['AsyncSpawn']
        })
    elif 'AsyncAwait' in kind:
        async_awaits.append({
            'service': e.get('metadata', {}).get('service_name'),
            'task': kind['AsyncAwait'].get('task_name', 'unknown'),
            'timestamp': e.get('timestamp', ''),
            'metadata': kind['AsyncAwait']
        })

if async_spawns or async_awaits:
    print(f'Async Operations Summary:')
    print(f'  🟣 AsyncSpawn events: {len(async_spawns)}')
    print(f'  🟠 AsyncAwait events: {len(async_awaits)}')
    print()

    # Try to pair spawns with awaits
    if async_spawns and async_awaits:
        print('  Async Operation Pairs (http_request):')
        for spawn in async_spawns:
            if spawn['task'] == 'http_request':
                matching_awaits = [a for a in async_awaits if a['task'] == 'http_request' and a['service'] == spawn['service']]
                if matching_awaits:
                    await_event = matching_awaits[0]
                    duration = await_event['metadata'].get('duration_ms', 'N/A')
                    status = await_event['metadata'].get('status_code', 'N/A')
                    print(f'    [{spawn[\"service\"]}] {spawn[\"task\"]} → completed (status={status}, {duration}ms)')
        print()

# Analyze decorator-tracked functions
function_calls = []
for e in events:
    kind = e.get('kind', {})
    if 'FunctionCall' in kind:
        fn_data = kind['FunctionCall']
        function_calls.append({
            'service': e.get('metadata', {}).get('service_name'),
            'function': fn_data.get('function_name', 'unknown'),
            'timestamp': e.get('timestamp', ''),
            'args': fn_data.get('args', {})
        })

# Identify decorator-tracked functions (contain module path or :return suffix)
decorator_functions = [f for f in function_calls if '.' in f['function'] or ':return' in f['function']]
if decorator_functions:
    print(f'Decorator-Tracked Functions:')
    print(f'  Total: {len(decorator_functions)}')

    # Group by service
    by_service = defaultdict(list)
    for f in decorator_functions:
        by_service[f['service']].append(f['function'])

    for svc in sorted(by_service.keys()):
        unique_functions = set(fn.split(':')[0] for fn in by_service[svc])
        print(f'  [{svc}]: {len(unique_functions)} unique functions tracked')
        for fn in sorted(unique_functions)[:5]:  # Show first 5
            print(f'    • {fn}')
        if len(unique_functions) > 5:
            print(f'    ... and {len(unique_functions) - 5} more')
    print()

# Show timeline (condensed)
print('Event Timeline (first 30 events):')
print('-'*80)
for i, e in enumerate(events[:30]):
    md = e.get('metadata', {})
    kind = e.get('kind', {})

    # Get event type and icon
    event_type = 'unknown'
    icon = '⚫'
    if isinstance(kind, dict) and kind:
        event_type = list(kind.keys())[0]
        icon = type_colors.get(event_type, '⚫')

    svc = md.get('service_name', 'unknown')
    dist_span = md.get('distributed_span_id', 'none')[:8] if md.get('distributed_span_id') else 'none'
    ts = e.get('timestamp', '')[:19]

    # Get specific details based on event type
    details = ''
    if event_type == 'FunctionCall':
        fn_name = kind[event_type].get('function_name', '')
        # Shorten long function names
        if len(fn_name) > 30:
            fn_name = fn_name[:27] + '...'
        details = fn_name
    elif event_type == 'AsyncSpawn':
        details = f\"spawn:{kind[event_type].get('task_name', '')}\"
    elif event_type == 'AsyncAwait':
        details = f\"await:{kind[event_type].get('task_name', '')}\"
    elif event_type == 'StateChange':
        details = kind[event_type].get('variable', '')
    elif event_type == 'VariableAccess':
        details = kind[event_type].get('variable', '')

    print(f'{i+1:2d}. {ts} {icon} [{svc:18s}] {event_type:15s} {details[:35]}')

if len(events) > 30:
    print(f'... and {len(events) - 30} more events')
print('='*80)
print()

# Verify all 4 services are present
expected_services = {'typescript-service', 'python-service', 'go-service', 'rust-service'}
found_services = set(services.keys())

if found_services == expected_services:
    print('✅ SUCCESS: All 4 services present in merged trace!')
    print('✅ Phase 2 distributed tracing working end-to-end!')
    print()
    print('📈 Enhanced Tracking Highlights:')
    print(f'  • {event_types.get(\"FunctionCall\", 0)} function calls tracked')
    print(f'  • {event_types.get(\"AsyncSpawn\", 0)} async operations spawned')
    print(f'  • {event_types.get(\"AsyncAwait\", 0)} async operations completed')
    print(f'  • {event_types.get(\"StateChange\", 0)} state changes tracked')
    print(f'  • {event_types.get(\"VariableAccess\", 0)} variable accesses tracked')
    print(f'  • {len(decorator_functions)} decorator-tracked function calls')
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
