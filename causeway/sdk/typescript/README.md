# Causeway SDK for TypeScript/JavaScript

AI-powered causal debugging engine for distributed systems. Automatically detect race conditions, understand causality, and debug production issues.

## Installation

```bash
npm install causeway-sdk
```

## Quick Start

### 1. Start Causeway Server

```bash
# Install Causeway CLI
cargo install causeway-cli

# Start server
causeway serve
```

### 2. Use SDK in Your Code

```typescript
import { Causeway } from 'causeway-sdk';

// Initialize
const causeway = new Causeway({
  serverUrl: 'http://localhost:8080',
  serviceName: 'my-api',
  environment: 'production',
});

// Start a trace
const trace = causeway.startTrace();

// Capture events
causeway.captureFunctionCall('transferMoney', {
  from: 'alice',
  to: 'bob',
  amount: 100,
});

// Capture state changes
causeway.captureStateChange(
  'alice.balance',
  900, // new value
  1000, // old value
  'transactions.ts:45'
);

// End trace
causeway.endTrace();

// Flush events (optional, happens automatically)
await causeway.flush();
```

## API Reference

### Constructor

```typescript
const causeway = new Causeway(config: CausewayConfig);
```

#### CausewayConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serverUrl` | `string` | **required** | URL of Causeway server |
| `serviceName` | `string` | `'unknown-service'` | Name of your service |
| `environment` | `string` | `process.env.NODE_ENV` | Environment (dev/staging/prod) |
| `enabled` | `boolean` | `true` | Enable/disable capture |
| `batchSize` | `number` | `100` | Events to buffer before flushing |
| `flushInterval` | `number` | `1000` | Flush interval in ms |
| `tags` | `Record<string, string>` | `{}` | Custom tags for all events |
| `debug` | `boolean` | `false` | Enable debug logging |

### Trace Management

#### `startTrace(traceId?: string): TraceContext`

Start a new trace. Returns a trace context.

```typescript
const trace = causeway.startTrace();
// or with custom ID:
const trace = causeway.startTrace('my-trace-id');
```

#### `getCurrentTrace(): TraceContext | null`

Get the current active trace context.

```typescript
const trace = causeway.getCurrentTrace();
if (trace) {
  console.log(`Current trace: ${trace.traceId}`);
}
```

#### `endTrace(): void`

End the current trace.

```typescript
causeway.endTrace();
```

### Event Capture

#### `captureFunctionCall(name, args, options?): Event`

Capture a function call event.

```typescript
causeway.captureFunctionCall('processOrder', {
  orderId: '123',
  userId: 'user-456',
}, {
  module: 'orders',
  file: 'orders.ts',
  line: 42,
});
```

#### `captureStateChange(variable, newValue, oldValue, location, options?): Event`

Capture a state change (variable read/write).

```typescript
causeway.captureStateChange(
  'user.balance',
  150, // new value
  100, // old value
  'payment.ts:78'
);
```

#### `captureHttpRequest(method, url, headers, body?, options?): Event`

Capture an HTTP request.

```typescript
causeway.captureHttpRequest(
  'POST',
  'https://api.example.com/orders',
  { 'Content-Type': 'application/json' },
  { orderId: '123' }
);
```

#### `captureHttpResponse(status, headers, durationMs, body?, options?): Event`

Capture an HTTP response.

```typescript
causeway.captureHttpResponse(
  200,
  { 'Content-Type': 'application/json' },
  123, // duration in ms
  { success: true }
);
```

#### `captureCustom(name, data, options?): Event`

Capture a custom event.

```typescript
causeway.captureCustom('payment_processed', {
  amount: 100,
  currency: 'USD',
  processor: 'stripe',
});
```

### Lifecycle

#### `flush(): Promise<void>`

Flush all buffered events immediately.

```typescript
await causeway.flush();
```

#### `stop(): Promise<void>`

Stop the SDK and flush all remaining events.

```typescript
await causeway.stop();
```

## Usage Examples

### Express.js Middleware

```typescript
import express from 'express';
import { Causeway } from 'causeway-sdk';

const app = express();
const causeway = new Causeway({
  serverUrl: 'http://localhost:8080',
  serviceName: 'my-api',
});

// Middleware to start trace
app.use((req, res, next) => {
  const trace = causeway.startTrace();
  res.locals.causeway = causeway;
  res.locals.trace = trace;

  // Capture HTTP request
  causeway.captureHttpRequest(
    req.method,
    req.url,
    req.headers as Record<string, string>,
    req.body
  );

  // Capture response
  const originalSend = res.send;
  res.send = function(body) {
    causeway.captureHttpResponse(
      res.statusCode,
      res.getHeaders() as Record<string, string>,
      Date.now() - res.locals.startTime,
      body
    );
    causeway.endTrace();
    return originalSend.call(this, body);
  };

  res.locals.startTime = Date.now();
  next();
});

// Your routes
app.post('/transfer', async (req, res) => {
  const { causeway } = res.locals;
  const { from, to, amount } = req.body;

  // Capture function call
  causeway.captureFunctionCall('transfer', { from, to, amount }, {
    file: __filename,
    line: 45,
  });

  // Do the transfer
  const oldBalance = await getBalance(from);
  causeway.captureStateChange(`${from}.balance`, oldBalance, null, 'transfer:read');

  const newBalance = oldBalance - amount;
  await setBalance(from, newBalance);
  causeway.captureStateChange(`${from}.balance`, newBalance, oldBalance, 'transfer:write');

  res.json({ success: true, newBalance });
});

app.listen(3000);
```

### Async Functions

```typescript
async function processPayment(userId: string, amount: number) {
  const trace = causeway.startTrace();

  causeway.captureFunctionCall('processPayment', { userId, amount });

  // Async operations are tracked
  const user = await db.findUser(userId);
  causeway.captureCustom('user_loaded', { userId: user.id });

  const charge = await stripe.charge(user, amount);
  causeway.captureCustom('charge_created', { chargeId: charge.id });

  causeway.endTrace();
  return charge;
}
```

### Detecting Race Conditions

```typescript
// Thread 1
async function withdraw1() {
  const trace = causeway.startTrace();

  const balance = account.balance; // Read
  causeway.captureStateChange('account.balance', balance, null, 'withdraw1:read');

  account.balance = balance - 100; // Write
  causeway.captureStateChange('account.balance', balance - 100, balance, 'withdraw1:write');

  causeway.endTrace();
}

// Thread 2 (running concurrently)
async function withdraw2() {
  const trace = causeway.startTrace();

  const balance = account.balance; // Read (same value!)
  causeway.captureStateChange('account.balance', balance, null, 'withdraw2:read');

  account.balance = balance - 50; // Write (overwrites thread 1!)
  causeway.captureStateChange('account.balance', balance - 50, balance, 'withdraw2:write');

  causeway.endTrace();
}

// Causeway will detect: "Race condition on account.balance"
```

## Viewing Results

### Terminal UI

```bash
causeway tui
```

Navigate with:
- `↑↓` or `j/k`: Navigate events
- `←→` or `h/l`: Switch traces
- `r`: Refresh
- `q`: Quit

### API

```bash
# List all traces
curl http://localhost:8080/api/traces

# Get specific trace
curl http://localhost:8080/api/traces/<trace-id>

# Analyze for race conditions
curl http://localhost:8080/api/traces/<trace-id>/analyze
```

## Performance

- **Low overhead:** ~10-50μs per event
- **Non-blocking:** Events buffered and sent asynchronously
- **Batching:** Configurable batch size and flush interval
- **Production-safe:** Can be enabled in production

## Best Practices

1. **Start traces at request boundaries** (HTTP, message queue, etc.)
2. **Capture state changes** for variables that might race
3. **Use meaningful variable names** (`user.balance` not `x`)
4. **Add context with custom events** for important business logic
5. **Flush before process exit** to ensure events are sent

## Troubleshooting

### Events not appearing in TUI

1. Check server is running: `curl http://localhost:8080/health`
2. Enable debug mode: `new Causeway({ debug: true })`
3. Check for errors in console
4. Manually flush: `await causeway.flush()`

### High memory usage

Reduce `batchSize` and `flushInterval`:

```typescript
const causeway = new Causeway({
  serverUrl: 'http://localhost:8080',
  batchSize: 10,
  flushInterval: 100,
});
```

## License

MIT
