# Causeway Architecture

## Overview

Causeway is a distributed causal debugging system that captures, analyzes, and visualizes the complete execution flow of applications across multiple languages and services.

## System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Applications                         │
│  (TypeScript/JavaScript, Rust, Python, Go, etc.)                │
└────────────────────┬────────────────────────────────────────────┘
                     │ Auto-instrumentation
                     ↓
┌─────────────────────────────────────────────────────────────────┐
│                   Instrumentation Layer                          │
│  • TypeScript: AST transformation via Babel                      │
│  • Rust: Procedural macros                                       │
│  • Python: Import hooks                                          │
│  • Captures: Function calls, state changes, async ops, HTTP      │
└────────────────────┬────────────────────────────────────────────┘
                     │ Events (JSON over HTTP/gRPC)
                     ↓
┌─────────────────────────────────────────────────────────────────┐
│                      Causeway Core (Rust)                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Event Capture Engine                                      │  │
│  │ • Lock-free crossbeam channels                            │  │
│  │ • Batched processing                                      │  │
│  │ • 10,000 events/sec per core                              │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Causal Graph Builder                                      │  │
│  │ • Directed acyclic graph (petgraph)                       │  │
│  │ • Vector clocks for causality tracking                    │  │
│  │ • Topological sorting                                     │  │
│  │ • Path finding algorithms                                 │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Trace Context Management                                  │  │
│  │ • Async-aware context propagation                         │  │
│  │ • Distributed trace correlation                           │  │
│  │ • W3C Trace Context compatible                            │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────────────┘
                     │ Graph data
                     ↓
┌─────────────────────────────────────────────────────────────────┐
│                    AI Analysis Layer (Python)                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Anomaly Detection                                         │  │
│  │ • Isolation Forest (scikit-learn)                         │  │
│  │ • Temporal pattern analysis                               │  │
│  │ • Outlier detection                                       │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Race Condition Detection                                  │  │
│  │ • Concurrent state mutation analysis                      │  │
│  │ • Vector clock comparison                                 │  │
│  │ • Dependency graph analysis                               │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Test Case Generation                                      │  │
│  │ • Trace replay synthesis                                  │  │
│  │ • Mock generation                                         │  │
│  │ • Jest/Pytest code generation                             │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────────────┘
                     │ Analysis results
                     ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Visualization Layer                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Terminal UI (Ratatui)                                     │  │
│  │ • Real-time event stream                                  │  │
│  │ • Interactive navigation                                  │  │
│  │ • Anomaly highlighting                                    │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Web UI (React + D3.js)                                    │  │
│  │ • Interactive graph visualization                         │  │
│  │ • Time-travel debugging                                   │  │
│  │ • Flamegraph view                                         │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ CLI Interface                                             │  │
│  │ • Query API                                               │  │
│  │ • Export functionality                                    │  │
│  │ • CI/CD integration                                       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Event Flow

### 1. Capture
```
Application Code
    ↓
Instrumentation intercepts:
  - Function entry/exit
  - Async spawn/await
  - Variable assignments
  - HTTP calls
  - Database queries
    ↓
Event created with:
  - Unique ID
  - Timestamp
  - Parent ID (causal link)
  - Vector clock
  - Metadata
    ↓
Sent to Causeway Core
```

### 2. Processing
```
Event arrives at Core
    ↓
Crossbeam channel (lock-free)
    ↓
Batched (100 events)
    ↓
Added to causal graph
    ↓
Vector clocks updated
    ↓
Edges created based on:
  - Parent-child relationships
  - Data dependencies
  - Happens-before relations
```

### 3. Analysis
```
Graph sent to AI layer
    ↓
Feature extraction:
  - Temporal features
  - Concurrency level
  - Call depth
  - Event types
    ↓
ML models analyze:
  - Isolation Forest → outliers
  - Rule engine → race conditions
  - Pattern matching → known issues
    ↓
Anomalies returned with:
  - Type
  - Confidence score
  - Description
  - Affected events
```

### 4. Visualization
```
User opens TUI/Web UI
    ↓
Query by trace ID
    ↓
Graph rendered with:
  - Topological sort
  - Layout algorithm
  - Color coding by type
  - Highlighting anomalies
    ↓
User navigates:
  - Select event → see details
  - Click anomaly → see cause
  - Time travel → replay state
```

## Data Structures

### Event
```rust
struct Event {
    id: Uuid,
    trace_id: Uuid,
    parent_id: Option<Uuid>,
    timestamp: DateTime<Utc>,
    kind: EventKind,
    metadata: EventMetadata,
    causality_vector: Vec<(Uuid, u64)>,  // Vector clock
}
```

### Causal Graph
```rust
struct CausalGraph {
    graph: DiGraph<Uuid, CausalEdge>,
    nodes: DashMap<Uuid, CausalNode>,
    trace_roots: DashMap<Uuid, Vec<Uuid>>,
}
```

### Anomaly
```python
@dataclass
class Anomaly:
    event_id: str
    anomaly_type: str
    score: float
    description: str
    affected_events: List[str]
    confidence: float
```

## Key Algorithms

### 1. Causal Ordering (Vector Clocks)
```
happened_before(A, B):
    For all i: A.clock[i] <= B.clock[i]
    AND
    Exists j: A.clock[j] < B.clock[j]

concurrent(A, B):
    NOT happened_before(A, B) AND NOT happened_before(B, A)
```

### 2. Race Detection
```
For each variable V:
    events = all state changes to V
    For each pair (A, B) in events:
        If concurrent(A, B):
            REPORT: Race condition on V between A and B
```

### 3. Root Cause Analysis
```
find_root_cause(error_event):
    path = []
    current = error_event
    While current has parent:
        path.prepend(current)
        current = current.parent
    Return path  // Causal chain from root to error
```

## Performance Characteristics

| Component | Throughput | Latency | Memory |
|-----------|-----------|---------|--------|
| Event Capture | 10K events/sec | < 1ms | 10MB buffer |
| Graph Builder | 5K events/sec | < 2ms | O(n) nodes |
| AI Analysis | 1K events/sec | < 100ms | 100MB |
| TUI | 60 FPS | < 16ms | 50MB |

## Distributed Tracing

```
Service A                Service B                Service C
    │                        │                        │
    ├─ HTTP Request ────────→│                        │
    │  (trace_id: abc)       ├─ Process               │
    │                        ├─ HTTP Request ────────→│
    │                        │  (trace_id: abc)       ├─ Process
    │                        │←──────────────────────┤
    │←───────────────────────┤                        │
    │                        │                        │

All events linked by trace_id, causal graph spans services
```

## Security & Privacy

- **Sanitization**: PII automatically redacted
- **Sampling**: Configure capture rate
- **Filtering**: Exclude sensitive paths
- **Encryption**: TLS for event transmission
- **Local-first**: Can run entirely on localhost

## Extensibility

### Custom Event Types
```typescript
causeway.event('custom-event', {
    myData: 'value'
});
```

### Custom Analysis
```python
class CustomDetector(AnomalyDetector):
    def detect_custom_pattern(self, events):
        # Your logic here
        pass
```

### Language Plugins
```
causeway/
  plugins/
    java/
    csharp/
    ruby/
```

## Future Enhancements

- [ ] OpenTelemetry integration
- [ ] Kubernetes operator
- [ ] Cloud-hosted SaaS version
- [ ] LLM-powered root cause explanations
- [ ] Automatic fix suggestions
- [ ] Production profiling mode
- [ ] Integration with APM tools
