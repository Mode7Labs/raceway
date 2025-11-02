# Distributed Tracing

Track causality across service boundaries in microservices and distributed systems.

## Overview

**Distributed tracing** tracks execution flow across multiple services, maintaining causal relationships even as requests traverse service boundaries.

**Key features:**
- Automatic trace ID propagation
- Vector clock synchronization across services
- Cross-service race detection
- Service dependency mapping
- End-to-end critical path analysis

## How It Works

### 1. Trace Propagation

When Service A calls Service B, it passes:
- **Trace ID**: Unique identifier for the entire request
- **Vector Clock**: Current causal timestamp

```
┌─────────┐   HTTP Headers:         ┌─────────┐
│Service A│   X-Raceway-Trace-Id    │Service B│
│         │─────X-Raceway-VC────────>│         │
└─────────┘   trace_id=abc123       └─────────┘
              vc={"svc-a": 5}
```

### 2. Vector Clock Merging

Service B receives the vector clock and merges it:

```typescript
// Service A sends: {"service-a": 5}
// Service B receives and merges:
const merged = {
  "service-a": 5,      // From upstream
  "service-b": 1       // Local counter
};
```

This maintains causality: events in B happen-after events in A.

### 3. Cross-Service Analysis

Raceway analyzes the combined trace:
- Events from all services in one view
- Causal relationships preserved
- Race detection across services
- Critical path spanning services

## SDK Integration

### Automatic Propagation

All SDKs automatically propagate traces in HTTP requests:

::: code-group

```typescript [TypeScript/Express]
import { racewayMiddleware } from '@mode-7/raceway';

app.use(racewayMiddleware({
  serviceName: 'api-service',
  serverUrl: 'http://localhost:8080'
}));

// Outgoing requests automatically include headers
await fetch('http://service-b/api', {
  headers: await raceway.getTraceHeaders()
});
```

```python [Python/Flask]
from raceway import raceway_middleware

app.wsgi_app = raceway_middleware(
    app.wsgi_app,
    service_name='api-service',
    server_url='http://localhost:8080'
)

# Outgoing requests
headers = raceway.get_trace_headers()
requests.post('http://service-b/api', headers=headers)
```

```go [Go]
import "github.com/mode7labs/raceway/sdks/go/raceway"

// Middleware
r.Use(raceway.Middleware(client))

// Outgoing requests
headers := client.GetTraceHeaders()
req.Header.Set("X-Raceway-Trace-Id", headers["X-Raceway-Trace-Id"])
```

```rust [Rust/Axum]
use raceway_client::middleware::RacewayLayer;

let app = Router::new()
    .layer(RacewayLayer::new(client));

// Outgoing requests
let headers = client.get_trace_headers().await;
```

:::

## Service Dependency Graph

Raceway automatically builds a service dependency graph:

```
┌──────────┐
│ Frontend │
└─────┬────┘
      │
      ▼
┌──────────┐    ┌──────────────┐
│   API    │───>│ Auth Service │
└─────┬────┘    └──────────────┘
      │
      ├────────>┌───────────────┐
      │         │ Order Service │
      │         └───────┬───────┘
      │                 │
      │                 ▼
      │         ┌────────────────┐
      └────────>│Payment Service │
                └────────────────┘
```

**View in Web UI:**
1. Go to "Insights" → "Dependency Graph"
2. See visual service graph
3. Click services to filter
4. View call counts and latencies

## Cross-Service Race Detection

Races can occur across services:

```typescript
// Service A: Inventory Service
const stock = await db.query('SELECT stock FROM products WHERE id = ?');
// stock = 10

// Service B: Order Service (concurrent!)
const stock = await db.query('SELECT stock FROM products WHERE id = ?');
// stock = 10 (same value!)

// Both decrement
await db.query('UPDATE products SET stock = ? WHERE id = ?', stock - 1);
```

**Raceway detects:**
- Two services read same database value concurrently
- Both write back  decremented value
- Race condition across services!

## Distributed Critical Path

Critical path in distributed systems spans services:

```
Total: 850ms

Frontend (50ms) → API (100ms) → Auth (150ms)
                              ↘
                                Order (300ms) → Payment (250ms)

Critical path: 850ms
  Frontend → API → Auth → Order → Payment
```

**Optimization:** Payment Service (250ms) is biggest contributor—optimize it first.

## Best Practices

### 1. Always Propagate Traces

Never break the trace chain:

```typescript
// Bad: Headers not propagated
await fetch('http://service-b/api');

// Good: Headers included
await fetch('http://service-b/api', {
  headers: await raceway.getTraceHeaders()
});
```

### 2. Name Services Consistently

Use consistent naming:

```typescript
// Good
serviceName: 'order-service'
serviceName: 'payment-service'

// Bad
serviceName: 'OrderSvc'
serviceName: 'payments'
```

### 3. Automatic Trace Creation

The middleware automatically handles requests without trace headers:

- If incoming headers contain a trace ID, the trace is joined
- If no trace ID exists, a new root trace is created automatically
- No manual intervention needed

### 4. Monitor Service Health

Use distributed traces to:
- Identify slow services
- Detect cascading failures
- Find service bottlenecks
- Track error propagation

## Troubleshooting

### Broken Trace Chains

**Symptom:** Trace shows some services but not others

**Causes:**
- Headers not propagated
- Service not instrumented
- Different trace IDs used

**Solution:**
- Verify header propagation
- Check all services have SDK
- Debug header values

### Clock Skew

**Symptom:** Events appear in wrong order

**Causes:**
- Large clock differences between servers
- Timestamps used instead of vector clocks

**Solution:**
- Sync server clocks (NTP)
- Rely on vector clocks, not timestamps
- Deploy services in same region

## Next Steps

- [Critical Path](/guide/critical-path) - Distributed critical paths
- [Race Detection](/guide/race-detection) - Cross-service races
- [Services API](/api/services) - Service metrics and dependencies
- [SDKs](/sdks/overview) - Integration guides
