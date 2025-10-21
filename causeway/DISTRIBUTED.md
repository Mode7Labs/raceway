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

### Workstreams

1. **Common Trace Context module**
   - Shared spec describing trace IDs, parent IDs, and vector clocks.
   - Provide utilities for serialization/deserialization and merge semantics.
2. **Outbound propagation**
   - TypeScript SDK: Express middleware exports headers on `fetch/axios` wrappers.
   - Python SDK: Requests/httpx wrappers, Flask/FastAPI middleware.
   - Go SDK: `http.Client` transport, gRPC interceptors.
   - Rust SDK: reqwest/axum tower layers.
3. **Inbound extraction**
   - Middleware for each framework to read headers, merge clocks, and set context.
4. **Context merging semantics**
   - On receive, merge vector clocks (element-wise max). Track originating service metadata.

### Testing

- Unit tests for header encode/decode per language.
- Contract tests using captured HTTP fixtures to ensure interoperability.
- Integration tests (each SDK) spinning up a fake service that propagates context to a downstream test server, asserting trace continuity.

**Exit criteria:** All SDKs can forward and receive context over HTTP; gRPC queued for Phase 2.

---

## Phase 2 – Engine & Storage Enhancements

### Engine

- Modify `Event` ingestion to accept optional remote parent references (service, span ID, vector clock).
- Update `CausalGraph`:
  - Allow multiple root nodes per logical trace, merging by trace id.
  - Add support for “external edge” linking events from different services.
  - Handle missing parents gracefully (e.g., dropped headers) with warning edges.

### Vector Clocks

- Extend from per-trace `DashMap<Uuid, u64>` to per-service or per-span component.
- Introduce identifier scheme (service name + instance id) to avoid collisions.
- Keep clocks bounded (evict old components).

### Storage

- Postgres migrations:
  - New table for distributed edges (`distributed_edges`).
  - Indexes for `trace_id` + `service_name`.
  - Optional materialized view for service dependency map.
- Memory backend:
  - Mirror distributed edges in-memory (e.g., `DashMap<(Uuid, Uuid), DistributedEdge>`).

### Routing/Config

- Add server config toggles (`distributed_tracing.enabled`, default false).
- Gracefully reject distributed headers when disabled.

### Testing

- Unit tests for graph merge logic.
- Property tests ensuring vector clock happens-before remains correct after merges.
- Storage tests verifying migrations and retrieval of cross-service data.
- Engine integration test: ingest events from two “services” and ensure graph connectivity.

**Exit criteria:** Core engine can accept distributed events and construct a coherent graph; persisted structures support fetching.

---

## Phase 3 – UI & Analytics

### Terminal UI

- Service-aware trace list (show service count).
- Graph view grouping nodes by service with color coding.
- Critical path spanning services.
- Alert when edges missing (header loss).

### Web UI

- Update service dependency graph to use distributed edges.
- Timeline overlay per service.
- Filters for service/operation.

### API

- `/api/traces/:id` responses include distributed edges and service metadata.
- New endpoints (optional) for service-level metrics (e.g., `/api/services/:name/dependencies`).

### Testing

- Snapshot tests for API payloads.
- Cypress/Playwright flows verifying multi-service trace visualization.
- TUI golden tests (ratatui) verifying layout with distributed data.

**Exit criteria:** Users can inspect multi-service traces end-to-end in both UIs.

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

1. **M0 (Design sign-off)** – approved spec, storage plan, SDK API changes outlined.
2. **M1 (HTTP propagation)** – SDKs send/receive headers; basic engine support behind a feature flag.
3. **M2 (Engine/storage GA)** – distributed traces persisted; API surfaces cross-service data; tests passing.
4. **M3 (UI support)** – TUI/web show multi-service traces; feature flag default-on for beta users.
5. **M4 (Full release)** – gRPC/queues supported; resilience tooling; documentation and sample apps updated.

---

## Documentation & Rollout Tasks

- Update README and docs with configuration and usage instructions.
- Publish sample multi-service demo (docker-compose).
- Release notes per milestone with migration guidance.
- Provide observability guidance (verify context headers in network probes).
