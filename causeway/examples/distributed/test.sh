#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICES_DIR="${SCRIPT_DIR}/services"
PATTERNS_DIR="${SCRIPT_DIR}/patterns"

# PIDs of background processes
PIDS=()

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Cleaning up services...${NC}"

    # First, send SIGTERM to all PIDs for graceful shutdown
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -TERM "$pid" 2>/dev/null || true
        fi
    done

    # Also send SIGTERM to any processes on our ports
    lsof -ti:6001 | xargs kill -TERM 2>/dev/null || true
    lsof -ti:6002 | xargs kill -TERM 2>/dev/null || true
    lsof -ti:6003 | xargs kill -TERM 2>/dev/null || true
    lsof -ti:6004 | xargs kill -TERM 2>/dev/null || true

    # Wait 3 seconds for graceful shutdown (to flush events)
    sleep 3

    # Force kill any remaining processes
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null || true
        fi
    done
    lsof -ti:6001 | xargs kill -9 2>/dev/null || true
    lsof -ti:6002 | xargs kill -9 2>/dev/null || true
    lsof -ti:6003 | xargs kill -9 2>/dev/null || true
    lsof -ti:6004 | xargs kill -9 2>/dev/null || true

    echo -e "${GREEN}Cleanup complete${NC}"
}

trap cleanup EXIT INT TERM

# Wait for a service to be healthy
wait_for_service() {
    local port=$1
    local service_name=$2
    local max_attempts=30
    local attempt=0

    echo -n "Waiting for ${service_name} (port ${port})... "

    while [ $attempt -lt $max_attempts ]; do
        if curl -s "http://localhost:${port}/health" > /dev/null 2>&1; then
            echo -e "${GREEN}✓${NC}"
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 1
    done

    echo -e "${RED}✗ (timeout)${NC}"
    return 1
}

# Start TypeScript service
echo -e "${YELLOW}Starting TypeScript service...${NC}"
cd "${SERVICES_DIR}/typescript-service"
npm install --silent > /dev/null 2>&1 || true
npm start > /tmp/ts-service.log 2>&1 &
PIDS+=($!)

# Start Python service
echo -e "${YELLOW}Starting Python service...${NC}"
cd "${SERVICES_DIR}/python-service"
pip3 install -q -r requirements.txt > /dev/null 2>&1 || true
python3 server.py > /tmp/py-service.log 2>&1 &
PIDS+=($!)

# Start Go service
echo -e "${YELLOW}Starting Go service...${NC}"
cd "${SERVICES_DIR}/go-service"
go mod download > /dev/null 2>&1 || true
go run main.go > /tmp/go-service.log 2>&1 &
PIDS+=($!)

# Start Rust service
echo -e "${YELLOW}Starting Rust service...${NC}"
cd "${SERVICES_DIR}/rust-service"
cargo build --quiet > /dev/null 2>&1 || true
cargo run --quiet > /tmp/rust-service.log 2>&1 &
PIDS+=($!)

# Wait for all services to be healthy
echo ""
wait_for_service 6001 "TypeScript" || exit 1
wait_for_service 6002 "Python" || exit 1
wait_for_service 6003 "Go" || exit 1
wait_for_service 6004 "Rust" || exit 1

echo ""
echo -e "${GREEN}✓ All services are healthy!${NC}"
echo ""

# Run test patterns
cd "${PATTERNS_DIR}"

echo -e "${YELLOW}Running test patterns...${NC}"
echo ""

if [ -f "./linear.sh" ]; then
    ./linear.sh
else
    echo -e "${RED}Pattern tests not found yet${NC}"
fi

echo ""
echo -e "${GREEN}✓ All tests completed!${NC}"
