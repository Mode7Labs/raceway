# Test Coverage & Implementation Plan

## Current Test Coverage

### Core (Rust) ✅ Good Coverage
**Location:** `core/src/graph.rs` (in `#[cfg(test)]` module)

- ✅ Graph operations (add_event)
- ✅ Race detection (concurrent events)
- ✅ Lock-protected events (no false positives)
- ✅ Critical path analysis
- ✅ Performance anomaly detection
- ✅ Audit trail generation
- ✅ Service dependencies
- ✅ Global concurrency detection
- ✅ Vector clock happens-before relationships

**Other files with tests:**
- `core/src/config.rs` - Configuration parsing
- `core/src/event.rs` - Event structures
- `core/src/capture.rs` - Event capture
- `core/src/engine.rs` - Core engine

### SDKs ⚠️ Partial Coverage
**TypeScript:** `sdks/typescript/src/trace-context.test.ts` (415 lines)
- ✅ W3C traceparent parsing (valid, malformed, array-valued)
- ✅ Raceway vector clock parsing (valid, malformed, wrong version)
- ✅ Header combination (traceparent + raceway-clock)
- ✅ Tracestate propagation
- ✅ New trace generation when no headers
- ✅ Clock vector initialization and preservation
- ✅ Propagation header building
- ✅ Span ID generation
- ✅ Clock vector incrementing
- ✅ Multi-hop propagation (A → B → C)
- ❌ Middleware functionality
- ❌ Auto-tracking with Proxies
- ❌ Error handling in HTTP operations

**Python:** `sdks/python/tests/test_trace_context.py`
- ✅ Trace context parsing
- ✅ Header propagation
- ❌ Flask/FastAPI middleware
- ❌ contextvars propagation

**Go:** `sdks/go/raceway/trace_context_test.go`
- ✅ Trace context parsing
- ✅ Header propagation
- ❌ HTTP middleware
- ❌ context.Context propagation

**Rust:** `sdks/rust/src/trace_context.rs`
- ✅ Trace context parsing (presumably)
- ❌ Axum middleware
- ❌ tokio::task_local! propagation

### Integration ⚠️ Minimal
**Location:** `raceway-test/tests/e2e.rs`

- ✅ Basic E2E flow (event ingestion → analysis)
- ❌ Distributed tracing end-to-end
- ❌ API endpoint comprehensive tests
- ❌ Database operation edge cases

---

## Priority 1: Critical Gaps 🔴

### 1. Distributed Trace Merging Tests
**File:** `raceway-test/tests/distributed.rs` (NEW)

**Status:** ⬜ Not Started

**Why Critical:** Core Phase 2 functionality - recursive BFS across services must work correctly.

**Tests to implement:**
- [ ] Two-service chain (A → B)
  - Service A creates events with span_id_1
  - Service B receives events with parent_span=span_id_1
  - Verify distributed edge created
  - Verify events merged into single trace

- [ ] Three-service chain (A → B → C)
  - Test full chain propagation
  - Verify all distributed edges present
  - Verify correct parent-child relationships

- [ ] Four-service chain (TS → Py → Go → Rust)
  - Mirror the actual distributed demo
  - Test with real SDK-generated events

- [ ] Parallel calls (A → B and A → C)
  - Service A calls both B and C
  - Verify both branches in same trace
  - Verify distributed graph structure

- [ ] Missing/orphaned spans
  - Event has parent_span_id but parent not found
  - Should handle gracefully (don't crash)
  - Should still show in trace with notation

- [ ] Circular dependencies
  - Edge case: A → B → A (shouldn't happen but test anyway)
  - Should detect and handle without infinite loop

- [ ] Large distributed trace (10+ services)
  - Performance test for BFS
  - Verify all edges found
  - Verify reasonable query time

**Code Reference:**
- BFS implementation: `cli/src/server.rs:748-807` (get_trace_with_distributed)
- Distributed span queries: Uses recursive CTE in SQL

---

### 2. API Endpoint Tests
**File:** `raceway-test/tests/api.rs` (NEW)

**Status:** ⬜ Not Started

**Why Critical:** API is the main interface - must be rock solid.

**Tests to implement:**

#### GET /api/traces
- [ ] Pagination works correctly
  - Request page=1, page_size=10
  - Verify returns max 10 traces
  - Verify total count correct

- [ ] Filtering by service
  - `/api/traces?service=my-service`
  - Only returns traces from that service

- [ ] Sorting (if implemented)
  - By timestamp, event count, etc.

- [ ] Empty database
  - Returns empty array, not error

- [ ] Invalid pagination params
  - page=0 or negative
  - page_size=0 or > 1000

#### GET /api/traces/:id
- [ ] Valid trace ID returns full trace
  - Events array populated
  - Analysis includes race_details
  - Critical path computed
  - Audit trails present

- [ ] Distributed trace returns all services
  - Events from multiple services
  - Distributed edges included
  - Correct parent-child relationships

- [ ] Invalid trace ID (404)
  - Proper error response
  - Correct HTTP status code

- [ ] Malformed trace ID (400)
  - UUID format validation

#### POST /events
- [ ] Valid event batch accepted
  - Returns 200/201
  - Events stored in database

- [ ] Invalid event structure (400)
  - Missing required fields
  - Invalid event type
  - Malformed JSON

- [ ] Empty batch
  - Should accept or return meaningful error

- [ ] Large batch (1000+ events)
  - Performance test
  - All events stored correctly

#### Error Responses
- [ ] 404 for non-existent routes
- [ ] 500 for server errors (simulate)
- [ ] CORS headers present on all responses
- [ ] Proper error JSON structure

**Code Reference:**
- API routes: `cli/src/server.rs` (axum handlers)
- Database queries: Various methods in server.rs

---

### 3. Vector Clock Logic Tests
**File:** `core/src/clock.rs` (add `#[cfg(test)]` module)

**Status:** ⬜ Not Started

**Why Critical:** Vector clocks are fundamental to distributed causality tracking.

**Tests to implement:**
- [ ] Merge two clock vectors
  - `merge([["A", 5], ["B", 3]], [["A", 3], ["C", 2]])`
  - Should return `[["A", 5], ["B", 3], ["C", 2]]`

- [ ] Happens-before relationship
  - Clock A: `[["S1", 5], ["S2", 3]]`
  - Clock B: `[["S1", 6], ["S2", 3]]`
  - B happens-after A

- [ ] Concurrent events
  - Clock A: `[["S1", 5], ["S2", 3]]`
  - Clock B: `[["S1", 4], ["S2", 4]]`
  - Neither happens-before the other = concurrent

- [ ] Clock increment
  - Increment local component
  - Preserve other components

- [ ] Serialization/deserialization
  - Convert to/from JSON
  - Convert to/from base64url
  - Round-trip testing

**Code Reference:**
- Clock operations scattered across SDKs
- May need to extract to core if not already present

---

## Priority 2: Important 🟡

### 4. Database Operations Tests
**File:** `raceway-test/tests/database.rs` (NEW)

**Status:** ⬜ Not Started

- [ ] Insert events
- [ ] Query by trace_id
- [ ] Distributed span queries
- [ ] Edge cases (missing spans, orphaned events)
- [ ] Concurrent inserts (stress test)

### 5. SDK Middleware Tests
**Files:** Add to each SDK's test suite

**Status:** ⬜ Not Started

**TypeScript** (`sdks/typescript/src/middleware.test.ts`)
- [ ] AsyncLocalStorage context propagation
- [ ] Header extraction from Express request
- [ ] Context available in handlers
- [ ] Nested async operations preserve context

**Python** (`sdks/python/tests/test_middleware.py`)
- [ ] contextvars propagation
- [ ] Flask before_request/after_request hooks
- [ ] FastAPI middleware integration
- [ ] Thread safety

**Go** (`sdks/go/raceway/middleware_test.go`)
- [ ] context.Context propagation
- [ ] HTTP middleware chain
- [ ] Goroutine safety

**Rust** (`sdks/rust/src/middleware.rs` tests)
- [ ] tokio::task_local! propagation
- [ ] Axum middleware integration
- [ ] Async task safety

### 6. Configuration Tests
**File:** `core/src/config.rs` (expand existing tests)

**Status:** ⬜ Not Started

- [ ] Invalid configurations rejected
- [ ] Default values applied
- [ ] Environment variable parsing
- [ ] File-based config loading

---

## Priority 3: Nice to Have 🟢

### 7. CLI Command Tests
**File:** `cli/tests/commands.rs` (NEW)

**Status:** ⬜ Not Started

- [ ] `raceway serve` starts server
- [ ] `raceway tui` launches TUI
- [ ] Exit codes correct
- [ ] Help text accurate

### 8. Error Handling Tests
**Various files**

**Status:** ⬜ Not Started

- [ ] Malformed events
- [ ] Invalid trace IDs
- [ ] Network failures in SDKs
- [ ] Database connection failures
- [ ] Disk full scenarios

### 9. Performance Tests
**File:** `raceway-test/benches/performance.rs` (NEW)

**Status:** ⬜ Not Started

- [ ] Large trace handling (1000+ events)
- [ ] Concurrent event ingestion
- [ ] BFS performance on deep graphs
- [ ] Memory usage under load

---

## Running Tests

### All tests
```bash
./raceway-dev
# Select: 2) Build & Test
# Select: 2) Run all tests
```

Or directly:
```bash
cargo test
```

### Specific test file
```bash
cargo test -p raceway-test --test distributed
cargo test -p raceway-test --test api
cargo test -p raceway-core clock
```

### With output
```bash
cargo test -- --nocapture
```

---

## Test Implementation Guidelines

1. **Use the existing TestApp harness** (`raceway-test/src/harness.rs`)
   - Spins up test server
   - Provides helper methods for HTTP requests
   - Handles cleanup

2. **Use fixtures** (`raceway-test/src/fixtures.rs`)
   - Create reusable test data
   - Keep tests DRY

3. **Test isolation**
   - Each test should be independent
   - Use unique trace IDs
   - Clean up after tests

4. **Async tests**
   - Use `#[tokio::test]` for async tests
   - Use `tokio::time::sleep` for delays
   - Be careful with race conditions

5. **Assertions**
   - Use meaningful assertion messages
   - Test both happy path and error cases
   - Verify HTTP status codes

---

## Progress Tracking

**Last Updated:** 2025-10-22

**Overall Progress:** 0/3 Priority 1 tasks completed

- Priority 1: 0/3 ⬜⬜⬜
- Priority 2: 0/3 ⬜⬜⬜
- Priority 3: 0/3 ⬜⬜⬜

**Total Test Coverage:**
- Core: ~70% estimated
- SDKs: ~40% estimated
- Integration: ~20% estimated

**Target:**
- Core: 80%+
- SDKs: 70%+
- Integration: 60%+
