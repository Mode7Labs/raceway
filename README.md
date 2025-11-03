<p align="center">
  <img src="docs/logo.png" alt="Raceway Logo" width="120" />
</p>

# Raceway

**Deep concurrency analysis and debugging for distributed systems**

Raceway is a causality tracking engine for debugging concurrent and distributed applications. Using vector clocks, it reconstructs the causal order of events across async operations, enabling deep trace analysis, critical path computation, race condition detection, and performance anomaly identification.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Rust](https://img.shields.io/badge/rust-1.70%2B-orange.svg)](https://www.rust-lang.org/)

---

## Core Concept

Raceway captures events from your application (function calls, state changes, locks, HTTP requests) and assigns each a **vector clock timestamp**. This creates a partial ordering of events that respects causality—the happens-before relationship—even across async task migrations and thread boundaries.

**What you can do with this:**
- **Visualize execution**: See the complete causal flow of concurrent operations
- **Find critical paths**: Identify the longest dependency chain affecting latency
- **Detect race conditions**: Discover concurrent accesses to shared state without synchronization
- **Audit variable access**: Trace every read/write to specific variables across the entire execution
- **Analyze anomalies**: Spot performance outliers and unexpected behavior
- **Map service dependencies**: Extract cross-service call graphs from traces

**Key insight**: Traditional debuggers and profilers break down in async systems where operations hop between threads. Raceway's **trace-local vector clocks** follow async tasks across thread migrations, maintaining accurate causality even when `await` moves your code to different threads.

## Architecture

```
┌─────────────────────────────────────┐
│   Application (instrumented)        │
│   client.track_state_change(...)   │
└────────────────┬────────────────────┘
                 │ HTTP POST /events
                 ▼
┌─────────────────────────────────────┐
│   Raceway Server (Rust/Axum)        │
│   - Event ingestion & buffering     │
│   - Vector clock tracking           │
│   - Causal graph construction       │
│   - Race detection (O(m·k²))        │
│   - Critical path analysis          │
│   - Anomaly detection               │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│   Storage                           │
│   - In-Memory (DashMap)             │
│   - PostgreSQL / Supabase           │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│   Analysis Interfaces               │
│   - Terminal UI (Ratatui)           │
│   - Web UI (React)                  │
│   - HTTP API (12 endpoints)         │
└─────────────────────────────────────┘
```

**Tech Stack:**
- **Server**: Rust (Axum, Tokio, petgraph)
- **Storage**: In-memory (DashMap) + PostgreSQL (sqlx)
- **TUI**: Ratatui with keyboard navigation
- **Web UI**: React + TypeScript + Vite
- **SDKs**: Python, TypeScript/Node, Go, Rust

## Quick Start

### Security First

Raceway runs as an HTTP service. If you expose it beyond localhost you should:

1. Enable API key authentication (`auth_enabled = true`, set `api_keys` in `raceway.toml`).
2. Run behind HTTPS (reverse proxy or enable TLS once implemented) so SDKs talk over TLS.
3. Configure rate limiting (`rate_limit_enabled = true`) to avoid abuse.
4. Use environment variables for secrets (e.g. `RACEWAY_API_KEY` referenced in config) and avoid logging confidential data.

Authentication headers:

```http
Authorization: Bearer <api-key>
X-Raceway-Key: <api-key>
```

SDKs will default to sending `Authorization` once you provide `apiKey` in their configuration. The Terminal UI picks up the `RACEWAY_API_KEY` environment variable automatically.

Example configuration:

```toml
[server]
auth_enabled = true
api_keys = ["my-secret-key"]
rate_limit_enabled = true
rate_limit_rpm = 600

[engine]
# ... other settings ...
```

### 1. Start the Server

```bash
git clone https://github.com/mode7labs/raceway
cd raceway
cargo build --release

# Option A: In-memory storage (default)
./target/release/raceway serve

# Option B: PostgreSQL/Supabase persistence
# Edit raceway.toml to configure database connection
./target/release/raceway --config raceway.toml serve
```

Server runs on http://localhost:8080 by default (configurable via `raceway.toml`).

### 2. Choose Your Interface

**Terminal UI (recommended for development):**
```bash
# If your server enforces API keys
export RACEWAY_API_KEY=your-key-here

./target/release/raceway tui
# or during development
cargo run -p raceway -- tui
```

Keyboard shortcuts:
- `j/k` or `↑/↓`: Navigate traces
- `Enter`: View trace details
- `r`: Refresh
- `Tab`: Switch panels (Events, Tree, CriticalPath, Anomalies, Dependencies, AuditTrail)
- `q`: Quit

**Web UI (recommended for sharing):**
```bash
# Start web UI server
cd web

# Copy environment template (first time only)
cp .env.example .env

npm install
npm run dev
# Open http://localhost:5173
```

Features:
- Trace list with search/filtering
- Event timeline visualization
- Causal tree view
- Race condition highlighting
- Critical path analysis
- Performance anomaly detection
- Service dependency graph
- Variable audit trails

### 3. Instrument Your Application

**Python (Flask):**
```python
from raceway import RacewayClient, Config
from raceway.middleware import flask_middleware

client = RacewayClient(Config(
    endpoint="http://localhost:4242",
    service_name="banking-api"
))

middleware = flask_middleware(client)

@app.before_request
def init_raceway():
    middleware.before_request()

@app.after_request
def finish_raceway(response):
    return middleware.after_request(response)

# Track state changes
balance = accounts[user]["balance"]
client.track_state_change(f"{user}.balance", None, balance, "Read")

accounts[user]["balance"] -= amount
client.track_state_change(f"{user}.balance", balance, new_balance, "Write")
```

**TypeScript/Node (Express):**
```typescript
import { Raceway } from '@mode-7/raceway';

const raceway = new Raceway({
  serverUrl: 'http://localhost:4242',
  serviceName: 'banking-api'
});

app.use(raceway.middleware());

raceway.trackStateChange('user.balance', oldValue, newValue, 'Write');
```

**Go (Gin):**
```go
import "github.com/mode7labs/raceway/sdks/go"

client := raceway.New(raceway.Config{
    ServerURL:   "http://localhost:4242",
    ServiceName: "banking-api",
})
defer client.Shutdown()

// Use GinMiddleware for Gin framework
router.Use(client.GinMiddleware())

// Track state changes
client.TrackStateChange(ctx, "user.balance", oldValue, newValue, "main.go:10", "Write")
```

**Rust (Axum):**
```rust
use raceway::{RacewayClient, Config};

let client = RacewayClient::new(Config {
    endpoint: "http://localhost:4242".to_string(),
    service_name: "banking-api".to_string(),
    ..Default::default()
});

client.track_state_change("user.balance", Some(&old), &new, "Write").await?;
```

### 4. Run a Demo

```bash
# Terminal 1: Start server
cargo run -p raceway --release -- serve

# Terminal 2: Run Python banking demo
cd examples/python-banking
pip install -r requirements.txt
PORT=3053 python3 app.py

# Terminal 3: Trigger race condition
# Open http://localhost:3053
# Click "Trigger Race Condition"

# Terminal 4: View results
./target/release/raceway tui
# Or open http://localhost:5173 for Web UI
```

### 5. Verify the Engine

To run the regression test suites locally:

```bash
# Graph-level unit tests (race detection, anomalies, critical path, etc.)
cargo test -p raceway-core graph::tests

# End-to-end harness (ingest → API responses)
cargo test -p raceway-test

# Or use the helper menu
./raceway-dev   # choose option 5 to run both suites
```

## What's Implemented

### Core Analysis Features
- ✅ **Vector clock causality tracking** - Trace-local clocks, async-aware, follows tasks across threads
- ✅ **Distributed tracing** - W3C Trace Context propagation, cross-service trace merging, vector clock sync
- ✅ **Critical path analysis** - Async-aware longest path computation showing execution bottlenecks
- ✅ **Variable audit trails** - Complete access history per variable with causal ordering
- ✅ **Service dependency extraction** - Cross-service call graph from trace data
- ✅ **Anomaly detection** - Statistical analysis (>1.5σ threshold) for performance outliers
- ✅ **Lock set tracking** - Captures locks held at event time for synchronization analysis
- ✅ **Race condition detection** - Optimized O(m·k²) variable indexing to find unsynchronized accesses
- ✅ **Global cross-trace analysis** - Correlate events across different traces

### Storage Backends
- ✅ **In-Memory** - DashMap-based, zero-config
- ✅ **PostgreSQL** - Full async sqlx implementation
- ✅ **Supabase** - Drop-in compatible with PostgreSQL backend

### User Interfaces

**Terminal UI (Ratatui):**
- ✅ Real-time trace list with auto-refresh
- ✅ Event timeline view
- ✅ Causal tree visualization
- ✅ Critical path highlighting
- ✅ Anomaly detection panel
- ✅ Service dependency graph
- ✅ Audit trail view
- ✅ Keyboard navigation (vim-style)
- ✅ Panel switching and focus management

**Web UI (React):**
- ✅ Paginated trace list
- ✅ Event timeline with zoom/pan
- ✅ Tree view of causal relationships
- ✅ Race condition highlighting
- ✅ Performance anomaly charts
- ✅ Service dependency visualization
- ✅ Variable audit trail inspector
- ✅ Trace export (JSON)
- ✅ Dark/light theme
- ✅ Keyboard shortcuts

### HTTP API
12 endpoints:
- `POST /events` - Event ingestion
- `GET /api/traces` - List traces (paginated)
- `GET /api/traces/:id` - Full trace data
- `GET /api/traces/:id/analyze` - Race detection
- `GET /api/traces/:id/critical-path` - Critical path
- `GET /api/traces/:id/anomalies` - Performance anomalies
- `GET /api/traces/:id/dependencies` - Service graph
- `GET /api/traces/:id/audit-trail/:variable` - Variable history
- `GET /api/analyze/global` - Cross-trace races
- `GET /health` - Health check
- `GET /status` - Server statistics

### SDKs
- ✅ **Python** - `raceway` package, Flask/FastAPI middleware
- ✅ **TypeScript/Node** - `@mode-7/raceway` package, Express middleware
- ✅ **Go** - `github.com/mode7labs/raceway/sdks/go`, Gin/net/http middleware
- ✅ **Rust** - `raceway` crate, Axum/Actix support

### Event Types Supported
16 event kinds tracked:
- FunctionCall, AsyncSpawn, AsyncAwait
- StateChange (Read, Write, AtomicRead, AtomicWrite, AtomicRMW)
- LockAcquire, LockRelease
- MemoryFence (Relaxed, Acquire, Release, AcqRel, SeqCst)
- HttpRequest, HttpResponse
- DatabaseQuery, DatabaseResult
- Error, Custom

## How Race Detection Works

### Vector Clock Algorithm

Each event receives a vector clock: `{trace_id -> logical_timestamp}`.

```rust
Event 1: Read  alice.balance  VC = {trace_1: 1}
Event 2: Write alice.balance  VC = {trace_1: 2}
Event 3: Read  alice.balance  VC = {trace_2: 1}  // Different trace!
Event 4: Write alice.balance  VC = {trace_2: 2}
```

**Happens-before relationship:**
- Event A happens-before Event B if:
  - For ALL traces: VC_A[trace] ≤ VC_B[trace]
  - AND at least one trace: VC_A[trace] < VC_B[trace]

**Concurrent events:**
- Events are concurrent if NEITHER happens-before the other
- Example: VC={trace_1:1} vs VC={trace_2:1} → Concurrent (incomparable)

**Race detection:**
```
IF events are concurrent
AND access same variable
AND at least one is a write
AND NOT protected by same lock
→ RACE CONDITION
```

### Optimized Variable Indexing

Instead of O(n²) all-pairs comparison, Raceway uses **variable indexing**:

1. Index StateChange events by variable name
2. For each variable, only compare accesses to that variable
3. Complexity: **O(m·k²)** where:
   - m = number of unique variables
   - k = average accesses per variable (typically << n)

This makes race detection practical even for traces with thousands of events.

### Lock Set Tracking

Raceway captures which locks are held when each event occurs:

```python
# Thread 1
lock.acquire()
balance = account.balance  # Event captured with lock_set = ["account_lock"]
lock.release()
```

If two events share ANY lock in their lock sets, they're serialized (race-safe).

### Example: Banking Race

```python
# Request 1 (trace_1)
balance = accounts["alice"]["balance"]     # Read:  VC={t1:1}, balance=1000
time.sleep(0.01)
accounts["alice"]["balance"] -= 100        # Write: VC={t1:2}, balance=900

# Request 2 (trace_2) - concurrent
balance = accounts["alice"]["balance"]     # Read:  VC={t2:1}, balance=1000
time.sleep(0.01)
accounts["alice"]["balance"] -= 200        # Write: VC={t2:2}, balance=800
```

**Raceway detects:**
1. Read events VC={t1:1} and VC={t2:1} are concurrent ✓
2. Both access `alice.balance` ✓
3. Followed by writes (at least one write) ✓
4. No shared locks ✓
5. → **RACE: Lost $100 update**

## What Needs Work

We're looking for contributors to help with:

### High Priority

**1. Auto-Instrumentation (Partial)**
- ✅ **JavaScript/TypeScript**: Babel plugin fully implemented (`babel-plugin-raceway`)
- ⏳ **Python**: AST transformation or bytecode instrumentation (planned)
- ⏳ **Rust**: Procedural macros for automatic tracking (planned)
- ⏳ **Go**: Compiler plugin or code generation (planned)

**2. Performance Optimization**
- Benchmark suite (missing)
- Connection pooling for database (basic implementation exists)
- Event batching improvements (batching implemented, can be optimized)
- Graph construction parallelization

### Medium Priority

**3. UI Enhancements**
- Web UI search/filter improvements
- Timeline zoom/pan in TUI (basic pan implemented)
- Export formats (JSON implemented, protobuf/MessagePack planned)
- Trace comparison view

**4. Testing**
- Expand unit test coverage (38 tests in core, ~80 in Python SDK)
- Integration tests for race detection (basic tests exist)
- Property-based tests for vector clock invariants
- Performance regression tests

**5. Documentation**
- API reference documentation
- Architecture deep dive
- Troubleshooting guide (basic guide exists)
- Comprehensive tutorials for each SDK

**6. Production Readiness**
- Harden authentication & rate limiting policies
- Sampling and backpressure strategies
- Prometheus/metrics endpoint
- Alerting and on-call integrations

### Nice to Have

**7. Additional Storage Backends**
- MySQL (stubbed)
- SQLite (stubbed)
- ClickHouse for analytics

**8. Advanced Features**
- Deadlock detection (algorithm designed, not implemented)
- Machine learning-based anomaly detection
- Real-time alerting (Slack, Discord, PagerDuty)
- OpenTelemetry integration

**10. Additional SDKs**
- C/C++
- Java/Kotlin
- C# / .NET
- Ruby
- PHP

## Examples

All examples include working demos with race conditions:

- **`examples/python-banking/`** - Flask app with concurrent transfer race
- **`examples/express-banking/`** - Node.js/Express app with read-modify-write races
- **`examples/rust-banking/`** - Axum app demonstrating atomicity violations
- **`examples/go-banking/`** - Gin app with balance update races

Each includes:
- Web UI for triggering races
- Instructions for reproducing
- Expected Raceway output

## Configuration

Create a `raceway.toml` (or copy `raceway.toml.example`) with the fields that are currently supported:

```toml
[server]
host = "127.0.0.1"
port = 8080
verbose = false
cors_enabled = true
cors_origins = ["*"]
rate_limit_enabled = false
rate_limit_rpm = 1000
auth_enabled = false
# api_keys = ["your-secret-key-here"]

[storage]
backend = "memory" # or "postgres" / "supabase"

[storage.postgres]
# connection_string = "postgresql://user:pass@localhost/raceway"
max_connections = 10
min_connections = 2
connection_timeout_seconds = 30
auto_migrate = true

[engine]
buffer_size = 10000
batch_size = 100
flush_interval_ms = 100

[race_detection]
enabled = true

[anomaly_detection]
enabled = true

[logging]
level = "info"
include_modules = false

[development]
cors_allow_all = false
```

Everything else (metrics endpoints, alerting hooks, automatic instrumentation toggles, etc.) is intentionally omitted until those features land. Check the ["What Needs Work"](#what-needs-work) section for ideas on what to build next.

## Performance

**Current benchmarks** (Python SDK, 10k events):
- Event capture: ~2-3ms per operation
- Network transmission: Batched every 100ms
- Server processing: <1ms per event
- Race detection: ~50ms for 1000-event trace
- Critical path: ~10ms for 1000-event trace

**Known bottlenecks:**
- Some SDKs use synchronous HTTP (should be async)
- No connection pooling (each batch opens new connection)
- Graph construction is single-threaded

We need more comprehensive benchmarks.

## Contributing

Raceway is an early-stage project with solid foundations. We welcome contributions!

**Good first issues:**
- Add search/filter to Web UI (`web/src/components/TraceList.tsx`)
- Write unit tests for vector clock logic (`core/src/graph.rs`)
- Improve error handling in SDKs
- Add more event types to capture

**Interesting challenges:**
- Implement auto-instrumentation for Python (AST transformation)
- Add distributed tracing support (trace context propagation)
- Build deadlock detection on top of lock tracking
- Optimize race detection for large traces (>100k events)

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup.

## Technical Details

### Storage Schema (PostgreSQL)

```sql
CREATE TABLE events (
    id UUID PRIMARY KEY,
    trace_id UUID NOT NULL,
    parent_id UUID,
    timestamp TIMESTAMPTZ NOT NULL,
    kind JSONB NOT NULL,
    metadata JSONB,
    causality_vector JSONB NOT NULL,  -- {trace_id: clock_value}
    lock_set JSONB                    -- [lock_ids]
);

CREATE INDEX idx_events_trace_id ON events(trace_id);
CREATE INDEX idx_events_timestamp ON events(timestamp);
```

### Critical Path Algorithm

Raceway's critical path computation is **async-aware**:

```
For each event:
  IF spawns concurrent children:
    duration += MAX(child_durations)  // Concurrent branches
  ELSE:
    duration += SUM(child_durations)  // Sequential execution
```

This correctly handles async/await patterns where multiple promises run concurrently.

### Anomaly Detection

Statistical outlier detection using baseline metrics:

```
For each event kind:
  Compute: mean, stddev, p95, min, max

For each event:
  deviation = (duration - mean) / stddev

  IF deviation > 1.5: Flag as anomaly
    Severity:
      2-3σ: Minor
      3-5σ: Warning
      >5σ:  Critical
```

## Production Deployment

While Raceway is alpha quality and the examples use localhost for demonstration, you can deploy it to production environments with proper configuration.

### Server Configuration

**1. Create Production Config** (`raceway.toml`):

```toml
[server]
host = "0.0.0.0"  # Accept external connections
port = 8080
verbose = false

cors_enabled = true
cors_origins = ["https://your-app.com", "https://your-dashboard.com"]

# Enable rate limiting
rate_limit_enabled = true
rate_limit_rpm = 1000

# Enable API authentication
auth_enabled = true
api_keys = ["your-secret-api-key-here"]

[storage]
backend = "postgres"

[storage.postgres]
connection_string = "postgresql://user:password@db-host:5432/raceway"
max_connections = 20
auto_migrate = true

[engine]
buffer_size = 10000
batch_size = 100
flush_interval_ms = 100

[race_detection]
enabled = true

[anomaly_detection]
enabled = true

[distributed_tracing]
enabled = true

[logging]
level = "info"
```

**2. Start the Server**:

```bash
raceway serve --config raceway.toml
```

### SDK Configuration

Configure SDKs to point to your production Raceway server using environment variables:

**TypeScript/Node.js**:
```typescript
import { Raceway } from '@mode-7/raceway';

const raceway = new Raceway({
  serverUrl: process.env.RACEWAY_URL || 'http://localhost:8080',
  serviceName: 'your-service',
  apiKey: process.env.RACEWAY_KEY,
});
```

**Python**:
```python
from raceway import RacewayClient, Config

raceway = RacewayClient(Config(
    endpoint=os.getenv("RACEWAY_URL", "http://localhost:8080"),
    service_name="your-service",
    api_key=os.getenv("RACEWAY_KEY"),
))
```

**Go**:
```go
racewayClient := raceway.New(raceway.Config{
    ServerURL:   os.Getenv("RACEWAY_URL"),
    ServiceName: "your-service",
    APIKey:      getAPIKey(), // Helper to read from env
})
```

**Rust**:
```rust
let api_key = std::env::var("RACEWAY_KEY").ok();
let endpoint = std::env::var("RACEWAY_URL")
    .unwrap_or_else(|_| "http://localhost:8080".to_string());

let raceway = Arc::new(RacewayClient::new_with_api_key(
    &endpoint,
    "your-service",
    api_key.as_deref(),
));
```

### Environment Variables

Set these in your production environment:

```bash
# Raceway server endpoint
export RACEWAY_URL=https://raceway.your-domain.com

# API authentication key (if auth_enabled = true)
export RACEWAY_KEY=your-secret-api-key-here
```

### Database Setup

**PostgreSQL** (Recommended):

```bash
# Create database
createdb raceway

# Connection string format
postgresql://user:password@host:5432/raceway
```

Raceway will automatically create tables on first run when `auto_migrate = true`.

### Security Considerations

1. **Authentication**: Always enable `auth_enabled = true` in production
2. **CORS**: Set specific origins instead of `["*"]`
3. **Rate Limiting**: Enable rate limiting to prevent abuse
4. **Network**: Use HTTPS/TLS for all connections
5. **Database**: Use strong credentials and encrypted connections
6. **API Keys**: Store keys securely (environment variables, secrets managers)

### Docker Deployment

```dockerfile
FROM rust:1.75 AS builder
WORKDIR /app
COPY . .
RUN cargo build --release --bin raceway

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/raceway /usr/local/bin/
COPY raceway.toml /etc/raceway/raceway.toml
EXPOSE 8080
CMD ["raceway", "serve", "--config", "/etc/raceway/raceway.toml"]
```

```bash
docker build -t raceway:latest .
docker run -p 8080:8080 \
  -e RACEWAY_KEY=your-api-key \
  -e DATABASE_URL=postgresql://... \
  raceway:latest
```

## License

MIT License - see [LICENSE](LICENSE) for details.

## Community

- **Issues**: https://github.com/mode7labs/raceway/issues
- **Discussions**: Questions and ideas welcome
- **Contributing**: See [CONTRIBUTING.md](CONTRIBUTING.md)

---

**Project Status**: Alpha quality, actively developed. Core analysis features work well (causality tracking, distributed tracing, critical path analysis, race detection, anomaly detection, TUI, Web UI, PostgreSQL persistence). Not yet recommended for production use - expect breaking changes. Great for debugging concurrent applications in development/testing environments and for concurrency research.
