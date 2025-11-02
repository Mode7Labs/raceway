# raceway-rust

Official Rust SDK for [Raceway](https://github.com/mode7labs/raceway) - Race condition detection and distributed tracing for Rust applications.

📚 **[Full Documentation](https://mode7labs.github.io/raceway/sdks/rust)**

## Features

- Automatic context propagation using `tokio::task_local!`
- Axum middleware support
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

```rust
use axum::{
    extract::State,
    routing::post,
    Json, Router,
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

#[tokio::main]
async fn main() {
    let raceway = Arc::new(RacewayClient::new(
        "http://localhost:8080",
        "my-service"
    ));

    let app = Router::new()
        .route("/api/transfer", post(transfer))
        .layer(axum::middleware::from_fn_with_state(
            raceway.clone(),
            RacewayClient::middleware,
        ))
        .with_state(raceway);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await.unwrap();

    axum::serve(listener, app).await.unwrap();
}

async fn transfer(
    State(raceway): State<Arc<RacewayClient>>,
    Json(req): Json<TransferRequest>,
) -> Json<serde_json::Value> {
    raceway.track_function_call("transfer", &req);

    // Track state changes
    let balance = get_balance(&req.from).await;
    raceway.track_state_change(
        &format!("{}.balance", req.from),
        None::<i64>, balance, "Read"
    );

    set_balance(&req.from, balance - req.amount).await;
    raceway.track_state_change(
        &format!("{}.balance", req.from),
        Some(balance), balance - req.amount, "Write"
    );

    Json(serde_json::json!({ "success": true }))
}
```

## Distributed Tracing

Propagate traces across service boundaries:

```rust
use reqwest::Client;

async fn checkout(
    State(raceway): State<Arc<RacewayClient>>,
) -> Json<serde_json::Value> {
    // Get propagation headers
    let headers = raceway.propagation_headers(None).unwrap();

    // Call downstream service
    let client = Client::new();
    client
        .post("http://inventory-service/reserve")
        .header("traceparent", headers.get("traceparent").unwrap())
        .header("raceway-clock", headers.get("raceway-clock").unwrap())
        .send()
        .await;

    Json(serde_json::json!({ "success": true }))
}
```

## Documentation

- 📚 **[Full SDK Documentation](https://mode7labs.github.io/raceway/sdks/rust)** - Complete API reference and examples
- 🚀 **[Getting Started Guide](https://mode7labs.github.io/raceway/guide/getting-started)** - Step-by-step setup
- 🔍 **[Race Detection Guide](https://mode7labs.github.io/raceway/guide/race-detection)** - Understanding race conditions
- 🌐 **[Distributed Tracing](https://mode7labs.github.io/raceway/guide/distributed-tracing)** - Cross-service tracing
- 🔐 **[Security Guide](https://mode7labs.github.io/raceway/guide/security)** - Best practices

## Examples

See [examples/rust-banking](../../examples/rust-banking) for a complete Axum application with Raceway integration.

## License

MIT

## Links

- [GitHub Repository](https://github.com/mode7labs/raceway)
- [Documentation](https://mode7labs.github.io/raceway)
- [Issue Tracker](https://github.com/mode7labs/raceway/issues)
