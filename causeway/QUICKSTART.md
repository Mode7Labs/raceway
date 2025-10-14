# Quick Start Guide

Get started with Causeway in 5 minutes!

## Installation

```bash
# Install Causeway CLI
cargo install causeway

# Install TypeScript instrumentation
npm install -g @causeway/instrumentation
```

## 1. Start the Causeway Server

```bash
causeway serve
```

You should see:
```
🚀 Starting Causeway server on 127.0.0.1:8080
✨ Causeway server ready!
   • Event ingestion: http://127.0.0.1:8080/events
   • Web UI: http://127.0.0.1:8080
   • API docs: http://127.0.0.1:8080/docs
🎧 Listening on 127.0.0.1:8080
```

## 2. Instrument Your Application

### Option A: Automatic (Recommended)

Add one line to your entry point:

```typescript
// index.ts
import '@causeway/instrumentation';

// Rest of your code...
```

### Option B: Manual Control

```typescript
import { causeway } from '@causeway/instrumentation';

causeway.configure({
  endpoint: 'http://localhost:8080',
  serviceName: 'my-service',
});

// Wrap code you want to trace
await causeway.trace('my-operation', async () => {
  // Your code here
});
```

## 3. Run Your Application

```bash
npm start
# or
node index.js
```

Your application now sends trace data to Causeway automatically!

## 4. View Traces in the TUI

Open a new terminal:

```bash
causeway tui
```

You'll see an interactive terminal UI showing:
- All captured traces
- Event timeline for each trace
- Detected anomalies and race conditions
- Detailed event information

### Navigation

- `↑↓` or `j k` - Navigate events
- `←→` or `h l` - Switch traces
- `Enter` - Expand details
- `q` - Quit

## 5. Analyze Issues

When you see an anomaly, get detailed analysis:

```bash
causeway analyze --trace-id abc123
```

Output example:
```json
{
  "total_events": 142,
  "total_anomalies": 2,
  "anomalies": [
    {
      "type": "RACE_CONDITION",
      "score": 0.95,
      "description": "Concurrent modifications to 'user.balance'",
      "confidence": 0.90,
      "recommendation": "Use atomic operations or database transactions"
    }
  ]
}
```

## 6. Export Test Cases

Convert production bugs into tests:

```bash
causeway export --trace-id abc123 --output bug-reproduction.test.ts
```

This generates a Jest test that reproduces the exact sequence of events!

## Example: Debug a Race Condition

Try the included example:

```bash
cd causeway/examples
ts-node race-condition-demo.ts
```

Then view it in Causeway:

```bash
causeway tui
```

You'll see Causeway automatically detect the race condition and show you:
- Which variables are being modified concurrently
- The exact timing of each operation
- A recommended fix

## Next Steps

- Read the [full documentation](README.md)
- Check out more [examples](examples/)
- Configure [privacy settings](docs/privacy.md)
- Set up [distributed tracing](docs/distributed.md)

## Troubleshooting

### Events not appearing?

Check that:
1. Causeway server is running (`causeway serve`)
2. Your app is instrumented (import statement present)
3. Endpoint is correct (default: `http://localhost:8080`)

### Too much overhead?

Adjust sampling:

```typescript
causeway.configure({
  samplingRate: 0.1  // Only capture 10% of traces
});
```

### Need help?

- GitHub Issues: https://github.com/causeway/causeway/issues
- Discord: https://discord.gg/causeway
- Docs: https://docs.causeway.dev
