# Express Banking API - Causeway Example

This example demonstrates how Causeway can detect race conditions in a Node.js/Express banking API.

## The Bug

The `/transfer` endpoint has a classic **read-modify-write race condition**:

```javascript
// Thread 1                    // Thread 2
const balance = 1000;          const balance = 1000;  // Both read same value!
const newBalance = 900;        const newBalance = 800;
account.balance = 900;         account.balance = 800;  // Thread 2 overwrites Thread 1!
```

**Result:** Lost $100! (Should be $700, actually $800)

## Running the Example

### 1. Start Causeway Server

```bash
cd ../..  # Go to root causeway directory
cargo run --release -- serve
```

### 2. Start the Banking API

```bash
cd examples/express-banking
npm install
node index.js
```

### 3. Trigger the Race Condition

```bash
node test-race.js
```

### 4. View Results in TUI

```bash
cd ../..
cargo run --release -- tui
```

Press `r` to refresh and see the race condition!

## What You'll See

### In the Terminal (test-race.js output):

```
🚨 Race Condition Test

💰 Alice's initial balance: $1000

⚡ Sending two concurrent transfers from Alice:
   Transfer 1: Alice → Bob ($100)
   Transfer 2: Alice → Charlie ($200)

💰 Alice's final balance: $800
💰 Expected balance: $700
💰 Actual balance: $800

🚨 RACE CONDITION DETECTED!
   Lost $100 due to concurrent writes!
```

### In the Causeway TUI:

**Left Panel - Traces:**
```
🔍 Trace 1: a3b4c5d6...
🔍 Trace 2: f7e8d9a0...
```

**Middle Panel - Event Timeline:**
```
1. [14:32:10] HttpRequest
2. [14:32:10] FunctionCall (transferMoney)
3. [14:32:10] StateChange (alice.balance READ)
4. [14:32:10] StateChange (alice.balance WRITE)
```

**Right Panel - Event Details:**
```json
{
  "kind": {
    "StateChange": {
      "variable": "alice.balance",
      "old_value": 1000,
      "new_value": 800,
      "location": "index.js:217 (WRITE)"
    }
  },
  "metadata": {
    "thread_id": "node-12345"
  }
}
```

**Bottom Right - Anomalies:**
```
🚨 RACE CONDITIONS DETECTED! 🚨

⚠️  2 concurrent event pairs found
⚠️  2 potential race conditions

Found 2 pairs of concurrent events - potential race conditions

💡 These events accessed shared state
   without proper synchronization!
```

## The Fix

To fix the race condition, use proper locking:

```javascript
const locks = new Map();

async function transferWithLock(from, to, amount) {
  // Acquire lock on 'from' account
  const lock = await acquireLock(from);

  try {
    const balance = accounts[from].balance;
    if (balance >= amount) {
      accounts[from].balance = balance - amount;
      accounts[to].balance += amount;
      return { success: true };
    }
    return { success: false, error: 'Insufficient funds' };
  } finally {
    lock.release();
  }
}
```

Or use atomic operations:

```javascript
// Using a database with proper ACID guarantees
await db.transaction(async (tx) => {
  const account = await tx.accounts.findOne({ name: from });
  if (account.balance >= amount) {
    await tx.accounts.update({ name: from }, {
      $inc: { balance: -amount }
    });
    await tx.accounts.update({ name: to }, {
      $inc: { balance: amount }
    });
  }
});
```

## API Endpoints

- `GET /balance/:account` - Get account balance
- `POST /transfer` - Transfer money (has race condition!)
  - Body: `{ "from": "alice", "to": "bob", "amount": 100 }`
- `POST /reset` - Reset all accounts to initial values

## Testing Manually

```bash
# Get balance
curl http://localhost:3000/balance/alice

# Transfer money
curl -X POST http://localhost:3000/transfer \
  -H "Content-Type: application/json" \
  -d '{"from":"alice","to":"bob","amount":100}'

# Trigger race (run in parallel)
curl -X POST http://localhost:3000/transfer \
  -H "Content-Type: application/json" \
  -d '{"from":"alice","to":"bob","amount":100}' &
curl -X POST http://localhost:3000/transfer \
  -H "Content-Type: application/json" \
  -d '{"from":"alice","to":"charlie","amount":200}' &
wait
```

## How Causeway Detects It

Causeway tracks:

1. **Causal relationships** - Which events caused which
2. **State changes** - Reads and writes to variables
3. **Thread IDs** - Which thread performed each operation
4. **Timestamps** - When events occurred

When it sees:
- Two StateChange events on the same variable (`alice.balance`)
- From different threads
- With no causal dependency between them
- Both writing values

→ **Race condition detected!**

## Learn More

- [Causeway Documentation](../../README.md)
- [TypeScript SDK](../../sdk/typescript/README.md)
- [Race Condition Detection](../../docs/RACE_DETECTION.md)
