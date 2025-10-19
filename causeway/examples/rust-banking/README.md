# Rust Banking API - Raceway Demo

This demonstrates how Raceway can detect race conditions in a Rust/Axum banking API.

## Quick Start

### 1. Start Raceway Server

```bash
cd ../..  # Go to root causeway directory
cargo run --release -- serve
```

The Raceway server will start on `http://localhost:8080`

### 2. Start the Banking API

```bash
cd examples/rust-banking
cargo run --release
```

The banking app will start on `http://localhost:3051`

### 3. Open the Web UI

Open your browser to:
- **Banking App:** http://localhost:3051
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

```rust
// Thread 1                    // Thread 2
let balance = 1000;            let balance = 1000;  // Both read same value!
let new_balance = 900;         let new_balance = 800;
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

```rust
use raceway_sdk::{RacewayClient, Config};

let raceway = RacewayClient::new(Config {
    service_name: "banking-api".to_string(),
    ..Default::default()
});

raceway.start_trace().await;

raceway.track_state_change(
    "alice.balance",      // Variable name
    Some(1000),           // Old value
    900,                  // New value
    "main.rs:277",        // Location
    "Write",              // Access type
).await;

raceway.end_trace().await;
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
curl -X POST http://localhost:3051/api/transfer \
  -H "Content-Type: application/json" \
  -d '{"from":"alice","to":"bob","amount":100}'
```

### Concurrent Transfers (Race Condition)

```bash
# Run both commands simultaneously
curl -X POST http://localhost:3051/api/transfer \
  -H "Content-Type: application/json" \
  -d '{"from":"alice","to":"bob","amount":100}' &

curl -X POST http://localhost:3051/api/transfer \
  -H "Content-Type: application/json" \
  -d '{"from":"alice","to":"charlie","amount":200}' &

wait
```

### Reset Accounts

```bash
curl -X POST http://localhost:3051/api/reset
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

### Option 1: Hold Lock for Entire Operation

```rust
async fn transfer_with_lock(state: &AppState, req: TransferRequest) -> Result<()> {
    let mut accounts = state.accounts.write(); // Hold lock for entire operation

    let from_balance = accounts.get(&req.from).unwrap().balance;
    if from_balance < req.amount {
        return Err("Insufficient funds");
    }

    accounts.get_mut(&req.from).unwrap().balance -= req.amount;
    accounts.get_mut(&req.to).unwrap().balance += req.amount;

    Ok(())
}
```

### Option 2: Use Atomic Operations

```rust
use std::sync::atomic::{AtomicI64, Ordering};

struct Account {
    balance: AtomicI64,
}

async fn transfer_atomic(state: &AppState, req: TransferRequest) -> Result<()> {
    let accounts = state.accounts.read();

    // Atomic compare-and-swap loop
    loop {
        let current = accounts.get(&req.from).unwrap().balance.load(Ordering::SeqCst);
        if current < req.amount {
            return Err("Insufficient funds");
        }

        let new_balance = current - req.amount;
        if accounts.get(&req.from).unwrap()
            .balance
            .compare_exchange(current, new_balance, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            break;
        }
    }

    // Credit recipient
    accounts.get(&req.to).unwrap()
        .balance
        .fetch_add(req.amount, Ordering::SeqCst);

    Ok(())
}
```

### Option 3: Use Database Transactions

```rust
use sqlx::postgres::PgPool;

async fn transfer_with_tx(pool: &PgPool, req: TransferRequest) -> Result<()> {
    let mut tx = pool.begin().await?;

    // Lock rows with SELECT FOR UPDATE
    let from_balance: i64 = sqlx::query_scalar(
        "SELECT balance FROM accounts WHERE name = $1 FOR UPDATE"
    )
    .bind(&req.from)
    .fetch_one(&mut *tx)
    .await?;

    if from_balance < req.amount {
        return Err("Insufficient funds");
    }

    sqlx::query("UPDATE accounts SET balance = balance - $1 WHERE name = $2")
        .bind(req.amount)
        .bind(&req.from)
        .execute(&mut *tx)
        .await?;

    sqlx::query("UPDATE accounts SET balance = balance + $1 WHERE name = $2")
        .bind(req.amount)
        .bind(&req.to)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(())
}
```

## Learn More

- [Raceway Documentation](../../README.md)
- [Instrumentation Guide](../../docs/INSTRUMENTATION_GUIDE.md)
- [Rust SDK Reference](../../sdks/rust/README.md)
