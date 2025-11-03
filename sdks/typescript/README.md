# @mode-7/raceway

Official Node.js/TypeScript SDK for [Raceway](https://github.com/mode7labs/raceway) - Race condition detection and distributed tracing for Node.js applications.

📚 **[Full Documentation](https://mode7labs.github.io/raceway/sdks/typescript)**

## Features

- **Three instrumentation approaches:** Proxy-based auto-tracking, Babel plugin, or manual tracking
- **Automatic lock tracking helpers:** `withLock()` for easy lock instrumentation
- **Automatic context propagation** using AsyncLocalStorage
- **Distributed tracing** across service boundaries (W3C Trace Context)
- **Race condition detection** and concurrency bug analysis
- **Express/Connect middleware** support

## Installation

```bash
npm install @mode-7/raceway
```

## Quick Start

```typescript
import express from 'express';
import { Raceway } from '@mode-7/raceway';

const raceway = new Raceway({
  serverUrl: 'http://localhost:8080',
  serviceName: 'my-service'
});

const app = express();
app.use(express.json());
app.use(raceway.middleware());

// Auto-track state changes with Proxies
const accounts = raceway.track({
  alice: { balance: 1000 },
  bob: { balance: 500 }
}, 'accounts');

app.post('/transfer', async (req, res) => {
  const { from, to, amount } = req.body;

  // Automatically tracked!
  const balance = accounts[from].balance;
  if (balance < amount) {
    return res.status(400).json({ error: 'Insufficient funds' });
  }

  accounts[from].balance -= amount;
  accounts[to].balance += amount;

  res.json({ success: true });
});

app.listen(3000);
```

## Distributed Tracing

Propagate traces across service boundaries:

```typescript
import axios from 'axios';

app.post('/checkout', async (req, res) => {
  const { orderId } = req.body;

  // Get propagation headers
  const headers = raceway.propagationHeaders();

  // Call downstream services
  await axios.post('http://inventory-service/reserve',
    { orderId },
    { headers }
  );

  res.json({ success: true });
});
```

## Which Approach Should I Use?

- **Have shared mutable objects?** → Use `raceway.track()` for auto-tracking
- **Need to track local variables?** → Use Babel plugin for zero-code instrumentation
- **Want precise control?** → Use manual tracking API
- **Need lock tracking?** → Use `withLock()` helpers

## Documentation

- 📚 **[Full SDK Documentation](https://mode7labs.github.io/raceway/sdks/typescript)** - Complete API reference, examples, and best practices
- 🚀 **[Getting Started Guide](https://mode7labs.github.io/raceway/guide/getting-started)** - Step-by-step setup
- 🔍 **[Race Detection Guide](https://mode7labs.github.io/raceway/guide/race-detection)** - Understanding race conditions
- 🌐 **[Distributed Tracing](https://mode7labs.github.io/raceway/guide/distributed-tracing)** - Cross-service tracing
- 🔐 **[Security Guide](https://mode7labs.github.io/raceway/guide/security)** - Best practices

## Examples

See [examples/typescript-banking](../../examples/typescript-banking) for a complete Express.js application with Raceway integration.

## License

MIT

## Links

- [GitHub Repository](https://github.com/mode7labs/raceway)
- [Documentation](https://mode7labs.github.io/raceway)
- [Issue Tracker](https://github.com/mode7labs/raceway/issues)
