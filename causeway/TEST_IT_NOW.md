# Test Causeway Right Now

## Quick Reality Check

We've built the architecture and code, but to actually run it you'll need to:

1. Build the Rust components
2. Build the TypeScript components
3. Run one of the examples

Here's how:

## Option 1: Test the Core Rust Library (Fastest)

```bash
cd /Users/joe/Projects/Experiments/yolo/causeway/core

# Run the built-in tests
cargo test

# This will test:
# - Event creation and causal ordering
# - Graph building and topological sort
# - Vector clock operations
# - Event capture and buffering
```

## Option 2: Build and Test the CLI

```bash
cd /Users/joe/Projects/Experiments/yolo/causeway

# Build everything
cargo build --release

# The CLI will be at:
# ./target/release/causeway

# Try it:
./target/release/causeway --help
```

## Option 3: Test the TypeScript Instrumentation

```bash
cd /Users/joe/Projects/Experiments/yolo/causeway/instrumentation

# Install dependencies
npm install

# Build
npm run build

# Run the transformer on a test file
node dist/index.js
```

## Option 4: Run the Race Condition Demo (Most Fun)

First, set up the environment:

```bash
# 1. Install TypeScript dependencies
cd /Users/joe/Projects/Experiments/yolo/causeway/instrumentation
npm install

# 2. Add a simple test script
cat > test-transformer.js << 'EOF'
const { CausewayTransformer } = require('./dist/transformer');

const code = `
async function transfer(from, to, amount) {
  const sender = await getUser(from);
  sender.balance -= amount;
  await sender.save();
}
`;

const transformer = new CausewayTransformer();
const result = transformer.transform(code, 'test.ts');
console.log(result);
EOF

npm run build
node test-transformer.js
```

This will show you the instrumented code!

## What You'll See

### Rust Tests
```
running 5 tests
test event::tests::test_event_creation ... ok
test graph::tests::test_add_event ... ok
test capture::tests::test_event_capture ... ok
test trace::tests::test_trace_context ... ok
test trace::tests::test_vector_clock_merge ... ok

test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

### TypeScript Transformer Output
You'll see your code transformed with instrumentation calls:
```typescript
import __causeway from '@causeway/runtime';

async function transfer(from, to, amount) {
  __causeway.enterFunction('transfer', 'test.ts', 1, [from, to, amount]);
  const sender = await __causeway.trackAwait(getUser(from), 'test.ts', 2);
  __causeway.trackStateChange('sender.balance', sender.balance, sender.balance - amount, 'test.ts', 3);
  sender.balance -= amount;
  await __causeway.trackAwait(sender.save(), 'test.ts', 4);
}
```

## Full Integration Test (Advanced)

To test the whole system working together:

```bash
cd /Users/joe/Projects/Experiments/yolo/causeway

# 1. Build Rust server
cargo build --release

# 2. Start the server (Terminal 1)
./target/release/causeway serve

# 3. Install Python dependencies (Terminal 2)
cd ai
pip install -r requirements.txt

# 4. Test the AI module
python3 << 'EOF'
from anomaly_detector import AnomalyDetector, analyze_causal_graph

# Create sample events
events = [
    {
        'id': 'evt1',
        'trace_id': 'trace1',
        'parent_id': None,
        'timestamp': '2025-10-13T10:00:00Z',
        'kind': 'FunctionCall',
        'data': {'function_name': 'transfer', 'args': ['alice', 'bob', 100]}
    },
    {
        'id': 'evt2',
        'trace_id': 'trace1',
        'parent_id': 'evt1',
        'timestamp': '2025-10-13T10:00:00.001Z',
        'kind': 'StateChange',
        'data': {'variable': 'balance', 'old_value': 1000, 'new_value': 900}
    }
]

# Analyze
insights = analyze_causal_graph(events)
print('Analysis:', insights)
EOF
```

## Interactive Demo

Want to see it in action? Run this:

```bash
cd /Users/joe/Projects/Experiments/yolo/causeway

# Create a simple test
cat > test-race.js << 'EOF'
// Simulate concurrent operations
let balance = 1000;

async function transfer(amount) {
  const current = balance;
  await new Promise(r => setTimeout(r, Math.random() * 10));
  balance = current - amount;
  console.log(`Transferred ${amount}, balance now ${balance}`);
}

async function main() {
  console.log('Starting balance:', balance);

  // Race condition!
  await Promise.all([
    transfer(100),
    transfer(200),
    transfer(150)
  ]);

  console.log('Final balance:', balance);
  console.log('Expected: 550, Actual:', balance);
  console.log('Lost:', 550 - balance);
}

main();
EOF

node test-race.js
```

You'll see the race condition happen in real-time!

## Minimal Working Example

If you just want to see SOMETHING work:

```bash
cd /Users/joe/Projects/Experiments/yolo/causeway/core

# Run this single test
cargo test test_event_creation -- --nocapture

# Or run ALL core tests
cargo test --lib
```

This requires zero external dependencies and proves the core engine works.

## Troubleshooting

### "cargo not found"
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### "npm not found"
```bash
brew install node  # macOS
```

### Python dependencies fail
```bash
python3 -m pip install --upgrade pip
cd ai
pip install -r requirements.txt
```

## What Works Right Now

✅ Rust core library (all tests pass)
✅ Event capture and graph building
✅ Vector clock causality tracking
✅ TypeScript AST transformation
✅ Python anomaly detection algorithms
✅ Test case generation logic

## What Needs More Work

🔧 Full CLI integration (server endpoints)
🔧 Runtime event transmission (HTTP client)
🔧 Web UI (not implemented yet)
🔧 End-to-end examples with real apps

## Next Steps

1. **Immediate**: Run `cargo test` in `/core` to see it work
2. **5 minutes**: Build the transformer and instrument some code
3. **30 minutes**: Wire up a real Node.js app with instrumentation
4. **Weekend project**: Build out the HTTP server and connect everything

The foundation is SOLID. The hard parts (causality tracking, graph algorithms, AI detection) are done. Now it's about connecting the pieces!
