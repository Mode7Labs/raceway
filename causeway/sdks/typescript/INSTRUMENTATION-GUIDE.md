# Raceway TypeScript SDK: Instrumentation Guide

## TL;DR - Which Approach Should I Use?

```
Start here: Do you have shared mutable objects (like a global state/cache)?
│
├─ YES → Use `raceway.track()` (Proxy-based) ✅
│   │
│   └─ Perfect for:
│       • In-memory databases (accounts, sessions)
│       • Shared caches
│       • Global state objects
│       • Objects you can wrap at initialization
│
└─ NO → Do you need to track local variables?
    │
    ├─ YES → Use Babel Plugin 🔧
    │   │
    │   └─ Perfect for:
    │       • Local variables in functions
    │       • Computed property access
    │       • Existing codebases (no code changes)
    │       • Automatic instrumentation
    │
    └─ NO → Use Manual Tracking 🔨
        │
        └─ Perfect for:
            • Specific critical sections
            • Performance-sensitive code
            • Lock tracking
            • Custom events
```

---

## The Three Approaches

### Approach 1: Proxy-Based Auto-Tracking (Recommended)

**When to use:** You have objects that you can wrap at initialization time.

**Setup:**
```typescript
import { Raceway } from '@mode-7/raceway';

const raceway = new Raceway({
  serverUrl: 'http://localhost:8080',
  serviceName: 'my-service'
});

app.use(raceway.middleware());

// Wrap your state objects
const accounts = raceway.track({
  alice: { balance: 1000 },
  bob: { balance: 500 }
}, 'accounts');
```

**Usage:**
```typescript
// All reads and writes are automatically tracked!
const balance = accounts.alice.balance;  // ✅ Tracked as Read
accounts.alice.balance -= 100;            // ✅ Tracked as Write
```

**Pros:**
- ✅ Zero instrumentation - just wrap objects
- ✅ Tracks both reads AND writes
- ✅ Captures old values automatically
- ✅ No build step required
- ✅ Works with nested objects

**Cons:**
- ❌ Can't track primitives (numbers, strings stored in variables)
- ❌ Must wrap objects at initialization
- ❌ ~10-20% performance overhead (acceptable for dev/testing)
- ❌ Doesn't work with existing object references

**Example:**
```typescript
// Banking API with race condition
const accounts = raceway.track({
  alice: { balance: 1000 }
}, 'accounts');

app.post('/transfer', async (req, res) => {
  const { from, to, amount } = req.body;

  // ✅ Automatically tracked - no manual calls needed!
  const balance = accounts[from].balance;

  if (balance < amount) {
    return res.status(400).json({ error: 'Insufficient funds' });
  }

  // ✅ RACE CONDITION - Raceway will detect this!
  accounts[from].balance -= amount;
  accounts[to].balance += amount;

  res.json({ success: true });
});
```

---

### Approach 2: Babel Plugin (Build-Time Transform)

**When to use:** You need to track local variables or want fully automatic instrumentation.

**Setup:**

1. Install dependencies:
```bash
npm install --save-dev babel-plugin-raceway
npm install @mode-7/raceway
```

2. Configure Babel (`babel.config.js`):
```javascript
module.exports = {
  plugins: [
    ['babel-plugin-raceway', {
      instrumentFunctions: true,
      instrumentAssignments: true,
      instrumentAsync: true,
      exclude: ['node_modules/**', 'test/**']
    }]
  ]
};
```

3. Initialize runtime (in your app entry point):
```typescript
import { initializeRuntime } from '@mode-7/raceway/runtime';

initializeRuntime({
  serverUrl: 'http://localhost:8080',
  serviceName: 'my-service'
});

app.use(raceway.middleware());
```

**What gets transformed:**

```javascript
// Your code:
function transfer(from, to, amount) {
  let balance = accounts[from].balance;
  if (balance < amount) return false;

  accounts[from].balance -= amount;
  return true;
}

// After Babel transform:
import __raceway from '@mode-7/raceway/runtime';

function transfer(from, to, amount) {
  __raceway.captureFunctionCall('transfer', { from, to, amount });

  __raceway.trackStateChange('accounts[from].balance', null, accounts[from].balance, 'Read');
  let balance = accounts[from].balance;

  if (balance < amount) return false;

  const _oldValue = accounts[from].balance;
  __raceway.trackStateChange('accounts[from].balance', _oldValue, accounts[from].balance - amount, 'Write');
  accounts[from].balance -= amount;

  return true;
}
```

**Pros:**
- ✅ Fully automatic - no code changes needed
- ✅ Tracks local variables
- ✅ Tracks reads AND writes
- ✅ Captures old values
- ✅ Build-time transformation (zero runtime overhead for transform itself)

**Cons:**
- ❌ Requires build step
- ❌ Adds instrumentation code (increases bundle size)
- ❌ May be overly aggressive (tracks everything)
- ❌ Debugging transformed code can be confusing

**Configuration options:**
```javascript
{
  racewayInstance: '__raceway',        // Name of runtime variable
  instrumentFunctions: true,           // Track function calls
  instrumentAssignments: true,         // Track variable writes
  instrumentAsync: true,               // Track async/await
  exclude: ['node_modules/**']         // Exclude patterns
}
```

---

### Approach 3: Manual Tracking

**When to use:** You want precise control or have performance-sensitive code.

**Setup:**
```typescript
import { Raceway } from '@mode-7/raceway';

const raceway = new Raceway({
  serverUrl: 'http://localhost:8080',
  serviceName: 'my-service'
});

app.use(raceway.middleware());
```

**Usage:**
```typescript
app.post('/transfer', async (req, res) => {
  const { from, to, amount } = req.body;

  // Manual tracking
  raceway.trackFunctionCall('transfer', { from, to, amount });

  const balance = accounts[from].balance;
  raceway.trackStateChange(`accounts.${from}.balance`, null, balance, 'Read');

  if (balance < amount) {
    return res.status(400).json({ error: 'Insufficient funds' });
  }

  const oldBalance = accounts[from].balance;
  accounts[from].balance -= amount;
  raceway.trackStateChange(`accounts.${from}.balance`, oldBalance, accounts[from].balance, 'Write');

  res.json({ success: true });
});
```

**Pros:**
- ✅ Complete control over what's tracked
- ✅ No performance overhead except where you add it
- ✅ Works with any code structure
- ✅ Easy to debug
- ✅ Can be selective about critical sections

**Cons:**
- ❌ Tedious to write
- ❌ Easy to forget tracking calls
- ❌ Doubles lines of code
- ❌ Error-prone

---

## Lock Tracking

All approaches can use lock helpers:

### Auto-Tracked Locks (Recommended)

```typescript
import { Mutex } from 'async-mutex';

const lock = new Mutex();

// Before: Manual tracking (tedious)
await lock.acquire();
raceway.trackLockAcquire('account_lock', 'Mutex');
try {
  accounts.alice.balance -= 100;
} finally {
  raceway.trackLockRelease('account_lock', 'Mutex');
  lock.release();
}

// After: Auto-tracked (easy!)
await raceway.withLock(lock, 'account_lock', async () => {
  accounts.alice.balance -= 100;
});
```

### Lock Helper API

```typescript
// Async locks
await raceway.withLock(lock, 'lock_id', 'Mutex', async () => {
  // Critical section - lock acquire/release auto-tracked
});

// Sync locks
raceway.withLockSync(lock, 'lock_id', 'Mutex', () => {
  // Critical section
});

// Manual tracking (if needed)
raceway.trackLockAcquire('lock_id', 'Mutex');
try {
  // critical section
} finally {
  raceway.trackLockRelease('lock_id', 'Mutex');
}
```

---

## Comparison Table

| Feature | Proxy (`track()`) | Babel Plugin | Manual |
|---------|------------------|--------------|--------|
| Setup complexity | Low | Medium | Low |
| Code changes required | Minimal (wrap objects) | None (build config only) | High |
| Tracks local variables | ❌ | ✅ | ✅ |
| Tracks object properties | ✅ | ✅ | ✅ |
| Captures old values | ✅ | ✅ | ✅ (if you write it) |
| Performance overhead | ~10-20% | ~5-10% | <1% (only where you add it) |
| Build step required | ❌ | ✅ | ❌ |
| Bundle size impact | None | Moderate | None |
| Debugging | Easy | Can be confusing | Easy |
| Flexibility | Medium | Low | High |
| Error prone | Low | Very low | High |

---

## Recommended Workflow

### For New Projects
1. Start with `raceway.track()` for shared state
2. Add Babel plugin if you need local variable tracking
3. Use manual tracking for special cases (locks, critical sections)

### For Existing Projects
1. Add Babel plugin for automatic instrumentation
2. Use `raceway.track()` for new objects
3. Use manual tracking for debugging specific issues

### For Production
1. Use environment variables to enable/disable
2. Consider sampling (track 1% of requests)
3. Use manual tracking in performance-critical paths

```typescript
const raceway = new Raceway({
  serverUrl: process.env.RACEWAY_URL,
  enabled: process.env.NODE_ENV === 'development', // or sampling logic
  serviceName: process.env.SERVICE_NAME
});
```

---

## Common Patterns

### Pattern 1: Banking/Financial Apps
Use `raceway.track()` + lock helpers
```typescript
const accounts = raceway.track(accountsDb, 'accounts');

await raceway.withLock(accountLock, 'account_lock', async () => {
  const balance = accounts.alice.balance;  // Auto-tracked
  accounts.alice.balance -= 100;            // Auto-tracked
});
```

### Pattern 2: E-commerce Inventory
Use Babel plugin + manual for critical sections
```typescript
// Babel auto-instruments everything
function reserveInventory(productId, quantity) {
  let available = inventory[productId].stock;  // Auto-tracked by Babel

  if (available < quantity) return false;

  inventory[productId].stock -= quantity;      // Auto-tracked by Babel
  return true;
}
```

### Pattern 3: Session Management
Use `raceway.track()` for session store
```typescript
const sessions = raceway.track(new Map(), 'sessions');

sessions.set(userId, { lastActive: Date.now() });  // Auto-tracked
const session = sessions.get(userId);               // Auto-tracked
```

---

## Troubleshooting

### Proxy not tracking?
- Make sure you're using the wrapped object (not the original)
- Check that you're inside a request context (after middleware)
- Verify `enabled: true` in config

### Babel plugin not working?
- Run `npm run build` to see transformation
- Check Babel config is loaded (`npx babel --version`)
- Verify runtime is initialized before first request
- Check browser console for import errors

### Manual tracking not showing up?
- Verify middleware is installed
- Check server URL is correct
- Enable debug mode: `debug: true`
- Call `await raceway.flush()` to force send

---

## Next Steps

- [Full API Reference](./README.md)
- [Distributed Tracing Guide](./README.md#distributed-tracing)
- [Example Applications](../../examples/)
- [GitHub Issues](https://github.com/mode-7/raceway/issues)
