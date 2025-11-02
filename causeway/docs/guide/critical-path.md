# Critical Path Analysis

Understand what's slowing down your distributed system by identifying the sequence of dependent operations that determines minimum execution time.

## What is the Critical Path?

The **critical path** is the longest sequence of dependent events from the start to the end of a trace. It represents the **minimum possible execution time** for that operation, assuming infinite parallelism for non-critical operations.

**Key insight**: Optimizing operations that are *not* on the critical path won't improve overall latency—they're already running in parallel with the critical path.

## Why It Matters

### Example: API Request

```
Total execution time: 500ms

Event A: Query users DB      (100ms) ──→ Event B: Join with orders (200ms) ──→ Event D: Format response (150ms)
                                        ↗
Event C: Load from cache       (50ms) ──→

Critical path: A → B → D = 450ms (90% of total time)
Parallelizable: C = 50ms (runs concurrently with A)
```

**Analysis:**
- Critical path duration: 450ms (90% of total)
- Event C: 50ms (not on critical path)

**Optimization strategy:**
- **Don't optimize C**: Even if you make it instant (0ms), total time only drops to 450ms
- **Do optimize A, B, or D**: Each 10% improvement on these saves ~45ms total

**Wrong approach**: "Event C takes 50ms, let's cache it better!"
**Right approach**: "Event B takes 200ms and is on the critical path—let's optimize that join query"

## How Raceway Computes It

### Algorithm

1. **Build causal graph**: Construct directed acyclic graph (DAG) from vector clocks
2. **Find longest path**: Use dynamic programming to find path with maximum total duration
3. **Mark critical events**: All events on this longest path are critical

### Complexity

- **Graph construction**: O(n²) where n = number of events (checking happens-before relationships)
- **Longest path**: O(V + E) where V = events, E = edges (topological sort + DP)

## Viewing Critical Path

### Web UI

1. **Navigate to trace**: Select any trace from the list
2. **Go to Performance tab**: Click "Performance" in the tab bar
3. **View critical path**:
   - **List view**: See critical path events in order with durations
   - **Graph view**: Visualize the DAG with critical path highlighted

**Features:**
- Events on critical path shown in red/orange
- Total critical path duration displayed
- Percentage of total trace time
- Filter by event kind
- Search within path events

### Terminal UI (TUI)

1. **Select trace**: Navigate to your trace
2. **Critical Path view**: Press Tab to switch views
3. **See analysis**:
   - Event list with durations
   - Total path time
   - Percentage of trace

**Keyboard shortcuts:**
- `j/k`: Navigate events
- `Tab`: Switch views
- `Enter`: View event details

### HTTP API

```bash
GET /api/traces/{trace_id}/critical-path
```

**Response:**
```json
{
  "trace_id": "abc123",
  "path_events": 12,
  "total_duration_ms": 450.5,
  "trace_total_duration_ms": 500.0,
  "percentage_of_total": 90.1,
  "path": [
    {
      "id": "evt-001",
      "kind": "DatabaseQuery",
      "timestamp": "2024-11-02T10:30:00.000Z",
      "duration_ms": 100.0,
      "location": "api.ts:42"
    },
    ...
  ]
}
```

## Interpreting Results

### High Critical Path Percentage (>80%)

**Meaning**: Most of your execution time is sequential—little parallelism.

**Implications:**
- Limited opportunity for parallelization
- System is bound by dependent operations
- Optimizing critical path events has direct impact

**Example:**
```
Total: 500ms
Critical path: 480ms (96%)

Operation A (200ms) → B (150ms) → C (130ms)
```

**Action**: Focus on optimizing A, B, and C. Consider if any can be parallelized.

### Low Critical Path Percentage (<50%)

**Meaning**: Lots of work happening in parallel.

**Implications:**
- System is well-parallelized
- Optimizing critical path may not help much
- May need to reduce overall work, not just critical work

**Example:**
```
Total: 500ms
Critical path: 200ms (40%)

Critical: A (100ms) → B (100ms)
Parallel: C (400ms), D (300ms), E (200ms) all run alongside A and B
```

**Action**: Profile parallel operations C, D, E to find inefficiencies.

### Medium Critical Path Percentage (50-80%)

**Meaning**: Mix of sequential and parallel work.

**Implications:**
- Balanced system
- Opportunities for both types of optimization

**Action**:
- Optimize critical path events
- Look for opportunities to parallelize sequential operations

## Optimization Strategies

### 1. Reduce Critical Event Duration

**Identify slow operations on critical path:**

```typescript
// Critical path shows: database query takes 200ms
// Optimize:
- Add database index
- Reduce data fetched
- Cache results
- Use read replica
```

### 2. Parallelize Sequential Operations

**If two operations don't depend on each other, run them in parallel:**

::: code-group

```typescript [Before]
// Sequential (both on critical path)
const user = await db.users.findOne(id);        // 100ms
const orders = await db.orders.findMany(user);  // 150ms
// Total: 250ms
```

```typescript [After]
// Parallel (neither on critical path!)
const [user, ordersPre] = await Promise.all([
  db.users.findOne(id),                         // 100ms
  db.orders.findManyByUserId(id)                // 150ms
]);
// Total: 150ms (max of the two)
```

:::

### 3. Cache Expensive Operations

```typescript
// Before: Every request hits database (on critical path)
const config = await db.config.findOne();  // 50ms

// After: Cache config (removed from critical path)
const config = await cache.get('config') ??
  await db.config.findOne();  // 1ms (cache hit)
```

### 4. Move Work Off Critical Path

**Defer non-essential operations:**

```typescript
// Before: Send email on critical path
await processOrder(order);     // 200ms
await sendConfirmEmail(order); // 100ms (on critical path!)
// Total: 300ms

// After: Queue email for async processing
await processOrder(order);     // 200ms
await queue.publish('send-email', order);  // 1ms
// Total: 201ms (email sent asynchronously)
```

### 5. Service-Level Optimization

**For distributed systems, optimize slow services:**

```
Critical path crosses 3 services:

API Gateway (50ms) → Order Service (300ms) → Payment Service (100ms)

Bottleneck: Order Service (300ms)
```

**Actions:**
- Profile Order Service to find hotspots
- Optimize database queries
- Add caching layer
- Scale horizontally if CPU-bound

## Common Patterns

### Pattern 1: Database Queries on Critical Path

**Problem**: Sequential database queries dominate critical path.

```
User query (100ms) → Orders query (150ms) → Products query (200ms)
Critical path: 450ms
```

**Solutions:**
- Use database joins instead of N+1 queries
- Batch queries with DataLoader pattern
- Denormalize data for read performance
- Add database indexes

### Pattern 2: External API Calls

**Problem**: Slow third-party API on critical path.

```
Validate payment with Stripe (300ms) ← On critical path
```

**Solutions:**
- Cache validation results
- Use webhooks instead of polling
- Implement circuit breaker for failures
- Consider async payment processing

### Pattern 3: CPU-Intensive Operations

**Problem**: Heavy computation on critical path.

```
Image processing (500ms) ← On critical path
```

**Solutions:**
- Move to background job queue
- Use CDN for transforms
- Cache processed results
- Optimize algorithm

## Real-World Example

### E-Commerce Checkout

**Initial analysis:**

```
Critical path (1200ms total):

1. Validate cart items         (100ms)
2. Check inventory             (200ms)
3. Calculate shipping          (150ms)
4. Process payment             (400ms)  ← Bottleneck
5. Create order                (200ms)
6. Send confirmation email     (150ms)
```

**Percentage**: 1200ms / 1300ms = 92% (highly sequential)

**Optimizations applied:**

1. **Parallel operations**:
   ```typescript
   // Before: Sequential
   await checkInventory();
   await calculateShipping();

   // After: Parallel
   await Promise.all([
     checkInventory(),
     calculateShipping()
   ]);
   ```

2. **Async email**:
   ```typescript
   // Before: Synchronous on critical path (150ms)
   await sendConfirmationEmail();

   // After: Queued (1ms)
   await emailQueue.publish(order);
   ```

3. **Payment optimization**:
   ```typescript
   // Moved to faster payment provider
   // Optimized payload size
   // 400ms → 200ms
   ```

**Results:**

```
New critical path (650ms):

1. Validate cart               (100ms)
2. Inventory + Shipping        (200ms)  ← Parallelized
3. Process payment             (200ms)  ← Optimized
4. Create order                (150ms)

Email sent asynchronously (not on critical path)
```

**Improvement**: 1200ms → 650ms (46% faster)
**New percentage**: 650ms / 700ms = 93% (still efficient)

## Best Practices

### 1. Measure Before Optimizing

Always run traces to see the actual critical path—don't guess!

```bash
# Run workload
./run-load-test.sh

# Analyze critical path
curl http://localhost:8080/api/traces/{trace_id}/critical-path
```

### 2. Focus on Biggest Impact

Optimize events with:
- Longest duration on critical path
- Highest frequency (called many times)
- Easiest to optimize (low-hanging fruit)

### 3. Re-measure After Changes

Critical path may change after optimization:

```
Before optimization:
A (300ms) → B (100ms) → C (50ms)
Critical path: A → B → C (450ms)

After optimizing A to 50ms:
A (50ms) → B (100ms) → C (50ms)
Critical path: A → B → C (200ms)

New bottleneck: B (100ms) is now the focus
```

### 4. Consider Cost-Benefit

Sometimes the critical path is acceptable:

```
Critical path: 100ms
Total trace: 105ms
Percentage: 95%

Is optimizing 100ms → 80ms worth the effort?
- Depends on frequency (100 req/s vs 1 req/min)
- Depends on user experience requirements
- Depends on implementation complexity
```

## Distributed Systems Considerations

### Cross-Service Critical Paths

In microservices, critical path often spans multiple services:

```
Frontend (50ms) → API Gateway (20ms) → Auth Service (100ms)
→ Order Service (200ms) → Payment Service (150ms)

Total critical path: 520ms across 5 services
Bottleneck: Order Service (200ms)
```

**Optimization priorities:**
1. Order Service (200ms) - biggest single contributor
2. Payment Service (150ms) - second biggest
3. Auth Service (100ms) - could be cached

### Network Latency

Don't forget network overhead:

```
Service A → [50ms network] → Service B → [50ms network] → Service C

Actual critical path includes network time!
```

**Solutions:**
- Deploy services closer together (same region/AZ)
- Use HTTP/2 or gRPC for better performance
- Batch requests where possible

## Next Steps

- [Anomaly Detection](/guide/anomalies) - Find performance outliers
- [Race Detection](/guide/race-detection) - Find concurrency bugs
- [Web UI](/guide/web-ui) - Visualize critical paths
- [Distributed Tracing](/guide/distributed-tracing) - Track across services
