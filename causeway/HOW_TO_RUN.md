# How to Run Causeway (Complete Guide)

## Prerequisites

You'll need:
- **Rust** (for the server) - https://rustup.rs
- **Node.js** (for testing) - Already installed ✅

## Step 1: Install Rust (if needed)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

## Step 2: Build and Run the Server

```bash
# Navigate to the causeway directory
cd /Users/joe/Projects/Experiments/yolo/causeway

# Build the Rust server (this will take a few minutes the first time)
cargo build --release

# Start the server
cargo run --release -- serve
```

You should see:
```
🚀 Causeway Server Started!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   🌐 Server:        http://127.0.0.1:8080
   📥 Ingest:        http://127.0.0.1:8080/events
   📊 Status:        http://127.0.0.1:8080/status
   🔍 List traces:   http://127.0.0.1:8080/api/traces
   🎯 Get trace:     http://127.0.0.1:8080/api/traces/:id
   🤖 Analyze:       http://127.0.0.1:8080/api/traces/:id/analyze
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✨ Ready to capture events!
```

## Step 3: Test the Server

Open a **new terminal** and run:

```bash
cd /Users/joe/Projects/Experiments/yolo/causeway

# Make the test client executable
chmod +x test-client.js

# Run it
node test-client.js
```

You should see:
```
🧪 Testing Causeway Server

1️⃣  Testing health endpoint...
   ✅ Health check: { success: true, data: 'OK' }

2️⃣  Testing status endpoint...
   ✅ Status: {
     "success": true,
     "data": {
       "version": "0.1.0",
       "uptime_seconds": 0,
       "events_captured": 0,
       "traces_active": 0
     }
   }

3️⃣  Sending sample events...
   ✅ Events ingested: { success: true, data: 'Ingested 2 events' }

4️⃣  Listing traces...
   ✅ Traces: {
     "success": true,
     "data": {
       "total_traces": 1,
       "total_events": 2
     }
   }

✨ Test complete!
```

## Step 4: View in Browser

Open http://localhost:8080 in your browser!

You'll see a beautiful UI showing:
- All available API endpoints
- Server status
- Links to traces

## Step 5: Try the Race Condition Demo

```bash
# Run the demo
node demo-simple.js

# This shows the exact bug Causeway would detect
```

## What You Can Do Now

### Send Events via curl

```bash
curl -X POST http://localhost:8080/events \
  -H "Content-Type: application/json" \
  -d '{
    "events": [{
      "id": "test-1",
      "trace_id": "trace-1",
      "parent_id": null,
      "timestamp": "2025-10-13T10:00:00Z",
      "kind": {"Custom": {"name": "test", "data": {}}},
      "metadata": {
        "thread_id": "main",
        "process_id": 1234,
        "service_name": "test",
        "environment": "dev",
        "tags": {},
        "duration_ns": null
      },
      "causality_vector": []
    }]
  }'
```

### Check Server Status

```bash
curl http://localhost:8080/status | jq
```

### List All Traces

```bash
curl http://localhost:8080/api/traces | jq
```

## Troubleshooting

### "cargo: command not found"
Install Rust:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### "Address already in use"
Another process is using port 8080. Kill it or use a different port:
```bash
cargo run --release -- serve --port 9090
```

### Compilation errors
Make sure you have the latest Rust:
```bash
rustup update
```

## Next Steps

### 1. Integrate with Your Own Project

```bash
cd /your/project

# Install the instrumentation (once it's built)
npm install /Users/joe/Projects/Experiments/yolo/causeway/instrumentation

# Add to your code
import '@causeway/instrumentation';

# Configure
import { causeway } from '@causeway/instrumentation';
causeway.configure({
  endpoint: 'http://localhost:8080',
  serviceName: 'my-app',
});
```

### 2. Run the TUI

```bash
cargo run --release -- tui
```

### 3. Analyze a Specific Trace

```bash
# Get a trace ID from /api/traces
cargo run --release -- analyze --trace-id <trace-id>
```

## Performance Tips

- **Debug builds are slow**: Always use `cargo run --release`
- **First build takes time**: Subsequent builds are fast (incremental compilation)
- **Production mode**: Set `RUST_LOG=info` for less verbose output

## What's Working

✅ HTTP server with full REST API
✅ Event ingestion
✅ Trace storage in causal graph
✅ Race condition detection
✅ Web UI landing page
✅ Status endpoints
✅ CORS enabled for browser access

## What's Next

To make this production-ready:
1. Add persistent storage (SQLite/PostgreSQL)
2. Complete the TUI to fetch real data
3. Build the React web UI
4. Publish to crates.io and npm
5. Add authentication
6. Create Docker image

But **you can use it right now** for local debugging!
