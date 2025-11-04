# TypeScript/Node.js SDK

Official Node.js/TypeScript SDK for Raceway - Race condition detection and distributed tracing for Node.js applications.

## Features

- **Three instrumentation approaches:** Proxy-based, Babel plugin, or manual tracking
- **Automatic lock tracking helpers:** `withLock()` for easy lock instrumentation
- **Automatic context propagation** using AsyncLocalStorage
- **Zero-code auto-tracking** with JavaScript Proxies
- **Build-time instrumentation** with Babel plugin (optional)
- **Manual instrumentation API** for fine-grained control
- **Distributed tracing** across service boundaries (W3C Trace Context)
- **Race condition detection** and concurrency bug analysis
- **Express/Connect middleware** support

## Installation

```bash
npm install @mode-7/raceway
```

## Quick Start

### 1. Initialize with Middleware

```typescript
import express from 'express';
import { Raceway } from '@mode-7/raceway';

const raceway = new Raceway({
  serverUrl: 'http://localhost:8080',
  serviceName: 'my-service',
  instanceId: 'instance-1'
});

const app = express();
app.use(express.json());
app.use(raceway.middleware());

app.listen(3000);
```

### 2. Track Events

**Option A: Auto-Tracking (Recommended)**

Wrap state objects with Proxies for automatic tracking:

```typescript
const accounts = raceway.track({
  alice: { balance: 1000 },
  bob: { balance: 500 }
}, 'accounts');

app.post('/transfer', async (req, res) => {
  const { from, to, amount } = req.body;

  // Automatically tracked
  const balance = accounts[from].balance;

  if (balance < amount) {
    return res.status(400).json({ error: 'Insufficient funds' });
  }

  // Automatically tracked writes
  accounts[from].balance -= amount;
  accounts[to].balance += amount;

  res.json({ success: true });
});
```

**Option B: Manual Tracking**

```typescript
app.post('/transfer', async (req, res) => {
  const { from, to, amount } = req.body;

  raceway.trackFunctionCall('transfer', { from, to, amount });

  const balance = accounts[from].balance;
  raceway.trackStateChange(`accounts.${from}.balance`, null, balance, 'Read');

  if (balance < amount) {
    return res.status(400).json({ error: 'Insufficient funds' });
  }

  accounts[from].balance -= amount;
  raceway.trackStateChange(`accounts.${from}.balance`, balance, accounts[from].balance, 'Write');

  res.json({ success: true });
});
```

**Option C: Babel Plugin (Automatic)**

For fully automatic instrumentation with zero code changes:

```bash
npm install --save-dev babel-plugin-raceway
```

```javascript
// babel.config.js
module.exports = {
  plugins: ['babel-plugin-raceway']
};
```

```typescript
// Initialize runtime once
import { initializeRuntime } from '@mode-7/raceway/runtime';

initializeRuntime({
  serverUrl: 'http://localhost:8080',
  serviceName: 'my-service'
});

app.use(raceway.middleware());

// Your code - automatically instrumented!
app.post('/transfer', async (req, res) => {
  const { from, to, amount } = req.body;

  // ✅ All reads/writes automatically tracked by Babel
  const balance = accounts[from].balance;
  if (balance < amount) {
    return res.status(400).json({ error: 'Insufficient funds' });
  }

  accounts[from].balance -= amount;
  accounts[to].balance += amount;

  res.json({ success: true });
});
```

### 3. Lock Tracking

Track locks with automatic helpers to avoid manual acquire/release tracking:

```typescript
import { Mutex } from 'async-mutex';

const accountLock = new Mutex();

// Before: Manual (tedious)
await accountLock.acquire();
raceway.trackLockAcquire('account_lock', 'Mutex');
try {
  accounts.alice.balance -= 100;
} finally {
  raceway.trackLockRelease('account_lock', 'Mutex');
  accountLock.release();
}

// After: withLock helper (automatic)
await raceway.withLock(accountLock, 'account_lock', async () => {
  accounts.alice.balance -= 100;
  // Lock acquire/release automatically tracked!
});
```

## Middleware Patterns

The SDK middleware can be applied globally or per-route. Choose the pattern that best fits your environment.

### Global Middleware (Development/Quick Start)

```typescript
app.use(raceway.middleware());
```

Traces all routes. Good for development and getting started quickly.

### Per-Route Middleware (Production Recommended)

```typescript
// Health checks and metrics - no tracing
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/metrics', metricsHandler);

// Business endpoints - traced
app.post('/api/transfer', raceway.middleware(), transferHandler);
app.get('/api/users/:id', raceway.middleware(), getUserHandler);
app.post('/api/checkout', raceway.middleware(), checkoutHandler);
```

**Why per-route is better for production:**

- **No health check noise**: Load balancers polling `/health` every 10 seconds create 8,640 traces per day per instance
- **Excludes non-business endpoints**: Metrics, static assets, and internal endpoints don't pollute your analysis
- **Better signal-to-noise ratio**: Only trace what matters for debugging and analysis
- **Lower database load**: Fewer events = faster ingestion, less storage, better query performance
- **Cost savings**: Reduced database size and network traffic

**Example: Health check impact**

If you have 5 service instances with load balancers checking health every 10 seconds:
- Global middleware: **43,200 health check traces per day**
- Per-route middleware: **0 health check traces**

### Helper Pattern (Recommended for Clean Syntax)

For cleaner per-route middleware, create a helper:

```typescript
const traced = (...handlers) => [raceway.middleware(), ...handlers];

// Use it on routes
app.post('/api/transfer', ...traced(transferHandler));
app.get('/api/users/:id', ...traced(authMiddleware, getUserHandler));
app.post('/api/checkout', ...traced(authMiddleware, validateCart, checkoutHandler));
```

This pattern:
- Keeps route definitions clean and readable
- Makes it easy to add authentication and other middleware
- Ensures you never forget to add tracing to business endpoints

### When to Use Each Pattern

| Pattern | Use When | Trade-offs |
|---------|----------|-----------|
| **Global** | Development, early prototyping | Simple setup, but creates noise from health checks |
| **Per-Route** | Production, mature applications | Requires discipline, but much cleaner traces |
| **Helper** | Production with many routes | Best of both worlds - clean syntax with selective tracing |

## Which Approach Should I Use?

**Quick Decision Tree:**
- **Have shared mutable objects?** → Use `raceway.track()` (Option A)
- **Need to track local variables?** → Use Babel plugin (Option C)
- **Want precise control?** → Use manual tracking (Option B)
- **Need lock tracking?** → Use `withLock()` helpers

## Distributed Tracing

The SDK implements W3C Trace Context and Raceway vector clocks for distributed tracing across services.

### Propagating Trace Context

Use `propagationHeaders()` when calling downstream services:

```typescript
import axios from 'axios';

app.post('/checkout', async (req, res) => {
  const { orderId } = req.body;

  // Get propagation headers
  const headers = raceway.propagationHeaders();

  // Call downstream service
  const inventoryResult = await axios.post(
    'http://inventory-service/reserve',
    { orderId },
    { headers }
  );

  const paymentResult = await axios.post(
    'http://payment-service/charge',
    { orderId },
    { headers }
  );

  res.json({ success: true });
});
```

### What Gets Propagated

The middleware automatically:
- Parses incoming `traceparent`, `tracestate`, and `raceway-clock` headers
- Generates new span IDs for this service
- Returns headers for downstream calls via `propagationHeaders()`

Headers propagated:
- `traceparent`: W3C Trace Context (trace ID, span ID, trace flags)
- `tracestate`: W3C vendor-specific state
- `raceway-clock`: Raceway vector clock for causality tracking

### Cross-Service Trace Merging

Events from all services sharing the same trace ID are automatically merged by the Raceway backend. The backend recursively follows distributed edges to construct complete traces across arbitrary service chain lengths.

## Authentication

If your Raceway server is configured with API key authentication, provide the key when initializing the SDK:

```typescript
const raceway = new Raceway({
  serverUrl: 'http://localhost:8080',
  serviceName: 'my-service',
  apiKey: process.env.RACEWAY_API_KEY  // Read from environment variable
});
```

**Best Practices:**
- Store API keys in environment variables, never hardcode them
- Use different keys for different environments (dev, staging, production)
- Rotate keys periodically for security
- The SDK will include the API key in the `Authorization` header: `Bearer <your-api-key>`

**Without Authentication:**

If your Raceway server doesn't require authentication, simply omit the `apiKey` parameter:

```typescript
const raceway = new Raceway({
  serverUrl: 'http://localhost:8080',
  serviceName: 'my-service'
});
```

## API Reference

### Configuration

```typescript
interface RacewayConfig {
  serverUrl: string;              // Raceway server URL (required)
  apiKey?: string;                // API key for authentication
  serviceName?: string;           // Service name (default: 'unknown-service')
  instanceId?: string;            // Instance ID (default: hostname-PID)
  environment?: string;           // Environment (default: NODE_ENV || 'development')
  enabled?: boolean;              // Enable/disable tracking (default: true)
  batchSize?: number;             // Batch size (default: 100)
  flushInterval?: number;         // Flush interval in ms (default: 1000)
  tags?: Record<string, string>;  // Custom tags
  debug?: boolean;                // Debug mode (default: false)
}
```

### Core Methods

#### `raceway.middleware()`

Returns Express/Connect middleware for automatic trace initialization.

**Behavior:**
- Parses incoming `traceparent`, `tracestate`, `raceway-clock` headers
- Generates new span/trace when headers are missing
- Initializes AsyncLocalStorage context for all SDK methods
- Automatically tracks HTTP request/response events

#### `raceway.track<T>(obj, basePath, trackNested = true)`

Wrap an object with Proxies for automatic read/write tracking.

```typescript
const state = raceway.track({
  counter: 0,
  users: { alice: { score: 100 } }
}, 'appState');

// All access automatically tracked
state.counter++;
const score = state.users.alice.score;
```

#### `raceway.trackStateChange(variable, oldValue, newValue, accessType)`

Manually track a variable access.

```typescript
raceway.trackStateChange('counter', 0, 1, 'Write');
raceway.trackStateChange('balance', null, 100, 'Read');
```

#### `raceway.trackFunctionCall(functionName, args)`

Track a function call.

```typescript
raceway.trackFunctionCall('processPayment', { userId: 123, amount: 50 });
```

#### `raceway.trackLockAcquire(lockId, lockType?)`

Manually track lock acquisition.

```typescript
raceway.trackLockAcquire('account_lock', 'Mutex');
```

#### `raceway.trackLockRelease(lockId, lockType?)`

Manually track lock release.

```typescript
raceway.trackLockRelease('account_lock', 'Mutex');
```

#### `raceway.withLock(lock, lockId, lockType?, fn)`

Execute a function with automatic lock tracking (async).

```typescript
await raceway.withLock(myLock, 'account_lock', 'Mutex', async () => {
  // Lock automatically tracked
  await updateAccount();
});
```

**Lock object formats supported:**
- `{ lock(): Promise<void>; unlock(): void }` (async-mutex)
- `{ acquire(): void; release(): void }` (synchronous locks)

#### `raceway.withLockSync(lock, lockId, lockType?, fn)`

Execute a function with automatic lock tracking (sync).

```typescript
raceway.withLockSync(myLock, 'account_lock', 'Mutex', () => {
  // Lock automatically tracked
  updateAccountSync();
});
```

#### `raceway.trackHttpResponse(status, durationMs)`

Track an HTTP response.

```typescript
raceway.trackHttpResponse(200, 45);
```

#### `raceway.propagationHeaders(additionalHeaders?)`

Generate headers for downstream service calls.

```typescript
const headers = raceway.propagationHeaders();

await fetch('http://downstream-service/api', {
  method: 'POST',
  headers: {
    ...headers,
    'content-type': 'application/json'
  },
  body: JSON.stringify(data)
});
```

**Returns:** Object with `traceparent`, `tracestate`, and `raceway-clock` headers.

**Throws:** Error if called outside request context.

### Lifecycle Methods

#### `raceway.flush()`

Manually flush buffered events.

```typescript
await raceway.flush();
```

#### `raceway.stop()`

Stop the SDK and flush remaining events.

```typescript
await raceway.stop();
```

## Context Propagation

The SDK uses AsyncLocalStorage (same as OpenTelemetry) for automatic context propagation across:

- HTTP requests
- Promise chains
- async/await
- setTimeout/setInterval
- Event emitters

No manual context passing required.

## Best Practices

1. **Use per-route middleware in production**: Apply `raceway.middleware()` to business endpoints only, excluding health checks, metrics, and static assets to avoid trace noise
2. **Use auto-tracking for shared state**: Wrap shared data structures with `track()` for comprehensive coverage
3. **Propagate headers to downstream services**: Always use `propagationHeaders()` when calling other services
4. **Graceful shutdown**: Call `raceway.stop()` before process exit:
   ```typescript
   process.on('SIGINT', async () => {
     await raceway.stop();
     process.exit(0);
   });
   ```
5. **Use unique instance IDs**: Set `instanceId` to differentiate service instances in distributed environments
6. **Start with global middleware for development**: Use `app.use(raceway.middleware())` during development, then switch to per-route for production

## Distributed Example

Complete example with TypeScript → Python → Go chain:

```typescript
import express from 'express';
import axios from 'axios';
import { Raceway } from '@mode-7/raceway';

const raceway = new Raceway({
  serverUrl: 'http://localhost:8080',
  serviceName: 'api-gateway',
  instanceId: 'gateway-1'
});

const app = express();
app.use(express.json());

// Health check - not traced
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Business endpoint - traced
app.post('/api/order', raceway.middleware(), async (req, res) => {
  const { orderId } = req.body;

  raceway.trackFunctionCall('createOrder', { orderId });

  // Call inventory service with propagation headers
  const inventoryHeaders = raceway.propagationHeaders();
  const inventoryResult = await axios.post(
    'http://inventory-service:3001/reserve',
    { orderId },
    { headers: inventoryHeaders }
  );

  // Call payment service with propagation headers
  const paymentHeaders = raceway.propagationHeaders();
  const paymentResult = await axios.post(
    'http://payment-service:3002/charge',
    { orderId, amount: inventoryResult.data.total },
    { headers: paymentHeaders }
  );

  res.json({ success: true, orderId });
});

app.listen(3000);
```

All services in the chain will share the same trace ID, and Raceway will merge their events into a single distributed trace.

## TypeScript Support

Full TypeScript support with complete type definitions:

```typescript
import { Raceway, RacewayConfig, Event } from '@mode-7/raceway';

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

users.alice.balance += 100;  // Type-safe
```

## Troubleshooting

### Events not appearing

1. Check server is running: `curl http://localhost:8080/health`
2. Enable debug mode: `new Raceway({ debug: true })`
3. Manually flush: `await raceway.flush()`
4. Verify middleware is installed before routes

### Distributed traces not merging

1. Ensure all services use `propagationHeaders()` when calling downstream
2. Verify `traceparent` header is being sent (check with debug mode)
3. Check that all services report to the same Raceway server
4. Verify instance IDs are unique per service instance

### High Memory Usage

Reduce batch size and flush interval:

```typescript
const raceway = new Raceway({
  serverUrl: 'http://localhost:8080',
  batchSize: 10,
  flushInterval: 100
});
```

### Slow Event Ingestion

If events take a long time to appear in the UI (more than a few seconds), the Raceway server's batch processing may need tuning.

**SDK-side solutions:**
1. Reduce flush interval for more frequent sends:
   ```typescript
   const raceway = new Raceway({
     serverUrl: 'http://localhost:8080',
     flushInterval: 100  // Flush every 100ms
   });
   ```
2. Reduce batch size so partial batches flush sooner:
   ```typescript
   const raceway = new Raceway({
     serverUrl: 'http://localhost:8080',
     batchSize: 10
   });
   ```

**Server-side solutions:**
The Raceway server has its own batch processing configuration that significantly impacts ingestion performance. See the [Event Processing](/guide/configuration#event-processing) configuration guide for tuning server-side batching.

For high-volume applications (1000+ events/sec), increase server batch size to improve throughput by up to 200x.

## Next Steps

- [Python SDK](/sdks/python) - Python integration
- [Go SDK](/sdks/go) - Go integration
- [Rust SDK](/sdks/rust) - Rust integration
- [Security](/guide/security) - Best practices
- [Distributed Tracing](/guide/distributed-tracing) - Cross-service tracing
