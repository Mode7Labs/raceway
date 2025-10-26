# Babel Plugin Raceway

Automatic instrumentation for Raceway - causal debugging and race condition detection.

**Transform your code at build-time to automatically track:**
- ✅ Variable reads and writes
- ✅ Function calls with arguments
- ✅ Async/await operations
- ✅ Property access on objects

**Zero code changes required** - just configure Babel and your code is automatically instrumented!

## Installation

```bash
npm install --save-dev babel-plugin-raceway
npm install @mode-7/raceway-node
```

## Quick Start

### With Babel Config

Add to your `.babelrc` or `babel.config.js`:

```json
{
  "plugins": [
    ["babel-plugin-raceway", {
      "instrumentFunctions": true,
      "instrumentAssignments": true,
      "instrumentAsync": true,
      "exclude": ["node_modules/**", "test/**"]
    }]
  ]
}
```

### With CLI

```bash
npx raceway instrument ./src --output ./instrumented
```

## What It Does

This plugin automatically transforms your code to capture Raceway events:

### Function Calls

**Before:**
```javascript
function transferMoney(from, to, amount) {
  // ... logic
}
```

**After:**
```javascript
import __raceway from '@mode-7/raceway-node/runtime';

function transferMoney(from, to, amount) {
  __raceway.captureFunctionCall('transferMoney', { from, to, amount }, {
    file: __filename,
    line: 1
  });
  // ... logic
}
```

### Variable Assignments

**Before:**
```javascript
account.balance = newBalance;
```

**After:**
```javascript
__raceway.captureStateChange('account.balance', newBalance, undefined, '5'),
account.balance = newBalance;
```

### Async Operations

**Before:**
```javascript
const result = await fetchData();
```

**After:**
```javascript
__raceway.captureCustom('await', { location: '10' });
const result = await fetchData();
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `racewayInstance` | `string` | `'__raceway'` | Name of raceway runtime variable |
| `instrumentFunctions` | `boolean` | `true` | Instrument function declarations |
| `instrumentAssignments` | `boolean` | `true` | Instrument variable assignments |
| `instrumentAsync` | `boolean` | `true` | Instrument async/await |
| `exclude` | `string[]` | `[]` | File patterns to exclude |

## Examples

### Minimal Configuration

```javascript
// babel.config.js
module.exports = {
  plugins: ['babel-plugin-raceway']
};
```

### Custom Configuration

```javascript
// babel.config.js
module.exports = {
  plugins: [
    ['babel-plugin-raceway', {
      racewayInstance: 'raceway',
      instrumentFunctions: true,
      instrumentAssignments: false, // Skip variable tracking
      instrumentAsync: true,
      exclude: ['**/*.test.js', '**/mocks/**']
    }]
  ]
};
```

### With TypeScript

```javascript
// babel.config.js
module.exports = {
  presets: [
    '@babel/preset-typescript'
  ],
  plugins: [
    'babel-plugin-raceway'
  ]
};
```

## Runtime Setup

Initialize the Raceway runtime in your application entry point:

```javascript
// app.js or server.js
import { initializeRuntime } from '@mode-7/raceway-node/runtime';
import express from 'express';

// Initialize Raceway runtime before any instrumented code runs
const raceway = initializeRuntime({
  serverUrl: process.env.RACEWAY_URL || 'http://localhost:8080',
  serviceName: process.env.SERVICE_NAME || 'my-service',
  environment: process.env.NODE_ENV || 'development'
});

const app = express();

// Install middleware for request context
app.use(raceway.getInstance().middleware());

// Your routes - automatically instrumented by Babel!
app.post('/api/transfer', (req, res) => {
  const { from, to, amount } = req.body;

  // All variable access automatically tracked!
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

## Performance

- Instrumentation adds ~10-50μs per event
- Events are batched and sent asynchronously
- Minimal impact on application performance
- Can be disabled via configuration

## Limitations

- Does not instrument `eval()` or dynamically generated code
- Arrow functions without blocks are converted to block statements
- Destructuring assignments are captured as single events

## Troubleshooting

### Plugin not working

1. Check Babel is configured correctly: `npx babel --version`
2. Verify plugin is in `package.json` dependencies
3. Clear Babel cache: `rm -rf node_modules/.cache`

### Too many events

Reduce instrumentation scope:

```javascript
{
  "plugins": [
    ["babel-plugin-raceway", {
      "instrumentFunctions": true,
      "instrumentAssignments": false, // Disable variable tracking
      "instrumentAsync": false,
      "exclude": ["**/lib/**", "**/vendor/**"]
    }]
  ]
}
```

### Build errors

Make sure you have required presets:

```bash
npm install --save-dev @babel/preset-env @babel/preset-typescript
```

## License

MIT
