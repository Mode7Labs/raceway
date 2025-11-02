# Changelog

All notable changes to Raceway will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2024-11-02

### 🎉 Initial Release

Raceway is a causality tracking engine for debugging concurrent and distributed applications. Using vector clocks, it reconstructs the causal order of events across async operations, enabling deep trace analysis, critical path computation, race condition detection, and performance anomaly identification.

### ✨ Core Features

#### Event Tracking & Causality Analysis
- **Vector Clock Implementation**: Trace-local vector clocks maintain accurate causality across thread migrations
- **Causal Graph Construction**: Automatic reconstruction of happens-before relationships
- **Event Buffering**: Efficient in-memory event storage with DashMap
- **Multi-threaded Processing**: Tokio-based async event ingestion and analysis

#### Race Condition Detection
- **Concurrent Access Analysis**: O(m·k²) algorithm for detecting unsynchronized shared state access
- **Severity Classification**: Critical vs Warning level race conditions
- **Variable-level Tracking**: Per-variable access pattern analysis
- **Cross-trace Detection**: Identify races spanning multiple execution traces

#### Performance Analysis
- **Critical Path Computation**: Identify the longest dependency chain affecting latency
- **Anomaly Detection**: Statistical outlier detection for performance issues
- **Duration Tracking**: Nanosecond-precision event timing
- **Service Breakdown**: Per-service performance metrics

#### Distributed Tracing
- **Service Dependency Mapping**: Automatic extraction of cross-service call graphs
- **Distributed Trace Analysis**: Multi-service execution flow visualization
- **Cross-service Race Detection**: Identify concurrency issues across service boundaries

#### Variable Audit Trails
- **Complete Access History**: Track every read/write to specific variables
- **Cross-trace Variable Tracking**: Follow variable state across multiple traces
- **Thread-aware Analysis**: Understand which threads accessed variables and when
- **Location Tracking**: Capture source location for all variable accesses

### 🖥️ Interfaces

#### Terminal UI (TUI)
- Built with Ratatui for rich terminal experience
- Real-time trace monitoring and analysis
- Keyboard-driven navigation (Vim-style bindings)
- Multiple view modes: Events, Tree, Critical Path, Anomalies, Dependencies, Audit Trail
- Race condition highlighting in event views
- API key authentication support via `RACEWAY_API_KEY` environment variable

**Keyboard Shortcuts:**
- `j/k` or `↑/↓`: Navigate traces
- `Enter`: View trace details
- `r`: Refresh trace list
- `Tab`: Switch between analysis views
- `q`: Quit

#### Web UI
- Modern React + TypeScript interface
- Built with Vite for fast development and production builds
- Five event visualization modes:
  - **List View**: Detailed event list with service badges
  - **Tree View**: Hierarchical parent-child relationships
  - **Timeline View**: Time-based event visualization
  - **Causal Graph View**: DAG visualization of event dependencies
  - **Lock Contention View**: Lock acquisition and blocking analysis
- Critical path visualization with list and graph modes
- Service dependency graph with interactive filtering
- Variable audit trail with cross-trace analysis
- Race condition highlighting and severity indicators
- Dark/light theme support
- Responsive design for mobile and desktop

#### HTTP API
12 REST endpoints for programmatic access:
- `GET /health` - Health check
- `POST /events` - Event ingestion
- `GET /traces` - List all traces (paginated)
- `GET /traces/{trace_id}` - Get trace details
- `GET /traces/{trace_id}/events` - Get trace events
- `GET /traces/{trace_id}/critical-path` - Critical path analysis
- `GET /traces/{trace_id}/anomalies` - Performance anomalies
- `GET /traces/{trace_id}/dependencies` - Service dependencies
- `GET /traces/{trace_id}/audit-trail/{variable}` - Variable audit trail
- `GET /traces/{trace_id}/analysis/distributed` - Distributed analysis
- `GET /races` - Global race conditions
- `GET /services` - Service list with metrics

### 📦 SDKs

#### TypeScript/Node.js SDK (`@mode-7/raceway-node`)
- Express.js middleware for automatic HTTP tracing
- Manual event tracking API
- Lock helper functions with automatic tracking
- Vector clock propagation for distributed traces
- TypeScript type definitions included
- Configurable sampling and buffering
- API key authentication support

**Features:**
- Automatic HTTP request/response tracking
- Function execution tracking
- State change tracking
- Lock acquisition/release tracking
- Error and exception tracking

#### Python SDK (`raceway-python`)
- Flask middleware for automatic HTTP tracing
- Context manager API for scoped tracking
- Decorator support for function tracing
- Vector clock propagation
- Type hints included
- Async/await support
- API key authentication support

**Features:**
- Automatic Flask request/response tracking
- State change tracking
- Lock tracking with context managers
- Exception tracking
- Distributed trace propagation

#### Go SDK (`raceway-go`)
- net/http middleware for automatic HTTP tracing
- Struct-based configuration
- Lock helper functions
- Vector clock propagation
- Context-based trace management
- API key authentication support

**Features:**
- HTTP middleware for Gin, Echo, standard library
- Mutex tracking
- State change tracking
- Distributed trace propagation
- Error tracking

#### Rust SDK (`raceway-rust`)
- Axum middleware for automatic HTTP tracing
- Procedural macros for function instrumentation
- RAII lock guards with automatic tracking
- Vector clock propagation
- Tokio async runtime integration
- API key authentication support

**Features:**
- Automatic HTTP request tracking
- `#[raceway::track]` macro for function tracing
- Smart pointer tracking for state changes
- Mutex/RwLock automatic tracking
- Error propagation tracking

### 🗄️ Storage

#### In-Memory Storage (Default)
- DashMap-based concurrent storage
- No external dependencies
- Fast startup and operation
- Suitable for development and testing

#### PostgreSQL/Supabase Persistence
- Full trace persistence with sqlx
- Efficient indexing for fast queries
- Automatic schema migrations
- Connection pooling
- Suitable for production deployments

### 🔐 Security Features

- **API Key Authentication**: Bearer token and custom header support
- **Rate Limiting**: Configurable requests-per-minute limits
- **CORS Configuration**: Customizable cross-origin policies
- **Environment Variable Support**: Secure credential management
- **Configurable Binding**: Localhost-only by default

### 🛠️ Configuration

- **TOML-based Configuration**: Human-readable `raceway.toml`
- **Environment Variable Overrides**: All settings can be overridden via env vars
- **Flexible Storage Options**: Switch between in-memory and PostgreSQL
- **Tunable Performance Parameters**: Buffer sizes, worker threads, timeouts
- **Development Presets**: Example configurations included

### 📊 Analysis Algorithms

- **Vector Clock Ordering**: Lamport-style vector clocks for causal ordering
- **Critical Path**: Single-pass longest path computation
- **Race Detection**: Pairwise vector clock comparison (O(m·k²))
- **Anomaly Detection**: Statistical outlier detection based on event duration
- **Service Graph**: Topological sorting of service dependencies

### 🧪 Examples

Included example applications demonstrating:
- Banking service with race conditions
- Distributed order processing system
- Lock contention scenarios
- Cross-service tracing
- Variable audit trails

### 📚 Documentation

- Comprehensive README with quick start guide
- API documentation for all SDKs
- Configuration guide
- Security best practices
- Example applications
- Contributing guidelines

### Known Limitations

#### Storage
- **In-memory storage** does not persist across server restarts
- **PostgreSQL storage** requires manual schema setup on first run
- No built-in data retention policies (traces accumulate indefinitely)
- Limited query optimization for large trace datasets (>100k events)

#### Race Detection
- Race detection is **conservative** - may report potential races that are actually safe due to external synchronization
- Does not analyze lock ordering or detect potential deadlocks
- Limited to variables explicitly tracked via SDK calls
- Cannot detect races in untracked code paths

#### Performance
- **TUI refresh rate** is currently fixed (no dynamic adjustment)
- **Web UI** may be slow with traces containing >10,000 events
- Race detection performance degrades with high variable access counts
- No automatic trace archival or summarization

#### Distributed Tracing
- Requires manual trace ID propagation across service boundaries in some cases
- No automatic service discovery
- Clock skew between services not automatically compensated
- Limited support for async message queues (requires manual instrumentation)

#### SDKs
- **Python SDK**: No automatic async context propagation (requires manual tracking)
- **Go SDK**: No automatic goroutine-local context (requires explicit passing)
- **Rust SDK**: Procedural macro compile times can be significant in large projects
- **TypeScript SDK**: No automatic Promise chain tracking

#### Web UI
- No real-time updates (requires manual refresh)
- No collaborative features (annotations, comments)
- Graph visualizations may be slow with >1000 nodes
- Limited mobile optimization

#### API
- No GraphQL endpoint (REST only)
- No built-in API versioning strategy
- Rate limiting is per-server, not per-API-key
- No webhook support for event notifications

#### Deployment
- No official Docker image yet (planned for 0.2.0)
- No Kubernetes helm charts
- No official cloud deployment guides
- Single-server deployment only (no clustering)

### Migration Guide

**N/A** - This is the initial release. No migration required.

### 🙏 Acknowledgments

- Built with Rust, using the excellent Axum, Tokio, and Ratatui libraries
- Inspired by distributed tracing systems like Jaeger and Zipkin
- Vector clock implementation based on Lamport's classic papers

### 📝 Notes

- This is an **alpha release** suitable for development and testing
- Production use is possible but not recommended without thorough evaluation
- Breaking changes may occur in future 0.x releases
- Community feedback is highly encouraged!

### 🚀 What's Next?

See our roadmap for 0.2.0:
- Docker image and container deployment
- WebSocket support for real-time UI updates
- Enhanced race detection with lock ordering analysis
- Automatic trace summarization and archival
- Expanded SDK coverage (Java, C#, Ruby)
- Performance optimizations for large traces
- GraphQL API endpoint

---

[0.1.0]: https://github.com/mode7labs/raceway/releases/tag/v0.1.0
