# Babel Plugin Causeway

Automatic instrumentation for Causeway - AI-powered causal debugging engine.

## Installation

```bash
npm install --save-dev babel-plugin-causeway
npm install causeway-sdk
```

## Usage

### With Babel Config

Add to your `.babelrc` or `babel.config.js`:

```json
{
  "plugins": [
    ["babel-plugin-causeway", {
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
npx causeway instrument ./src --output ./instrumented
```

## What It Does

This plugin automatically transforms your code to capture Causeway events:

### Function Calls

**Before:**
```javascript
function transferMoney(from, to, amount) {
  // ... logic
}
```

**After:**
```javascript
import __causeway from 'causeway-sdk/runtime';

function transferMoney(from, to, amount) {
  __causeway.captureFunctionCall('transferMoney', { from, to, amount }, {
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
__causeway.captureStateChange('account.balance', newBalance, undefined, '5'),
account.balance = newBalance;
```

### Async Operations

**Before:**
```javascript
const result = await fetchData();
```

**After:**
```javascript
__causeway.captureCustom('await', { location: '10' });
const result = await fetchData();
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `causewayInstance` | `string` | `'__causeway'` | Name of causeway runtime variable |
| `instrumentFunctions` | `boolean` | `true` | Instrument function declarations |
| `instrumentAssignments` | `boolean` | `true` | Instrument variable assignments |
| `instrumentAsync` | `boolean` | `true` | Instrument async/await |
| `exclude` | `string[]` | `[]` | File patterns to exclude |

## Examples

### Minimal Configuration

```javascript
// babel.config.js
module.exports = {
  plugins: ['babel-plugin-causeway']
};
```

### Custom Configuration

```javascript
// babel.config.js
module.exports = {
  plugins: [
    ['babel-plugin-causeway', {
      causewayInstance: 'causeway',
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
    'babel-plugin-causeway'
  ]
};
```

## Runtime Setup

The plugin requires a runtime module that initializes Causeway:

```javascript
// causeway-sdk/runtime.js
import { Causeway } from 'causeway-sdk';

const causeway = new Causeway({
  serverUrl: process.env.CAUSEWAY_URL || 'http://localhost:8080',
  serviceName: process.env.SERVICE_NAME,
  environment: process.env.NODE_ENV
});

// Start a trace automatically
causeway.startTrace();

export default causeway;
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
    ["babel-plugin-causeway", {
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
