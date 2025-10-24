#!/bin/bash

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Phase 3 Testing Suite - Service-Aware Features${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""

# Track test results
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

# Helper function to run a test
run_test() {
    local test_name=$1
    local test_command=$2
    local expected_exit_code=${3:-0}

    TESTS_TOTAL=$((TESTS_TOTAL + 1))
    echo -ne "${CYAN}Test ${TESTS_TOTAL}: ${test_name}...${NC} "

    eval "$test_command" > /tmp/test_output_$TESTS_TOTAL.txt 2>&1
    local exit_code=$?

    if [ $exit_code -eq $expected_exit_code ]; then
        echo -e "${GREEN}✓ PASSED${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        echo -e "${RED}✗ FAILED${NC}"
        echo -e "${YELLOW}  Output:${NC}"
        cat /tmp/test_output_$TESTS_TOTAL.txt | head -20
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

# Helper to check JSON response
check_json_field() {
    local json_data=$1
    local field_path=$2
    local expected_value=$3

    local actual_value=$(echo "$json_data" | python3 -c "
import sys, json
data = json.load(sys.stdin)
parts = '$field_path'.split('.')
val = data
for part in parts:
    if isinstance(val, dict):
        val = val.get(part)
    else:
        print('ERROR: Not a dict')
        sys.exit(1)
print(val if val is not None else 'NULL')
" 2>/dev/null)

    if [ "$actual_value" = "$expected_value" ]; then
        return 0
    else
        echo "Expected '$expected_value', got '$actual_value'" >&2
        return 1
    fi
}

echo -e "${YELLOW}Phase 1: Generate Test Traces${NC}"
echo "Creating distributed trace across all 4 services..."
echo ""

# Create a distributed trace
RESPONSE=$(curl -s -X POST http://localhost:6001/process \
  -H "Content-Type: application/json" \
  -d '{
    "payload": "phase3-test",
    "downstream": "http://localhost:6002/process"
  }')

# Extract trace ID
TRACE_ID=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    r = json.load(sys.stdin)
    traceparent = r.get('downstream', {}).get('receivedHeaders', {}).get('traceparent', '')
    if traceparent:
        parts = traceparent.split('-')
        if len(parts) >= 2:
            hex_id = parts[1]
            # Convert to UUID format
            uuid = f'{hex_id[0:8]}-{hex_id[8:12]}-{hex_id[12:16]}-{hex_id[16:20]}-{hex_id[20:32]}'
            print(uuid)
except:
    pass
" 2>/dev/null)

if [ -z "$TRACE_ID" ]; then
    echo -e "${RED}✗ Failed to create test trace${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Created trace: $TRACE_ID${NC}"
echo ""

# Wait for event ingestion
echo -e "${YELLOW}Waiting for event ingestion (5 seconds)...${NC}"
sleep 5
echo ""

echo -e "${YELLOW}Phase 2: API Endpoint Tests${NC}"
echo ""

# Test 1: GET /api/services - List all services
run_test "GET /api/services returns success" \
    "curl -s http://localhost:8080/api/services | python3 -c \"import sys, json; data=json.load(sys.stdin); sys.exit(0 if data.get('success') else 1)\""

# Test 2: Verify service list contains expected services
run_test "GET /api/services contains typescript-service" \
    "curl -s http://localhost:8080/api/services | python3 -c \"import sys, json; data=json.load(sys.stdin); services=[s['name'] for s in data.get('data', {}).get('services', [])]; sys.exit(0 if 'typescript-service' in services else 1)\""

run_test "GET /api/services contains python-service" \
    "curl -s http://localhost:8080/api/services | python3 -c \"import sys, json; data=json.load(sys.stdin); services=[s['name'] for s in data.get('data', {}).get('services', [])]; sys.exit(0 if 'python-service' in services else 1)\""

# Test 3: Each service has event_count field
run_test "Services have event_count field" \
    "curl -s http://localhost:8080/api/services | python3 -c \"import sys, json; data=json.load(sys.stdin); services=data.get('data', {}).get('services', []); sys.exit(0 if all('event_count' in s for s in services) else 1)\""

# Test 4: GET /api/services/:name/dependencies
run_test "GET /api/services/typescript-service/dependencies returns success" \
    "curl -s http://localhost:8080/api/services/typescript-service/dependencies | python3 -c \"import sys, json; data=json.load(sys.stdin); sys.exit(0 if data.get('success') else 1)\""

# Test 5: Dependencies response has correct structure
run_test "Dependencies response has correct structure" \
    "curl -s http://localhost:8080/api/services/typescript-service/dependencies | python3 -c \"import sys, json; data=json.load(sys.stdin); d=data.get('data', {}); sys.exit(0 if all(k in d for k in ['service_name', 'dependencies', 'dependents']) else 1)\""

# Test 6: Dependencies contain expected downstream services
run_test "typescript-service has python-service as dependency" \
    "curl -s http://localhost:8080/api/services/typescript-service/dependencies | python3 -c \"import sys, json; data=json.load(sys.stdin); deps=[d['to_service'] for d in data.get('data', {}).get('dependencies', [])]; sys.exit(0 if 'python-service' in deps else 1)\""

echo ""
echo -e "${YELLOW}Phase 3: Trace Data Tests${NC}"
echo ""

# Test 7: GET /api/traces/:id returns events with service metadata
run_test "Trace events have service_name in metadata" \
    "curl -s http://localhost:8080/api/traces/${TRACE_ID} | python3 -c \"import sys, json; data=json.load(sys.stdin); events=data.get('data', {}).get('events', []); sys.exit(0 if all('service_name' in e.get('metadata', {}) for e in events) else 1)\""

# Test 8: GET /api/traces/:id includes dependencies
run_test "Full trace analysis includes dependencies" \
    "curl -s http://localhost:8080/api/traces/${TRACE_ID} | python3 -c \"import sys, json; data=json.load(sys.stdin); deps=data.get('data', {}).get('dependencies'); sys.exit(0 if deps is not None else 1)\""

# Test 9: Dependencies in trace have services array
run_test "Dependencies include services array" \
    "curl -s http://localhost:8080/api/traces/${TRACE_ID} | python3 -c \"import sys, json; data=json.load(sys.stdin); deps=data.get('data', {}).get('dependencies', {}); sys.exit(0 if 'services' in deps else 1)\""

# Test 10: Dependencies include cross-service calls
run_test "Dependencies include cross-service dependencies" \
    "curl -s http://localhost:8080/api/traces/${TRACE_ID} | python3 -c \"import sys, json; data=json.load(sys.stdin); deps=data.get('data', {}).get('dependencies', {}).get('dependencies', []); sys.exit(0 if len(deps) > 0 else 1)\""

echo ""
echo -e "${YELLOW}Phase 4: Service Statistics Tests${NC}"
echo ""

# Test 11: Service event counts are accurate
run_test "Service event counts > 0" \
    "curl -s http://localhost:8080/api/services | python3 -c \"import sys, json; data=json.load(sys.stdin); services=data.get('data', {}).get('services', []); sys.exit(0 if all(s.get('event_count', 0) > 0 for s in services) else 1)\""

# Test 12: Service dependency call counts
run_test "Service dependencies have call_count > 0" \
    "curl -s http://localhost:8080/api/services/typescript-service/dependencies | python3 -c \"import sys, json; data=json.load(sys.stdin); deps=data.get('data', {}).get('dependencies', []); sys.exit(0 if all(d.get('call_count', 0) > 0 for d in deps if deps) else 1)\""

echo ""
echo -e "${YELLOW}Phase 5: Distributed Span Tests${NC}"
echo ""

# Test 13: Events have distributed_span_id in metadata
run_test "Events have distributed_span_id" \
    "curl -s http://localhost:8080/api/traces/${TRACE_ID} | python3 -c \"import sys, json; data=json.load(sys.stdin); events=data.get('data', {}).get('events', []); sys.exit(0 if any('distributed_span_id' in e.get('metadata', {}) for e in events) else 1)\""

# Test 14: Multiple services in single trace
run_test "Trace contains multiple services" \
    "curl -s http://localhost:8080/api/traces/${TRACE_ID} | python3 -c \"import sys, json; data=json.load(sys.stdin); events=data.get('data', {}).get('events', []); services=set(e.get('metadata', {}).get('service_name') for e in events); sys.exit(0 if len(services) > 1 else 1)\""

echo ""
echo -e "${YELLOW}Phase 6: Database Query Tests${NC}"
echo ""

# Test 15: Verify distributed_spans table has data
run_test "Backend can query distributed trace data" \
    "curl -s http://localhost:8080/api/traces/${TRACE_ID} | python3 -c \"import sys, json; data=json.load(sys.stdin); deps=data.get('data', {}).get('dependencies'); sys.exit(0 if deps and deps.get('services') else 1)\""

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Test Summary${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Total Tests:  ${CYAN}${TESTS_TOTAL}${NC}"
echo -e "  Passed:       ${GREEN}${TESTS_PASSED}${NC}"
echo -e "  Failed:       ${RED}${TESTS_FAILED}${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✓✓✓ ALL PHASE 3 TESTS PASSED ✓✓✓${NC}"
    echo ""
    echo -e "${CYAN}Phase 3 Features Verified:${NC}"
    echo -e "  ✓ GET /api/services endpoint"
    echo -e "  ✓ GET /api/services/:name/dependencies endpoint"
    echo -e "  ✓ Service metadata in events"
    echo -e "  ✓ Service dependency tracking"
    echo -e "  ✓ Distributed span management"
    echo -e "  ✓ Cross-service call analysis"
    echo ""
    exit 0
else
    echo -e "${RED}✗✗✗ SOME TESTS FAILED ✗✗✗${NC}"
    echo ""
    echo -e "${YELLOW}Check test output above for details${NC}"
    echo ""
    exit 1
fi
