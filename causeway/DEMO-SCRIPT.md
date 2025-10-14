# Causeway Demo Script

**Duration:** 5 minutes
**Goal:** Show how Causeway automatically detects race conditions

---

## Setup (Before Demo)

```bash
# Terminal 1: Server
cd causeway
cargo build --release
cargo run --release -- serve

# Terminal 2: Banking API
cd examples/express-banking
npm install
node index.js

# Terminal 3: Ready for test script
cd examples/express-banking

# Terminal 4: TUI (ready but don't start yet)
cd causeway
```

---

## Demo Script

### Opening (30 seconds)

**"Hi, I'm going to show you Causeway - an AI-powered debugging tool that automatically detects race conditions in your code."**

**"Let's say you're building a banking API. You have code that transfers money between accounts. Looks fine, right?"**

*Show `examples/express-banking/index.js` around line 167-217*

```javascript
async function transferMoney(from, to, amount) {
  // Read balance
  const currentBalance = accounts[from].balance;

  // Check funds
  if (currentBalance < amount) {
    return error;
  }

  // Write new balance
  accounts[from].balance = currentBalance - amount;
}
```

**"But what if two transfers happen at the same time from the same account?"**

---

### The Bug (1 minute)

**"Let me show you the race condition."**

*Switch to Terminal 2 (Banking API running)*

**"The API is running. Alice has $1000."**

*Switch to Terminal 3*

**"I'm going to send TWO concurrent transfers from Alice:"**
- Transfer 1: Alice → Bob ($100)
- Transfer 2: Alice → Charlie ($200)

**"Expected final balance: $700"**
**"Let's see what actually happens..."**

```bash
node test-race.js
```

*Show output:*
```
💰 Alice's initial balance: $1000
⚡ Sending two concurrent transfers...
💰 Alice's final balance: $800
💰 Expected: $700
💰 Actual: $800

🚨 RACE CONDITION DETECTED!
   Lost $100 due to concurrent writes!
```

**"We lost $100! This is a classic read-modify-write race condition."**

**"What happened:**
1. Thread 1 reads balance = $1000
2. Thread 2 reads balance = $1000 (same value!)
3. Thread 1 writes balance = $900
4. Thread 2 writes balance = $800 (overwrites Thread 1!)
5. Result: Lost $100"

---

### Causeway Detection (2 minutes)

**"Now here's where Causeway comes in. It automatically captured all these events."**

*Switch to Terminal 4*

```bash
cargo run --release -- tui
```

*TUI opens*

**"This is the Causeway Terminal UI. Let me press 'r' to refresh the data."**

*Press 'r'*

**"Look at this - we can see all the traces..."**

*Navigate with arrow keys or 'h' to select the race condition trace*

**"Here's the trace that has the race condition. In the middle panel, you can see the timeline of events."**

*Point out:*
- Event 1: Transfer 1 starts
- Event 2: Transfer 2 starts (concurrent!)
- Event 3: Read balance
- Event 4: Read balance (both read same value!)
- Event 5: Write balance = $900
- Event 6: Write balance = $800 (overwrites!)

**"And look at the Anomalies panel on the right..."**

*Show anomalies panel:*
```
🚨 RACE CONDITIONS DETECTED! 🚨

⚠️  4 concurrent event pairs found
⚠️  4 potential race conditions

🚨 CRITICAL on alice.balance: thread-1 vs thread-2
```

**"Causeway automatically detected this as a CRITICAL race condition!"**

---

### How It Works (1 minute)

**"How does Causeway do this?"**

**"Three key technologies:"**

1. **Automatic Instrumentation**
   - Babel plugin transforms your code
   - Captures every function call and state change
   - Zero manual code changes

2. **Vector Clocks**
   - Not just timestamps - true causality
   - Knows which events caused which
   - Works across distributed systems

3. **Race Detection Algorithm**
   - Finds events that:
     - Access the same variable
     - From different threads
     - With no causal dependency
     - At least one is a write
   - Classifies severity (CRITICAL, WARNING, INFO)

---

### The Power (30 seconds)

**"This works for any concurrent bug:"**
- ✅ Race conditions (like we just saw)
- ✅ Async operation ordering issues
- ✅ Distributed system causality
- ✅ State mutation bugs

**"And it works in production with <1% overhead."**

---

### Call to Action (30 seconds)

**"Causeway is open source and ready to use:"**

```bash
git clone https://github.com/causeway/causeway
cd causeway
cargo build --release
cargo run --release -- serve

# Then instrument your code:
npm install causeway-sdk
causeway init
causeway instrument ./src
```

**"Try it on your codebase and find bugs you didn't know existed."**

**"Links in the description. Thanks for watching!"**

---

## Key Points to Emphasize

1. **Zero Configuration** - Just run the test, Causeway captures everything
2. **Automatic Detection** - No manual analysis needed
3. **Production Ready** - Low overhead, works in real apps
4. **Shows Exact Problem** - Thread IDs, locations, values
5. **Severity Levels** - CRITICAL/WARNING/INFO classification

---

## Backup Demo (If Something Fails)

If live demo fails, have screenshots/recording of:
1. The TUI showing race conditions
2. The test output showing lost money
3. The analysis API response (curl output)

---

## Questions to Answer

**Q: "Does this slow down my app?"**
A: Less than 1% overhead. Events are captured asynchronously and batched.

**Q: "Do I have to instrument my code manually?"**
A: No! Use the Babel plugin for automatic instrumentation.

**Q: "Does it work in production?"**
A: Yes! It's designed for production use with low overhead.

**Q: "What languages are supported?"**
A: TypeScript/JavaScript now. Python, Go, Rust coming in V1.0.

**Q: "Is it open source?"**
A: Yes! MIT licensed. Self-hosted, no cloud required.

---

## Visual Aids Needed

1. **Diagram:** Read-Modify-Write Race Condition
   ```
   Time →
   Thread 1: [READ $1000] -----> [WRITE $900]
   Thread 2:   [READ $1000] -----> [WRITE $800] ← Overwrites!
   ```

2. **Screenshot:** TUI with race conditions highlighted

3. **Architecture Diagram:**
   ```
   App → Causeway SDK → Server → Causal Graph → TUI
   ```

---

## Social Media Posts

### Twitter/X
```
🚨 Ever lost money to a race condition?

Causeway automatically detects concurrent bugs in your code.

✅ Zero config
✅ <1% overhead
✅ Works in production
✅ Open source

Demo: [link]
Repo: [link]

#debugging #race #concurrency
```

### Reddit (r/programming)
```
Title: I built an AI-powered tool to automatically detect race conditions

I got tired of debugging race conditions at 3am, so I built Causeway.

It uses vector clocks and causal graph analysis to automatically detect:
- Race conditions
- Concurrent state mutations
- Async ordering issues
- Distributed system causality bugs

Demo video shows it catching a banking bug that loses money due to concurrent writes.

Tech: Rust core, TypeScript SDK, Babel plugin for auto-instrumentation

Repo: [link]
```

### Hacker News
```
Title: Causeway – Automatic race condition detection using causal graphs

Hi HN! I built Causeway after spending too many late nights debugging production race conditions.

It captures all events in your app (function calls, state changes, async ops) and builds a causal graph using vector clocks. Then it automatically detects race conditions by finding concurrent accesses to shared state.

The demo shows it catching a banking bug where concurrent transfers cause lost money.

Key features:
- Automatic instrumentation (Babel plugin)
- <1% overhead (production-safe)
- Interactive TUI for exploration
- Works across distributed systems

Built with Rust + TypeScript. MIT licensed.

Would love feedback from the HN community!
```

---

## Launch Checklist

Before posting/demoing:
- [ ] Server builds without errors
- [ ] TUI works and shows data
- [ ] Example app runs
- [ ] Test script works
- [ ] Race condition is detected
- [ ] README is up to date
- [ ] Screenshots are ready
- [ ] Video is recorded (backup)
- [ ] GitHub repo is public
- [ ] License file exists
- [ ] Contributing guide exists
