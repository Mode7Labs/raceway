# Causeway - Quick Reference Guide

**One-page reference for common tasks**

---

## 🚀 Quick Start (5 minutes)

```bash
# 1. Clone and build
git clone https://github.com/causeway/causeway
cd causeway
cargo build --release

# 2. Start server (Terminal 1)
cargo run --release -- serve

# 3. Run example (Terminal 2)
cd examples/express-banking
npm install && node index.js

# 4. Trigger race (Terminal 3)
cd examples/express-banking
node test-race.js

# 5. View TUI (Terminal 4)
cd causeway
cargo run --release -- tui
# Press 'r' to refresh
```

---

## 📋 Common Commands

### Server

```bash
# Start server
cargo run --release -- serve

# Custom port
cargo run --release -- serve --port 9000

# Check status
curl http://localhost:8080/status
```

### TUI

```bash
# Launch TUI
cargo run --release -- tui

# Keyboard shortcuts:
# ↑↓ or jk - Navigate events
# ←→ or hl - Switch traces
# r       - Refresh
# q       - Quit
```

### CLI Tool (TypeScript)

```bash
# Initialize project
causeway init

# Instrument code
causeway instrument ./src --output ./instrumented

# Check server
causeway status

# Dry run (see what would be changed)
causeway instrument ./src --dry-run
```

---

## 🔧 TypeScript SDK

### Basic Usage

```typescript
import { Causeway } from 'causeway-sdk';

const causeway = new Causeway({
  serverUrl: 'http://localhost:8080',
  serviceName: 'my-api',
});

// Start trace
const trace = causeway.startTrace();

// Capture events
causeway.captureFunctionCall('myFunction', { arg1: 'value' });
causeway.captureStateChange('myVar', newValue, oldValue, 'file.ts:42');

// End trace
causeway.endTrace();

// Flush (optional - happens automatically)
await causeway.flush();
```

### Express Middleware

```typescript
app.use((req, res, next) => {
  const trace = causeway.startTrace();
  res.locals.causeway = causeway;

  res.on('finish', () => {
    causeway.endTrace();
  });

  next();
});
```

---

## 🎯 REST API

### Ingest Events

```bash
POST http://localhost:8080/events
Content-Type: application/json

{
  "events": [
    {
      "id": "uuid",
      "trace_id": "uuid",
      "parent_id": null,
      "timestamp": "2025-01-15T10:00:00Z",
      "kind": {
        "FunctionCall": {
          "function_name": "transferMoney",
          "module": "banking",
          "args": { "amount": 100 },
          "file": "index.js",
          "line": 42
        }
      },
      "metadata": {
        "thread_id": "main",
        "process_id": 12345,
        "service_name": "api",
        "environment": "prod",
        "tags": {},
        "duration_ns": null
      },
      "causality_vector": []
    }
  ]
}
```

### List Traces

```bash
GET http://localhost:8080/api/traces

# Response:
{
  "success": true,
  "data": {
    "total_traces": 3,
    "total_events": 42,
    "trace_ids": ["uuid1", "uuid2", "uuid3"]
  }
}
```

### Get Trace Details

```bash
GET http://localhost:8080/api/traces/:trace_id

# Response:
{
  "success": true,
  "data": {
    "trace_id": "uuid",
    "event_count": 10,
    "events": [...]
  }
}
```

### Analyze for Races

```bash
GET http://localhost:8080/api/traces/:trace_id/analyze

# Response:
{
  "success": true,
  "data": {
    "trace_id": "uuid",
    "concurrent_events": 4,
    "potential_races": 4,
    "anomalies": [
      "🚨 CRITICAL on alice.balance: thread-1 vs thread-2"
    ],
    "race_details": [
      {
        "severity": "CRITICAL",
        "variable": "alice.balance",
        "event1_thread": "thread-1",
        "event2_thread": "thread-2",
        "event1_location": "index.js:217",
        "event2_location": "index.js:217",
        "description": "Write-Write race..."
      }
    ]
  }
}
```

---

## 🔍 Event Types

### FunctionCall

```json
{
  "FunctionCall": {
    "function_name": "transferMoney",
    "module": "banking",
    "args": { "from": "alice", "to": "bob", "amount": 100 },
    "file": "index.js",
    "line": 42
  }
}
```

### StateChange

```json
{
  "StateChange": {
    "variable": "account.balance",
    "old_value": 1000,
    "new_value": 900,
    "location": "index.js:45"
  }
}
```

### HttpRequest

```json
{
  "HttpRequest": {
    "method": "POST",
    "url": "/api/transfer",
    "headers": {},
    "body": {}
  }
}
```

### HttpResponse

```json
{
  "HttpResponse": {
    "status": 200,
    "headers": {},
    "body": {},
    "duration_ms": 123
  }
}
```

### Custom

```json
{
  "Custom": {
    "name": "payment_processed",
    "data": { "amount": 100 }
  }
}
```

---

## ⚙️ Configuration

### .causewayrc.json

```json
{
  "serverUrl": "http://localhost:8080",
  "serviceName": "my-api",
  "environment": "development",
  "enabled": true,
  "batchSize": 100,
  "flushInterval": 1000,
  "instrumentation": {
    "functions": true,
    "assignments": true,
    "async": true,
    "exclude": [
      "node_modules/**",
      "dist/**"
    ]
  }
}
```

### Babel Plugin (.babelrc)

```json
{
  "plugins": [
    ["babel-plugin-causeway", {
      "instrumentFunctions": true,
      "instrumentAssignments": true,
      "instrumentAsync": true,
      "exclude": ["test/**"]
    }]
  ]
}
```

---

## 🐛 Troubleshooting

### Server won't start

```bash
# Check if port is in use
lsof -i :8080

# Kill process
kill -9 <PID>

# Or use different port
cargo run --release -- serve --port 9000
```

### TUI shows no data

```bash
# 1. Check server is running
curl http://localhost:8080/health

# 2. Enable debug mode in SDK
const causeway = new Causeway({ debug: true });

# 3. Check browser console / server logs

# 4. Manually flush
await causeway.flush();
```

### Events not appearing

```bash
# 1. Check server URL
console.log(causeway.config.serverUrl);

# 2. Check network
curl -X POST http://localhost:8080/events \
  -H "Content-Type: application/json" \
  -d '{"events":[]}'

# 3. Check batching
const causeway = new Causeway({
  batchSize: 1,  // Flush immediately
  flushInterval: 100  // Flush every 100ms
});
```

### Build errors

```bash
# Update Rust
rustup update

# Clean build
cargo clean
cargo build --release

# Check Rust version (need 1.70+)
rustc --version
```

---

## 📊 Race Condition Severity

| Severity | Meaning | Example |
|----------|---------|---------|
| **CRITICAL** | Write-Write race | Both threads write different values |
| **WARNING** | Read-Write race | One thread reads while another writes |
| **INFO** | Read-Read | Both threads read (usually safe) |

---

## 🎓 Glossary

**Trace** - A single execution path (e.g., one HTTP request)

**Event** - A single captured operation (function call, state change, etc.)

**Causal Order** - The true "happened-before" relationship between events

**Vector Clock** - A data structure for tracking causality in distributed systems

**Race Condition** - When two operations access shared state without proper synchronization

**Concurrent Events** - Events with no causal relationship (neither happened before the other)

---

## 📚 More Info

- [Full README](./README.md)
- [TODO/Roadmap](./TODO.md)
- [Demo Script](./DEMO-SCRIPT.md)
- [Completion Summary](./COMPLETION-SUMMARY.md)
- [TypeScript SDK Docs](./sdk/typescript/README.md)
- [Babel Plugin Docs](./sdk/typescript/babel-plugin/README.md)
- [Example App](./examples/express-banking/README.md)

---

## 💬 Get Help

- 🐛 [Report Bug](https://github.com/causeway/causeway/issues)
- 💡 [Request Feature](https://github.com/causeway/causeway/issues)
- 💬 [Ask Question](https://github.com/causeway/causeway/discussions)
- 📧 Email: support@causeway.dev

---

**Last Updated:** 2025-10-13
