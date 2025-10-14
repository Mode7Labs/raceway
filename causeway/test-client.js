#!/usr/bin/env node

/**
 * Test Client for Causeway Server
 *
 * This sends sample events to the Causeway server to test end-to-end integration.
 */

const SERVER_URL = 'http://localhost:8080';

// Generate a UUID (simple version)
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Create sample events
function createSampleEvents() {
  const traceId = generateUUID();
  const now = new Date().toISOString();

  return {
    events: [
      {
        id: generateUUID(),
        trace_id: traceId,
        parent_id: null,
        timestamp: now,
        kind: {
          FunctionCall: {
            function_name: 'transferMoney',
            module: 'transactions',
            args: { from: 'alice', to: 'bob', amount: 100 },
            file: 'transactions.ts',
            line: 42,
          }
        },
        metadata: {
          thread_id: 'main',
          process_id: process.pid,
          service_name: 'test-client',
          environment: 'test',
          tags: {},
          duration_ns: null,
        },
        causality_vector: [],
      },
      {
        id: generateUUID(),
        trace_id: traceId,
        parent_id: null,
        timestamp: new Date(Date.now() + 1).toISOString(),
        kind: {
          StateChange: {
            variable: 'balance',
            old_value: 1000,
            new_value: 900,
            location: 'transactions.ts:45',
          }
        },
        metadata: {
          thread_id: 'main',
          process_id: process.pid,
          service_name: 'test-client',
          environment: 'test',
          tags: {},
          duration_ns: 150000,
        },
        causality_vector: [],
      },
    ]
  };
}

async function testServer() {
  console.log('🧪 Testing Causeway Server\n');

  // Test 1: Health check
  console.log('1️⃣  Testing health endpoint...');
  try {
    const response = await fetch(`${SERVER_URL}/health`);
    const data = await response.json();
    console.log('   ✅ Health check:', data);
  } catch (error) {
    console.error('   ❌ Health check failed:', error.message);
    console.log('\n⚠️  Make sure the server is running: cargo run serve\n');
    return;
  }

  // Test 2: Server status
  console.log('\n2️⃣  Testing status endpoint...');
  try {
    const response = await fetch(`${SERVER_URL}/status`);
    const data = await response.json();
    console.log('   ✅ Status:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('   ❌ Status failed:', error.message);
  }

  // Test 3: Send events
  console.log('\n3️⃣  Sending sample events...');
  try {
    const events = createSampleEvents();
    const response = await fetch(`${SERVER_URL}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(events),
    });
    const data = await response.json();
    console.log('   ✅ Events ingested:', data);
  } catch (error) {
    console.error('   ❌ Event ingestion failed:', error.message);
  }

  // Test 4: List traces
  console.log('\n4️⃣  Listing traces...');
  try {
    const response = await fetch(`${SERVER_URL}/api/traces`);
    const data = await response.json();
    console.log('   ✅ Traces:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('   ❌ List traces failed:', error.message);
  }

  console.log('\n✨ Test complete!\n');
  console.log('👉 Open http://localhost:8080 in your browser to see the UI');
  console.log('👉 Check http://localhost:8080/status for server stats\n');
}

testServer().catch(console.error);
