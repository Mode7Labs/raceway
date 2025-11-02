# Rust SDK

Official Rust SDK for Raceway - Race condition detection and distributed tracing for Rust applications.

## Features

- Automatic context propagation using `tokio::task_local!`
- Axum middleware support
- Manual instrumentation API
- Distributed tracing across service boundaries (W3C Trace Context)
- Race condition and concurrency bug detection
- Automatic batching and background flushing

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
raceway = "0.1"
tokio = { version = "1.35", features = ["full", "macros"] }
```

## Quick Start

### Axum Integration

```rust
use axum::{
    extract::State,
    routing::{get, post},
    Json,
    Router,
};
use raceway_sdk::RacewayClient;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

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
        "my-service"
    ));

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/transfer", post(transfer))
        .layer(axum::middleware::from_fn_with_state(
            raceway.clone(),
            RacewayClient::middleware,
        ))
        .with_state(raceway);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .unwrap();

    axum::serve(listener, app).await.unwrap();
}

async fn transfer(
    State(raceway): State<Arc<RacewayClient>>,
    Json(req): Json<TransferRequest>,
) -> Json<TransferResponse> {
    raceway.track_function_call("transfer", &req);

    // Track state changes
    let balance = get_balance(&req.from).await;
    raceway.track_state_change(
        &format!("{}.balance", req.from),
        None::<i64>,
        balance,
        "Read"
    );

    if balance < req.amount {
        return Json(TransferResponse { success: false });
    }

    set_balance(&req.from, balance - req.amount).await;
    raceway.track_state_change(
        &format!("{}.balance", req.from),
        Some(balance),
        balance - req.amount,
        "Write"
    );

    Json(TransferResponse { success: true })
}
```

## Distributed Tracing

The SDK implements W3C Trace Context and Raceway vector clocks for distributed tracing across services.

### Propagating Trace Context

Use `propagation_headers()` when calling downstream services:

```rust
use reqwest::Client;
use serde_json::json;

async fn process_handler(
    State(raceway): State<Arc<RacewayClient>>,
    Json(req): Json<ProcessRequest>,
) -> Json<ProcessResponse> {
    raceway.track_function_call("process_request", &req);

    // Get propagation headers
    let headers = match raceway.propagation_headers(None) {
        Ok(h) => h,
        Err(e) => {
            eprintln!("Error getting propagation headers: {}", e);
            return Json(ProcessResponse { error: Some(e.to_string()) });
        }
    };

    // Call downstream service
    let client = Client::new();
    let result = client
        .post("http://inventory-service/reserve")
        .json(&json!({ "orderId": req.order_id }))
        .header("traceparent", headers.get("traceparent").unwrap())
        .header("raceway-clock", headers.get("raceway-clock").unwrap())
        .send()
        .await;

    Json(ProcessResponse { success: true, error: None })
}
```

### What Gets Propagated

The middleware automatically:
- Parses incoming `traceparent`, `tracestate`, and `raceway-clock` headers
- Generates new span IDs for this service
- Returns headers for downstream calls via `propagation_headers()`

Headers propagated:
- `traceparent`: W3C Trace Context (trace ID, span ID, trace flags)
- `tracestate`: W3C vendor-specific state
- `raceway-clock`: Raceway vector clock for causality tracking

### Cross-Service Trace Merging

Events from all services sharing the same trace ID are automatically merged by the Raceway backend. The backend recursively follows distributed edges to construct complete traces across arbitrary service chain lengths.

## Authentication

If your Raceway server is configured with API key authentication, provide the key when initializing the SDK:

```rust
use std::env;

let raceway = Arc::new(RacewayClient::new_with_auth(
    "http://localhost:8080",
    "my-service",
    &env::var("RACEWAY_API_KEY").expect("RACEWAY_API_KEY must be set")
));
```

**Best Practices:**
- Store API keys in environment variables, never hardcode them
- Use different keys for different environments (dev, staging, production)
- Rotate keys periodically for security
- The SDK will include the API key in the `Authorization` header: `Bearer <your-api-key>`

**Without Authentication:**

If your Raceway server doesn't require authentication, use the standard constructor:

```rust
let raceway = Arc::new(RacewayClient::new(
    "http://localhost:8080",
    "my-service"
));
```

## Configuration

The `RacewayClient` is created with minimal configuration:

```rust
// Basic initialization
let client = Arc::new(RacewayClient::new(
    "http://localhost:8080",  // Raceway server URL
    "my-service"              // Service name
));

// With custom module name
let client = Arc::new(RacewayClient::with_module(
    "http://localhost:8080",
    "my-service",
    "payments"                // Module name for function tracking
));
```

**Auto-Flush Behavior:**
- Events are automatically flushed every 1 second
- A background task is spawned on client creation to handle auto-flush

## API Reference

### Client Creation

#### `RacewayClient::new(endpoint, service_name)`

Create a new Raceway client instance with default module name "app".

```rust
let client = Arc::new(RacewayClient::new(
    "http://localhost:8080",
    "my-service"
));
```

#### `RacewayClient::with_module(endpoint, service_name, module_name)`

Create a new Raceway client instance with a custom module name.

```rust
let client = Arc::new(RacewayClient::with_module(
    "http://localhost:8080",
    "my-service",
    "payments"
));
```

### Core Tracking Methods

All methods are called on the `RacewayClient` instance and automatically read context from `tokio::task_local!` storage. They do not require `.await`.

#### `client.track_state_change<T: Serialize>(variable, old_value, new_value, access_type)`

Track a variable read or write.

```rust
// Track a read
client.track_state_change(
    "counter",
    None::<i64>,
    5,
    "Read"
);

// Track a write
client.track_state_change(
    "counter",
    Some(5),
    6,
    "Write"
);
```

#### `client.track_function_call<T: Serialize>(function_name, args)`

Track a function call (no duration tracking).

```rust
client.track_function_call(
    "process_payment",
    serde_json::json!({ "amount": 100 })
);
```

#### `client.track_function<F, T>(function_name, args, f) -> T` (async)

Track an async function with automatic duration measurement.

```rust
async fn process_payment(client: &RacewayClient, amount: i64) -> Result<(), Error> {
    client.track_function(
        "process_payment",
        serde_json::json!({ "amount": amount }),
        async {
            let result = do_payment(amount).await?;
            Ok(result)
        }
    ).await
}
```

#### `client.track_function_sync<F, T>(function_name, args, f) -> T`

Track a synchronous function with automatic duration measurement.

```rust
fn calculate_total(client: &RacewayClient, items: &[i64]) -> i64 {
    client.track_function_sync(
        "calculate_total",
        serde_json::json!({ "item_count": items.len() }),
        || items.iter().sum()
    )
}
```

#### `client.track_http_response(status, duration_ms)`

Track an HTTP response.

```rust
client.track_http_response(200, 45);
```

### Distributed Tracing Methods

#### `client.propagation_headers(extra_headers) -> Result<HashMap<String, String>, String>`

Generate headers for downstream service calls.

```rust
let headers = match client.propagation_headers(None) {
    Ok(h) => h,
    Err(e) => return Err(format!("Failed to get headers: {}", e))
};

let http_client = reqwest::Client::new();
http_client
    .post(downstream_url)
    .json(&payload)
    .header("traceparent", headers.get("traceparent").unwrap())
    .header("raceway-clock", headers.get("raceway-clock").unwrap())
    .send()
    .await?;
```

**Returns:** `HashMap` with `traceparent`, `tracestate`, and `raceway-clock` headers.

**Error:** Returns error if called outside request context.

#### `RacewayClient::middleware(client, headers, request, next)`

Axum middleware for automatic trace initialization.

```rust
let app = Router::new()
    .route("/api/endpoint", post(handler))
    .layer(axum::middleware::from_fn_with_state(
        raceway.clone(),
        RacewayClient::middleware,
    ))
    .with_state(raceway);
```

### Lifecycle Methods

#### `client.shutdown()`

Flush remaining events and stop background tasks.

```rust
client.shutdown();
```

## Context Propagation

The SDK uses `tokio::task_local!` via `RACEWAY_CONTEXT` for automatic context propagation across async operations. This is Rust's equivalent to:
- AsyncLocalStorage (Node.js/TypeScript)
- `context.Context` (Go)
- `contextvars` (Python)

Context is maintained across:
- HTTP requests (via middleware)
- `.await` points within the same task
- Function calls within the request scope

**Note:** Context does NOT automatically propagate to spawned tasks (`tokio::spawn`). For spawned tasks, you need to manually propagate the context.

## Best Practices

1. **Always use middleware**: Set up Raceway middleware to enable automatic trace initialization
2. **Use Arc for client**: Wrap the client in `Arc` for safe sharing across handlers
3. **Track shared state**: Focus on shared mutable state accessed by concurrent requests
4. **Propagate headers**: Always use `propagation_headers()` when calling downstream services
5. **Graceful shutdown**: Call `client.shutdown()` before exiting:
   ```rust
   tokio::select! {
       _ = ctrl_c => {
           client.shutdown();
       },
   }
   ```
6. **Pass client via State**: Use Axum's `State` extractor to access the client in handlers

## Distributed Example

Complete example with distributed tracing:

```rust
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    middleware,
    response::Json,
    routing::post,
    Router,
};
use raceway_sdk::RacewayClient;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Deserialize)]
struct OrderRequest {
    order_id: String,
}

#[derive(Serialize)]
struct OrderResponse {
    success: bool,
    order_id: String,
}

#[tokio::main]
async fn main() {
    let raceway = Arc::new(RacewayClient::new(
        "http://localhost:8080",
        "api-gateway"
    ));

    let app = Router::new()
        .route("/api/order", post(create_order))
        .layer(middleware::from_fn_with_state(
            raceway.clone(),
            RacewayClient::middleware,
        ))
        .with_state(raceway);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .unwrap();

    axum::serve(listener, app).await.unwrap();
}

async fn create_order(
    State(raceway): State<Arc<RacewayClient>>,
    Json(req): Json<OrderRequest>,
) -> (StatusCode, Json<OrderResponse>) {
    raceway.track_function_call("createOrder", &req);

    // Get propagation headers
    let headers = match raceway.propagation_headers(None) {
        Ok(h) => h,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(OrderResponse {
            success: false,
            order_id: req.order_id.clone(),
        })),
    };

    let client = reqwest::Client::new();

    // Call inventory service
    let _ = client
        .post("http://inventory-service:3001/reserve")
        .json(&serde_json::json!({ "orderId": &req.order_id }))
        .header("traceparent", headers.get("traceparent").unwrap())
        .header("raceway-clock", headers.get("raceway-clock").unwrap())
        .send()
        .await;

    // Call payment service
    let _ = client
        .post("http://payment-service:3002/charge")
        .json(&serde_json::json!({ "orderId": &req.order_id }))
        .header("traceparent", headers.get("traceparent").unwrap())
        .header("raceway-clock", headers.get("raceway-clock").unwrap())
        .send()
        .await;

    (StatusCode::OK, Json(OrderResponse {
        success: true,
        order_id: req.order_id,
    }))
}
```

All services in the chain will share the same trace ID, and Raceway will merge their events into a single distributed trace.

## Troubleshooting

### Events not appearing

1. Check server is running: `curl http://localhost:8080/health`
2. Verify middleware is properly configured
3. Ensure trace IDs are valid
4. Wait up to 1 second for auto-flush

### Distributed traces not merging

1. Ensure all services use `propagation_headers()` when calling downstream
2. Verify `traceparent` header is being sent
3. Check that all services report to the same Raceway server
4. Verify service names are unique

### Context not propagating

- Ensure middleware is set up on your Axum router
- Verify the middleware is applied before routes
- Check that handlers receive the `State<Arc<RacewayClient>>`
- For spawned tasks (`tokio::spawn`), context does NOT propagate automatically

## Next Steps

- [TypeScript SDK](/sdks/typescript) - Node.js integration
- [Python SDK](/sdks/python) - Python integration
- [Go SDK](/sdks/go) - Go integration
- [Security](/guide/security) - Best practices
- [Distributed Tracing](/guide/distributed-tracing) - Cross-service tracing
