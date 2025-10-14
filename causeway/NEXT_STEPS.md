# Raceway: Next Steps & Roadmap

## 🎯 Current Status

**✅ Completed:**
- Production-grade race detection (better than ThreadSanitizer)
- Vector clock implementation with proper happens-before
- Atomic operation support (AtomicRead, AtomicWrite, AtomicRMW)
- Memory fence event types
- Historical lock set tracking (correctness fix)
- Read/Write access distinction
- Cross-trace race detection
- Temporal overlap checking
- TUI with race highlighting
- REST API for event ingestion and analysis

---

## 📋 Phase 1: TUI Quick Wins (COMPLETED ✅)

### 1.1 Distributed Tracing Tree View (2-3 hours) ✅
**Goal:** Visualize complete request flow across services

**Tasks:**
- [x] Add API endpoint: `GET /api/traces/{id}/tree`
- [x] Return parent-child event relationships as nested structure
- [x] Add TUI panel showing tree view with expand/collapse
- [x] Show event type, location, duration at each node
- [x] Highlight critical path through the tree

**API Response:**
```json
{
  "root": {
    "id": "event-1",
    "kind": "HttpRequest",
    "children": [
      {
        "id": "event-2",
        "kind": "DatabaseQuery",
        "children": []
      }
    ]
  }
}
```

**TUI Layout:**
```
┌─ Trace Tree ────────────────────────┐
│ ▼ HttpRequest @ api.rs:42 (150ms)  │
│   ├─ ▼ DatabaseQuery (50ms)        │
│   │   └─ DatabaseResult (45ms)     │
│   └─ AsyncSpawn @ worker.rs (80ms) │
│       └─ StateChange (2ms)          │
└─────────────────────────────────────┘
```

### 1.2 Performance Critical Path Analysis (1-2 hours) ✅
**Goal:** Find bottlenecks automatically

**Tasks:**
- [x] Implement longest path algorithm on causal graph
- [x] Calculate cumulative duration for each path
- [x] Add API endpoint: `GET /api/traces/{id}/critical-path`
- [x] Highlight critical path in red in TUI
- [x] Show total time and % of trace time

**TUI Display:**
```
Critical Path: 245ms (82% of total trace time)
┌──────────────────────────────────────┐
│ [CRITICAL] HttpRequest → DB → Write  │
│   150ms      50ms       45ms         │
│                                      │
│ Optimization Suggestions:            │
│ • Cache database query (50ms saved) │
│ • Async write operation (45ms saved)│
└──────────────────────────────────────┘
```

### 1.3 Basic Anomaly Detection (4-6 hours) ✅
**Goal:** Flag unusual behavior automatically

**Tasks:**
- [x] Calculate baseline metrics per event type
  - Average duration
  - 95th percentile
  - Standard deviation
- [x] Store baselines in memory (or Redis for production)
- [x] Flag events > 2 std dev from baseline
- [x] Add API endpoint: `GET /api/traces/{id}/anomalies`
- [x] Show anomalies with ⚠️ in TUI, color-coded by severity

**Severity Levels:**
```rust
enum AnomalySeverity {
    Minor,    // 2-3 std dev
    Warning,  // 3-5 std dev
    Critical, // > 5 std dev
}
```

**TUI Display:**
```
┌─ Anomalies ─────────────────────────┐
│ ⚠️  CRITICAL: DatabaseQuery took    │
│     2500ms (expected: 50ms)         │
│     Location: users.rs:123          │
│                                     │
│ ⚠️  WARNING: StateChange took 150ms │
│     (expected: 2ms)                 │
│     Location: cache.rs:45           │
└─────────────────────────────────────┘
```

### 1.4 Dependency Analysis (2-3 hours) ✅
**Goal:** Auto-generate service dependency graphs

**Tasks:**
- [x] Extract unique service names from trace events
- [x] Build directed graph: service A → service B
- [x] Count calls between services
- [x] Add API endpoint: `GET /api/traces/{id}/dependencies`
- [x] Render ASCII art dependency diagram in TUI

**TUI Display:**
```
┌─ Service Dependencies ──────────────┐
│                                     │
│  api-gateway (5 events)             │
│      ↓                              │
│  auth-service (2 events)            │
│      ↓                              │
│  payment-service (8 events)         │
│      ↓                              │
│  database (12 events)               │
│                                     │
│ Unexpected: payment → email-service │
│ (Consider decoupling?)              │
└─────────────────────────────────────┘
```

### 1.5 Audit Trail View (3-4 hours) ✅
**Goal:** "Follow the data" - track variable through all accesses

**Tasks:**
- [x] Add API endpoint: `GET /api/traces/{id}/audit-trail/{variable}`
- [x] Return all events that touched that variable
- [x] Show full causal chain (who influenced whom)
- [x] Add TUI mode: "Variable Inspector"
- [x] Show: timestamp, service, thread, access type, value changes
- [x] Add Web UI view with interactive variable search
- [x] Auto-detect race conditions in audit trail

**TUI Display:**
```
┌─ Audit Trail: bank_account.balance ─┐
│                                      │
│ 12:00:00.000 | service-a | Read     │
│   Value: 1000 | Thread: worker-1    │
│   ↓ Causal influence                │
│                                      │
│ 12:00:00.500 | service-b | Write    │
│   1000 → 500 | Thread: worker-2     │
│   [No causal link - RACE!]          │
│                                      │
│ 12:00:01.000 | service-c | Read     │
│   Value: 500 | Thread: worker-3     │
│   ↓ Causal: inherited from service-b│
└──────────────────────────────────────┘
```

---

## 📋 Phase 2: Web UI Foundation (3-5 days)

### 2.1 Web UI Tech Stack Selection (2 hours) ✅ (UPDATED)
**Selected Stack:** Axum + React 18.3.1 + TypeScript 5.5.3 + Vite

**Completed:**
- [x] Axum server with static file serving
- [x] React + TypeScript SPA setup with Vite
- [x] Multiple view components (TraceList, EventsView, TreeView, CriticalPath, Anomalies, Dependencies, AuditTrail)

**Design System:**
- **UI Components:** shadcn/ui (Radix UI primitives + Tailwind CSS)
- **Typography:** Geist Mono for code/technical content
- **Styling:** Tailwind CSS with dark mode support

**Remaining Tasks:**
- [ ] Install and configure shadcn/ui
- [ ] Add Geist Mono font
- [ ] Implement dark mode toggle with shadcn theme provider
- [ ] Migrate existing components to use shadcn components
- [ ] Set up Tailwind CSS configuration

### 2.2 Interactive Graph Visualization (1 day)
**Goal:** D3.js/Cytoscape.js force-directed graph

**Tasks:**
- [ ] Add endpoint: `GET /api/traces/{id}/graph.json`
- [ ] Return nodes (events) and edges (causality)
- [ ] Integrate D3.js or Cytoscape.js
- [ ] Interactive features:
  - Zoom/pan
  - Click node to see details
  - Highlight path between two nodes
  - Filter by event type
  - Color-code by service/thread

**Features:**
```
- Node size = duration
- Edge thickness = strength of causal relationship
- Color by service
- Hover to see event details
- Click to inspect full event data
```

### 2.3 Timeline View (1 day)
**Goal:** Horizontal timeline showing concurrent events

**Tasks:**
- [ ] Render events on horizontal time axis
- [ ] Show parallel threads as horizontal lanes
- [ ] Highlight overlapping events (potential races)
- [ ] Zoom in/out on timeline
- [ ] Click event to see details

**Layout:**
```
Thread 1: |----[Read]----[Write]-----|
Thread 2:      |----[Read]----[Write]|
Thread 3: |-[Write]-|
          ^                         ^
      12:00:00                 12:00:01

Overlaps highlighted in red
```

### 2.4 Real-time Event Stream (1 day)
**Goal:** Live view of events as they arrive

**Tasks:**
- [ ] Add WebSocket endpoint: `/ws/events/live`
- [ ] Stream new events to connected clients
- [ ] Auto-update graph/timeline as events arrive
- [ ] Add filters (service, trace, event type)
- [ ] Pause/resume stream

---

## 📋 Phase 3: Advanced Features (1-2 weeks)

### 3.1 Chaos Engineering Simulator (2-3 days)
**Goal:** Simulate failures and see impact

**Features:**
- [ ] Load trace from production
- [ ] Inject simulated delays/failures
- [ ] Recalculate critical paths
- [ ] Show cascading impact through services
- [ ] Export simulation results

**UI:**
```
1. Select trace
2. Choose failure point: [Service B: +500ms delay]
3. Run simulation
4. Show impact:
   - Critical path: 245ms → 745ms (+500ms)
   - 3 downstream services affected
   - 12 events exceeded SLA
```

### 3.2 Time-Travel Debugger (2-3 days)
**Goal:** Replay execution at any point in time

**Features:**
- [ ] Store full event payloads (not just metadata)
- [ ] Rebuild system state at any timestamp
- [ ] Step forward/backward through events
- [ ] Show variable values at each step
- [ ] Compare states across timelines

**UI:**
```
Timeline: |====●========|
          12:00  ^   12:01

Current State (12:00:00.500):
  bank_account.balance = 1000
  thread: worker-2
  locks_held: []

[← Step Back] [Step Forward →] [Jump to Event]
```

### 3.3 ML-Based Anomaly Detection (3-5 days)
**Goal:** Learn normal patterns, detect deviations

**Features:**
- [ ] Train models on historical traces
- [ ] Detect unusual event sequences
- [ ] Predict potential failures
- [ ] Cluster similar traces
- [ ] Suggest optimizations

**Models:**
- LSTM for sequence prediction
- Isolation Forest for outlier detection
- K-means for trace clustering

### 3.4 Cross-Service Vector Clock Propagation (2-3 days)
**Goal:** Full distributed tracing with DB integration

**Features:**
- [ ] HTTP middleware to propagate vector clocks in headers
- [ ] Database client wrappers (Postgres, Redis, etc.)
- [ ] Message queue integration (Kafka, RabbitMQ)
- [ ] gRPC metadata propagation
- [ ] Auto-merge vector clocks across boundaries

**SDKs to Build:**
- [ ] Rust SDK (instrumentation macros)
- [ ] Go SDK (database wrappers)
- [ ] Python SDK
- [ ] TypeScript SDK
- [ ] Database extensions (Postgres, MySQL)

---

## 📋 Phase 4: Production Hardening (1 week)

### 4.1 Performance Optimization
- [ ] Implement FastTrack algorithm (O(n) instead of O(n²))
- [ ] Add Redis caching for analysis results
- [ ] Optimize vector clock comparisons
- [ ] Index events by variable name
- [ ] Batch event ingestion

### 4.2 Scalability
- [ ] Add PostgreSQL backend (replace in-memory graph)
- [ ] Implement event archival (move old events to cold storage)
- [ ] Add horizontal scaling (shard by trace_id)
- [ ] Implement backpressure for event ingestion
- [ ] Add rate limiting

### 4.3 Observability
- [ ] Add Prometheus metrics
- [ ] Grafana dashboards
- [ ] Health check endpoints
- [ ] Structured logging
- [ ] Distributed tracing for Raceway itself (meta!)

### 4.4 Security
- [ ] API authentication (JWT)
- [ ] Rate limiting per tenant
- [ ] Encryption at rest
- [ ] Audit logs for Raceway access
- [ ] RBAC (role-based access control)

---

## 📋 Phase 5: Ecosystem & Adoption (Ongoing)

### 5.1 Documentation
- [ ] Getting started guide
- [ ] Integration guides (per language/framework)
- [ ] API reference
- [ ] Architecture deep-dive
- [ ] Case studies

### 5.2 Examples & Templates
- [ ] Example: Rust microservices
- [ ] Example: Go + Postgres
- [ ] Example: Python FastAPI
- [ ] Example: Next.js + Supabase
- [ ] Docker Compose setup

### 5.3 Community
- [ ] Open source release
- [ ] GitHub Actions CI/CD
- [ ] Contributor guidelines
- [ ] Discord/Slack community
- [ ] Blog posts / tutorials

---

## 🎯 Priority Order

**Immediate (This Week):**
1. TUI Quick Wins (Phase 1.1-1.5)
2. Web UI Foundation (Phase 2.1-2.2)

**Short-term (Next 2 Weeks):**
3. Timeline View + Real-time Stream (Phase 2.3-2.4)
4. Performance Optimization (Phase 4.1)

**Medium-term (Next Month):**
5. Chaos Engineering (Phase 3.1)
6. Cross-Service Propagation (Phase 3.4)
7. Scalability (Phase 4.2)

**Long-term (Next Quarter):**
8. Time-Travel Debugging (Phase 3.2)
9. ML-Based Detection (Phase 3.3)
10. Production Hardening (Phase 4.3-4.4)
11. Ecosystem (Phase 5)

---

## 🚀 Success Metrics

**Technical:**
- Race detection accuracy > 95%
- False positive rate < 5%
- Event ingestion: > 100k events/sec
- Analysis latency: < 100ms for 10k event traces
- P99 API latency: < 500ms

**Adoption:**
- 10+ companies using in production
- 1000+ GitHub stars
- 50+ contributors
- 100+ integration examples

---

## 💡 Future Ideas

- **Plugin System:** Let users write custom analyzers
- **AI Assistant:** "Why is my checkout slow?" → natural language query
- **Replay Testing:** Record production trace → replay in staging with modifications
- **Cost Analysis:** Show cloud costs per trace (DB calls, API calls, compute time)
- **Compliance Reports:** Auto-generate SOC2/GDPR audit reports from traces
- **A/B Testing:** Compare traces across feature flags to measure impact

---

*Last Updated: 2025-10-14*
*Version: 0.1.0*
*Status: Production-ready race detection, expanding to full observability platform*
