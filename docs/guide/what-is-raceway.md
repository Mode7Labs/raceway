# What is Raceway?

Raceway is a **causality tracking engine** for debugging concurrent and distributed applications. It uses vector clocks to reconstruct the causal order of events across async operations, enabling deep trace analysis, critical path computation, race condition detection, and performance anomaly identification.

## The Problem

Traditional debuggers and profilers struggle with modern async systems:

- **Thread migration**: `await` moves execution between threads, breaking traditional debugging
- **Concurrent races**: Race conditions only appear under specific execution orders
- **Distributed complexity**: Understanding causality across services is nearly impossible
- **Performance mysteries**: Why is this request slow? What's the critical path?

## The Solution

Raceway captures events from your application and assigns each a **vector clock timestamp**. This creates a partial ordering of events that respects causality—the happens-before relationship—even across async task migrations and thread boundaries.

### Key Insight

**Trace-local vector clocks** follow async tasks across thread migrations, maintaining accurate causality even when `await` moves your code to different threads.

## What You Can Do

- **Visualize execution**: See the complete causal flow of concurrent operations
- **Find critical paths**: Identify the longest dependency chain affecting latency
- **Detect race conditions**: Discover concurrent accesses to shared state without synchronization
- **Audit variable access**: Trace every read/write to specific variables across the entire execution
- **Analyze anomalies**: Spot performance outliers and unexpected behavior
- **Map service dependencies**: Extract cross-service call graphs from traces

## How It Works

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
│   Analysis & Visualization          │
│   - Web UI (React/TypeScript)       │
│   - Terminal UI (Ratatui)           │
│   - HTTP API                        │
└─────────────────────────────────────┘
```

## Use Cases

### 1. Banking Application Race Condition

```typescript
// Two concurrent transfers from Alice's account
// Without proper locking, money gets lost!

// Thread 1: Transfer $100
const balance = account.balance; // Read: 1000
account.balance = balance - 100;  // Write: 900

// Thread 2: Transfer $200 (happens concurrently!)
const balance = account.balance; // Read: 1000 (still!)
account.balance = balance - 200;  // Write: 800 (overwrites!)

// Expected: $700, Actual: $800 (lost $100!)
```

**Raceway detects this race** by analyzing vector clocks:
- Both reads have no happens-before relationship
- Both writes access the same variable
- No synchronization between them
- **Race condition identified!**

### 2. Distributed Order Processing

Track an order across multiple services:
- Frontend → API Gateway → Order Service → Payment Service → Inventory Service
- See exact causality chain
- Identify critical path (which service is the bottleneck?)
- Detect cross-service race conditions

### 3. Performance Investigation

Your API sometimes takes 2 seconds instead of 200ms. Why?

Raceway shows you:
- The critical path (longest dependency chain)
- Which operations are on the critical path
- Anomalies (operations that took unusually long)
- Service dependencies (which service is the bottleneck)

## Next Steps

- [Getting Started](/guide/getting-started) - Install and run Raceway
- [Core Concepts](/guide/core-concepts) - Understand vector clocks and causality
- [SDKs](/sdks/overview) - Choose your language and start instrumenting
