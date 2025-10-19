/*!
# Raceway SDK - Rust

Lightweight SDK for race condition detection in Rust applications with automatic context propagation.

## Features

- **Plug-and-Play Middleware**: Automatic trace initialization and context propagation for Axum
- **Zero Manual Context Management**: Uses tokio::task_local! for automatic async context propagation
- **Simplified Tracking API**: No .await needed for tracking methods
- **Proper Causality Tracking**: Root event ID + logical clock vector for accurate race detection

## Example

```rust
use raceway_sdk::{RacewayClient, context::RACEWAY_CONTEXT};
use axum::{Router, routing::post, extract::State, Json};
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let client = Arc::new(RacewayClient::new(
        "http://localhost:8080",
        "my-service"
    ));

    let app = Router::new()
        .route("/api/transfer", post(transfer))
        .layer(axum::middleware::from_fn(|headers, request, next| {
            RacewayClient::middleware(client.clone(), headers, request, next)
        }))
        .with_state(client);

    // Server runs...
}

async fn transfer(
    State(raceway): State<Arc<RacewayClient>>,
    Json(payload): Json<TransferRequest>
) -> Json<Response> {
    // Track function call (no .await needed!)
    raceway.track_function_call("transfer", &payload);

    // All tracking happens automatically within the request context
    raceway.track_state_change("balance", Some(100), 50, "Write");

    Json(Response { success: true })
}
```
*/

mod client;
mod context;
mod types;

pub use client::RacewayClient;
pub use context::{RacewayContext, RACEWAY_CONTEXT};
pub use types::*;
