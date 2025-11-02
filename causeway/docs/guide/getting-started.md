# Getting Started

Get Raceway up and running in minutes.

## Prerequisites

- **Rust 1.70+** (for the server)
- **Node.js 18+** (for the Web UI)
- **PostgreSQL** (optional, for persistent storage)

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/mode7labs/raceway.git
cd raceway
```

### 2. Start the Raceway Server

```bash
# Development mode
cargo run -- serve

# Production mode (optimized)
cargo run --release -- serve
```

The server will start on `http://localhost:8080` by default.

### 3. Start the Web UI (Optional)

The Web UI is a separate React application. To use it:

```bash
# In a new terminal
cd web
npm install
npm run dev
```

Navigate to `http://localhost:3005` in your browser.

::: tip API-First Design
Raceway is API-first. The Web UI is optional - you can use the HTTP API directly or build your own visualization tools. See the [API Reference](/api/overview) for details.
:::

## Quick Example

Let's instrument a simple application and detect a race condition.

### Install an SDK

::: code-group

```bash [TypeScript]
npm install @mode-7/raceway
```

```bash [Python]
pip install raceway
```

```bash [Go]
go get github.com/mode7labs/raceway/sdks/go
```

```bash [Rust]
cargo add raceway-client
```

:::

### Instrument Your Code

All SDKs use **middleware** to automatically manage trace context. You don't need to manually call `startTrace()`/`endTrace()` - the middleware handles this for you.

::: code-group

```typescript [TypeScript]
import express from 'express';
import { Raceway } from '@mode-7/raceway';

const raceway = new Raceway({
  serverUrl: 'http://localhost:8080',
  serviceName: 'my-app'
});

const app = express();
app.use(express.json());

// Middleware automatically manages trace context
app.use(raceway.middleware());

app.post('/transfer', async (req, res) => {
  const { from, to, amount } = req.body;

  // Track state changes - context is automatic
  raceway.trackStateChange({
    variable: `${from}.balance`,
    oldValue: 1000,
    newValue: 1000 - amount,
    location: 'app.ts:15',
    accessType: 'Write'
  });

  res.json({ success: true });
});

app.listen(3000);
```

```python [Python]
from flask import Flask, request
from raceway import RacewayClient, Config
from raceway.middleware import flask_middleware

app = Flask(__name__)

raceway = RacewayClient(Config(
    endpoint="http://localhost:8080",
    service_name="my-app"
))

# Middleware automatically manages trace context
middleware = flask_middleware(raceway)

@app.before_request
def init_raceway():
    middleware.before_request()

@app.after_request
def finish_raceway(response):
    return middleware.after_request(response)

@app.route("/transfer", methods=["POST"])
def transfer():
    data = request.get_json()

    # Track state changes - context is automatic
    raceway.track_state_change(
        f"{data['from']}.balance",
        1000, 900, "Write"
    )

    return {"success": True}

if __name__ == "__main__":
    app.run(port=3000)
```

```go [Go]
package main

import (
    "net/http"
    raceway "github.com/mode7labs/raceway/sdks/go"
)

func main() {
    client := raceway.NewClient(raceway.Config{
        ServerURL:   "http://localhost:8080",
        ServiceName: "my-app",
    })
    defer client.Stop()

    mux := http.NewServeMux()
    mux.HandleFunc("/transfer", func(w http.ResponseWriter, r *http.Request) {
        ctx := r.Context()

        // Track state changes - context from middleware
        client.TrackStateChange(ctx, "alice.balance", 1000, 900, "Write")

        w.WriteHeader(http.StatusOK)
    })

    // Middleware automatically manages trace context
    handler := client.Middleware(mux)
    http.ListenAndServe(":3000", handler)
}
```

```rust [Rust]
use axum::{routing::post, Json, Router, extract::State};
use raceway_sdk::RacewayClient;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let raceway = Arc::new(RacewayClient::new(
        "http://localhost:8080",
        "my-app"
    ));

    let app = Router::new()
        .route("/transfer", post(transfer))
        // Middleware automatically manages trace context
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
) -> Json<serde_json::Value> {
    // Track state changes - context is automatic
    raceway.track_state_change(
        "alice.balance",
        Some(1000), 900, "Write"
    );

    Json(serde_json::json!({ "success": true }))
}
```

:::

::: tip Automatic Trace Management
The middleware automatically:
- Creates a new trace for each HTTP request
- Propagates distributed trace context across services
- Manages vector clocks and causality
- Flushes events when the request completes

You never need to call `startTrace()` or `endTrace()` manually.
:::

### View the Trace

1. **Start your application** with the code above
2. **Make a request** to trigger a trace:
   ```bash
   curl -X POST http://localhost:3000/transfer \
     -H "Content-Type: application/json" \
     -d '{"from": "alice", "to": "bob", "amount": 100}'
   ```
3. **View the trace:**
   - **Via Web UI**: Navigate to `http://localhost:3005` (if you started the web UI)
   - **Via API**: `curl http://localhost:8080/api/traces`

4. **In the Web UI** (if running):
   - You'll see your trace in the traces list
   - Click on it to view events, critical path, and anomalies

## Configuration

Create a `raceway.toml` file in your project root:

```toml
[server]
host = "0.0.0.0"
port = 8080

[storage]
# Use in-memory storage (default)
backend = "memory"

# Or use PostgreSQL
# backend = "postgres"
# [storage.postgres]
# connection_string = "postgresql://user:pass@localhost/raceway"

[server]
auth_enabled = false
# api_keys = ["your-secret-key"]

cors_enabled = true
cors_origins = ["http://localhost:3000"]
```

## Next Steps

- **[Core Concepts](/guide/core-concepts)** - Understand how Raceway works
- **[SDKs](/sdks/overview)** - Deep dive into SDK features
- **[Examples](https://github.com/mode7labs/raceway/tree/main/examples)** - See real-world examples
- **[Security Guide](/guide/security)** - Best practices and security

## Troubleshooting

### Server won't start

**Problem**: `Address already in use`

**Solution**: Another process is using port 8080. Either stop that process or change the port in `raceway.toml`:

```toml
[server]
port = 8081
```

### Events not appearing

**Problem**: Events sent from SDK don't appear in the UI

**Solutions**:
1. Check the server is running: `curl http://localhost:8080/health`
2. Verify the SDK serverUrl matches the server address
3. Check server logs for errors
4. Ensure you called `endTrace()` to flush events

### PostgreSQL connection fails

**Problem**: `Failed to connect to database`

**Solution**: Verify your connection string and ensure PostgreSQL is running:

```bash
psql postgresql://user:pass@localhost/raceway
```

Run migrations:

```bash
cargo run -- migrate
```
