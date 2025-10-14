/**
 * Example Express Banking API with Causeway Integration
 *
 * This demonstrates how Causeway can detect race conditions in a banking API.
 *
 * To run:
 * 1. Start Causeway server: cargo run --release -- serve
 * 2. Install deps: npm install
 * 3. Start this server: node index.js
 * 4. Test race condition: node test-race.js
 * 5. View in TUI: cargo run --release -- tui
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');

// NOTE: In a real app, you would import from 'causeway-sdk'
// For this example, we'll use the local implementation structure
const causeway = {
  serverUrl: 'http://localhost:8080',
  serviceName: 'banking-api',
  environment: 'development',
  enabled: true,
  debug: true,

  currentTrace: null,

  startTrace() {
    this.currentTrace = {
      traceId: uuidv4(),
      parentId: null,
      events: [],
    };
    console.log(`[Causeway] Started trace ${this.currentTrace.traceId}`);
    return this.currentTrace;
  },

  endTrace() {
    if (this.currentTrace) {
      console.log(`[Causeway] Ended trace ${this.currentTrace.traceId}`);
      this.sendEvents(this.currentTrace.events);
      this.currentTrace = null;
    }
  },

  captureEvent(kind, trace = this.currentTrace) {
    if (!this.enabled || !trace) return;

    const event = {
      id: uuidv4(),
      trace_id: trace.traceId,
      parent_id: trace.parentId,
      timestamp: new Date().toISOString(),
      kind,
      metadata: {
        thread_id: `node-${process.pid}`,
        process_id: process.pid,
        service_name: this.serviceName,
        environment: this.environment,
        tags: {},
        duration_ns: null,
      },
      causality_vector: [],
    };

    trace.events.push(event);
    trace.parentId = event.id;

    if (this.debug) {
      console.log(`[Causeway] Captured event:`, Object.keys(kind)[0]);
    }

    return event;
  },

  async sendEvents(events) {
    if (!events.length) return;

    try {
      const response = await fetch(`${this.serverUrl}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
      });

      if (response.ok) {
        console.log(`[Causeway] Sent ${events.length} events`);
      } else {
        console.error(`[Causeway] Failed to send events: ${response.status}`);
      }
    } catch (error) {
      console.error('[Causeway] Error sending events:', error.message);
    }
  },
};

// In-memory account database
const accounts = {
  alice: { balance: 1000 },
  bob: { balance: 500 },
  charlie: { balance: 300 },
};

const app = express();
app.use(express.json());

// Middleware to start Causeway trace for each request
app.use((req, res, next) => {
  const trace = causeway.startTrace();
  res.locals.trace = trace;

  // Capture HTTP request
  causeway.captureEvent(
    {
      HttpRequest: {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body,
      },
    },
    trace
  );

  // Capture response on finish
  res.on('finish', () => {
    causeway.captureEvent(
      {
        HttpResponse: {
          status: res.statusCode,
          headers: res.getHeaders(),
          body: null,
          duration_ms: Date.now() - res.locals.startTime,
        },
      },
      trace
    );
    causeway.endTrace();
  });

  res.locals.startTime = Date.now();
  next();
});

// Get balance endpoint
app.get('/balance/:account', (req, res) => {
  const { account } = req.params;
  const { trace } = res.locals;

  causeway.captureEvent(
    {
      FunctionCall: {
        function_name: 'getBalance',
        module: 'banking',
        args: { account },
        file: 'index.js',
        line: 134,
      },
    },
    trace
  );

  if (!accounts[account]) {
    return res.status(404).json({ error: 'Account not found' });
  }

  const balance = accounts[account].balance;

  causeway.captureEvent(
    {
      StateChange: {
        variable: `${account}.balance`,
        old_value: null,
        new_value: balance,
        location: 'index.js:145',
      },
    },
    trace
  );

  res.json({ account, balance });
});

// Transfer money endpoint (VULNERABLE TO RACE CONDITIONS!)
app.post('/transfer', async (req, res) => {
  const { from, to, amount } = req.body;
  const { trace } = res.locals;

  causeway.captureEvent(
    {
      FunctionCall: {
        function_name: 'transferMoney',
        module: 'banking',
        args: { from, to, amount },
        file: 'index.js',
        line: 167,
      },
    },
    trace
  );

  // Validate accounts exist
  if (!accounts[from] || !accounts[to]) {
    return res.status(404).json({ error: 'Account not found' });
  }

  // Simulate some processing time (makes race conditions more likely)
  await new Promise(resolve => setTimeout(resolve, 10));

  // READ: Get current balance
  const currentBalance = accounts[from].balance;
  causeway.captureEvent(
    {
      StateChange: {
        variable: `${from}.balance`,
        old_value: null,
        new_value: currentBalance,
        location: 'index.js:190 (READ)',
      },
    },
    trace
  );

  console.log(`[${from}] Read balance: ${currentBalance}`);

  // Check sufficient funds
  if (currentBalance < amount) {
    return res.status(400).json({ error: 'Insufficient funds' });
  }

  // Simulate more processing (window for race condition!)
  await new Promise(resolve => setTimeout(resolve, 10));

  // WRITE: Update balance (RACE CONDITION HERE!)
  const newBalance = currentBalance - amount;
  accounts[from].balance = newBalance;

  causeway.captureEvent(
    {
      StateChange: {
        variable: `${from}.balance`,
        old_value: currentBalance,
        new_value: newBalance,
        location: 'index.js:217 (WRITE)',
      },
    },
    trace
  );

  console.log(`[${from}] Wrote balance: ${newBalance}`);

  // Credit the recipient
  accounts[to].balance += amount;
  causeway.captureEvent(
    {
      StateChange: {
        variable: `${to}.balance`,
        old_value: accounts[to].balance - amount,
        new_value: accounts[to].balance,
        location: 'index.js:233',
      },
    },
    trace
  );

  res.json({
    success: true,
    from: { account: from, newBalance: accounts[from].balance },
    to: { account: to, newBalance: accounts[to].balance },
  });
});

// Reset accounts endpoint (for testing)
app.post('/reset', (req, res) => {
  accounts.alice = { balance: 1000 };
  accounts.bob = { balance: 500 };
  accounts.charlie = { balance: 300 };
  res.json({ message: 'Accounts reset', accounts });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`\n💰 Banking API running on http://localhost:${PORT}`);
  console.log(`🔍 Causeway integration enabled`);
  console.log(`\n📊 Available endpoints:`);
  console.log(`   GET  /balance/:account`);
  console.log(`   POST /transfer (body: { from, to, amount })`);
  console.log(`   POST /reset`);
  console.log(`\n🚨 To test race condition:`);
  console.log(`   node test-race.js`);
  console.log(`\n📺 View results:`);
  console.log(`   cargo run --release -- tui\n`);
});
