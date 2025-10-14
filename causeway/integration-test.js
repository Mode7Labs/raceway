#!/usr/bin/env node

/**
 * Integration Test - Send realistic events to Causeway
 *
 * This simulates a real application with a race condition
 */

const SERVER_URL = 'http://localhost:8080';

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function sendEvents(events) {
  const response = await fetch(`${SERVER_URL}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  });
  return response.json();
}

async function getStatus() {
  const response = await fetch(`${SERVER_URL}/status`);
  return response.json();
}

async function main() {
  console.log('🔍 Causeway Integration Test\n');

  // Check server
  try {
    await fetch(`${SERVER_URL}/health`);
  } catch (error) {
    console.error('❌ Server not running! Start it with: cargo run --release -- serve\n');
    process.exit(1);
  }

  const traceId = generateUUID();
  console.log(`📊 Trace ID: ${traceId}\n`);

  // Simulate a race condition scenario
  console.log('Simulating race condition with concurrent transfers...\n');

  const now = Date.now();

  // Event 1: Transfer A starts
  const event1 = {
    id: generateUUID(),
    trace_id: traceId,
    parent_id: null,
    timestamp: new Date(now).toISOString(),
    kind: {
      FunctionCall: {
        function_name: 'transferMoney',
        module: 'transactions',
        args: { from: 'alice', to: 'bob', amount: 100 },
        file: 'transactions.js',
        line: 42,
      }
    },
    metadata: {
      thread_id: 'thread-1',
      process_id: process.pid,
      service_name: 'bank-api',
      environment: 'production',
      tags: {},
      duration_ns: null,
    },
    causality_vector: [],
  };

  // Event 2: Transfer B starts (concurrent!)
  const event2 = {
    id: generateUUID(),
    trace_id: traceId,
    parent_id: null,
    timestamp: new Date(now + 1).toISOString(), // Almost simultaneous
    kind: {
      FunctionCall: {
        function_name: 'transferMoney',
        module: 'transactions',
        args: { from: 'alice', to: 'charlie', amount: 200 },
        file: 'transactions.js',
        line: 42,
      }
    },
    metadata: {
      thread_id: 'thread-2',
      process_id: process.pid,
      service_name: 'bank-api',
      environment: 'production',
      tags: {},
      duration_ns: null,
    },
    causality_vector: [],
  };

  // Event 3: Transfer A reads balance
  const event3 = {
    id: generateUUID(),
    trace_id: traceId,
    parent_id: event1.id,
    timestamp: new Date(now + 50).toISOString(),
    kind: {
      StateChange: {
        variable: 'alice.balance',
        old_value: null,
        new_value: 1000,
        location: 'transactions.js:45',
      }
    },
    metadata: {
      thread_id: 'thread-1',
      process_id: process.pid,
      service_name: 'bank-api',
      environment: 'production',
      tags: {},
      duration_ns: 50000,
    },
    causality_vector: [[event1.id, 1]],
  };

  // Event 4: Transfer B reads balance (RACE!)
  const event4 = {
    id: generateUUID(),
    trace_id: traceId,
    parent_id: event2.id,
    timestamp: new Date(now + 52).toISOString(), // Nearly same time!
    kind: {
      StateChange: {
        variable: 'alice.balance',
        old_value: null,
        new_value: 1000,
        location: 'transactions.js:45',
      }
    },
    metadata: {
      thread_id: 'thread-2',
      process_id: process.pid,
      service_name: 'bank-api',
      environment: 'production',
      tags: {},
      duration_ns: 52000,
    },
    causality_vector: [[event2.id, 1]],
  };

  // Event 5: Transfer A writes new balance
  const event5 = {
    id: generateUUID(),
    trace_id: traceId,
    parent_id: event3.id,
    timestamp: new Date(now + 100).toISOString(),
    kind: {
      StateChange: {
        variable: 'alice.balance',
        old_value: 1000,
        new_value: 900,
        location: 'transactions.js:46',
      }
    },
    metadata: {
      thread_id: 'thread-1',
      process_id: process.pid,
      service_name: 'bank-api',
      environment: 'production',
      tags: {},
      duration_ns: 100000,
    },
    causality_vector: [[event1.id, 2]],
  };

  // Event 6: Transfer B writes new balance (OVERWRITES A's change!)
  const event6 = {
    id: generateUUID(),
    trace_id: traceId,
    parent_id: event4.id,
    timestamp: new Date(now + 105).toISOString(),
    kind: {
      StateChange: {
        variable: 'alice.balance',
        old_value: 1000,
        new_value: 800,
        location: 'transactions.js:46',
      }
    },
    metadata: {
      thread_id: 'thread-2',
      process_id: process.pid,
      service_name: 'bank-api',
      environment: 'production',
      tags: {},
      duration_ns: 105000,
    },
    causality_vector: [[event2.id, 2]],
  };

  const events = [event1, event2, event3, event4, event5, event6];

  console.log('📤 Sending events to Causeway...\n');
  const result = await sendEvents(events);
  console.log('✅ Result:', result.data);

  console.log('\n📊 Server Status:');
  const status = await getStatus();
  console.log(JSON.stringify(status.data, null, 2));

  console.log('\n🎯 What just happened:');
  console.log('   • Transfer A and B both started at nearly the same time');
  console.log('   • Both read alice.balance = 1000');
  console.log('   • Transfer A wrote balance = 900 (1000 - 100)');
  console.log('   • Transfer B wrote balance = 800 (1000 - 200)');
  console.log('   • Final balance: 800 (should be 700!)');
  console.log('   • Lost $100 due to race condition! 💸\n');

  console.log('🔍 To see the analysis:');
  console.log(`   curl http://localhost:8080/api/traces/${traceId}/analyze | jq`);
  console.log('\n📺 Or view in the TUI:');
  console.log('   cargo run --release -- tui');
  console.log('\n🌐 Or check the web UI:');
  console.log('   http://localhost:8080/status\n');
}

main().catch(console.error);
