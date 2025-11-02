# SDK Overview

Raceway provides first-class SDKs for TypeScript, Python, Go, and Rust.

## Available SDKs

| Language | Package | Installation | Docs |
|----------|---------|--------------|------|
| **TypeScript/Node.js** | `@mode-7/raceway` | `npm install @mode-7/raceway` | [Docs](/sdks/typescript) |
| **Python** | `raceway` | `pip install raceway` | [Docs](/sdks/python) |
| **Go** | `github.com/mode7labs/raceway/sdks/go` | `go get github.com/mode7labs/raceway/sdks/go` | [Docs](/sdks/go) |
| **Rust** | `raceway-client` | `cargo add raceway-client` | [Docs](/sdks/rust) |

## Common Features

All SDKs provide:

- **Manual Event Tracking**: Explicitly track state changes, function calls, etc.
- **Vector Clock Management**: Automatic trace-local vector clock handling
- **Distributed Tracing**: Propagate traces across service boundaries
- **Lock Tracking**: Monitor lock acquisition and contention
- **Buffering**: Efficient batching of events before sending to server
- **Error Handling**: Graceful degradation if server is unavailable

## Framework-Specific Features

### TypeScript/Node.js
- **Express.js middleware**: Automatic HTTP request tracking
- **Proxy-based tracking**: Automatic object change detection
- **Lock helpers**: Promise-based mutex with automatic tracking

### Python
- **Flask middleware**: Automatic HTTP request tracking
- **Decorators**: `@raceway.track` for function instrumentation
- **Context managers**: `with raceway.track_lock()` for scoped tracking

### Go
- **net/http middleware**: Automatic HTTP request tracking
- **Context propagation**: Pass traces through `context.Context`
- **Struct-based configuration**: Type-safe setup

### Rust
- **Axum middleware**: Automatic HTTP request tracking
- **Procedural macros**: `#[raceway::track]` for function instrumentation
- **RAII guards**: Automatic lock tracking with guard types
- **Tokio integration**: Async runtime support

## Quick Comparison

::: code-group

```typescript [TypeScript]
import { RacewayClient } from '@mode-7/raceway';

const client = new RacewayClient({
  serviceName: 'my-service',
  serverUrl: 'http://localhost:8080'
});

await client.trackStateChange({
  variable: 'counter',
  newValue: 42,
  location: 'app.ts:10',
  accessType: 'Write'
});
```

```python [Python]
from raceway import RacewayClient

client = RacewayClient(
    service_name="my-service",
    server_url="http://localhost:8080"
)

client.track_state_change(
    variable="counter",
    new_value=42,
    location="app.py:10",
    access_type="Write"
)
```

```go [Go]
import "github.com/mode7labs/raceway/sdks/go/raceway"

client := raceway.NewClient(raceway.Config{
    ServiceName: "my-service",
    ServerURL:   "http://localhost:8080",
})

client.TrackStateChange(raceway.StateChange{
    Variable:   "counter",
    NewValue:   "42",
    Location:   "main.go:10",
    AccessType: "Write",
})
```

```rust [Rust]
use raceway_client::{RacewayClient, Config};

let client = RacewayClient::new(Config {
    service_name: "my-service".to_string(),
    server_url: "http://localhost:8080".to_string(),
    ..Default::default()
});

client.track_state_change(
    "counter",
    None,
    "42",
    "main.rs:10",
    "Write"
).await;
```

:::

## Choosing an SDK

Pick the SDK that matches your application's language:

- **Building a Node.js API?** → TypeScript SDK
- **Flask or FastAPI app?** → Python SDK
- **Go microservice?** → Go SDK
- **Rust backend?** → Rust SDK

All SDKs have feature parity, so choose based on your language, not features.

## Common Patterns

### Trace Lifecycle

All SDKs follow the same pattern:

1. **Start trace**: Begin tracking a new execution
2. **Track events**: Capture state changes, function calls, etc.
3. **End trace**: Flush events to the server

### Distributed Tracing

When making cross-service calls, propagate the trace:

::: code-group

```typescript [TypeScript]
// Service A: Add headers to outgoing request
const headers = await client.getTraceHeaders();
await fetch('http://service-b/api', { headers });
```

```python [Python]
# Service A: Add headers to outgoing request
headers = client.get_trace_headers()
requests.post('http://service-b/api', headers=headers)
```

```go [Go]
// Service A: Add headers to outgoing request
headers := client.GetTraceHeaders()
req.Header.Set("X-Raceway-Trace-Id", headers["X-Raceway-Trace-Id"])
```

```rust [Rust]
// Service A: Add headers to outgoing request
let headers = client.get_trace_headers().await;
req.headers().insert("X-Raceway-Trace-Id", headers["X-Raceway-Trace-Id"]);
```

:::

## Next Steps

- **[TypeScript SDK](/sdks/typescript)** - Node.js/Express.js integration
- **[Python SDK](/sdks/python)** - Flask/FastAPI integration
- **[Go SDK](/sdks/go)** - net/http integration
- **[Rust SDK](/sdks/rust)** - Axum/Tokio integration
- **[Getting Started](/guide/getting-started)** - Setup guide for all SDKs
