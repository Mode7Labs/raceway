# Express Banking API - Raceway Demo

This example demonstrates how Raceway can detect race conditions in a Node.js/Express banking API.

## Quick Start

### 1. Start Raceway Server

```bash
cd ../..  # Go to root causeway directory
cargo run --release -- serve
```

The Raceway server will start on `http://localhost:8080`

### 2. Start the Banking API

```bash
cd examples/express-banking
npm install
node index.js
```

The banking app will start on `http://localhost:3050`

### 3. Open the Web UI

Open your browser to:
- **Banking App:** http://localhost:3050
- **Raceway Analysis:** http://localhost:8080

### 4. Trigger the Race Condition

In the banking app, click the **"Trigger Race Condition"** button. This will:

1. Send two concurrent transfers from Alice's account
2. Cause a race condition due to read-modify-write bug
3. Send instrumentation events to Raceway
4. Show the detected race in Raceway's Web UI

### 5. View Results in Raceway

Go to `http://localhost:8080` and:
- Select one of the traces from the left panel
- Navigate to the "Anomalies" or "Cross Trace" tab
- See the detected race condition with detailed analysis

## The Bug

The `/api/transfer` endpoint has a classic **read-modify-write race condition**:

```javascript
// Thread 1                    // Thread 2
const balance = 1000;          const balance = 1000;  // Both read same value!
const newBalance = 900;        const newBalance = 800;
account.balance = 900;         account.balance = 800;  // Thread 2 overwrites Thread 1!
```

**Expected result:** Alice transfers $100 + $200 = should have $700 left
**Actual result:** Alice has $800 left (lost $100!)

## How It Works

### Instrumentation

The banking API uses the Raceway SDK to track:

1. **State Changes:** Reads and writes to account balances
2. **Function Calls:** Entry into transfer logic
3. **HTTP Events:** Request/response lifecycle

Example instrumentation:

```javascript
const raceway = new RacewayClient({
  serviceName: 'banking-api',
  environment: 'development',
});

raceway.startTrace();

raceway.trackStateChange(
  'alice.balance',      // Variable name
  1000,                 // Old value
  900,                  // New value
  'index.js:277',       // Location
  'Write'               // Access type
);

raceway.endTrace();
```

### Race Detection

Raceway analyzes the events and detects when:
- Two state changes access the same variable (`alice.balance`)
- From different traces (concurrent requests)
- With no causal dependency between them
- Both performing writes

This indicates a potential race condition!

## API Endpoints

- `GET /api/accounts` - Get all account balances
- `GET /api/balance/:account` - Get specific account balance
- `POST /api/transfer` - Transfer money (has race condition!)
  - Body: `{ "from": "alice", "to": "bob", "amount": 100 }`
- `POST /api/reset` - Reset all accounts to initial values

## Testing Manually

### Single Transfer (No Race)

```bash
curl -X POST http://localhost:3050/api/transfer \
  -H "Content-Type: application/json" \
  -d '{"from":"alice","to":"bob","amount":100}'
```

### Concurrent Transfers (Race Condition)

```bash
# Run both commands simultaneously
curl -X POST http://localhost:3050/api/transfer \
  -H "Content-Type: application/json" \
  -d '{"from":"alice","to":"bob","amount":100}' &

curl -X POST http://localhost:3050/api/transfer \
  -H "Content-Type: application/json" \
  -d '{"from":"alice","to":"charlie","amount":200}' &

wait
```

### Reset Accounts

```bash
curl -X POST http://localhost:3050/api/reset
```

## Understanding the Results

### In Raceway Web UI

1. **Traces Tab:** Shows all captured trace executions
2. **Events Tab:** Timeline of events within a trace
3. **Anomalies Tab:** Detected race conditions and timing anomalies
4. **Cross Trace Tab:** Race conditions across multiple traces
5. **Debugger Tab:** Step-by-step audit trail of variable accesses

### What You'll See

When you trigger the race condition, Raceway will show:

- **Concurrent Events:** Multiple writes to `alice.balance` happening concurrently
- **No Causal Link:** The events have no happens-before relationship
- **State Divergence:** The final state doesn't match expected state

## The Fix

To fix the race condition, use proper synchronization:

### Option 1: Locking

```javascript
const locks = new Map();

async function transferWithLock(from, to, amount) {
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

### Option 2: Atomic Operations

```javascript
// Using a database with ACID guarantees
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

### Option 3: Compare-and-Swap

```javascript
let success = false;
while (!success) {
  const currentBalance = accounts[from].balance;
  if (currentBalance < amount) {
    return { error: 'Insufficient funds' };
  }

  // Atomic compare-and-swap
  success = atomicCAS(
    accounts[from],
    'balance',
    currentBalance,
    currentBalance - amount
  );
}
```

## Learn More

- [Raceway Documentation](../../README.md)
- [Instrumentation Guide](../../docs/INSTRUMENTATION_GUIDE.md)
- [TypeScript SDK Reference](../../sdks/typescript/README.md)
