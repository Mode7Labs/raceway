# Architecture

Raceway's architecture consists of several key components working together to provide causality tracking and analysis.

## System Overview

```
┌─────────────────────────────────────┐
│   Application (instrumented)        │
│   - TypeScript/Python/Go/Rust SDK  │
│   - Track events (state, calls)    │
└────────────────┬────────────────────┘
                 │ HTTP POST /events
                 ▼
┌─────────────────────────────────────┐
│   Raceway Server (Rust/Axum)        │
│   ┌───────────────────────────────┐ │
│   │  Event Ingestion Pipeline     │ │
│   │  - Buffering (DashMap)        │ │
│   │  - Vector clock assignment    │ │
│   │  - Validation                 │ │
│   └───────────────────────────────┘ │
│   ┌───────────────────────────────┐ │
│   │  Analysis Engine              │ │
│   │  - Causal graph construction  │ │
│   │  - Race detection (O(m·k²))   │ │
│   │  - Critical path computation  │ │
│   │  - Anomaly detection          │ │
│   └───────────────────────────────┘ │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│   Storage Layer                     │
│   - In-Memory (DashMap)             │
│   - PostgreSQL (sqlx)               │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│   User Interfaces                   │
│   - Web UI (React/Vite)             │
│   - Terminal UI (Ratatui)           │
│   - HTTP API (Axum)                 │
└─────────────────────────────────────┘
```

## Components

### SDK Layer

Client libraries that instrument your application code.

**Technologies:**
- TypeScript: Node.js runtime, async/await support
- Python: Sync and async support, Flask middleware
- Go: Context propagation, net/http middleware
- Rust: Tokio async, procedural macros

**Responsibilities:**
- Track application events
- Maintain trace-local vector clocks
- Buffer events for batch transmission
- Propagate traces across service boundaries

### Server Layer

Core Rust server handling event ingestion and analysis.

**Technologies:**
- **Axum**: HTTP server framework
- **Tokio**: Async runtime
- **DashMap**: Concurrent hash map for in-memory storage
- **sqlx**: Async PostgreSQL driver

**Components:**

#### Event Ingestion
- Receives events via HTTP POST
- Validates event structure
- Assigns/merges vector clocks
- Buffers in memory

#### Analysis Engine
- **Causal Graph**: DAG of event dependencies
- **Race Detector**: O(m·k²) analysis of concurrent accesses
- **Critical Path**: Longest dependency chain
- **Anomaly Detection**: Statistical outlier detection

### Storage Layer

Persistent or ephemeral storage of traces and events.

**Options:**

#### In-Memory (Default)
- **Technology**: DashMap (concurrent hash map)
- **Pros**: Fast, no setup required
- **Cons**: No persistence, limited by RAM
- **Use case**: Development, testing

#### PostgreSQL
- **Technology**: sqlx with async support
- **Pros**: Persistent, scalable, queryable
- **Cons**: Requires database setup
- **Use case**: Production deployments

### UI Layer

User interfaces for visualizing and analyzing traces.

#### Web UI
- **Technology**: React, TypeScript, Vite, shadcn/ui
- **Features**:
  - Real-time trace monitoring
  - Multiple event visualizations (list, tree, timeline, DAG, locks)
  - Critical path analysis
  - Service dependency graphs
  - Variable audit trails
  - Dark/light theme

#### Terminal UI (TUI)
- **Technology**: Ratatui (Rust terminal UI framework)
- **Features**:
  - Keyboard-driven navigation
  - Real-time trace monitoring
  - Multiple analysis views
  - Vim-style bindings

#### HTTP API
- **Technology**: Axum REST endpoints
- **Features**:
  - Event ingestion
  - Trace retrieval
  - Analysis results
  - Service metrics

## Data Flow

### 1. Event Capture

```typescript
// Application code
await raceway.trackStateChange({
  variable: 'balance',
  newValue: 900,
  location: 'api.ts:42',
  accessType: 'Write'
});
```

### 2. Event Transmission

SDK sends to server:
```http
POST /events HTTP/1.1
Content-Type: application/json

{
  "trace_id": "abc123",
  "event_id": "evt-001",
  "kind": "StateChange",
  "vector_clock": {"thread-1": 5},
  "metadata": {...}
}
```

### 3. Server Processing

- Validate event structure
- Merge vector clock
- Store in memory/database
- Add to trace's event list
- Update analysis data structures

### 4. Analysis

On-demand or periodic:
- Construct causal graph
- Detect races
- Compute critical path
- Identify anomalies

### 5. Retrieval

User fetches results:
```http
GET /api/traces/abc123
```

Server returns:
- All events
- Critical path
- Detected races
- Anomalies
- Service dependencies

## Scalability Considerations

### Current Design (v0.1.0)

- **Single server**: No clustering support
- **In-memory buffering**: Limited by RAM
- **Synchronous analysis**: On-demand computation

### Future Improvements (Roadmap)

- **Horizontal scaling**: Multiple server instances
- **Message queue**: Kafka/RabbitMQ for event buffering
- **Incremental analysis**: Update results as events arrive
- **Data retention**: Automatic trace archival
- **Read replicas**: Separate read/write paths

## Security Architecture

### Authentication

Optional API key authentication:
- Bearer token in Authorization header
- Custom `X-Raceway-API-Key` header
- Query parameter `?api_key=...`

### CORS

Configurable cross-origin policies for Web UI.

### Network Binding

Default: `127.0.0.1` (localhost only)
Production: Configure specific interfaces

## Next Steps

- [Configuration](/guide/configuration) - Configure Raceway for your needs
- [Storage Options](/guide/storage) - Choose in-memory or PostgreSQL
- [Security](/guide/security) - Secure your deployment
