# @mode-7/raceway-node

Official Node.js/TypeScript SDK for [Raceway](https://github.com/mode-7/raceway) - AI-powered race condition detection for distributed systems.

## Features

- **🚀 Zero-Code Auto-Tracking**: Use JavaScript Proxies to automatically track variable access with zero manual instrumentation
- **🔌 Plug-and-Play Architecture**: Automatic context propagation using AsyncLocalStorage (same as OpenTelemetry)
- **🐛 Race Detection**: Detect data races, atomicity violations, and concurrency bugs in production
- **📊 Distributed Tracing**: Track causality across async operations and service boundaries
- **⚡ Production-Ready**: Low overhead (~9% total: 7% AsyncLocalStorage + 2% Proxies)

## Installation

```bash
npm install @mode-7/raceway-node
```

## Quick Start

### 1. Initialize & Add Middleware

```typescript
import express from 'express';
import { Raceway } from '@mode-7/raceway-node';

const raceway = new Raceway({
  serverUrl: 'http://localhost:8080',
  apiKey: process.env.RACEWAY_API_KEY,
  serviceName: 'my-service',
  environment: 'production'
});

const app = express();

// ✨ One line - automatic trace initialization for all requests
app.use(raceway.middleware());
```

### 2. Choose Your Instrumentation Style

**Option A: Zero-Code Auto-Tracking (Recommended)**

Wrap your state objects once and get automatic race detection:

```typescript
// Wrap your data structures once
const users = raceway.track({
  alice: { balance: 1000 },
  bob: { balance: 500 }
}, 'users');

// All access is now automatically tracked - ZERO manual instrumentation!
app.post('/transfer', async (req, res) => {
  const { from, to, amount } = req.body;

  // ✅ Auto-tracked Read
  const balance = users[from].balance;

  if (balance < amount) {
    return res.status(400).json({ error: 'Insufficient funds' });
  }

  // ✅ Auto-tracked Write (RACE CONDITION DETECTED!)
  users[from].balance -= amount;

  // ✅ Auto-tracked Write
  users[to].balance += amount;

  res.json({ success: true });
});
```

**That's it!** Raceway will automatically detect if two concurrent requests create a race condition.

**Option B: Manual Instrumentation**

For fine-grained control:

```typescript
app.post('/transfer', async (req, res) => {
  const startTime = Date.now();
  const { from, to, amount } = req.body;

  raceway.trackFunctionCall('transfer', { from, to, amount });

  const balance = users[from].balance;
  raceway.trackStateChange(`users.${from}.balance`, null, balance, 'Read');

  if (balance < amount) {
    raceway.trackHttpResponse(400, Date.now() - startTime);
    return res.status(400).json({ error: 'Insufficient funds' });
  }

  users[from].balance -= amount;
  raceway.trackStateChange(`users.${from}.balance`, balance, users[from].balance, 'Write');

  raceway.trackHttpResponse(200, Date.now() - startTime);
  res.json({ success: true });
});
```

## API Reference

### Authentication

If your Raceway server requires API keys, provide `apiKey` when constructing the SDK (or set `RACEWAY_API_KEY` in the environment). The client will automatically attach both `Authorization: Bearer <key>` and `X-Raceway-Key` headers to every request.

### `new Raceway(config)`

Creates a new Raceway client instance.

**Config Options:**

```typescript
interface RacewayConfig {
  serverUrl: string;              // Raceway server URL (required)
  apiKey?: string;                // API key (uses process.env.RACEWAY_API_KEY if omitted)
  serviceName?: string;           // Service identifier (default: 'unknown-service')
  instanceId?: string;            // Instance identifier for distributed clocks (default: hostname-PID)
  environment?: string;           // Environment (default: process.env.NODE_ENV || 'development')
  enabled?: boolean;              // Enable/disable tracking (default: true)
  batchSize?: number;             // Event batch size (default: 100)
  flushInterval?: number;         // Flush interval in ms (default: 1000)
  tags?: Record<string, string>;  // Custom tags for all events
  debug?: boolean;                // Debug logging (default: false)
}
```

### Core Methods

#### `raceway.middleware()`

Returns Express/Connect middleware for automatic trace initialization and context propagation.

**Usage:**
```typescript
app.use(raceway.middleware());
```

**What it does:**
- Parses incoming `traceparent`, `tracestate`, and `raceway-clock` headers (if present)
- Generates a new span/trace when no headers are provided
- Initializes AsyncLocalStorage context shared by all SDK helpers
- Automatically tracks HTTP request/response events

---

#### `raceway.track<T>(obj, basePath, trackNested = true)`

**🌟 The killer feature!** Wraps an object with JavaScript Proxies for zero-code automatic tracking.

**Parameters:**
- `obj` - Object to track
- `basePath` - Base path for property names (e.g., 'accounts')
- `trackNested` - Recursively track nested objects (default: true)

**Returns:** Proxied object with automatic tracking

**Example:**
```typescript
const state = raceway.track({
  counter: 0,
  users: {
    alice: { score: 100, items: [] }
  }
}, 'appState');

// All of these are automatically tracked:
state.counter++;                        // ✅ Auto-tracked Write
const score = state.users.alice.score;  // ✅ Auto-tracked Read (nested)
state.users.alice.score += 10;          // ✅ Auto-tracked Write (nested)
```

### Manual Tracking Methods

Use these for fine-grained control or when Proxies aren't suitable:

#### `trackStateChange(variable, oldValue, newValue, accessType)`

Track a variable read or write.

```typescript
raceway.trackStateChange('counter', 0, 1, 'Write');
raceway.trackStateChange('balance', null, 100, 'Read');
```

#### `trackFunctionCall(functionName, args)`

Track a function call.

```typescript
raceway.trackFunctionCall('processPayment', { userId: 123, amount: 50 });
```

#### `trackHttpRequest(method, url)`

Track an HTTP request (automatically called by middleware).

```typescript
raceway.trackHttpRequest('POST', '/api/users');
```

#### `trackHttpResponse(status, durationMs)`

Track an HTTP response.

```typescript
raceway.trackHttpResponse(200, 45);
```

#### `raceway.propagationHeaders(additionalHeaders?)`

Generate outbound headers for cross-service calls. The SDK increments the local vector clock and returns a header map you can spread into `fetch`, `axios`, or any HTTP client.

```typescript
const headers = raceway.propagationHeaders();

await fetch('http://ledger.internal/debit', {
  method: 'POST',
  headers: {
    ...headers,
    'content-type': 'application/json'
  },
  body: JSON.stringify({ amount: 100 })
});
```

The map includes:
- `traceparent` / `tracestate` (W3C Trace Context)
- `raceway-clock` (Raceway vector clock payload)

Call this only after the middleware has initialised the request context; otherwise the SDK throws an error.

### Lifecycle Methods

#### `raceway.flush()`

Manually flush buffered events to the server.

```typescript
await raceway.flush();
```

#### `raceway.stop()`

Stop the SDK and flush remaining events.

```typescript
await raceway.stop();
```

## Architecture & Performance

### Context Propagation

Raceway uses **AsyncLocalStorage** - the exact same mechanism as OpenTelemetry - for automatic context propagation across async operations. This ensures traces are maintained across:

- HTTP requests
- Promise chains
- Async/await
- setTimeout/setInterval
- Event emitters

### Virtual Thread IDs

Since JavaScript is single-threaded, Raceway generates unique "virtual thread IDs" (UUIDs) for each request context. This allows the race detector to identify concurrent operations even within the same Node.js process.

### Performance Comparison

| Feature | OpenTelemetry | Raceway (Auto-Track) |
|---------|---------------|----------------------|
| Context Mechanism | AsyncLocalStorage | ✅ AsyncLocalStorage (same!) |
| Auto-Instrumentation | Monkey-patching | ✅ Proxy-based |
| **Total Overhead** | **~87%** | **✅ ~9%** |
| Tracks HTTP requests | ✅ | ✅ |
| Tracks variable access | ❌ | **✅ Unique!** |
| Race detection | ❌ | **✅ Unique!** |

**Performance Breakdown:**
- AsyncLocalStorage: ~7% (industry standard, same as OTel)
- Proxy-based tracking: ~2%
- **Total: ~9%** vs OpenTelemetry's ~87%

## Complete Example

```typescript
import express from 'express';
import { Raceway } from '@mode-7/raceway-node';

// Initialize Raceway
const raceway = new Raceway({
  serverUrl: 'http://localhost:8080',
  serviceName: 'banking-api',
  environment: 'production',
  debug: false
});

// Wrap shared state with auto-tracking
const accounts = raceway.track({
  alice: { balance: 1000 },
  bob: { balance: 500 },
  charlie: { balance: 300 }
}, 'accounts');

const app = express();
app.use(express.json());

// Add Raceway middleware
app.use(raceway.middleware());

// Simple transfer endpoint - ZERO manual instrumentation!
app.post('/api/transfer', async (req, res) => {
  const startTime = Date.now();
  const { from, to, amount } = req.body;

  // Optional: Track function call for better visibility
  raceway.trackFunctionCall('transferMoney', { from, to, amount });

  // Validate
  if (!accounts[from] || !accounts[to]) {
    raceway.trackHttpResponse(404, Date.now() - startTime);
    return res.status(404).json({ error: 'Account not found' });
  }

  // Simulate async processing
  await new Promise(resolve => setTimeout(resolve, 10));

  // ✅ Auto-tracked Read
  const balance = accounts[from].balance;

  if (balance < amount) {
    raceway.trackHttpResponse(400, Date.now() - startTime);
    return res.status(400).json({ error: 'Insufficient funds' });
  }

  await new Promise(resolve => setTimeout(resolve, 10));

  // ✅ Auto-tracked Write (RACE CONDITION WINDOW!)
  accounts[from].balance -= amount;

  // ✅ Auto-tracked Write
  accounts[to].balance += amount;

  raceway.trackHttpResponse(200, Date.now() - startTime);
  res.json({
    success: true,
    from: { account: from, balance: accounts[from].balance },
    to: { account: to, balance: accounts[to].balance }
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await raceway.stop();
  process.exit(0);
});

app.listen(3000);
```

### Testing Race Conditions

Send two concurrent transfers:

```bash
TRACE_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"

curl -X POST http://localhost:3000/api/transfer \
  -H "Content-Type: application/json" \
  -H "X-Trace-ID: $TRACE_ID" \
  -d '{"from":"alice","to":"bob","amount":100}' &

curl -X POST http://localhost:3000/api/transfer \
  -H "Content-Type: application/json" \
  -H "X-Trace-ID: $TRACE_ID" \
  -d '{"from":"alice","to":"charlie","amount":200}' &

wait
```

Raceway will detect the race: both requests read `balance=1000`, then write conflicting values, causing money to be lost!

## Best Practices

1. **Use Auto-Tracking for Shared State**: Wrap all shared data structures with `track()` to get comprehensive race detection with minimal code.

2. **Validate Trace IDs**: If propagating trace IDs via HTTP headers, ensure they're valid UUIDs. The middleware will auto-generate one if invalid.

3. **Graceful Shutdown**: Always call `raceway.stop()` before exiting:
   ```typescript
   process.on('SIGINT', async () => {
     await raceway.stop();
     process.exit(0);
   });
   ```

4. **Production Debugging**: Use environment variables to enable debug mode temporarily:
   ```typescript
   const raceway = new Raceway({
     debug: process.env.RACEWAY_DEBUG === 'true'
   });
   ```

5. **Selective Tracking**: Not all data needs tracking. Focus on shared mutable state that multiple requests might access concurrently.

## TypeScript Support

Full TypeScript support with complete type definitions:

```typescript
import { Raceway, RacewayConfig, Event, EventData } from '@mode-7/raceway-node';

const config: RacewayConfig = {
  serverUrl: 'http://localhost:8080',
  serviceName: 'my-service'
};

const raceway = new Raceway(config);

// Type-safe auto-tracking
interface User {
  balance: number;
  email: string;
}

const users = raceway.track<Record<string, User>>({
  alice: { balance: 1000, email: 'alice@example.com' }
}, 'users');

// TypeScript knows the shape!
users.alice.balance += 100;  // ✅ Type-safe
```

## Viewing Results

### Web UI

```bash
# Start Raceway server (if not already running)
raceway serve

# Open http://localhost:8080 in your browser
```

### Terminal UI

```bash
raceway tui
```

**Keyboard shortcuts:**
- `↑↓` or `j/k`: Navigate traces
- `Enter`: View trace details
- `r`: Refresh
- `q`: Quit

### API

```bash
# List all traces
curl http://localhost:8080/api/traces

# Get specific trace
curl http://localhost:8080/api/traces/<trace-id>

# Analyze for race conditions
curl http://localhost:8080/api/analyze
```

## Examples

See the [examples/express-banking](../../examples/express-banking) directory for a complete working example demonstrating:

- Plug-and-play middleware integration
- Zero-code auto-tracking with Proxies
- Race condition detection in a banking API
- Concurrent transfer scenario

## Troubleshooting

### Events not appearing

1. Check server is running: `curl http://localhost:8080/health`
2. Enable debug mode: `new Raceway({ debug: true })`
3. Check console for errors
4. Manually flush: `await raceway.flush()`
5. Verify trace IDs are valid UUIDs

### 422 Validation Errors

- Ensure trace IDs are valid UUIDs (8-4-4-4-12 format)
- The middleware validates and auto-generates if invalid
- Check event structure matches backend schema

### High Memory Usage

Reduce batch size and flush interval:

```typescript
const raceway = new Raceway({
  serverUrl: 'http://localhost:8080',
  batchSize: 10,
  flushInterval: 100
});
```

## Migration from Old API

If you're using the old manual API (`startTrace`/`endTrace`), migrate to the new plug-and-play API:

**Old (Deprecated):**
```typescript
const trace = raceway.startTrace();
raceway.captureStateChange('balance', 100, null);
raceway.endTrace();
```

**New (Recommended):**
```typescript
app.use(raceway.middleware());  // Automatic trace management

const state = raceway.track({ balance: 100 }, 'state');
// Access automatically tracked!
```

## License

MIT

## Support

- **Documentation**: https://docs.raceway.dev
- **Examples**: https://github.com/mode-7/raceway/tree/main/examples
- **Issues**: https://github.com/mode-7/raceway/issues
- **Discord**: https://discord.gg/raceway
