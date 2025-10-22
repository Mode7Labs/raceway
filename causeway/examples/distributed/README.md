# Distributed Tracing Demo (Phase 1.5)

This demo validates SDK propagation of distributed tracing headers across all 4 Raceway SDKs **without requiring Phase 2 backend changes**.

## Architecture

Four HTTP services that can call each other:

- **TypeScript Service** (port 6001) - Express + Raceway SDK
- **Python Service** (port 6002) - Flask + Raceway SDK
- **Go Service** (port 6003) - net/http + Raceway SDK
- **Rust Service** (port 6004) - Axum + Raceway SDK

## What This Validates

✅ W3C `traceparent` headers propagate correctly
✅ Custom `raceway-clock` headers propagate correctly
✅ Vector clocks accumulate components from all services
✅ Events from all services share the same `trace_id`
✅ Service metadata correctly identifies each service
✅ Middleware integration works in all frameworks

## Known Limitations (Acceptable without Phase 2)

⚠️ Graph shows 4 disconnected sub-graphs (no cross-service edges yet)
⚠️ Critical path doesn't span services (calculated per-service only)
⚠️ No cross-service race detection (within-service races still work)
⚠️ No distributed span hierarchy (span linkage is local to each service)

## Prerequisites

- Node.js / npm (for TypeScript service)
- Python 3 / pip3 (for Python service)
- Go 1.21+ (for Go service)
- Rust / Cargo (for Rust service)

## Running the Demo

```bash
cd examples/distributed
./test.sh
```

The test script will:
1. Install dependencies for all services
2. Start all 4 services in the background
3. Wait for services to be healthy
4. Run test patterns
5. Validate header propagation
6. Clean up all services

## Test Patterns

### Linear Pattern (TS → Python → Go → Rust)

Tests a sequential chain of calls across all 4 languages.

```bash
./patterns/linear.sh
```

This validates:
- Headers are injected correctly by each SDK
- Headers are extracted correctly by each SDK
- `trace_id` remains consistent across the entire chain
- Vector clock accumulates components: `[typescript#ts-1, python#py-1, go#go-1, rust#rust-1]`

## Manual Testing

You can also manually test individual services:

```bash
# Start all services
./test.sh &

# Make a request through the full chain
curl -X POST http://localhost:6001/process \
  -H "Content-Type: application/json" \
  -d '{
    "downstream": "http://localhost:6002/process",
    "payload": "test"
  }'

# Call Python → Go → Rust
curl -X POST http://localhost:6002/process \
  -H "Content-Type: application/json" \
  -d '{
    "downstream": "http://localhost:6003/process",
    "payload": "test"
  }'

# Kill all services
lsof -ti:6001,6002,6003,6004 | xargs kill
```

## Service Logs

Service logs are written to `/tmp/`:
- `/tmp/ts-service.log`
- `/tmp/py-service.log`
- `/tmp/go-service.log`
- `/tmp/rust-service.log`

Check these for detailed header propagation debugging.

## Adding New Patterns

Create new test patterns in `patterns/`:

```bash
# Example: Parallel pattern (TS → [Python + Go + Rust])
./patterns/parallel.sh

# Example: Diamond pattern (TS → Python → [Go + Rust] → merge)
./patterns/diamond.sh
```

## Next Steps (Phase 2)

After Phase 2 backend changes:
- ✅ Cross-service edges will connect the graph
- ✅ Critical path will span all services
- ✅ Race detection will work across service boundaries
- ✅ Distributed span hierarchy will link parent/child spans

See `DISTRIBUTED.md` for full roadmap.
