## Distributed Tracing Roadmap

### Goal
Extend Raceway beyond single-process traces so a request flowing across multiple services appears as one causal graph with shared vector clocks, critical path analysis, and race detection.

### Guiding Principles
- Prefer open standards (W3C Trace Context) for headers and context propagation.
- Optimise for greenfield adoption—no backwards-compatibility constraints.
- Make propagation opt-in per SDK while features are under active development.
- Validate behavior under failure (dropped headers, clock skew, retries).

---

## Phase 0 – Discovery & Design

### Phase 0 Outcomes

1. **Requirements workshop**
   - **SDK inventory:** TypeScript (Node/Express, HTTP only), Python (Flask/FastAPI via requests), Go (net/http), Rust (axum/reqwest). No current gRPC or queue integrations; JS auto-tracking exists but stays single-process.
   - **Must-have scenarios for first release:** HTTP REST between services instrumented with the existing SDKs. Nice-to-have (later phases): gRPC (Go/Rust) and async messaging (Kafka/SQS).
   - **Non-goals for initial rollout:** Legacy header compatibility, polyglot mobile/edge SDKs.

2. **Header/protocol decision**
   - Adopt **W3C `traceparent`/`tracestate`** for baseline propagation to interoperate with existing tooling.
   - Introduce a vendor header `raceway-clock` containing a compact, versioned vector clock payload:
     ```text
     raceway-clock: v1;base64url(<zstd-compressed JSON>)
     ```
     JSON schema (`v1`):
     ```json
     {
       "trace_id": "<uuid>",
       "span_id": "<uuid>",
       "parent_span_id": "<uuid|null>",
       "service": "<string>",
       "clock": [["service-A#instance", 42], ["service-B#instance", 7]]
     }
     ```
   - Future-proof via `v<N>` prefix and optional `flags` array for experimental fields.

3. **Graph/engine design**
   - Extend `EventMetadata` with optional `distributed_span_id` and `upstream_span_id`.
   - Vector clock merge: element-wise max keyed by `<service>#<instance>`; discard entries older than configurable TTL (default 15 minutes).
   - Duplicate suppression: treat `(trace_id, span_id, event_id)` as unique; if incoming event already attached, log and skip.
   - External edges: store in new `DistributedEdge { from_span, to_span, link_type }` structure; engine builds edges post-ingestion.

4. **Storage impact review**
   - **Postgres:** add tables
     ```sql
     distributed_spans(trace_id UUID, span_id UUID PRIMARY KEY, service TEXT, instance TEXT, first_event TIMESTAMPTZ);
     distributed_edges(from_span UUID, to_span UUID, link_type TEXT, metadata JSONB);
     ```
     Indexes on `(trace_id, service)` and `(from_span, to_span)`. Backfill strategy: when distributed tracing disabled, tables remain empty; no migration of legacy data required.
   - **Memory backend:** mirror spans/edges with `DashMap<Uuid, DistributedSpan>` and adjacency lists.
   - No additional backfill necessary (greenfield adoption).

5. **UI requirements**
   - **TUI:** add service summary column in trace list, color-coded service lanes in timeline, breadcrumb showing service transitions.
   - **Web:** enhance dependency graph to consume `distributed_edges`, timeline segmented per service, filters for `service`, `operation`, and header-loss warnings.
   - Provide hover tooltips showing vector clock entries and originating service.

6. **Test strategy draft**
   - Expand existing test matrix (see “Testing Plan”) with:
     - Header interoperability suite comparing Raceway headers against W3C conformance examples.
     - Engine property tests verifying idempotency of duplicate span ingestion.
     - UI screenshot/visual regression tests for multi-service timelines.
   - Plan to introduce `./examples/distributed-demo` for end-to-end CI validation (Node → Go → Python chain).

**Deliverables produced:** this plan (architecture decisions), header specification (`raceway-clock v1`), storage schema sketch, updated milestone plan (Phase 1–4 unchanged but now informed by decisions).

---

## Phase 1 – SDK Propagation Foundations

### Status: ✅ Phase 1.5 Complete!

**Current Progress:**

**Phase 1: Trace Context Modules - ✅ COMPLETE!**
- ✅ **Trace Context Modules** (ALL SDKs COMPLETE!)
  - TypeScript: Full implementation with 23 passing unit tests ✅
  - Python: Full implementation with 23 passing unit tests ✅ (includes bug fix for span_id parsing)
  - Go: Full implementation with 26 passing unit tests ✅ (includes bug fix for span_id parsing + missing runtime import)
  - Rust: Full implementation with 22 passing unit tests + 1 doc-test ✅ (includes bug fix for span_id parsing)
- ✅ **Testing Infrastructure** (COMPLETE!)
  - ✅ TypeScript: Jest configured, comprehensive test suite (serialization, propagation, multi-hop)
  - ✅ Python: pytest configured, comprehensive test suite (serialization, propagation, multi-hop)
  - ✅ Go: go test configured, comprehensive test suite (serialization, propagation, multi-hop)
  - ✅ Rust: cargo test configured, comprehensive test suite (serialization, propagation, multi-hop)
  - ✅ Test harness extended in `./raceway-dev` to run all SDK tests alongside core tests

**Phase 1.5: SDK Propagation - ✅ COMPLETE!**
- ✅ **Middleware Integration** (all SDKs complete!)
  - TypeScript: Express middleware for inbound/outbound propagation ✅
  - Python: Flask/FastAPI middleware ✅
  - Go: net/http middleware with public getters (ServiceName, InstanceID) ✅
  - Rust: Axum tower::Layer ✅
- ✅ **Cross-Language Demo** (`examples/distributed/`)
  - TypeScript → Python → Go → Rust HTTP chain ✅
  - Bash orchestration (no Docker required) ✅
  - Integration smoke test script with header validation ✅
- ✅ **Demo Applications** (complete on ports 6001-6004)
- ✅ **Integrated into `./raceway-dev` menu** (option 11)

**Next Steps:**
1. ✅ ~~Complete all SDK trace context modules~~ DONE!
2. ✅ ~~Implement middleware integration~~ DONE!
3. ✅ ~~Build `examples/distributed/` smoke test~~ DONE!
4. **Phase 2: Engine changes for cross-service graph edges** ← Next milestone
5. Cross-language integration testing with full graph support

**Key Achievement:** All 4 SDKs now have identical trace context implementations with comprehensive test coverage (95 total tests across all SDKs)!

**Phase 1.5 Goal:** Validate SDK propagation works end-to-end BEFORE requiring backend changes (Phase 2). This allows parallel development and early validation.

### Objectives
- Implement the shared trace-context layer across SDKs using the decisions from Phase 0.
- Ensure every SDK can inject and extract distributed tracing metadata over HTTP calls.
- Provide sample middleware/wrappers so framework integration is straightforward.

### Deliverables
- Document header usage (`traceparent`, `tracestate`, `raceway-clock`) for all SDKs.
- Shared serialization/deserialization libraries in each SDK (TypeScript, Python, Go, Rust).
- Middleware/reference implementations for the primary frameworks per language.
- Automated tests or linters verifying builds (TypeScript `tsc`, Rust `cargo fmt`, Go/Python format checks).
- Sample “Service A → Service B” demos (pending cross-language chain).

### Work Breakdown

1. **Trace Context Modules**
   - Define language-specific structures mirroring the `raceway-clock v1` schema.
   - Implement helper APIs:
     - `TraceContext::from_headers(headers) -> Result<Option<Context>>`
     - `TraceContext::to_headers(&self) -> HeaderMap`
     - `TraceContext::merge(&mut self, incoming: &Context)`
   - Include validation (UUID formats, version prefixes) and error reporting.

2. **Outbound Propagation**
   - **TypeScript**
     - Add fetch/axios interceptors that pull context from AsyncLocalStorage and set headers.
     - Extend Express middleware to initialize context and wrap downstream `RacewayClient`.
   - **Python**
     - Provide `requests` and `httpx` session adapters that inject headers.
     - Flask/FastAPI: route middleware seeds context, utilities for background tasks.
   - **Go**
     - Implement `http.RoundTripper` wrapper plus helper for `http.Client`.
     - Add context helpers (`context.Context`) storing trace/span ids.
   - **Rust**
     - Provide `tower::Layer` for axum/reqwest.
     - Add macros or helpers to wrap `reqwest::Client` requests.

3. **Inbound Extraction**
   - Extend existing middleware for Express, Flask/FastAPI, Gin, and Axum to:
     - Parse headers via `TraceContext::from_headers`.
     - Merge with local context (element-wise max of vector clock).
     - Generate new span ids when missing, mark context as “distributed=false” if no headers.

4. **SDK Surface Area Updates**
   - Add ability to set service name/instance id (if not already) for clock keys.
   - Document new config knobs (e.g., `propagation_enabled`, `propagation_headers_debug`).
   - Provide logging hooks to detect propagation issues (missing header, parse failure).

5. **Demo Applications**
   - For each SDK, create a minimal two-service example:
     - Service A receives a request, calls Service B using the SDK client, both emit events, verify they share the same distributed trace id/span structure.
   - Consolidate demos under `examples/distributed/<language>-chain`.

6. **Phase 1.5: Integration Smoke Test**
   - Build cross-language demo: TypeScript → Python → Go → Rust HTTP chain
   - Validate SDK propagation WITHOUT requiring Phase 2 backend changes
   - Location: `examples/distributed/` with docker-compose orchestration

   **What This Validates:**
   - ✅ Headers propagate correctly across all 4 SDKs
   - ✅ Vector clocks accumulate components from all services
   - ✅ Events from all services share the same `trace_id`
   - ✅ Service metadata correctly identifies each service
   - ✅ Middleware integration works in all frameworks (Express, Flask, net/http, Axum)

   **Known Limitations (Acceptable without Phase 2):**
   - ⚠️ Graph shows 4 disconnected sub-graphs (no cross-service edges yet)
   - ⚠️ Critical path doesn't span services (calculated per-service only)
   - ⚠️ No cross-service race detection (within-service races still work)
   - ⚠️ No distributed span hierarchy (span linkage is local to each service)

   **Test Script:** `examples/distributed/test.sh`
   - Starts all services via docker-compose
   - Makes request through full chain
   - Validates headers, vector clocks, and event grouping
   - Reports success with clear note about Phase 2 requirements

### Testing Plan (Phase 1)

| Layer            | Tests                                                                                                     |
|------------------|-----------------------------------------------------------------------------------------------------------|
| Serialization    | Unit tests for encode/decode of `raceway-clock` (valid data, version mismatch, invalid base64). ✅ DONE (95 tests)  |
| Header handling  | Unit tests ensuring `traceparent`/`tracestate` round-trip; verify vendor header appended without clobbering existing state. ✅ DONE |
| Middleware       | Integration tests spinning up local HTTP servers asserting that contexts propagate end-to-end (Service A -> Service B). ⏳ NEXT |
| Merge semantics  | Property tests (where available) checking element-wise max behavior and TTL trimming. ✅ DONE (in unit tests) |
| Regression       | Ensure single-process traces still behave identically when propagation disabled. ⏳ After middleware |
| Smoke Test       | `examples/distributed/test.sh` - Full TS→Py→Go→Rust chain validates header propagation and event grouping. ⏳ Phase 1.5 |

### Exit Criteria

**Phase 1 (Trace Context Modules) - ✅ COMPLETE**
- ✅ All 4 SDKs have trace context serialization/parsing (95 tests passing)
- ✅ Cross-SDK header compatibility validated via unit tests
- ✅ Vector clock merge semantics tested

**Phase 1.5 (SDK Propagation) - ✅ COMPLETE**
- ✅ All maintained SDKs propagate headers on outbound HTTP requests and consume them on inbound requests
- ✅ Middleware integration complete for Express, Flask, net/http, Axum
- ✅ `examples/distributed/` demo runs successfully (bash orchestration)
- ✅ Smoke test validates: header propagation, vector clock accumulation, trace_id consistency
- ✅ Demo integrated into `./raceway-dev` menu (option 11)
- ✅ Go SDK enhanced with public getters for ServiceName() and InstanceID()

**Phase 1.5 Success Criteria - ✅ ACHIEVED:**
```bash
$ cd examples/distributed && ./test.sh
Starting TypeScript service...
Starting Python service...
Starting Go service...
Starting Rust service...

Waiting for TypeScript (port 6001)... ✓
Waiting for Python (port 6002)... ✓
Waiting for Go (port 6003)... ✓
Waiting for Rust (port 6004)... ✓

✓ All services are healthy!

═══════════════════════════════════════════════════════
  Linear Pattern Test: TS → Python → Go → Rust
═══════════════════════════════════════════════════════

W3C traceparent headers:
  ○ TypeScript (entry point - no incoming headers)
  ✓ Python received traceparent
  ✓ Go received traceparent
  ✓ Rust received traceparent

Raceway vector clock headers:
  ○ TypeScript (entry point - no incoming headers)
  ✓ Python received raceway-clock
  ✓ Go received raceway-clock
  ✓ Rust received raceway-clock

✓ Linear pattern test PASSED
  - Headers propagated across all 4 services
  - All services share the same trace_id

⚠️  Note: Graph will show 4 disconnected sub-graphs
   (cross-service edges require Phase 2)

✓ All tests completed!
```

---

## Phase 2 – Engine & Storage Enhancements

### Status: ✅ Phase 2 FULLY Complete! (All Critical Bugs Fixed)

**Current Progress:**

**Phase 2.1: SDK Distributed Metadata - ✅ COMPLETE!**
- ✅ **All SDKs send distributed metadata unconditionally** (not gated by distributed flag)
  - TypeScript: Always sets instance_id, distributed_span_id, upstream_span_id when context exists ✅
  - Python: Always sets distributed metadata when context exists ✅
  - Go: Always sets distributed metadata when context exists ✅
  - Rust: Always sets distributed metadata when context exists ✅
- ✅ **Entry-point services create distributed spans** (fixed bug where they previously didn't)

**Phase 2 Critical Bug Fixes - ✅ COMPLETE! (October 24, 2025)**
- ✅ **Bug Fix 1: SDK Span ID Propagation**
  - **Problem**: All 4 SDKs were generating new span IDs instead of using received ones from propagation headers
  - **Impact**: Service relationships broken, no edges created between services
  - **Fix**: Modified all SDKs to extract and use `span_id` from incoming `traceparent` and `raceway-clock` headers
  - **Files**: `sdks/*/trace_context.{ts,py,go,rs}` - Updated parsing logic
  - **Result**: Each service now correctly uses its assigned span ID

- ✅ **Bug Fix 2: Context Mutation After Propagation (CRITICAL)**
  - **Problem**: Go and Python SDKs were updating their own context to use child span ID after calling `propagation_headers()`
  - **Impact**: Services shared span IDs with downstream services, breaking span isolation
  - **Fix**: Removed context mutation lines that overwrote `ctx.span_id` and `ctx.parent_span_id`
  - **Files**:
    - `sdks/go/raceway/client.go:270-276` - Removed span_id mutation
    - `sdks/python/raceway/client.py:243-246` - Removed span_id mutation
  - **Result**: Services maintain their own unique span IDs throughout request lifecycle

- ✅ **Bug Fix 3: Server Span Ownership**
  - **Problem**: Server was overwriting span service ownership when processing updates
  - **Impact**: Span service attribution incorrect in database
  - **Fix**: Modified span upsert to only update `last_event` timestamp, not service/instance
  - **Files**: `core/src/analysis.rs:135-158` - Changed upsert logic
  - **Result**: Span ownership preserved, service attribution accurate

- ✅ **Verification**: All 4 services validated with unique span IDs and correct edges
  - TypeScript (`f86bdb89e6fb45ad`) → Python (`15dec22bef8e228b`) ✓
  - Python (`15dec22bef8e228b`) → Go (`0e74e81176ef3c3b`) ✓
  - Go (`0e74e81176ef3c3b`) → Rust (`b3ff477838b546fa`) ✓
  - Total: 12 events across 4 services with full edge chain

**Phase 2.2: Storage - ✅ COMPLETE!**
- ✅ **PostgreSQL tables implemented and working:**
  - `distributed_spans(trace_id, span_id, service, instance, first_event)` ✅
  - `distributed_edges(from_span, to_span, edge_type, metadata)` ✅
  - Indexes on `(trace_id)`, `(span_id)`, `(from_span, to_span)` ✅
- ✅ **Storage trait extended:**
  - `get_distributed_spans(trace_id) -> Result<Vec<DistributedSpan>>` ✅
  - `get_distributed_span(span_id) -> Result<Option<DistributedSpan>>` ✅
  - `get_distributed_edges(trace_id) -> Result<Vec<DistributedEdge>>` ✅
  - `upsert_distributed_span()` and `upsert_distributed_edge()` ✅

**Phase 2.3: Backend Merging - ✅ COMPLETE!**
- ✅ **Recursive BFS implementation in `core/src/analysis.rs:316-447`:**
  - Uses BFS queue to recursively discover all connected spans
  - Follows edges through arbitrary chain lengths (tested with 4-service chain)
  - Groups spans by trace_id to minimize queries
  - Filters events by distributed_span_id
  - Sorts merged events chronologically
  - Logs: "Merged trace X: Y events from Z spans across N traces"
- ✅ **4-Service Chain Validated:**
  - TypeScript → Python → Go → Rust successfully merged
  - 13 events from 5 distributed spans across 1 trace
  - All services present in chronological event timeline

**Phase 2.4: Event Ingestion - ✅ COMPLETE!**
- ✅ **Event metadata includes distributed fields:**
  - `instance_id: Option<String>`
  - `distributed_span_id: Option<String>`
  - `upstream_span_id: Option<String>`
- ✅ **Spans and edges automatically created during ingestion**
- ✅ **HttpCall/GrpcCall events create distributed edges**

**What's Working:**
```bash
$ cd examples/distributed && ./patterns/full-chain.sh

Making single request: TypeScript → Python → Go → Rust...

📊 MERGED DISTRIBUTED TRACE ANALYSIS
======================================================================
Trace ID: 332e9289-da37-4670-b75d-e38f517e8909
Total Events: 13

Events by Service:
  • go-service: 3 events
  • python-service: 4 events
  • rust-service: 3 events
  • typescript-service: 3 events

✅ SUCCESS: All 4 services present in merged trace!
✅ Recursive BFS distributed tracing working end-to-end!

This proves the system scales to arbitrary chain lengths!
```

**✅ Phase 2.5 - COMPLETE!**
- ✅ Vector clock merge logic (element-wise max) - implemented in core/src/graph.rs:185-220
- ✅ CausalGraph updates for cross-service edges (external edge linking via distributed_edges)
- ✅ Config toggles for distributed tracing (distributed_tracing.enabled in raceway.toml)
- ✅ Unit tests for graph merge logic (6 new tests in core/src/graph.rs)
- ⏳ Property tests for vector clock semantics (optional, deferred)

### Original Requirements

### Engine

- ✅ Modify `Event` ingestion to accept optional remote parent references (service, span ID, vector clock).
- ✅ Update `CausalGraph`:
  - ✅ Allow multiple root nodes per logical trace, merging by trace id.
  - ✅ Add support for "external edge" linking events from different services (distributed_edges DashMap).
  - ✅ Handle missing parents gracefully (e.g., dropped headers) with warning edges.

### Vector Clocks

- ✅ Extend from per-trace `DashMap<Uuid, u64>` to per-service or per-span component.
- ✅ Introduce identifier scheme (service name + instance id) to avoid collisions.
- ⏳ Keep clocks bounded (evict old components) - future optimization.

### Storage

- ✅ Postgres migrations:
  - ✅ New table for distributed edges (`distributed_edges`).
  - ✅ Indexes for `trace_id` + `service_name`.
  - Optional materialized view for service dependency map.
- ✅ Memory backend:
  - ✅ Mirror distributed edges in-memory (e.g., `DashMap<(Uuid, Uuid), DistributedEdge>`).

### Routing/Config

- ✅ Add server config toggles (`distributed_tracing.enabled`, default false in code, true in raceway.toml).
- ✅ Gracefully reject distributed headers when disabled (gated by config flag).

### Testing

- ✅ Unit tests for graph merge logic (6 comprehensive tests for distributed edges).
- ⏳ Property tests ensuring vector clock happens-before remains correct after merges (optional, deferred).
- ✅ Storage tests verifying migrations and retrieval of cross-service data.
- ✅ Engine integration test: ingest events from two "services" and ensure graph connectivity.

**Exit criteria:** ✅ **Core engine can accept distributed events and construct a coherent graph; persisted structures support fetching.** ACHIEVED! Recursive BFS proves arbitrary-length chains work end-to-end.

---

## Phase 2.5 – Complete Engine Work (Causal Analysis Across Services)

### Status: ✅ COMPLETE

**Why This Matters:**
Phase 2 Core successfully merges distributed traces (events from multiple services appear together). However, **causal analysis doesn't span services yet**. Critical path, race detection, and happens-before relationships are currently computed per-service only. Phase 2.5 makes distributed tracing **fully functional** by extending the CausalGraph to understand cross-service edges.

**Estimated Effort:** Medium
**Impact:** HIGH - Makes distributed tracing production-ready

---

### Phase 2.5 Tasks

#### 1. ✅ Vector Clock Merge Logic (ALREADY IMPLEMENTED!)

**Status:** ✅ Complete in `core/src/graph.rs:185-220`

**What's Working:**
- Element-wise max merge already implemented
- Incoming `causality_vector` from SDK propagation preserved
- Parent clocks merged correctly using `max()` for overlapping components
- Service/instance identification using `service#instance` format

**Code Reference:** `core/src/graph.rs:185-220` (add_event method)

```rust
// Start with any pre-existing causality vector (from distributed propagation via SDKs)
let mut causality_vector: Vec<(String, u64)> = event.causality_vector.clone();

// If there's a parent, merge parent's vector clock (take max of each component)
if let Some(parent_id) = event.parent_id {
    if let Some(parent_entry) = self.nodes.get(&parent_id) {
        let parent_event = &parent_entry.value().1.event;

        // Merge vector clocks: for each component in parent, take max with existing
        for (parent_component, parent_clock) in &parent_event.causality_vector {
            if let Some(existing) = causality_vector.iter_mut().find(|(c, _)| c == parent_component) {
                // Component exists in both - take the maximum
                existing.1 = existing.1.max(*parent_clock);
            } else {
                // Component only in parent - add it
                causality_vector.push((parent_component.clone(), *parent_clock));
            }
        }
    }
}
```

**Tests:** 7 comprehensive vector clock tests in `core/src/graph.rs` (#[cfg(test)] module)

**No Further Work Needed** - This was fixed during Priority 1 testing when a bug was discovered and resolved.

---

#### 2. Add Cross-Service Edge Support (External Edges)

**Status:** ✅ COMPLETE
**Actual Effort:** ~4 hours

**Current Situation:**
- `DistributedEdge` struct exists in `core/src/event.rs:19`
- Database tables exist and populated during ingestion
- `CausalGraph` only tracks local edges (within same service)
- Critical path and race detection don't cross service boundaries

**What Needs to Change:**

##### 2a. Extend CausalGraph to Load Distributed Edges

**File:** `core/src/graph.rs`

**Add new field to CausalGraph:**
```rust
pub struct CausalGraph {
    // ... existing fields ...

    /// External edges connecting events across services (Phase 2.5)
    /// Maps from downstream event_id to (upstream_event_id, edge_type)
    pub distributed_edges: DashMap<Uuid, Vec<(Uuid, EdgeLinkType)>>,
}
```

**Modify graph construction** to load distributed edges when building the graph:

```rust
impl CausalGraph {
    pub async fn from_events_with_distributed(
        events: Vec<Event>,
        distributed_edges: Vec<DistributedEdge>,
        storage: Arc<dyn Storage>,
    ) -> Result<Self> {
        let graph = Self::from_events(events)?;

        // Add distributed edges to the graph
        for dist_edge in distributed_edges {
            // Find events matching the span IDs
            let upstream_event = graph.find_event_by_span(&dist_edge.from_span);
            let downstream_event = graph.find_event_by_span(&dist_edge.to_span);

            if let (Some(up_id), Some(down_id)) = (upstream_event, downstream_event) {
                graph.distributed_edges
                    .entry(down_id)
                    .or_insert_with(Vec::new)
                    .push((up_id, dist_edge.link_type));
            }
        }

        Ok(graph)
    }

    // Helper to find event by distributed_span_id
    fn find_event_by_span(&self, span_id: &str) -> Option<Uuid> {
        for node_entry in self.nodes.iter() {
            let (event_id, (_, node)) = node_entry.pair();
            if let Some(ref event_span) = node.event.metadata.distributed_span_id {
                if event_span == span_id {
                    return Some(*event_id);
                }
            }
        }
        None
    }
}
```

##### 2b. Update Critical Path to Use Distributed Edges

**File:** `core/src/graph.rs` (critical_path method)

**Current:** Only considers local parent_id edges
**Change:** Also consider distributed_edges when traversing

```rust
pub fn critical_path(&self, trace_id: Uuid) -> Result<CriticalPath> {
    // ... existing setup ...

    // When building the graph, include distributed edges:
    for node_entry in self.nodes.iter() {
        let (event_id, (_, node)) = node_entry.pair();

        // Add local parent edge
        if let Some(parent_id) = node.event.parent_id {
            if self.nodes.contains_key(&parent_id) {
                graph.add_edge(parent_node, node_index, edge_type);
            }
        }

        // Add distributed edges (NEW)
        if let Some(dist_edges) = self.distributed_edges.get(event_id) {
            for (upstream_id, edge_type) in dist_edges.value() {
                if let Some(upstream_node) = event_to_node.get(upstream_id) {
                    graph.add_edge(*upstream_node, node_index, *edge_type);
                }
            }
        }
    }

    // ... rest of critical path algorithm unchanged ...
}
```

##### 2c. Update Race Detection to Use Distributed Edges

**File:** `core/src/graph.rs` (detect_races method)

**Current:** Only considers events concurrent within same service
**Change:** Use vector clocks to detect races across services

```rust
pub fn detect_races(&self, trace_id: Uuid) -> Result<Vec<RaceCondition>> {
    // ... existing setup ...

    // When checking happens-before, distributed edges establish causality:
    fn happens_before(
        &self,
        event_a: &Event,
        event_b: &Event,
        distributed_edges: &DashMap<Uuid, Vec<(Uuid, EdgeLinkType)>>
    ) -> bool {
        // 1. Check direct parent chain (existing)
        if self.is_ancestor(event_a.id, event_b.id) {
            return true;
        }

        // 2. Check distributed edges (NEW)
        if let Some(b_upstreams) = distributed_edges.get(&event_b.id) {
            for (upstream_id, _) in b_upstreams.value() {
                if *upstream_id == event_a.id || self.is_ancestor(event_a.id, *upstream_id) {
                    return true;
                }
            }
        }

        // 3. Use vector clocks for cross-service causality (existing)
        vector_clocks_establish_order(&event_a.causality_vector, &event_b.causality_vector)
    }

    // ... rest of race detection unchanged ...
}
```

**Expected Outcome:**
- ✅ Critical path spans services (e.g., TS → Python → Go → Rust)
- ✅ Race detection works across services
- ✅ Happens-before relationships respect distributed edges
- ✅ All existing tests continue to pass
- ✅ Distributed tests show full graph connectivity

**Code References:**
- `core/src/event.rs:19` - DistributedEdge struct
- `core/src/graph.rs` - CausalGraph implementation
- `core/src/analysis.rs:316-447` - Recursive BFS (already fetches distributed_edges)

---

#### 3. Add Config Toggle for Distributed Tracing

**Status:** ✅ COMPLETE
**Actual Effort:** ~2 hours

**Current Situation:**
- `DistributedTracingConfig` exists in `core/src/config.rs:267-276`
- Defaults to `enabled: false`
- **Currently not checked anywhere** - distributed tracing always runs

**What Needs to Change:**

##### 3a. Check Config During Event Ingestion

**File:** `core/src/engine.rs` or wherever events are ingested

```rust
async fn process_event(&self, event: Event, storage: Arc<dyn Storage>) -> Result<()> {
    // ... existing event processing ...

    // Only process distributed metadata if enabled
    if self.config.distributed_tracing.enabled {
        if let Some(ref span_id) = event.metadata.distributed_span_id {
            // Create distributed span
            storage.upsert_distributed_span(...).await?;

            // Create distributed edge if upstream_span_id exists
            if let Some(ref upstream_span) = event.metadata.upstream_span_id {
                storage.upsert_distributed_edge(...).await?;
            }
        }
    }

    // ... rest of processing ...
}
```

##### 3b. Check Config During Graph Construction

**File:** `core/src/analysis.rs:316` (get_trace_with_distributed)

```rust
pub async fn get_trace_with_distributed(
    storage: Arc<dyn Storage>,
    trace_id: Uuid,
    config: &Config,  // NEW parameter
) -> Result<TraceWithAnalysis> {
    let events = if config.distributed_tracing.enabled {
        // Use recursive BFS to merge distributed traces
        merge_distributed_events(storage.clone(), trace_id).await?
    } else {
        // Just get events for this trace_id (existing behavior)
        storage.get_events(trace_id).await?
    };

    // Build graph and analyze
    let distributed_edges = if config.distributed_tracing.enabled {
        storage.get_distributed_edges(trace_id).await?
    } else {
        Vec::new()
    };

    let graph = CausalGraph::from_events_with_distributed(
        events,
        distributed_edges,
        storage.clone()
    ).await?;

    // ... rest of analysis ...
}
```

##### 3c. Document Config Flag

**File:** `core/src/config.rs:264-276`

Update comments to be clear about behavior:

```rust
/// Controls whether distributed tracing is enabled (Phase 2).
///
/// When enabled:
/// - Events with distributed_span_id create spans and edges in distributed tables
/// - Traces are merged across services using recursive BFS
/// - Critical path and race detection span services
/// - Vector clocks track causality across service boundaries
///
/// When disabled:
/// - Each service's events remain isolated
/// - Distributed metadata ignored (backward compatible)
/// - Single-service behavior unchanged
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DistributedTracingConfig {
    #[serde(default = "default_false")]
    pub enabled: bool,
}
```

**Expected Outcome:**
- ✅ Config flag `distributed_tracing.enabled = true` enables all Phase 2 features
- ✅ Config flag `distributed_tracing.enabled = false` reverts to Phase 1 behavior
- ✅ Default remains `false` for backward compatibility
- ✅ Demo and tests explicitly enable it

**Code References:**
- `core/src/config.rs:267-276` - DistributedTracingConfig
- `core/src/engine.rs` - Event ingestion
- `core/src/analysis.rs:316` - get_trace_with_distributed

---

#### 4. Complete Property Tests for Vector Clock Semantics

**Status:** ⏳ OPTIONAL (Deferred)
**Estimated Effort:** 3-4 hours if implemented

**Current Situation:**
- 7 vector clock unit tests exist in `core/src/graph.rs` (#[cfg(test)])
- Tests cover merge, concurrent detection, serialization
- Missing: property-based tests for invariants

**What Needs to Change:**

##### 4a. Add proptest Dependency

**File:** `core/Cargo.toml`

```toml
[dev-dependencies]
proptest = "1.0"
```

##### 4b. Add Property Tests

**File:** `core/src/graph.rs` (in #[cfg(test)] module)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // ... existing unit tests ...

    // Property: Merge is commutative
    proptest! {
        #[test]
        fn prop_vector_clock_merge_commutative(
            clock_a in prop_vector_clock(),
            clock_b in prop_vector_clock(),
        ) {
            let mut merged_ab = clock_a.clone();
            merge_vector_clocks(&mut merged_ab, &clock_b);

            let mut merged_ba = clock_b.clone();
            merge_vector_clocks(&mut merged_ba, &clock_a);

            // Order shouldn't matter
            assert_eq_clocks(&merged_ab, &merged_ba);
        }
    }

    // Property: Merge is associative
    proptest! {
        #[test]
        fn prop_vector_clock_merge_associative(
            clock_a in prop_vector_clock(),
            clock_b in prop_vector_clock(),
            clock_c in prop_vector_clock(),
        ) {
            // (A ⊔ B) ⊔ C
            let mut merged_ab = clock_a.clone();
            merge_vector_clocks(&mut merged_ab, &clock_b);
            merge_vector_clocks(&mut merged_ab, &clock_c);

            // A ⊔ (B ⊔ C)
            let mut merged_bc = clock_b.clone();
            merge_vector_clocks(&mut merged_bc, &clock_c);
            let mut merged_a_bc = clock_a.clone();
            merge_vector_clocks(&mut merged_a_bc, &merged_bc);

            assert_eq_clocks(&merged_ab, &merged_a_bc);
        }
    }

    // Property: Merge is idempotent
    proptest! {
        #[test]
        fn prop_vector_clock_merge_idempotent(clock in prop_vector_clock()) {
            let mut merged = clock.clone();
            merge_vector_clocks(&mut merged, &clock);

            assert_eq_clocks(&merged, &clock);
        }
    }

    // Property: Happens-before is transitive
    proptest! {
        #[test]
        fn prop_happens_before_transitive(
            clock_a in prop_vector_clock(),
            clock_b_increment in prop::collection::vec(1u64..10, 1..5),
            clock_c_increment in prop::collection::vec(1u64..10, 1..5),
        ) {
            // Create A ≺ B ≺ C chain
            let mut clock_b = clock_a.clone();
            for incr in clock_b_increment {
                increment_clock(&mut clock_b, incr);
            }

            let mut clock_c = clock_b.clone();
            for incr in clock_c_increment {
                increment_clock(&mut clock_c, incr);
            }

            // If A ≺ B and B ≺ C, then A ≺ C
            assert!(happens_before(&clock_a, &clock_b));
            assert!(happens_before(&clock_b, &clock_c));
            assert!(happens_before(&clock_a, &clock_c));
        }
    }

    // Property: Concurrent events remain concurrent after merge
    proptest! {
        #[test]
        fn prop_concurrent_stays_concurrent(
            clock_a in prop_vector_clock(),
            clock_b in prop_vector_clock(),
        ) {
            // If A and B are concurrent
            if !happens_before(&clock_a, &clock_b) && !happens_before(&clock_b, &clock_a) {
                // Merging with a third clock shouldn't make them ordered
                let mut merged_a = clock_a.clone();
                merge_vector_clocks(&mut merged_a, &clock_b);

                // merged_a now dominates both (happens-after both)
                assert!(happens_before(&clock_a, &merged_a));
                assert!(happens_before(&clock_b, &merged_a));
            }
        }
    }

    // Helper: Generate arbitrary vector clocks
    fn prop_vector_clock() -> impl Strategy<Value = Vec<(String, u64)>> {
        prop::collection::vec(
            (
                prop::string::string_regex("[a-z-]+#[a-z0-9-]+").unwrap(),
                1u64..1000,
            ),
            0..10,
        )
    }

    fn assert_eq_clocks(a: &[(String, u64)], b: &[(String, u64)]) {
        let mut sorted_a = a.to_vec();
        let mut sorted_b = b.to_vec();
        sorted_a.sort_by(|x, y| x.0.cmp(&y.0));
        sorted_b.sort_by(|x, y| x.0.cmp(&y.0));
        assert_eq!(sorted_a, sorted_b);
    }
}
```

**Expected Outcome:**
- ✅ Property tests validate vector clock invariants
- ✅ Commutativity, associativity, idempotency proven
- ✅ Happens-before transitivity verified
- ✅ Concurrent events behavior validated
- ✅ Run via `cargo test prop_` to execute property tests

**Code References:**
- `core/src/graph.rs` - Existing tests (#[cfg(test)] module)
- Property testing guide: https://docs.rs/proptest/latest/proptest/

---

### Phase 2.5 Implementation Order

**Recommended Sequence:**

1. **Task 3: Config Toggle** (2-3 hours) ✅ Low risk, high clarity
   - Easiest to implement
   - Provides gating mechanism for all features
   - Can be tested immediately with existing demo

2. **Task 2: Cross-Service Edges** (4-6 hours) ⚠️ Core functionality
   - Most impactful change
   - Enables critical path and race detection across services
   - Requires careful testing with distributed tests

3. **Task 4: Property Tests** (3-4 hours) ✅ Validation
   - Validates all vector clock logic
   - Catches edge cases
   - Builds confidence in distributed causality

**Total Estimated Effort:** 9-13 hours (1-2 days of focused work)

---

### Phase 2.5 Exit Criteria

**Must Have:**
- ✅ Config flag `distributed_tracing.enabled` controls all Phase 2 features
- ✅ CausalGraph loads and uses distributed edges
- ✅ Critical path spans services in 4-service chain demo
- ✅ Race detection works across service boundaries
- ✅ All existing tests continue to pass
- ✅ Distributed tests validate cross-service analysis

**Success Metric:**
```bash
$ cd examples/distributed && ./patterns/full-chain.sh

# With distributed_tracing.enabled = true:
✅ Critical Path Analysis:
  Total Duration: 127ms
  Path:
    1. TypeScript: HTTP /chain (45ms)
    2. Python: HTTP /process (38ms)      ← SPANS SERVICES!
    3. Go: HTTP /transform (29ms)
    4. Rust: HTTP /finalize (15ms)

✅ Race Detection:
  Detected 0 races across 4 services

✅ Vector Clocks:
  typescript-service#ts-1: 4
  python-service#py-1: 3
  go-service#go-1: 2
  rust-service#rust-1: 1
```

**When Phase 2.5 Complete:**
- Distributed tracing is **production-ready**
- All causal analysis works across services
- Config flag provides clean opt-in/opt-out
- Comprehensive test coverage validates correctness

---

## Phase 3 – UI & Analytics (Distributed Trace Visualization)

### Status: ⏳ Ready to Implement

**Why This Matters:**
Phase 2 made distributed tracing work in the backend. Phase 3 makes it **visible and actionable** for users. Currently, users can only inspect distributed traces via raw API calls. Phase 3 adds intuitive visualizations showing service dependencies, cross-service critical paths, and distributed race conditions.

**Estimated Effort:** Medium-High (1-2 weeks)
**Impact:** HIGH - Makes distributed tracing usable for developers

---

### Phase 3 Tasks

#### Task 1: API Endpoints for Distributed Trace Analysis

**Status:** ⏳ Not Started
**Estimated Effort:** 4-6 hours

**What Needs to Change:**

**1a. Add `/api/traces/:id/analysis` endpoint**
- Returns critical path, race conditions, anomalies for a specific trace
- Include service breakdown in critical path
- Highlight cross-service edges

```rust
// File: api/src/handlers/traces.rs

pub struct TraceAnalysis {
    pub trace_id: Uuid,
    pub critical_path: CriticalPathResponse,
    pub race_conditions: Vec<RaceCondition>,
    pub anomalies: Vec<Anomaly>,
    pub service_breakdown: ServiceBreakdown,
}

pub struct ServiceBreakdown {
    pub services: Vec<ServiceStats>,
    pub cross_service_calls: usize,
    pub total_services: usize,
}

pub struct ServiceStats {
    pub service_name: String,
    pub event_count: usize,
    pub total_duration_ms: f64,
    pub critical_path_time_ms: f64,
}
```

**1b. Add `/api/services` endpoint**
- List all services that have sent events
- Show event counts, trace participation
- Optional time range filtering

**1c. Add `/api/services/:name/dependencies` endpoint**
- Show upstream and downstream services
- Based on distributed_edges
- Include call counts and average latencies

**Files to Modify:**
- `api/src/handlers/traces.rs` - Add analysis endpoint
- `api/src/handlers/mod.rs` - Add services handler module
- `api/src/router.rs` - Register new routes

---

#### Task 2: Terminal UI (TUI) - Distributed Trace View

**Status:** ⏳ Not Started
**Estimated Effort:** 8-12 hours

**Current Situation:**
- TUI exists but only shows single-service traces
- No service grouping or distributed visualization

**What Needs to Change:**

**2a. Service-Aware Trace List**
Show traces with service participation counts:
```
┌─ Distributed Traces ──────────────────────────────────┐
│ ID                                   Services Duration │
│ 11e55b6f-3a19-4fcd-9f93-e03dcd72a703 [4]      127ms   │
│ 22c76c59-aaae-424e-a5ef-0f8aef8418be [1]       45ms   │
│ 67875f83-e9c4-486c-a51a-7d6358a423e5 [2]       68ms   │
└───────────────────────────────────────────────────────┘
```

**2b. Service-Grouped Event Timeline**
```
┌─ Trace: 11e55b6f │ Services: 4 │ Duration: 127ms ────┐
│                                                         │
│ typescript-service [ts-1]                               │
│   0ms   ├─ HTTP /chain                           45ms  │
│  10ms   │  └─ FunctionCall: processRequest            │
│                                                         │
│ python-service [py-1]                                   │
│  45ms   ├─ HTTP /process                        38ms  │
│  50ms   │  └─ FunctionCall: process_request           │
│                                                         │
│ go-service [go-1]                                       │
│  83ms   ├─ HTTP /transform                      29ms  │
│  85ms   │  └─ FunctionCall: Process                   │
│                                                         │
│ rust-service [rust-1]                                   │
│ 112ms   ├─ HTTP /finalize                       15ms  │
│ 115ms   │  └─ FunctionCall: process_request           │
│                                                         │
│ ★ Critical Path: 127ms across 4 services              │
└─────────────────────────────────────────────────────────┘
```

**2c. Service Dependency Graph View**
```
┌─ Service Dependencies ────────────────────────────────┐
│                                                         │
│    typescript-service                                   │
│           │                                             │
│           ├─→ python-service (38ms avg)                │
│                     │                                   │
│                     ├─→ go-service (29ms avg)          │
│                               │                         │
│                               └─→ rust-service (15ms)  │
│                                                         │
│ Legend: [service] → [downstream] (avg latency)        │
└─────────────────────────────────────────────────────────┘
```

**Files to Create/Modify:**
- `tui/src/views/trace_detail.rs` - Add service grouping
- `tui/src/views/service_graph.rs` - NEW: Service dependency view
- `tui/src/widgets/service_timeline.rs` - NEW: Service-grouped timeline widget

---

#### Task 3: Web UI - Distributed Trace Visualization

**Status:** ⏳ Not Started
**Estimated Effort:** 12-16 hours

**Note:** Raceway may not have a Web UI yet. If not, this task becomes:
- **Option A:** Build basic web UI from scratch (React/Next.js + D3.js/Recharts)
- **Option B:** Defer to Phase 4 and focus on TUI + API for M3

**If Web UI exists:**

**3a. Service Dependency Graph**
- Interactive force-directed graph showing services as nodes
- Edges show HTTP calls with latency/volume
- Click service to filter traces

**3b. Distributed Trace Timeline**
- Gantt-chart style timeline
- Each row = service
- Show cross-service calls as connecting lines
- Highlight critical path

**3c. Service Metrics Dashboard**
- Service health overview
- Call volume and latencies per service pair
- Error rates across service boundaries

---

#### Task 4: Testing

**Status:** ⏳ Not Started
**Estimated Effort:** 4-6 hours

**4a. API Tests**
- Integration tests for `/api/traces/:id/analysis`
- Validate service breakdown calculations
- Test `/api/services` endpoints

**4b. TUI Tests**
- Snapshot tests for service-grouped layouts
- Verify correct rendering with distributed data
- Test keyboard navigation in service graph view

**4c. End-to-End Validation**
- Run 4-service demo
- Verify TUI shows all 4 services correctly
- Validate critical path spans services in UI

---

### Phase 3 Implementation Order

**Recommended Sequence:**

1. **Task 1: API Endpoints** (4-6 hours) ✅ Foundation
   - Needed by both TUI and Web UI
   - Easy to test independently
   - Enables manual validation

2. **Task 2: Terminal UI** (8-12 hours) ⚠️ High priority
   - Most Raceway users likely use TUI
   - Faster to implement than Web UI
   - Immediate value for developers

3. **Task 4: Testing** (4-6 hours) ✅ Validation
   - Validates API and TUI changes
   - Ensures no regressions

4. **Task 3: Web UI** (12-16 hours) ⏳ Optional for M3
   - Can be deferred to M4 if needed
   - More complex if building from scratch

**Total Estimated Effort:** 16-24 hours (2-3 days) for API + TUI
**With Web UI:** 28-40 hours (4-5 days)

---

### Phase 3 Exit Criteria

**Must Have:**
- ✅ `/api/traces/:id/analysis` returns service breakdown and cross-service critical path
- ✅ `/api/services` endpoints list services and dependencies
- ✅ TUI trace view groups events by service
- ✅ TUI shows critical path spanning multiple services
- ✅ TUI service graph view shows dependencies
- ✅ All tests passing

**Success Metric:**
```bash
$ raceway tui

# View distributed trace:
┌─ Trace: 11e55b6f │ Services: 4 │ Duration: 127ms ────┐
│ typescript-service → python-service → go-service → rust-service │
│ ★ Critical Path: 127ms across 4 services              │
└─────────────────────────────────────────────────────────┘

# Service dependency graph shows all connections
# Cross-service calls clearly visible
# Performance bottlenecks identifiable
```

**When Phase 3 Complete:**
- Developers can **visualize** distributed traces
- Service dependencies are **clear and actionable**
- Performance analysis **spans service boundaries**
- Distributed tracing is **production-ready for end users**

---

## Phase 4 – Advanced Propagation & Resilience

- gRPC interceptors for all SDKs.
- Message queue/staged propagation (Kafka headers, etc.).
- Fallback clocks when headers missing (generate synthetic spans, mark as incomplete).
- Replay support: ability to rehydrate distributed traces from storage into engine.
- Telemetry & observability: metrics for header adoption, drop rate, clock conflict warnings.

### Tests

- End-to-end scenario: service A → gRPC → service B → Kafka → service C.
- Chaos tests: randomly drop headers to ensure system degrades gracefully.
- Load tests to measure impact on ingestion and storage.

---

## Testing Plan Summary

| Area                  | Tests                                                                                   |
|-----------------------|-----------------------------------------------------------------------------------------|
| SDKs                  | Unit tests for serialization, integration tests with mock servers, contract tests       |
| Engine/Graph          | Unit & property tests on clock merge, integration test ingesting multi-service events    |
| Storage               | Migration tests, round-trip tests for distributed edges                                 |
| APIs                  | Regression tests verifying JSON structure for distributed traces                        |
| TUI/Web               | Snapshot/golden tests for distributed visualizations                                    |
| End-to-End            | Multi-service demo app executed in CI (docker-compose) verifying trace continuity       |
| Resilience            | Chaos-style tests dropping headers, clock skew simulation                               |

---

## Milestones & Deliverables

1. ✅ **M0 (Design sign-off)** – approved spec, storage plan, SDK API changes outlined. **COMPLETE**
2. ✅ **M1 (HTTP propagation)** – SDKs send/receive headers; basic engine support behind a feature flag. **COMPLETE**
3. ✅ **M2 (Engine/storage GA)** – distributed traces persisted; API surfaces cross-service data; tests passing. **FULLY COMPLETE**
   - ✅ All 4 SDKs sending distributed metadata
   - ✅ Storage tables and queries working
   - ✅ Recursive BFS merging arbitrary-length chains
   - ✅ 4-service chain validated end-to-end
   - ✅ **CRITICAL BUG FIXES (Oct 24, 2025):**
     - ✅ SDK span ID propagation fixed (all SDKs)
     - ✅ Context mutation bug fixed (Go + Python)
     - ✅ Server span ownership bug fixed
     - ✅ Full edge chain verified: TS → Python → Go → Rust
4. ✅ **M2.5 (Complete Engine Work)** – causal analysis spans services; config toggles; comprehensive tests. **COMPLETE**
   - ✅ Task 1: Vector clock merge (already implemented)
   - ✅ Task 2: Cross-service edges in CausalGraph (~4 hours)
   - ✅ Task 3: Config toggle for distributed_tracing.enabled (~2 hours)
   - ⏳ Task 4: Property tests for vector clock invariants (optional, deferred)
   - **Actual Effort:** ~6 hours (distributed edge tests + config integration)
   - **Bug Fix Effort:** ~4 hours (span propagation + context mutation + ownership fixes)
5. ⏳ **M3 (UI support)** – TUI/web show multi-service traces; feature flag default-on for beta users. **READY TO START**
6. ⏳ **M4 (Full release)** – gRPC/queues supported; resilience tooling; documentation and sample apps updated.

---

## Documentation & Rollout Tasks

- Update README and docs with configuration and usage instructions.
- Publish sample multi-service demo (docker-compose).
- Release notes per milestone with migration guidance.
- Provide observability guidance (verify context headers in network probes).
