#!/bin/bash

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Stopping all distributed services...${NC}"

# Send SIGTERM for graceful shutdown (allows event flushing)
echo "Sending SIGTERM to services..."
lsof -ti:6001 | xargs kill -TERM 2>/dev/null || true
lsof -ti:6002 | xargs kill -TERM 2>/dev/null || true
lsof -ti:6003 | xargs kill -TERM 2>/dev/null || true
lsof -ti:6004 | xargs kill -TERM 2>/dev/null || true

# Wait for graceful shutdown
echo "Waiting for graceful shutdown (3 seconds for event flush)..."
sleep 3

# Force kill any remaining processes
echo "Force killing any remaining processes..."
lsof -ti:6001 | xargs kill -9 2>/dev/null || true
lsof -ti:6002 | xargs kill -9 2>/dev/null || true
lsof -ti:6003 | xargs kill -9 2>/dev/null || true
lsof -ti:6004 | xargs kill -9 2>/dev/null || true

# Verify ports are free
PORTS_IN_USE=0
for port in 6001 6002 6003 6004; do
    if lsof -ti:${port} > /dev/null 2>&1; then
        echo -e "⚠️  Port ${port} still in use"
        PORTS_IN_USE=1
    fi
done

if [ $PORTS_IN_USE -eq 0 ]; then
    echo -e "${GREEN}✓ All services stopped successfully${NC}"
else
    echo -e "${YELLOW}Some ports may still be in use. Try running again or reboot.${NC}"
    exit 1
fi
