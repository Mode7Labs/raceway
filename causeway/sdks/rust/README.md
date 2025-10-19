# raceway-rust

Official Rust SDK for [Raceway](https://github.com/mode-7/raceway) - AI-powered race condition detection for distributed systems.

## Features

- **🔌 Plug-and-Play Architecture**: Automatic context propagation using `tokio::task_local!`
- **🦀 Zero-Cost Abstractions**: Built on Rust's powerful type system and async runtime
- **🐛 Race Detection**: Detect data races, atomicity violations, and concurrency bugs in production
- **📊 Distributed Tracing**: Track causality across async tasks and service boundaries
- **⚡ Production-Ready**: Minimal overhead with async event batching and non-blocking I/O

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
raceway-sdk = "0.1"
tokio = { version = "1.35", features = ["full", "macros"] }
```

## Quick Start

### 1. Initialize the SDK

```rust
use raceway_sdk::RacewayClient;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    // Basic initialization
    let raceway = Arc::new(RacewayClient::new(
        "http://localhost:8080",
        "my-service"
    ));

    // Or with custom module name
    let raceway = Arc::new(RacewayClient::with_module(
        "http://localhost:8080",
        "my-service",
        "my-module"
    ));
}
```

### 2. Use the Plug-and-Play API with Axum Middleware

The Rust SDK uses `tokio::task_local!` for automatic context propagation (similar to AsyncLocalStorage in Node.js):

```rust
use raceway_sdk::RacewayClient;
use axum::{Router, routing::post, extract::State, Json};
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let raceway = Arc::new(RacewayClient::new(
        "http://localhost:8080",
        "my-service"
    ));

    let app = Router::new()
        .route("/api/transfer", post(handle_transfer))
        .layer(axum::middleware::from_fn({
            let raceway = raceway.clone();
            move |headers, request, next| {
                RacewayClient::middleware(raceway.clone(), headers, request, next)
            }
        }))
        .with_state(raceway);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn handle_transfer(
    State(raceway): State<Arc<RacewayClient>>,
    Json(payload): Json<TransferRequest>
) -> Json<Response> {
    // Track function call (no .await needed!)
    raceway.track_function_call("transfer", &payload);

    // Your application logic
    let balance = get_balance(&payload.from).await;
    raceway.track_state_change(
        &format!("{}.balance", payload.from),
        None::<i64>,
        balance,
        "Read"
    );

    if balance < payload.amount {
        return Json(Response { success: false });
    }

    // Write new balance (RACE CONDITION WINDOW!)
    set_balance(&payload.from, balance - payload.amount).await;
    raceway.track_state_change(
        &format!("{}.balance", payload.from),
        Some(balance),
        balance - payload.amount,
        "Write"
    );

    Json(Response { success: true })
}
```

## API Reference

### `RacewayClient::new(endpoint, service_name)`

Creates a new Raceway client instance with default module name "app".

**Parameters:**
- `endpoint: &str` - Raceway server endpoint (e.g., "http://localhost:8080")
- `service_name: &str` - Service name for event metadata

**Example:**
```rust
let client = Arc::new(RacewayClient::new(
    "http://localhost:8080",
    "my-service"
));
```

### `RacewayClient::with_module(endpoint, service_name, module_name)`

Creates a new Raceway client instance with a custom module name.

**Parameters:**
- `endpoint: &str` - Raceway server endpoint
- `service_name: &str` - Service name for event metadata
- `module_name: &str` - Module name for function call tracking

**Example:**
```rust
let client = Arc::new(RacewayClient::with_module(
    "http://localhost:8080",
    "my-service",
    "payments"
));
```

**Auto-Flush Behavior:**
- Events are automatically flushed every 1 second
- A background task is spawned on client creation to handle auto-flush

### Core Tracking Methods

All methods are called on the `RacewayClient` instance and automatically read context from `tokio::task_local!` storage. They do not require `.await`.

#### `client.track_state_change<T: Serialize>(variable, old_value, new_value, access_type)`

Track a variable read or write.

**Parameters:**
- `variable: &str` - Variable name
- `old_value: Option<T>` - Previous value (None for reads)
- `new_value: T` - New value
- `access_type: &str` - "Read" or "Write"

```rust
// Track a Read
client.track_state_change(
    "counter",
    None::<i64>,
    5,
    "Read"
);

// Track a Write
client.track_state_change(
    "counter",
    Some(5),
    6,
    "Write"
);
```

#### `client.track_function_call<T: Serialize>(function_name, args)`

Track a function entry. File and line information are captured automatically.

**Parameters:**
- `function_name: &str` - Name of the function
- `args: T` - Function arguments (any serializable type)

**Note:** The module name is set when creating the client (defaults to "app").

```rust
client.track_function_call(
    "process_payment",
    serde_json::json!({ "amount": 100 })
);
```

#### `client.track_http_response(status, duration_ms)`

Track an HTTP response.

**Parameters:**
- `status: u16` - HTTP status code
- `duration_ms: u64` - Request duration in milliseconds

**Note:** HTTP requests are tracked automatically by the middleware.

```rust
client.track_http_response(200, 45);
```

### Middleware

#### `RacewayClient::middleware(client, headers, request, next)`

Axum middleware that automatically initializes trace context from request headers and tracks HTTP requests.

**Parameters:**
- `client: Arc<RacewayClient>` - The Raceway client instance
- `headers: HeaderMap` - Request headers
- `request: Request` - The Axum request
- `next: Next` - Next middleware in chain

**Behavior:**
- Extracts trace ID from `x-trace-id` header or generates a new one
- Initializes `RACEWAY_CONTEXT` for the request scope
- Tracks HTTP request automatically

**Example:**
```rust
let app = Router::new()
    .route("/api/endpoint", post(handler))
    .layer(axum::middleware::from_fn({
        let raceway = raceway.clone();
        move |headers, request, next| {
            RacewayClient::middleware(raceway.clone(), headers, request, next)
        }
    }));
```

## Architecture

### Task-Local Storage

The Rust SDK uses **`tokio::task_local!`** via `RACEWAY_CONTEXT` for automatic context propagation across async operations. This is Rust's equivalent to:
- AsyncLocalStorage (Node.js/TypeScript)
- `context.Context` (Go)
- `contextvars` (Python)

This ensures traces are maintained across:
- HTTP requests (via middleware)
- `.await` points within the same task
- Function calls within the request scope

**Note:** Context does NOT automatically propagate to spawned tasks (`tokio::spawn`). For spawned tasks, you need to manually propagate the context.

### Thread IDs

Rust's SDK uses actual OS thread IDs for identifying concurrent operations, as Rust has true multi-threading. Each task gets tracked with its thread ID automatically.

## Axum Integration Example

```rust
use axum::{
    extract::State,
    routing::post,
    Json,
    Router,
};
use raceway_sdk::RacewayClient;
use std::sync::Arc;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct TransferRequest {
    from: String,
    to: String,
    amount: i64,
}

#[derive(Serialize)]
struct TransferResponse {
    success: bool,
}

#[tokio::main]
async fn main() {
    let raceway = Arc::new(RacewayClient::new(
        "http://localhost:8080",
        "banking-api"
    ));

    let app = Router::new()
        .route("/api/transfer", post(transfer))
        .layer(axum::middleware::from_fn({
            let raceway = raceway.clone();
            move |headers, request, next| {
                RacewayClient::middleware(raceway.clone(), headers, request, next)
            }
        }))
        .with_state(raceway);

    // Graceful shutdown
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .unwrap();

    axum::serve(listener, app).await.unwrap();
}

async fn transfer(
    State(raceway): State<Arc<RacewayClient>>,
    Json(req): Json<TransferRequest>,
) -> Json<TransferResponse> {
    // Track function call (context is automatic via middleware!)
    raceway.track_function_call(
        "transfer",
        serde_json::json!({
            "from": &req.from,
            "to": &req.to,
            "amount": req.amount
        })
    );

    // Simulate async processing
    tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

    // Read balance
    let balance = get_balance(&req.from).await;
    raceway.track_state_change(
        &format!("{}.balance", req.from),
        None::<i64>,
        balance,
        "Read"
    );

    if balance < req.amount {
        raceway.track_http_response(400, 15);
        return Json(TransferResponse { success: false });
    }

    tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

    // Write new balance (RACE CONDITION WINDOW!)
    set_balance(&req.from, balance - req.amount).await;
    raceway.track_state_change(
        &format!("{}.balance", req.from),
        Some(balance),
        balance - req.amount,
        "Write"
    );

    // Credit recipient
    let to_balance = get_balance(&req.to).await;
    set_balance(&req.to, to_balance + req.amount).await;
    raceway.track_state_change(
        &format!("{}.balance", req.to),
        Some(to_balance),
        to_balance + req.amount,
        "Write"
    );

    // Track HTTP response
    raceway.track_http_response(200, 50);

    Json(TransferResponse { success: true })
}

// Helper functions
async fn get_balance(account: &str) -> i64 {
    // Implementation...
    1000
}

async fn set_balance(account: &str, balance: i64) {
    // Implementation...
}
```

## Testing Race Conditions

Send concurrent requests with the same trace ID:

```bash
TRACE_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')

curl -X POST http://localhost:3000/api/transfer \
  -H "Content-Type: application/json" \
  -H "X-Trace-ID: $TRACE_ID" \
  -d '{"from":"alice","to":"bob","amount":100}' &

curl -X POST http://localhost:3000/api/transfer \
  -H "Content-Type: application/json" \
  -H "X-Trace-ID: $TRACE_ID" \
  -d '{"from":"alice","to":"charlie","amount":200}' &

wait
```

Raceway will detect the race when both requests read the same balance before either writes!

## Event Types

The SDK supports tracking the following event types:

- **StateChange**: Variable reads and writes
- **FunctionCall**: Function entry points
- **FunctionReturn**: Function exits with return values
- **AsyncSpawn**: Spawning async tasks
- **AsyncAwait**: Awaiting async operations
- **HttpRequest**: HTTP requests
- **HttpResponse**: HTTP responses
- **LockAcquire**: Acquiring locks/mutexes
- **LockRelease**: Releasing locks/mutexes
- **Error**: Exceptions and errors

## Best Practices

1. **Use Middleware**: Always set up the Raceway middleware on your Axum router to enable automatic context propagation:
   ```rust
   .layer(axum::middleware::from_fn({
       let raceway = raceway.clone();
       move |headers, request, next| {
           RacewayClient::middleware(raceway.clone(), headers, request, next)
       }
   }))
   ```

2. **Track Shared State**: Focus on tracking accesses to shared variables that multiple tasks might access concurrently.

3. **Pass Client via State**: Use Axum's `State` extractor to access the Raceway client in your handlers:
   ```rust
   async fn handler(State(raceway): State<Arc<RacewayClient>>) { ... }
   ```

4. **Automatic Flush**: The SDK automatically flushes events every 1 second. No manual shutdown is needed for most cases.

5. **Selective Tracking**: Not all state needs tracking. Focus on shared mutable state accessed by concurrent requests.

## Performance

The SDK is designed for minimal overhead:

- **Zero-cost context propagation** using `tokio::task_local!`
- **Event buffering** with batched transmission
- **Non-blocking I/O** for event transmission
- **Auto-flush** every 1 second
- **Compile-time optimizations** via Rust's zero-cost abstractions
- **Efficient serialization** using parking_lot for synchronization

**Typical overhead**: <5% for most workloads

## Examples

See the [examples/rust-banking](../../examples/rust-banking) directory for a complete working example demonstrating:

- Axum middleware integration
- Automatic context propagation with task-local storage
- Race condition detection in a banking API
- Concurrent transfer scenarios

## Viewing Results

### Web UI

```bash
# Start Raceway server (if not already running)
raceway serve

# Open http://localhost:8080 in your browser
```

### Terminal UI

```bash
raceway tui
```

**Keyboard shortcuts:**
- `↑↓` or `j/k`: Navigate traces
- `Enter`: View trace details
- `r`: Refresh
- `q`: Quit

### API

```bash
# List all traces
curl http://localhost:8080/api/traces

# Get specific trace
curl http://localhost:8080/api/traces/<trace-id>

# Analyze for race conditions
curl http://localhost:8080/api/analyze
```

## Troubleshooting

### Events not appearing

1. Check server is running: `curl http://localhost:8080/health`
2. Check console output - the SDK prints flush messages with `eprintln!`
3. Verify middleware is properly configured
4. Ensure trace IDs are valid (check `x-trace-id` header)
5. Wait up to 1 second for auto-flush

### Context not propagating

- Ensure middleware is set up on your Axum router
- Verify the middleware is applied before routes
- Check that handlers receive the `State<Arc<RacewayClient>>`
- For spawned tasks (`tokio::spawn`), context does NOT propagate automatically

### High Memory Usage

The SDK uses an event buffer that flushes every 1 second. If you're generating events faster than they can be flushed, memory usage may increase temporarily. This is normal behavior.

## Current API Design

The Raceway Rust SDK uses:

- **`RacewayClient`** - The main client struct
- **`RacewayClient::new(endpoint, service_name)`** - Simple constructor
- **`RacewayClient::with_module(...)`** - Constructor with custom module name
- **`RacewayClient::middleware(...)`** - Axum middleware for automatic context setup
- **Instance methods** - All tracking methods are called on the client instance
- **No .await needed** - Tracking methods are synchronous (events are buffered)
- **Automatic flushing** - Events are sent to the server every 1 second

**Example:**
```rust
let raceway = Arc::new(RacewayClient::new("http://localhost:8080", "my-service"));

// In your handler (context is automatic via middleware):
async fn handler(State(raceway): State<Arc<RacewayClient>>) {
    raceway.track_state_change("balance", Some(100), 150, "Write");
    // No .await needed! Context is automatic!
}
```

## License

MIT

## Support

- **Documentation**: https://docs.raceway.dev
- **Examples**: https://github.com/mode-7/raceway/tree/main/examples
- **Issues**: https://github.com/mode-7/raceway/issues
- **Discord**: https://discord.gg/raceway
