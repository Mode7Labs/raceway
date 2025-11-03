# Race Condition Detection

Learn how Raceway detects race conditions using vector clock analysis to find concurrency bugs in your distributed systems.

## What is a Race Condition?

A **race condition** occurs when:
1. **Two or more operations** access the same memory location or shared state
2. **At least one operation is a write** (modifies the state)
3. **The operations are concurrent** (no happens-before relationship)
4. **The outcome depends on timing** (execution order affects the result)

Race conditions are among the most difficult bugs to find because:
- They may only manifest under specific timing conditions
- They're hard to reproduce consistently
- Traditional debuggers can alter timing and hide the bug
- They often only appear in production under load

## Raceway's Approach

Raceway uses **vector clocks** to detect potential races without needing to reproduce them. It analyzes the causal relationships between events to find concurrent accesses.

### Detection Algorithm

```
For each variable V in the trace:
  For each pair of accesses (A, B) to V:
    If (A is Write OR B is Write):
      If concurrent(A, B):  # No happens-before relationship
        Report race between A and B on variable V
```

**Key insight**: Two events are concurrent if neither happened-before the other according to their vector clocks.

**Time complexity**: O(m·k²) where:
- `m` = number of tracked variables
- `k` = average number of accesses per variable

## Example: Banking Transfer Race

### The Bug

```typescript
// Thread 1: Transfer $100 from Alice to Bob
const balance = account.balance;  // Read: 1000
account.balance = balance - 100;   // Write: 900

// Thread 2: Transfer $200 from Alice to Charlie (concurrent!)
const balance = account.balance;  // Read: 1000 (still!)
account.balance = balance - 200;   // Write: 800 (overwrites Thread 1!)

// Expected: Alice has $700 (1000 - 100 - 200)
// Actual: Alice has $800 (lost $100!)
```

### How Raceway Detects It

**Events captured:**

| Event | Thread | Variable | Type | Value | Vector Clock |
|-------|--------|----------|------|-------|--------------|
| E1 | thread-1 | alice.balance | Read | 1000 | {t1: 1} |
| E2 | thread-1 | alice.balance | Write | 900 | {t1: 2} |
| E3 | thread-2 | alice.balance | Read | 1000 | {t2: 1} |
| E4 | thread-2 | alice.balance | Write | 800 | {t2: 2} |

**Analysis:**

1. Compare E2 ({t1: 2}) and E4 ({t2: 2}):
   - Neither vector clock is ≤ the other
   - Therefore, E2 and E4 are **concurrent**

2. Both E2 and E4 are writes to `alice.balance`

3. **Race detected!** Two concurrent writes to the same variable.

## Severity Levels

### Critical: Write-Write Race

**Definition**: Two concurrent write operations to the same variable.

**Impact**:
- **Data corruption**: One write silently overwrites the other
- **Lost updates**: Changes are lost without any error
- **Incorrect state**: Final state depends on unpredictable timing

**Example:**
```typescript
// Thread 1
balance = 900;  // This write may be lost

// Thread 2 (concurrent)
balance = 800;  // This write may win
```

**In Raceway Web UI**: Shown in red with "Critical" badge.

### Warning: Read-Write Race

**Definition**: A read operation concurrent with a write to the same variable.

**Impact**:
- **Inconsistent reads**: May see old or new value unpredictably
- **Stale data**: May read a value that's about to be overwritten
- **Logic errors**: Decisions based on inconsistent state

**Example:**
```typescript
// Thread 1
const x = balance;  // May see 1000 or 900

// Thread 2 (concurrent)
balance = 900;      // Write happening concurrently
```

**In Raceway Web UI**: Shown in orange with "Warning" badge.

## Viewing Race Conditions

### Web UI

1. **Overview Tab**: Shows race count badge at the top
2. **Anomalies Tab**: Lists all detected races with details
3. **Events Views**: Race-involved events highlighted in red/orange
4. **Cross-Trace View**: Shows races spanning multiple traces

### Terminal UI (TUI)

1. Select a trace
2. Navigate to "Anomalies" view
3. See race conditions with:
   - Variable name
   - Conflicting events
   - Severity level
   - Source locations

### HTTP API

```bash
# Get races for a specific trace
GET /api/traces/{trace_id}/anomalies

# Get global races across all traces
GET /api/distributed/global-races
```

## Understanding False Positives

Raceway's race detection is **conservative** (reports potential races that might be safe).

### Why False Positives Occur

1. **Untracked synchronization**: External locks or barriers not visible to Raceway
2. **Intentional races**: Some concurrent accesses are safe by design
3. **Benign races**: Multiple writes that produce the same value

### Example: Safe Concurrent Initialization

```typescript
// Multiple threads may initialize, but all write the same value
if (!config) {
  config = loadDefaultConfig();  // All threads write identical object
}
```

**Raceway will report this as a race** (concurrent writes), but it's actually safe because:
- All writes produce the same result
- Only initialization happens once

### Reducing False Positives

1. **Track synchronization primitives** explicitly:
   ```typescript
   await raceway.trackLock('config-lock', 'acquire');
   config = loadDefaultConfig();
   await raceway.trackLock('config-lock', 'release');
   ```

2. **Use SDK lock helpers** (automatic tracking):
   ```typescript
   await withLock('config-lock', async () => {
     config = loadDefaultConfig();
   });
   ```

3. **Document known safe races** in your codebase

## Limitations

### What Raceway Cannot Detect

1. **Untracked code paths**: Only detects races in instrumented code
2. **Lock ordering issues**: Doesn't detect potential deadlocks
3. **Atomicity violations**: Can't infer required atomicity of operations
4. **High-level invariants**: Doesn't understand business logic constraints

### Example: Atomicity Violation Not Detected

```typescript
// Thread 1
if (balance >= 100) {           // Check
  balance = balance - 100;      // Use (not atomic with check!)
}

// Thread 2
balance = balance - 200;        // Concurrent modification
```

**Raceway detects**: Concurrent writes to `balance`
**Raceway doesn't detect**: The check-then-act pattern is broken

## Best Practices

### 1. Instrument Critical Sections

Track all accesses to shared state:

```typescript
// Before modification
await raceway.trackStateChange({
  variable: 'account.balance',
  oldValue: currentBalance,
  newValue: newBalance,
  location: 'api.ts:42',
  accessType: 'Write'
});
```

### 2. Use Lock Helpers

Automatically track synchronization:

::: code-group

```typescript [TypeScript]
import { withLock } from '@mode-7/raceway';

await withLock('account-lock', async () => {
  const balance = account.balance;
  account.balance = balance - amount;
});
```

```python [Python]
from raceway import with_lock

with with_lock('account-lock'):
    balance = account.balance
    account.balance = balance - amount
```

```go [Go]
func transfer() {
    raceway.WithLock("account-lock", func() {
        balance := account.Balance
        account.Balance = balance - amount
    })
}
```

```rust [Rust]
let _guard = raceway.lock("account-lock").await;
let balance = account.balance;
account.balance = balance - amount;
// Guard automatically releases on drop
```

:::

### 3. Review All Detected Races

Don't ignore warnings:
- Investigate each race
- Determine if it's a true bug or false positive
- Document known safe races
- Fix true races with proper synchronization

### 4. Test with Different Workloads

Run your application with:
- High concurrency (many simultaneous requests)
- Varied timing patterns
- Edge cases

Raceway will detect races regardless of whether they manifest.

## Common Race Patterns

### 1. Read-Modify-Write

```typescript
// BAD: Separate read and write
const current = counter;
counter = current + 1;

// GOOD: Atomic operation
counter.fetch_add(1);  // Or use a lock
```

### 2. Check-Then-Act

```typescript
// BAD: Non-atomic check and act
if (balance >= amount) {
  balance = balance - amount;
}

// GOOD: Lock the entire operation
await withLock('balance-lock', async () => {
  if (balance >= amount) {
    balance = balance - amount;
  }
});
```

### 3. Lazy Initialization

```typescript
// BAD: Multiple threads may initialize
if (!cache) {
  cache = buildCache();
}

// GOOD: Use once initialization
const cache = onceFn(() => buildCache());
```

## Fixing Races

### Option 1: Hold Lock for Entire Operation

```typescript
async function transfer(from, to, amount) {
  await withLock('account-lock', async () => {
    const balance = from.balance;
    if (balance >= amount) {
      from.balance -= amount;
      to.balance += amount;
    }
  });
}
```

**Pros**: Simple, obviously correct
**Cons**: May reduce concurrency

### Option 2: Atomic Operations

```typescript
// Use compare-and-swap
do {
  const current = atomicBalance.load();
  const newValue = current - amount;
  if (newValue < 0) throw new Error('Insufficient funds');
} while (!atomicBalance.compareAndSwap(current, newValue));
```

**Pros**: High concurrency
**Cons**: More complex, retry loops

### Option 3: Database Transactions

```sql
BEGIN TRANSACTION;
  SELECT balance FROM accounts WHERE id = ? FOR UPDATE;
  UPDATE accounts SET balance = balance - ? WHERE id = ?;
COMMIT;
```

**Pros**: Database guarantees atomicity
**Cons**: Requires database support

## Real-World Example

See the [banking example](https://github.com/mode7labs/raceway/tree/main/examples) in the repository for a complete demonstration of:
- A banking API with a race condition
- How Raceway detects it
- Multiple ways to fix it
- Testing the fix

## Next Steps

- [Critical Path Analysis](/guide/critical-path) - Find performance bottlenecks
- [Anomaly Detection](/guide/anomalies) - Detect performance issues
- [Security Guide](/guide/security) - Best practices and security
- [Web UI Guide](/guide/web-ui) - Visualize races in the UI
