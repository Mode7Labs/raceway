# TypeScript SDK v0.1.0 - Release Notes

## What's New

### 🎉 Complete Babel Plugin
- **Automatic instrumentation** with zero code changes
- Tracks property reads AND writes
- Proper old value capture
- 18 integration tests (100% passing)

### 🔒 Lock Tracking Helpers
- `withLock()` - Async lock helper
- `withLockSync()` - Sync lock helper  
- `trackLockAcquire()` / `trackLockRelease()` - Manual tracking
- Reduces lock tracking from 8 lines to 1 line

### 📖 Comprehensive Documentation
- `INSTRUMENTATION-GUIDE.md` - Complete decision tree
- Updated `README.md` with all three approaches
- Comparison tables and examples
- Troubleshooting guide

## Three Ways to Use Raceway

### 1. Proxy-Based (Recommended for shared state)
```typescript
const accounts = raceway.track({ alice: { balance: 1000 } }, 'accounts');
accounts.alice.balance -= 100;  // Auto-tracked!
```

### 2. Babel Plugin (Recommended for automatic instrumentation)
```javascript
// babel.config.js
module.exports = {
  plugins: ['babel-plugin-raceway']
};
```

### 3. Manual Tracking (Recommended for precise control)
```typescript
raceway.trackStateChange('balance', oldValue, newValue, 'Write');
```

## Installation

```bash
# Main SDK
npm install @mode-7/raceway-node

# Babel Plugin (optional)
npm install --save-dev babel-plugin-raceway
```

## Quick Start

```typescript
import { Raceway } from '@mode-7/raceway-node';

const raceway = new Raceway({
  serverUrl: 'http://localhost:8080',
  serviceName: 'my-service'
});

app.use(raceway.middleware());

// Option A: Proxy-based auto-tracking
const state = raceway.track({ counter: 0 }, 'state');
state.counter++;  // Auto-tracked!

// Option B: Lock helpers
await raceway.withLock(lock, 'my_lock', async () => {
  // Lock automatically tracked!
});
```

## Breaking Changes

None - this is the initial release.

## Bug Fixes

- Fixed Babel plugin read tracking
- Fixed Babel plugin old value capture
- Created runtime module for Babel plugin

## Documentation

- 📖 [README.md](./README.md) - API reference
- 📖 [INSTRUMENTATION-GUIDE.md](./INSTRUMENTATION-GUIDE.md) - Decision tree guide
- 📖 [babel-plugin/README.md](./babel-plugin/README.md) - Babel plugin docs

## Links

- **npm:** https://www.npmjs.com/package/@mode-7/raceway-node
- **Babel Plugin:** https://www.npmjs.com/package/babel-plugin-raceway
- **GitHub:** https://github.com/mode-7/raceway
- **Issues:** https://github.com/mode-7/raceway/issues
