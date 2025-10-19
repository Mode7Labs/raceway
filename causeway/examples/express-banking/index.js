/**
 * Example Express Banking API with Raceway Integration
 *
 * This demonstrates how Raceway can detect race conditions in a banking API
 * using the plug-and-play SDK architecture.
 *
 * To run:
 * 1. Start Raceway server: cd ../.. && cargo run --release -- serve
 * 2. Install deps: npm install
 * 3. Start this server: node index.js
 * 4. Open browser: http://localhost:3050
 * 5. Click "Trigger Race Condition" to see the bug in action
 * 6. View results in Raceway Web UI: http://localhost:8080
 */

const express = require('express');
const path = require('path');
const { Raceway } = require('@mode-7/raceway-node');

// ============================================================
// Application Setup
// ============================================================

// Initialize Raceway client
const raceway = new Raceway({
  serverUrl: 'http://localhost:8080',
  serviceName: 'banking-api',
  environment: 'development',
  debug: true,
});

// In-memory account database
// Wrap with auto-tracking for zero-instrumentation mode!
const accounts = raceway.track({
  alice: { balance: 1000 },
  bob: { balance: 500 },
  charlie: { balance: 300 },
}, 'accounts');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Install Raceway middleware for automatic trace initialization
app.use(raceway.middleware());

// Track HTTP response timing
app.use((req, res, next) => {
  res.locals.startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - res.locals.startTime;
    raceway.trackHttpResponse(res.statusCode, duration);
  });

  next();
});

// ============================================================
// API Endpoints
// ============================================================

// Get all accounts
app.get('/api/accounts', (req, res) => {
  raceway.trackFunctionCall('getAllAccounts', {});
  res.json({ accounts });
});

// Get balance endpoint
app.get('/api/balance/:account', (req, res) => {
  const { account } = req.params;

  raceway.trackFunctionCall('getBalance', { account });

  if (!accounts[account]) {
    return res.status(404).json({ error: 'Account not found' });
  }

  // ✅ AUTO-TRACKED Read
  const balance = accounts[account].balance;

  res.json({ account, balance });
});

// Transfer money endpoint (VULNERABLE TO RACE CONDITIONS!)
// ✨ ZERO MANUAL INSTRUMENTATION - Proxies handle everything!
app.post('/api/transfer', async (req, res) => {
  const { from, to, amount } = req.body;

  // Track function call (optional - for better visibility)
  raceway.trackFunctionCall('transferMoney', { from, to, amount });

  // Validate accounts exist
  if (!accounts[from] || !accounts[to]) {
    return res.status(404).json({ error: 'Account not found' });
  }

  // Simulate some processing time (makes race conditions more likely)
  await new Promise(resolve => setTimeout(resolve, 10));

  // READ: Get current balance (✅ AUTO-TRACKED!)
  const currentBalance = accounts[from].balance;

  console.log(`[${from}] Read balance: ${currentBalance}`);

  // Check sufficient funds
  if (currentBalance < amount) {
    return res.status(400).json({ error: 'Insufficient funds' });
  }

  // Simulate more processing (window for race condition!)
  await new Promise(resolve => setTimeout(resolve, 10));

  // WRITE: Update balance (✅ AUTO-TRACKED - RACE CONDITION HERE!)
  const newBalance = currentBalance - amount;
  accounts[from].balance = newBalance;

  console.log(`[${from}] Wrote balance: ${newBalance}`);

  // Credit the recipient (✅ AUTO-TRACKED!)
  accounts[to].balance += amount;

  res.json({
    success: true,
    from: { account: from, newBalance: accounts[from].balance },
    to: { account: to, newBalance: accounts[to].balance },
  });
});

// Reset accounts endpoint (for testing)
app.post('/api/reset', (req, res) => {
  raceway.trackFunctionCall('resetAccounts', {});

  accounts.alice = { balance: 1000 };
  accounts.bob = { balance: 500 };
  accounts.charlie = { balance: 300 };

  res.json({ message: 'Accounts reset', accounts });
});

// ============================================================
// Server Startup
// ============================================================

const PORT = process.env.PORT || 3050;
app.listen(PORT, () => {
  console.log(`\n💰 Banking API running on http://localhost:${PORT}`);
  console.log(`🔍 Raceway plug-and-play integration enabled`);
  console.log(`\n📊 Web UI: http://localhost:${PORT}`);
  console.log(`📊 Raceway Analysis: http://localhost:8080`);
  console.log(`\n🚨 Click "Trigger Race Condition" in the UI to see the bug!\n`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await raceway.stop();
  process.exit(0);
});
