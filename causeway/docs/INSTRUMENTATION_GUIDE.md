# Raceway Instrumentation Library Guide

**Version:** 1.0
**Last Updated:** October 2025

This guide provides a **language-agnostic approach** for building Raceway instrumentation libraries across TypeScript, Rust, Go, and Python.

---

## Table of Contents

1. [Overview](#overview)
2. [Project Structure](#project-structure)
3. [SDK Requirements](#sdk-requirements)
4. [Event Schema](#event-schema)
5. [Demo App Requirements](#demo-app-requirements)
6. [Implementation Checklist](#implementation-checklist)
7. [Testing Strategy](#testing-strategy)
8. [Publishing Guidelines](#publishing-guidelines)

---

## Overview

### What is Raceway Instrumentation?

Raceway instrumentation libraries allow applications to automatically capture execution events and send them to a Raceway server for race condition detection and distributed tracing analysis.

### Supported Languages

- **TypeScript/Node.js** - Web APIs, serverless functions
- **Rust** - High-performance systems, async/concurrent apps
- **Go** - Microservices, goroutine-heavy applications
- **Python** - Web apps (FastAPI, Django), data pipelines

### Architecture

```
┌─────────────────┐
│   Your App      │
│  + Raceway SDK  │ ← Captures events
└────────┬────────┘
         │ HTTP POST /events
         ▼
┌─────────────────┐
│ Raceway Server  │ ← Analyzes races
└─────────────────┘
         │
         ▼
┌─────────────────┐
│   TUI / WebUI   │ ← Visualizes traces
└─────────────────┘
```

---

## Project Structure

### Repository Layout

```
raceway/
├── sdks/                      # All language SDKs
│   ├── typescript/
│   │   ├── src/
│   │   │   ├── index.ts       # Main entry point
│   │   │   ├── client.ts      # RacewayClient class
│   │   │   ├── transport.ts   # HTTP event transport
│   │   │   └── context.ts     # Thread/trace context
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   ├── rust/
│   │   ├── src/
│   │   │   ├── lib.rs         # Main entry point
│   │   │   ├── client.rs      # RacewayClient
│   │   │   ├── transport.rs   # HTTP transport
│   │   │   └── context.rs     # Thread-local context
│   │   ├── Cargo.toml
│   │   └── README.md
│   ├── go/
│   │   ├── raceway/
│   │   │   ├── client.go
│   │   │   ├── transport.go
│   │   │   └── context.go
│   │   ├── go.mod
│   │   └── README.md
│   └── python/
│       ├── raceway/
│       │   ├── __init__.py
│       │   ├── client.py
│       │   ├── transport.py
│       │   └── context.py
│       ├── setup.py
│       └── README.md
├── examples/
│   ├── typescript-banking/    # Demo apps with web UIs
│   ├── rust-banking/
│   ├── go-banking/
│   └── python-banking/
└── docs/
    └── INSTRUMENTATION_GUIDE.md  # This file
```

---

## SDK Requirements

### Core Components

Every SDK must implement these 4 components:

#### 1. Client API

```
RacewayClient (class/struct)
├── init(config: Config) → Client
├── captureEvent(event: Event) → void
├── captureStateChange(variable, oldVal, newVal, location) → void
├── captureAsyncSpawn(taskId) → void
├── captureAsyncAwait(futureId, location) → void
├── captureLockAcquire(lockId, lockType, location) → void
├── captureLockRelease(lockId, lockType, location) → void
├── captureHttpRequest(method, url, headers, body) → void
├── captureHttpResponse(status, headers, body, duration) → void
├── flush() → void (async)
└── shutdown() → void
```

**Example (Pseudo-code):**

```typescript
const raceway = new RacewayClient({
  endpoint: 'http://localhost:8080',
  serviceName: 'banking-api',
  environment: 'development'
});

// Capture a state change
raceway.captureStateChange(
  'alice.balance',  // variable name
  1000,             // old value
  900,              // new value
  'transfer.ts:42'  // location
);

// Auto-flush after 1 second or 100 events
raceway.shutdown(); // Final flush
```

#### 2. Event Transport

- **HTTP POST** to `{endpoint}/events`
- **Batching**: Buffer events (default: 100 events)
- **Auto-flush**: Timer-based flush (default: 1 second)
- **Non-blocking**: Use async HTTP client (don't block app)
- **Error handling**: Log errors, don't crash app

**Transport Interface:**

```
Transport
├── send(events: Event[]) → Promise<void>
├── startAutoFlush(interval: Duration) → void
└── stopAutoFlush() → void
```

#### 3. Context Management

Track per-thread/task context:

```
Context (thread-local or task-local)
├── traceId: UUID                   # Current trace
├── parentId: UUID | null           # Parent span
├── spanStack: Stack<UUID>          # Call hierarchy
├── causalityVector: Map<UUID, u64> # Vector clock
└── lockSet: Set<string>            # Held locks
```

**Key Operations:**
- `enterFunction(name)` → Push span to stack
- `exitFunction()` → Pop span from stack
- `getCurrentSpan()` → Get current span ID
- `incrementVectorClock()` → Advance causal clock
- `acquireLock(id)` → Add to lock set
- `releaseLock(id)` → Remove from lock set

#### 4. Configuration

```
Config
├── endpoint: string           # Raceway server URL
├── serviceName: string        # Application identifier
├── environment: string        # dev/staging/prod
├── batchSize: int            # Events before auto-flush (default: 100)
├── flushInterval: duration   # Time before auto-flush (default: 1s)
├── enabled: bool             # Feature flag (default: true)
└── debug: bool               # Verbose logging (default: false)
```

---

## Event Schema

### Standard Event Format

All SDKs must emit events matching this JSON schema:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "trace_id": "6fa459ea-ee8a-3ca4-894e-db77e160355e",
  "parent_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "timestamp": "2025-10-18T14:32:10.123Z",
  "kind": {
    "StateChange": {
      "variable": "alice.balance",
      "old_value": 1000,
      "new_value": 900,
      "location": "transfer.ts:42",
      "access_type": "Write"
    }
  },
  "metadata": {
    "thread_id": "main",
    "process_id": 12345,
    "service_name": "banking-api",
    "environment": "development",
    "tags": {},
    "duration_ns": null
  },
  "causality_vector": [
    ["550e8400-e29b-41d4-a716-446655440000", 1],
    ["6fa459ea-ee8a-3ca4-894e-db77e160355e", 2]
  ],
  "lock_set": []
}
```

### Event Types

#### StateChange
Captures variable reads/writes:

```json
{
  "kind": {
    "StateChange": {
      "variable": "counter",
      "old_value": 10,
      "new_value": 11,
      "location": "counter.rs:25",
      "access_type": "Write"  // Read | Write | AtomicRead | AtomicWrite | AtomicRMW
    }
  }
}
```

#### FunctionCall
Captures function entry:

```json
{
  "kind": {
    "FunctionCall": {
      "function_name": "transferMoney",
      "module": "banking",
      "args": {"from": "alice", "to": "bob", "amount": 100},
      "file": "transfer.ts",
      "line": 42
    }
  }
}
```

#### AsyncSpawn
Captures task/promise creation:

```json
{
  "kind": {
    "AsyncSpawn": {
      "task_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "spawned_by": "main::process_request"
    }
  }
}
```

#### AsyncAwait
Captures await/join operations:

```json
{
  "kind": {
    "AsyncAwait": {
      "future_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "awaited_at": "handler.rs:15"
    }
  }
}
```

#### LockAcquire / LockRelease
Captures mutex/lock operations:

```json
{
  "kind": {
    "LockAcquire": {
      "lock_id": "account_lock_alice",
      "lock_type": "Mutex",
      "location": "account.go:89"
    }
  }
}
```

#### HttpRequest / HttpResponse
Captures HTTP calls:

```json
{
  "kind": {
    "HttpRequest": {
      "method": "POST",
      "url": "https://api.example.com/v1/users",
      "headers": {"Content-Type": "application/json"},
      "body": {"name": "Alice"}
    }
  }
}
```

#### Error
Captures exceptions/errors:

```json
{
  "kind": {
    "Error": {
      "error_type": "ValueError",
      "message": "Invalid account balance",
      "stack_trace": ["File transfer.py, line 42", "..."]
    }
  }
}
```

#### Custom
User-defined events:

```json
{
  "kind": {
    "Custom": {
      "name": "cache_hit",
      "data": {"key": "user:123", "ttl": 3600}
    }
  }
}
```

---

## Demo App Requirements

### Banking API Demo

Each language needs **one complete demo app** that demonstrates race detection.

### Features

**Backend (HTTP Server):**
- `GET /` - Serve static index.html
- `GET /balances` - Get all account balances
- `POST /transfer` - Transfer money (**HAS RACE CONDITION**)
- `POST /deposit` - Deposit money (safe operation)
- `POST /reset` - Reset all balances to initial state

**Frontend (index.html):**
- Clean, simple UI that looks like a real banking app
- Display current account balances
- Buttons to trigger safe operations (normal traces)
- **Special button to trigger race condition** (concurrent transfers)
- Event log showing what happened
- Raceway integration status indicator

### Example Directory Structure

```
examples/typescript-banking/
├── server.ts              # Express/Fastify HTTP server
├── public/
│   └── index.html         # Web UI
├── package.json
└── README.md
```

### Web UI Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Raceway Banking Demo - TypeScript</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 800px;
      margin: 50px auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .card {
      background: white;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    button {
      padding: 10px 20px;
      margin: 5px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }
    .safe { background: #4CAF50; color: white; }
    .danger { background: #f44336; color: white; }
    .info { background: #2196F3; color: white; }
    #log {
      max-height: 300px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 12px;
      background: #000;
      color: #0f0;
      padding: 10px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <h1>💰 Raceway Banking Demo</h1>
  <p>Demonstrates race condition detection with TypeScript</p>

  <div class="card">
    <h2>Account Balances</h2>
    <div id="balances">Loading...</div>
    <button class="info" onclick="refreshBalances()">🔄 Refresh</button>
  </div>

  <div class="card">
    <h2>Safe Operations (Normal Traces)</h2>
    <p>These operations are properly instrumented but won't cause races:</p>
    <button class="safe" onclick="deposit('alice', 100)">Deposit $100 to Alice</button>
    <button class="safe" onclick="transfer('alice', 'bob', 50)">Transfer $50 (Alice → Bob)</button>
  </div>

  <div class="card">
    <h2>⚠️ Race Condition Triggers</h2>
    <p><strong>Warning:</strong> This will trigger a read-modify-write race!</p>
    <button class="danger" onclick="triggerRace()">
      🚨 Trigger Race: Concurrent Transfers
    </button>
    <p style="font-size: 12px; color: #666;">
      Sends 2 concurrent transfers from Alice. The second transfer will
      read stale balance and cause a lost update.
    </p>
  </div>

  <div class="card">
    <button class="info" onclick="reset()">🔄 Reset All Balances</button>
  </div>

  <div class="card">
    <h2>Event Log</h2>
    <div id="log"></div>
  </div>

  <script>
    const API = 'http://localhost:3000';

    function log(msg) {
      const logDiv = document.getElementById('log');
      const timestamp = new Date().toLocaleTimeString();
      logDiv.innerHTML += `[${timestamp}] ${msg}\n`;
      logDiv.scrollTop = logDiv.scrollHeight;
    }

    async function refreshBalances() {
      const res = await fetch(`${API}/balances`);
      const data = await res.json();
      const html = Object.entries(data)
        .map(([name, balance]) => `<div><strong>${name}:</strong> $${balance}</div>`)
        .join('');
      document.getElementById('balances').innerHTML = html;
      log('Balances refreshed');
    }

    async function deposit(account, amount) {
      log(`Depositing $${amount} to ${account}...`);
      await fetch(`${API}/deposit`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({account, amount})
      });
      log(`✓ Deposited $${amount} to ${account}`);
      refreshBalances();
    }

    async function transfer(from, to, amount) {
      log(`Transferring $${amount} from ${from} to ${to}...`);
      await fetch(`${API}/transfer`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({from, to, amount})
      });
      log(`✓ Transferred $${amount}`);
      refreshBalances();
    }

    async function triggerRace() {
      log('🚨 TRIGGERING RACE CONDITION...');
      log('Sending 2 concurrent transfers from Alice...');

      // Send 2 concurrent requests
      const [r1, r2] = await Promise.all([
        fetch(`${API}/transfer`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({from: 'alice', to: 'bob', amount: 100})
        }),
        fetch(`${API}/transfer`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({from: 'alice', to: 'charlie', amount: 200})
        })
      ]);

      log('✓ Both transfers completed');
      log('⚠️ Check Raceway TUI for race detection!');
      refreshBalances();
    }

    async function reset() {
      log('Resetting balances...');
      await fetch(`${API}/reset`, {method: 'POST'});
      log('✓ Balances reset');
      refreshBalances();
    }

    // Initial load
    refreshBalances();
    log('Banking demo initialized');
    log('✓ Connected to Raceway-instrumented API');
  </script>
</body>
</html>
```

### Demo README Template

```markdown
# {Language} Banking API - Raceway Demo

Simple banking API demonstrating race condition detection with Raceway.

## Quick Start

### 1. Start Raceway Server

```bash
cd ../../  # Go to raceway root
cargo run --release -- serve
```

Server will start at `http://localhost:8080`

### 2. Start Demo App

```bash
cd examples/{language}-banking
{language-specific run command}
# TypeScript: npm install && npm start
# Rust: cargo run
# Go: go run main.go
# Python: pip install -r requirements.txt && python app.py
```

App will start at `http://localhost:3000`

### 3. Open Web UI

Open your browser to: **http://localhost:3000**

### 4. Trigger a Race Condition

1. Click **"Trigger Race: Concurrent Transfers"** button
2. This sends 2 simultaneous transfers from Alice's account
3. A race condition occurs (lost update)

### 5. View in Raceway TUI

```bash
cd ../../
cargo run --release -- tui
```

- Press `Tab` or `v` to cycle through views
- Navigate to **"Cross-Trace Races"** view
- You'll see the detected race between the two transfers!

## The Race Condition Explained

### What Happens

```{language}
// Thread 1                    // Thread 2
balance = getBalance('alice')  balance = getBalance('alice')  // Both read $1000
// balance = $1000             // balance = $1000
newBalance = balance - 100     newBalance = balance - 200
// newBalance = $900           // newBalance = $800
setBalance('alice', 900)       setBalance('alice', 800)  // ← Overwrites Thread 1!
```

**Expected final balance:** $700 (1000 - 100 - 200)
**Actual final balance:** $800 (Thread 2 overwrites Thread 1's update)
**Lost:** $100!

### Why This Happens

Classic **read-modify-write race condition**:
1. No locking/synchronization
2. Both threads read the same initial value
3. Both compute new values independently
4. Second write overwrites first write
5. Result: Lost update

### How Raceway Detects It

Raceway tracks:
- **State changes** on `alice.balance` variable
- **Thread IDs** of each operation
- **Causal relationships** between events
- **Concurrent writes** without synchronization

When it sees two `StateChange` events:
- Same variable (`alice.balance`)
- Different threads
- No causal dependency (concurrent)
- Both writing values

→ **Race condition detected!**

## API Endpoints

| Endpoint | Method | Description | Race? |
|----------|--------|-------------|-------|
| `/` | GET | Serve web UI | - |
| `/balances` | GET | Get all account balances | No |
| `/deposit` | POST | Deposit money | No |
| `/transfer` | POST | Transfer money | **YES** |
| `/reset` | POST | Reset balances | No |

## Safe vs Unsafe Operations

### Safe (Normal Traces)
- Single deposit
- Single transfer
- All properly instrumented
- Raceway tracks execution but won't detect races

### Unsafe (Race Condition)
- **Concurrent transfers** (button in UI)
- Two simultaneous POST /transfer requests
- Causes read-modify-write race
- **Raceway will detect and report!**

## Example Output

### In Browser Console
```
[14:32:10] Banking demo initialized
[14:32:10] ✓ Connected to Raceway-instrumented API
[14:32:15] 🚨 TRIGGERING RACE CONDITION...
[14:32:15] Sending 2 concurrent transfers from Alice...
[14:32:15] ✓ Both transfers completed
[14:32:15] ⚠️ Check Raceway TUI for race detection!
[14:32:16] Balances refreshed
```

### In Raceway TUI
Navigate to **Cross-Trace Races** view:
```
🌍 Cross-Trace Races

⚠️  RACE DETECTED: alice.balance

Thread A (trace-abc123):
  [14:32:15.123] StateChange: alice.balance = 900
  Location: transfer.{ext}:42

Thread B (trace-def456):
  [14:32:15.125] StateChange: alice.balance = 800  ← Overwrites Thread A
  Location: transfer.{ext}:42

Severity: HIGH
Concurrent writes with no synchronization!
```

## Next Steps

1. Try different race scenarios
2. View traces in the TUI
3. Add proper locking to fix the race
4. Re-run and verify no race detected

## Learn More

- [Raceway Documentation](../../README.md)
- [Instrumentation Guide](../../docs/INSTRUMENTATION_GUIDE.md)
- [Race Detection Theory](../../docs/RACE_DETECTION.md)
```

---

## Implementation Checklist

### Per Language SDK

- [ ] **Core Client**
  - [ ] `RacewayClient` class/struct
  - [ ] `init()` / constructor
  - [ ] `captureEvent()` method
  - [ ] Event type helper methods (StateChange, AsyncSpawn, etc.)
  - [ ] `flush()` and `shutdown()` methods

- [ ] **Transport Layer**
  - [ ] HTTP POST client
  - [ ] Event batching (buffer up to N events)
  - [ ] Auto-flush timer (every N seconds)
  - [ ] Error handling (log, don't crash)
  - [ ] Non-blocking/async implementation

- [ ] **Context Management**
  - [ ] Thread-local or task-local storage
  - [ ] Trace ID tracking
  - [ ] Span stack (call hierarchy)
  - [ ] Vector clock (causality)
  - [ ] Lock set tracking

- [ ] **Configuration**
  - [ ] Config struct/object
  - [ ] Sensible defaults
  - [ ] Validation
  - [ ] Debug mode

- [ ] **Documentation**
  - [ ] SDK README with quick start
  - [ ] API reference
  - [ ] Examples
  - [ ] Installation instructions

### Per Demo App

- [ ] **Backend Implementation**
  - [ ] HTTP server (Express/Axum/Gin/Flask)
  - [ ] `GET /` - Serve static HTML
  - [ ] `GET /balances` - Get account balances
  - [ ] `POST /transfer` - Transfer money (with race)
  - [ ] `POST /deposit` - Deposit money (safe)
  - [ ] `POST /reset` - Reset balances
  - [ ] Raceway SDK integration
  - [ ] Event capture on all operations

- [ ] **Frontend (Web UI)**
  - [ ] Clean, simple design
  - [ ] Balance display
  - [ ] Safe operation buttons
  - [ ] Race trigger button
  - [ ] Event log
  - [ ] Reset button

- [ ] **Documentation**
  - [ ] README with quick start
  - [ ] Explanation of race condition
  - [ ] How to run
  - [ ] What to expect in TUI
  - [ ] Screenshots/examples

- [ ] **Testing**
  - [ ] Manual test: Start app, trigger race, view in TUI
  - [ ] Verify events arrive at Raceway server
  - [ ] Verify race detected in TUI

---

## Testing Strategy

### Manual Testing

1. **Start Raceway server:**
   ```bash
   cargo run --release -- serve
   ```

2. **Start demo app:**
   ```bash
   cd examples/{language}-banking
   {run command}
   ```

3. **Open web UI:**
   ```
   http://localhost:3000
   ```

4. **Trigger operations:**
   - Click safe operations (verify traces captured)
   - Click race trigger (verify race detected)

5. **Check TUI:**
   ```bash
   cargo run --release -- tui
   ```
   - Verify traces appear
   - Navigate to Cross-Trace view
   - Verify race is detected

### Automated Testing (Future)

- Unit tests for SDK components
- Integration tests (send events → verify in DB)
- Performance benchmarks (overhead measurement)
- CI/CD pipeline

---

## Publishing Guidelines

### Package Naming

- **TypeScript**: `@raceway/sdk` or `raceway`
- **Rust**: `raceway`
- **Go**: `github.com/raceway/raceway-go`
- **Python**: `raceway`

### Version Numbers

- Start at `0.1.0`
- Follow semantic versioning
- Increment minor version for new features
- Increment major version for breaking changes

### Package Metadata

**Required fields:**
- Name
- Version
- Description: "Race condition detection and distributed tracing for {Language}"
- Author: Your name/organization
- License: MIT
- Repository: GitHub URL
- Keywords: `tracing`, `debugging`, `race-detection`, `concurrency`, `instrumentation`

### Pre-Publish Checklist

- [ ] All core features working
- [ ] Demo app working end-to-end
- [ ] README complete
- [ ] License file included
- [ ] CHANGELOG.md updated
- [ ] Version number set
- [ ] Package metadata complete

### Publish Commands

```bash
# TypeScript
npm publish

# Rust
cargo publish

# Go
git tag v0.1.0
git push --tags

# Python
python -m build
twine upload dist/*
```

---

## FAQ

### Q: Do I need auto-instrumentation or is manual SDK enough?

**A:** Start with manual SDK. Auto-instrumentation (compiler plugins, code transformers) can be added later as a separate enhancement.

### Q: What's the minimum viable SDK?

**A:** Support for:
- `captureStateChange()` (most important for race detection)
- Basic HTTP transport
- Simple configuration

Everything else can be added incrementally.

### Q: How do I handle performance overhead?

**A:**
- Use async/non-blocking transport
- Batch events (don't send one at a time)
- Make instrumentation optional (feature flag)
- Target < 5% overhead in production

### Q: Can events from different languages be mixed?

**A:** Yes! All SDKs emit the same event schema. You can have a Python service and TypeScript service in the same trace.

### Q: How do I debug SDK issues?

**A:**
1. Enable debug mode in config
2. Check events are being sent (`console.log` / `println!` / etc.)
3. Verify server receives events (check server logs)
4. Use TUI to verify events appear

---

## Support

- **GitHub Issues**: Report bugs, request features
- **Discussions**: Ask questions, share examples
- **Documentation**: Main README, SDK READMEs

---

**Last Updated:** October 18, 2025
**Contributors:** [Your name]
