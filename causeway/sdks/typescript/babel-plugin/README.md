# Babel Plugin Raceway

Automatic instrumentation for Raceway - AI-powered causal debugging engine.

## Installation

```bash
npm install --save-dev babel-plugin-raceway
npm install raceway-sdk
```

## Usage

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
import __raceway from 'raceway-sdk/runtime';

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

The plugin requires a runtime module that initializes Raceway:

```javascript
// raceway-sdk/runtime.js
import { Raceway } from 'raceway-sdk';

const raceway = new Raceway({
  serverUrl: process.env.RACEWAY_URL || 'http://localhost:8080',
  serviceName: process.env.SERVICE_NAME,
  environment: process.env.NODE_ENV
});

// Start a trace automatically
raceway.startTrace();

export default raceway;
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
