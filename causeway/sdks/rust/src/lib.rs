/*!
# Raceway SDK - Rust

Lightweight SDK for race condition detection in Rust applications with automatic context propagation.

## Features

- **Plug-and-Play Middleware**: Automatic trace initialization and context propagation for Axum
- **Zero Manual Context Management**: Uses tokio::task_local! for automatic async context propagation
- **Simplified Tracking API**: No .await needed for tracking methods
- **Proper Causality Tracking**: Root event ID + logical clock vector for accurate race detection
- **RAII Lock Tracking**: Automatic lock tracking with TrackedMutex and TrackedRwLock

## Example

```rust,no_run
use raceway_sdk::RacewayClient;
use serde::Serialize;

#[derive(Serialize)]
struct TransferData {
    from: String,
    to: String,
    amount: u64,
}

// Create a client
let client = RacewayClient::new("http://localhost:8080", "my-service");

// Track events
let transfer = TransferData {
    from: "alice".to_string(),
    to: "bob".to_string(),
    amount: 100,
};

client.track_function_call("transfer", &transfer);
client.track_state_change("balance", Some(100), 50, "Write");
```
*/

mod client;
mod context;
mod lock_helpers;
mod trace_context;
mod types;

pub use client::RacewayClient;
pub use context::{RacewayContext, RACEWAY_CONTEXT};
pub use lock_helpers::{TrackedMutex, TrackedMutexGuard, TrackedRwLock, TrackedRwLockReadGuard, TrackedRwLockWriteGuard};
pub use types::*;
