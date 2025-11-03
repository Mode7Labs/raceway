---
layout: home

hero:
  name: Raceway
  text: Deep concurrency analysis for distributed systems
  tagline: Debug race conditions, analyze critical paths, and trace causality across async operations
  image:
    src: /logo.png
    alt: Raceway
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/mode7labs/raceway

features:
  - icon: 🔍
    title: Race Condition Detection
    details: Discover concurrent accesses to shared state without proper synchronization using vector clock analysis
  - icon: 📊
    title: Critical Path Analysis
    details: Identify the longest dependency chain affecting latency in your distributed systems
  - icon: 🔗
    title: Causality Tracking
    details: Vector clock-based event ordering that respects happens-before relationships across async operations
  - icon: 🎯
    title: Anomaly Detection
    details: Spot performance outliers and unexpected behavior with statistical analysis
  - icon: 🗺️
    title: Service Dependencies
    details: Automatic extraction of cross-service call graphs from distributed traces
  - icon: 📝
    title: Variable Audit Trails
    details: Trace every read and write to specific variables across entire execution flows
  - icon: 🌐
    title: Distributed Tracing
    details: Multi-service execution flow visualization with causal ordering
  - icon: ⚡
    title: Fast & Efficient
    details: Built in Rust with async processing and efficient in-memory or PostgreSQL storage
  - icon: 🛠️
    title: Multiple SDKs
    details: First-class support for TypeScript, Python, Go, and Rust applications
  - icon: 🖥️
    title: Modern UIs
    details: Beautiful Web UI and powerful Terminal UI for trace visualization and analysis
---

## Quick Start

Install the Raceway server:

```bash
# Clone the repository
git clone https://github.com/mode7labs/raceway.git
cd raceway

# Run the server
cargo run --release -- serve
```

Install an SDK and start tracking:

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
cargo add raceway
```

:::

## Example

::: code-group

```typescript [TypeScript]
import { RacewayClient } from '@mode-7/raceway';

const raceway = new RacewayClient({
  serviceName: 'my-api',
  serverUrl: 'http://localhost:8080'
});

// Track state changes
await raceway.trackStateChange({
  variable: 'user.balance',
  oldValue: 1000,
  newValue: 900,
  location: 'api.ts:42',
  accessType: 'Write'
});
```

```python [Python]
from raceway import RacewayClient

raceway = RacewayClient(
    service_name="my-api",
    server_url="http://localhost:8080"
)

# Track state changes
raceway.track_state_change(
    variable="user.balance",
    old_value=1000,
    new_value=900,
    location="api.py:42",
    access_type="Write"
)
```

```go [Go]
package main

import "github.com/mode7labs/raceway/sdks/go/raceway"

func main() {
    client := raceway.NewClient(raceway.Config{
        ServiceName: "my-api",
        ServerURL:   "http://localhost:8080",
    })

    // Track state changes
    client.TrackStateChange(raceway.StateChange{
        Variable:   "user.balance",
        OldValue:   "1000",
        NewValue:   "900",
        Location:   "main.go:42",
        AccessType: "Write",
    })
}
```

```rust [Rust]
use raceway_client::{RacewayClient, Config};

#[tokio::main]
async fn main() {
    let client = RacewayClient::new(Config {
        service_name: "my-api".to_string(),
        server_url: "http://localhost:8080".to_string(),
        ..Default::default()
    });

    // Track state changes
    client.track_state_change(
        "user.balance",
        Some("1000"),
        "900",
        "main.rs:42",
        "Write"
    ).await;
}
```

:::

## Why Raceway?

Traditional debuggers and profilers break down in async systems where operations hop between threads. Raceway's **trace-local vector clocks** follow async tasks across thread migrations, maintaining accurate causality even when `await` moves your code to different threads.

This enables:
- Finding race conditions that only appear under specific concurrent execution orders
- Understanding why certain requests are slow (critical path analysis)
- Debugging distributed systems with proper causal ordering
- Auditing all accesses to sensitive variables across your system

## License

MIT License - see [LICENSE](https://github.com/mode7labs/raceway/blob/main/LICENSE) for details.
