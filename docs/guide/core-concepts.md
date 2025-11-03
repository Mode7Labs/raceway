# Core Concepts

Understanding the fundamentals of Raceway's causality tracking.

## Vector Clocks

A **vector clock** is a data structure that tracks causality in distributed systems. Unlike physical timestamps, vector clocks capture the happens-before relationship between events.

### How Vector Clocks Work

Each trace maintains a vector clock: a map from thread/task IDs to logical timestamps.

```typescript
// Example vector clock
{
  "thread-1": 5,
  "thread-2": 3,
  "async-task-abc": 12
}
```

When an event occurs:
1. The current thread/task increments its counter
2. The event is tagged with the current vector clock
3. When communicating (HTTP, message passing, etc.), the vector clock is sent
4. The receiver merges the vector clocks (takes the max of each component)

### Happens-Before Relationship

Event A **happens-before** event B (`A → B`) if:
- `A.vector_clock[i] ≤ B.vector_clock[i]` for all components `i`
- `A.vector_clock[j] < B.vector_clock[j]` for at least one component `j`

If neither `A → B` nor `B → A`, then A and B are **concurrent**.

### Example

```typescript
// Thread 1
Event A: { thread-1: 1 }  // Write to balance
Event B: { thread-1: 2 }  // A → B (happened before)

// Thread 2 (concurrent)
Event C: { thread-2: 1 }  // Write to balance
Event D: { thread-2: 2 }  // C → D (happened before)

// A and C are concurrent! (potential race)
// B and D are concurrent! (potential race)
```

## Trace-Local Vector Clocks

Raceway's key innovation: **trace-local** vector clocks that follow async operations.

### The Problem with Traditional Approaches

```typescript
// Traditional: vector clock per physical thread
async function handler(req) {
  await db.query('SELECT ...');  // Moves to different thread!
  // Lost causality tracking!
}
```

When `await` suspends, the continuation often runs on a different thread. Traditional per-thread vector clocks lose track.

### Raceway's Solution

```typescript
// Raceway: vector clock follows the trace
async function handler(req) {
  const trace = raceway.getTrace(); // Trace-local storage
  await db.query('SELECT ...');     // Clock follows the trace!
  // Causality preserved!
}
```

The vector clock is stored in **trace-local storage** (similar to thread-local storage, but for async traces), ensuring causality is maintained across thread migrations.

## Events

Everything in Raceway is an **event**. Events have:

- **ID**: Unique identifier
- **Trace ID**: Which trace this event belongs to
- **Kind**: Type of event (StateChange, FunctionCall, HttpRequest, etc.)
- **Timestamp**: Physical time (for visualization)
- **Vector Clock**: Logical time (for causality)
- **Location**: Source code location
- **Metadata**: Additional context (variable name, values, etc.)

### Event Types

| Event Type | Description | Example |
|------------|-------------|---------|
| `StateChange` | Read or write to a variable | `user.balance = 900` |
| `FunctionCall` | Function entry/exit | `processPayment()` |
| `HttpRequest` | HTTP request/response | `POST /api/transfer` |
| `LockAcquire` | Lock acquisition | `mutex.lock()` |
| `LockRelease` | Lock release | `mutex.unlock()` |
| `Error` | Exception or error | `throw new Error()` |

## Causal Graph

The **causal graph** is a directed acyclic graph (DAG) where:
- **Nodes** = Events
- **Edges** = Happens-before relationships

```
Event A ──→ Event B ──→ Event D
           ↗
Event C ──→
```

This graph enables:
- **Critical path analysis**: Longest path from start to end
- **Parallel execution detection**: Events with no path between them
- **Dependency visualization**: See what depends on what

## Race Detection

A **race condition** occurs when:
1. Two or more events access the same variable
2. At least one access is a write
3. The events are concurrent (no happens-before relationship)
4. No synchronization protects the accesses

### Detection Algorithm

```
For each variable V:
  For each pair of accesses (A, B) to V:
    If (A is Write OR B is Write) AND concurrent(A, B):
      Report race: (A, B, V)
```

**Complexity**: O(m·k²) where m = number of variables, k = average accesses per variable

### Severity Classification

- **Critical**: Two writes to the same variable (data corruption likely)
- **Warning**: Read and write (may see inconsistent state)

## Critical Path

The **critical path** is the longest sequence of dependent events from trace start to end. It represents the minimum execution time.

### Why It Matters

```
Total execution time: 500ms

Event A (100ms) ──→ Event B (200ms) ──→ Event D (150ms)
                   ↗
Event C (50ms)  ──→

Critical path: A → B → D (450ms)
Parallelizable: C (50ms runs concurrently with A)
```

**Insight**: Optimizing Event C won't improve overall latency (it's not on the critical path). Focus on A, B, or D instead.

## Distributed Tracing

Raceway extends to distributed systems by propagating vector clocks across service boundaries.

### HTTP Header Propagation

```
Service A ──[HTTP + vector clock]──→ Service B

Request headers:
  X-Raceway-Trace-Id: abc123
  X-Raceway-Vector-Clock: {"service-a": 5}

Service B merges vector clocks:
  {"service-a": 5, "service-b": 1}
```

This maintains causal ordering across services!

## Next Steps

- **[Race Detection](/guide/race-detection)** - Deep dive into race detection
- **[Critical Path Analysis](/guide/critical-path)** - Understand performance bottlenecks
- **[Security Guide](/guide/security)** - Best practices and security
