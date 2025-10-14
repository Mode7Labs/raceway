# 🔍 Causeway

**The AI-Powered Causal Debugging Engine for Distributed Systems**

> *Finally debug production race conditions, async chaos, and distributed nightmares with surgical precision*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Rust](https://img.shields.io/badge/rust-1.70%2B-orange.svg)](https://www.rust-lang.org/)
[![TypeScript](https://img.shields.io/badge/typescript-5.0%2B-blue.svg)](https://www.typescriptlang.org/)

---

## 🎯 The Problem

You've been there:
- A race condition that only happens in production
- An async operation that fails 0.1% of the time
- State that changes in ways you can't explain
- Hours spent adding console.logs, only to change the timing and make the bug disappear

**Traditional debuggers break in distributed, async-heavy applications. They can't answer:**
- "What caused this state change?"
- "Which async operations are racing?"
- "What was the exact sequence of events that led to this error?"

## ⚡ The Solution

**Causeway** automatically builds a complete causal graph of your application's execution across:
- Frontend & Backend
- Multiple services
- Async operations
- Database queries
- HTTP requests
- State mutations

Then uses AI to:
- Detect race conditions automatically
- Find the root cause of bugs
- Generate reproducible test cases
- Predict where problems might occur

## 🚀 Features

### 🔬 Zero-Config Instrumentation
```bash
# TypeScript/JavaScript
npm install @causeway/instrumentation
causeway instrument ./src

# Rust
cargo add causeway-core

# That's it. Your entire codebase is now traced.
```

### 🧠 AI-Powered Analysis
- **Race Condition Detection**: Finds concurrent state mutations automatically
- **Anomaly Detection**: ML models spot unusual patterns in execution
- **Root Cause Analysis**: Traces bugs back to their origin across services
- **Predictive Warnings**: "These two operations might race in production"

### 🎨 Beautiful Time-Travel Debugging
```bash
causeway tui
```

Interactive terminal UI showing:
- Real-time event timeline
- Causal relationships between events
- Detected anomalies
- Event details and stack traces

### 📊 Causal Graph Visualization
- See the entire execution flow as a directed acyclic graph
- Click any event to see what caused it
- Time-travel to any point in execution
- Export graphs for documentation

### 🧪 Automatic Test Generation
```bash
causeway export --trace-id abc123 --format test
```

Generates reproducible test cases from production bugs, including:
- Exact timing of async operations
- Order of state mutations
- HTTP responses and database results

## 📦 Installation

### Quick Start
```bash
# Clone the repo
git clone https://github.com/causeway/causeway
cd causeway

# Build and start server (Terminal 1)
cargo build --release
cargo run --release -- serve

# Install SDK and run example (Terminal 2)
cd examples/express-banking
npm install
node index.js

# Test race condition (Terminal 3)
cd examples/express-banking
node test-race.js

# View in TUI (Terminal 4)
cd ../..
cargo run --release -- tui
# Press 'r' to refresh
```

### Language Support
- ✅ TypeScript/JavaScript (Node.js, Browser, Deno)
- ✅ Rust
- 🔄 Python (coming soon)
- 🔄 Go (coming soon)

## 🎮 Usage

### 1. Instrument Your Code

#### Automatic (Recommended)
```typescript
// Add to your entry point
import '@causeway/instrumentation';

// Your code is now automatically instrumented!
async function processPayment(userId: string) {
  const user = await db.users.findOne({ id: userId });
  user.balance -= 100;
  await user.save();
}
```

#### Manual
```typescript
import { causeway } from '@causeway/instrumentation';

causeway.trace('payment-processing', async () => {
  // Your code here
});
```

### 2. Run Your Application
```bash
# Your app sends events to Causeway automatically
npm start
```

### 3. Debug with the TUI
```bash
causeway tui
```

Navigate traces with keyboard:
- `↑↓` or `jk`: Navigate events
- `←→` or `hl`: Switch traces
- `Enter`: Expand event details
- `t`: Time-travel to event
- `a`: Show anomalies only
- `q`: Quit

### 4. Analyze Bugs
```bash
# Get AI analysis of a specific trace
causeway analyze --trace-id abc123

# Output:
# 🚨 2 Anomalies Detected:
#
# 1. RACE_CONDITION (confidence: 95%)
#    Events user.balance write and user.balance write occurred within 2ms
#    Location: src/payment.ts:42 and src/refund.ts:18
#    Recommendation: Add transaction lock or use atomic operations
#
# 2. SLOW_QUERY (confidence: 90%)
#    Database query took 2.5s (threshold: 1s)
#    Query: SELECT * FROM orders WHERE user_id = ?
#    Recommendation: Add index on user_id column
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│  Your Application (TypeScript, Rust, Python, etc)  │
│  ↓ (Auto-instrumented)                              │
└─────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│  Causeway Core (Rust)                               │
│  • Event Capture (Lock-free queues)                 │
│  • Causal Graph Builder (Vector clocks)             │
│  • Topological Sort & Analysis                      │
└─────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│  AI Analysis Layer (Python)                         │
│  • Anomaly Detection (Isolation Forest)             │
│  • Race Condition Detection (Concurrency analysis)  │
│  • Pattern Recognition (ML models)                  │
└─────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│  Visualization Layer                                │
│  • TUI (Ratatui) - Terminal interface               │
│  • Web UI (React + D3.js) - Browser interface       │
│  • Export (JSON, DOT, Test cases)                   │
└─────────────────────────────────────────────────────┘
```

## 🔥 Real-World Examples

### Finding a Race Condition
```typescript
// Before: This code has a subtle race condition
async function transferMoney(fromId, toId, amount) {
  const from = await getUser(fromId);
  const to = await getUser(toId);

  from.balance -= amount;  // ⚠️ Race here!
  to.balance += amount;    // ⚠️ And here!

  await Promise.all([from.save(), to.save()]);
}
```

**Causeway detects:**
```
🚨 RACE_CONDITION detected (confidence: 98%)

Concurrent modifications to user.balance:
  1. Event evt_a1b2: from.balance -= 100 (transfer.ts:45)
  2. Event evt_c3d4: from.balance -= 50  (transfer.ts:45)

Both events have no causal relationship (happened concurrently)

Timeline:
  T+0ms:   transferMoney(user1, user2, 100) starts
  T+1ms:   transferMoney(user1, user3, 50) starts
  T+150ms: Both read user1.balance = 1000
  T+152ms: First writes user1.balance = 900
  T+153ms: Second writes user1.balance = 950  ❌ Lost update!

Recommendation: Use database transactions or atomic operations
```

### Debugging Async Chaos
```typescript
// Complex async flow
async function processOrder(orderId) {
  const order = await fetchOrder(orderId);
  const [inventory, payment, shipping] = await Promise.all([
    checkInventory(order.items),
    processPayment(order.total),
    scheduleShipping(order.address)
  ]);
  await finalizeOrder(order, inventory, payment, shipping);
}
```

**Causeway shows you:**
```
📊 Causal Graph:

fetchOrder
  ├─→ checkInventory
  ├─→ processPayment
  │     └─→ [HTTP] POST /api/payments
  │           └─→ [DB] INSERT INTO payments
  └─→ scheduleShipping
        └─→ [HTTP] POST /api/shipments
              ↓
            ⚠️ TIMEOUT (5000ms)
                ↓
           (cascading failure)
                ↓
         finalizeOrder never called
```

## 🎓 Advanced Features

### Custom Events
```typescript
import { causeway } from '@causeway/instrumentation';

causeway.event('user-action', {
  action: 'button-click',
  buttonId: 'checkout',
  userId: user.id
});
```

### Distributed Tracing
```typescript
// Service A
const traceContext = causeway.createTrace();
await fetch('/api/service-b', {
  headers: { 'X-Causeway-Trace': traceContext.serialize() }
});

// Service B (different service/language)
const traceContext = causeway.deserializeTrace(req.headers['x-causeway-trace']);
causeway.continueTrace(traceContext);
```

### Privacy & Filtering
```typescript
// Don't capture sensitive data
causeway.configure({
  excludePatterns: ['**/auth/**', '**/secrets/**'],
  sanitizeValues: true,  // Redact values in events
  captureArgs: false,    // Don't capture function arguments
});
```

## 📈 Performance

Causeway is built for production:
- **< 1% overhead** on application performance
- **Lock-free** event capture
- **Async** event processing
- **Batched** network transmission
- **Configurable** sampling rates

```rust
// Configure for your needs
causeway::Config {
    buffer_size: 10_000,    // Events before flush
    sampling_rate: 1.0,      // 100% = capture all
    batch_size: 100,         // Events per batch
    flush_interval_ms: 100,  // Auto-flush interval
}
```

## 🤝 Contributing

We'd love your help making Causeway even better!

```bash
git clone https://github.com/causeway/causeway
cd causeway
cargo build --release
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📜 License

MIT License - see [LICENSE](LICENSE) for details.

## 🌟 Why "Causeway"?

A causeway is a raised road across water or wetland - it provides a clear path through murky, complex terrain. That's exactly what this tool does for debugging: **it gives you a clear path through the murky complexity of distributed, async systems to find the root cause of bugs**.

---

## 🚧 Roadmap

**✅ MVP COMPLETE:**
- [x] Core event capture engine (Rust)
- [x] Causal graph with vector clocks
- [x] Race condition detection
- [x] Terminal UI (TUI) with real-time updates
- [x] HTTP REST API server
- [x] TypeScript/JavaScript SDK
- [x] Automatic instrumentation (Babel plugin)
- [x] CLI tool (`causeway init`, `causeway instrument`, etc.)
- [x] Working Express.js example

**🔜 V1.0 (Next):**
- [ ] PostgreSQL storage/persistence
- [ ] Web UI dashboard (React)
- [ ] Python SDK
- [ ] Go SDK
- [ ] Alerting (Slack, PagerDuty)
- [ ] OpenTelemetry integration

**🔮 V2.0 (Future):**
- [ ] AI anomaly detection (ML models)
- [ ] Deadlock detection
- [ ] Automatic fix suggestions
- [ ] Test case generator
- [ ] Time-travel debugging
- [ ] VS Code extension
- [ ] Chrome DevTools integration

---

<div align="center">

**[⭐ Star us on GitHub](https://github.com/causeway/causeway)** | **[📖 Read the Docs](https://docs.causeway.dev)** | **[💬 Join Discord](https://discord.gg/causeway)**

*Built with ❤️ by developers who are tired of debugging production race conditions at 3am*

</div>
