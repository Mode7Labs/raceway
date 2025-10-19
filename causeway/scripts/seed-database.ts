#!/usr/bin/env ts-node
/**
 * Seed script for Raceway database
 *
 * This script:
 * 1. Clears the Supabase database
 * 2. Seeds ~50 events with race conditions and anomalies
 * 3. Creates multiple traces for testing
 *
 * Usage: npx ts-node scripts/seed-database.ts
 */

import { v4 as uuidv4 } from 'uuid';

const SUPABASE_PROJECT_ID = 'qzfkmyqskvlybeambkgi';
const API_URL = 'http://localhost:8080';

interface Event {
  id: string;
  trace_id: string;
  parent_id: string | null;
  timestamp: string;
  kind: any;
  metadata: {
    thread_id: string;
    process_id: number;
    service_name: string;
    environment: string;
    tags: Record<string, string>;
    duration_ns: number | null;
  };
  causality_vector: Array<[string, number]>;
  lock_set: string[];
}

// Test data that will be seeded and validated
export const SEED_DATA = {
  // Trace 1: Banking transaction with race conditions
  trace1: {
    traceId: uuidv4(),
    name: 'Banking Transaction Race',
    events: [] as Event[],
    expectedRaces: 3, // 2 Read-Write races + 1 Write-Write race on account_balance
    expectedAnomalies: 0,
  },

  // Trace 2: Normal trace with anomalies (slow queries)
  trace2: {
    traceId: uuidv4(),
    name: 'Slow Database Queries',
    events: [] as Event[],
    expectedRaces: 0,
    expectedAnomalies: 3,
  },

  // Trace 3: Complex microservice trace with both races and anomalies
  trace3: {
    traceId: uuidv4(),
    name: 'Microservice Race & Anomaly',
    events: [] as Event[],
    expectedRaces: 1,
    expectedAnomalies: 2,
  },
};

function createEvent(
  traceId: string,
  kind: any,
  parentId: string | null = null,
  serviceName: string = 'test-service',
  threadId: string = 'thread-1',
  timestampOffset: number = 0
): Event {
  const now = new Date();
  now.setMilliseconds(now.getMilliseconds() + timestampOffset);

  return {
    id: uuidv4(),
    trace_id: traceId,
    parent_id: parentId,
    timestamp: now.toISOString(),
    kind,
    metadata: {
      thread_id: threadId,
      process_id: 1234,
      service_name: serviceName,
      environment: 'test',
      tags: {},
      duration_ns: null,
    },
    causality_vector: [],
    lock_set: [],
  };
}

// Create Trace 1: Banking transaction with race conditions
function createTrace1() {
  const { traceId } = SEED_DATA.trace1;
  const events: Event[] = [];

  // Event 1: Start transaction (thread 1)
  const e1 = createEvent(
    traceId,
    { FunctionCall: { function_name: 'transfer_money', module: 'banking', args: { from: 'A', to: 'B', amount: 100 }, file: 'banking.ts', line: 42 } },
    null,
    'banking-service',
    'thread-1',
    0
  );
  events.push(e1);

  // Event 2: Read account balance (thread 1)
  events.push(createEvent(
    traceId,
    { StateChange: { variable: 'account_balance', old_value: null, new_value: 1000, location: 'banking.ts:45', access_type: 'Read' } },
    e1.id,
    'banking-service',
    'thread-1',
    10
  ));

  // Event 3: CONCURRENT - Start transaction (thread 2)
  const e3 = createEvent(
    traceId,
    { FunctionCall: { function_name: 'transfer_money', module: 'banking', args: { from: 'A', to: 'C', amount: 50 }, file: 'banking.ts', line: 42 } },
    null,
    'banking-service',
    'thread-2',
    5  // Overlaps with thread 1
  );
  events.push(e3);

  // Event 4: Read account balance (thread 2) - RACE with thread 1
  events.push(createEvent(
    traceId,
    { StateChange: { variable: 'account_balance', old_value: null, new_value: 1000, location: 'banking.ts:45', access_type: 'Read' } },
    e3.id,
    'banking-service',
    'thread-2',
    15
  ));

  // Event 5: Write account balance (thread 1) - RACE CONDITION
  events.push(createEvent(
    traceId,
    { StateChange: { variable: 'account_balance', old_value: 1000, new_value: 900, location: 'banking.ts:52', access_type: 'Write' } },
    e1.id,
    'banking-service',
    'thread-1',
    20
  ));

  // Event 6: Write account balance (thread 2) - RACE CONDITION
  events.push(createEvent(
    traceId,
    { StateChange: { variable: 'account_balance', old_value: 1000, new_value: 950, location: 'banking.ts:52', access_type: 'Write' } },
    e3.id,
    'banking-service',
    'thread-2',
    22  // Concurrent with event 5
  ));

  // Event 7: Commit transaction (thread 1)
  events.push(createEvent(
    traceId,
    { DatabaseQuery: { query: 'COMMIT', database: 'postgres', duration_ms: 5 } },
    e1.id,
    'banking-service',
    'thread-1',
    30
  ));

  // Event 8: Commit transaction (thread 2)
  events.push(createEvent(
    traceId,
    { DatabaseQuery: { query: 'COMMIT', database: 'postgres', duration_ms: 5 } },
    e3.id,
    'banking-service',
    'thread-2',
    32
  ));

  SEED_DATA.trace1.events = events;
  return events;
}

// Create Trace 2: Slow database queries (anomalies)
function createTrace2() {
  const { traceId } = SEED_DATA.trace2;
  const events: Event[] = [];

  // Normal query (baseline)
  const e1 = createEvent(
    traceId,
    { FunctionCall: { function_name: 'get_users', module: 'api', args: {}, file: 'api.ts', line: 10 } },
    null,
    'api-service',
    'thread-1',
    0
  );
  e1.metadata.duration_ns = 50_000_000; // 50ms - normal
  events.push(e1);

  events.push(createEvent(
    traceId,
    { DatabaseQuery: { query: 'SELECT * FROM users', database: 'postgres', duration_ms: 45 } },
    e1.id,
    'api-service',
    'thread-1',
    50
  ));

  // ANOMALY: Slow query #1
  const e3 = createEvent(
    traceId,
    { FunctionCall: { function_name: 'get_users', module: 'api', args: {}, file: 'api.ts', line: 10 } },
    null,
    'api-service',
    'thread-1',
    100
  );
  e3.metadata.duration_ns = 5_000_000_000; // 5000ms - VERY SLOW
  events.push(e3);

  events.push(createEvent(
    traceId,
    { DatabaseQuery: { query: 'SELECT * FROM users', database: 'postgres', duration_ms: 4950 } },
    e3.id,
    'api-service',
    'thread-1',
    5100
  ));

  // ANOMALY: Slow query #2
  const e5 = createEvent(
    traceId,
    { FunctionCall: { function_name: 'get_orders', module: 'api', args: {}, file: 'api.ts', line: 25 } },
    null,
    'api-service',
    'thread-1',
    5200
  );
  e5.metadata.duration_ns = 3_000_000_000; // 3000ms - SLOW
  events.push(e5);

  events.push(createEvent(
    traceId,
    { DatabaseQuery: { query: 'SELECT * FROM orders', database: 'postgres', duration_ms: 2950 } },
    e5.id,
    'api-service',
    'thread-1',
    8200
  ));

  // ANOMALY: Slow HTTP request
  const e7 = createEvent(
    traceId,
    { HttpRequest: { method: 'GET', url: 'https://api.slow-service.com/data', headers: {}, body: null } },
    null,
    'api-service',
    'thread-1',
    8300
  );
  events.push(e7);

  const e8 = createEvent(
    traceId,
    { HttpResponse: { status: 200, headers: {}, body: null, duration_ms: 8000 } },
    e7.id,
    'api-service',
    'thread-1',
    16300
  );
  e8.metadata.duration_ns = 8_000_000_000; // 8000ms - VERY SLOW
  events.push(e8);

  SEED_DATA.trace2.events = events;
  return events;
}

// Create Trace 3: Microservice with races and anomalies
function createTrace3() {
  const { traceId } = SEED_DATA.trace3;
  const events: Event[] = [];

  // Event 1: API receives request
  const e1 = createEvent(
    traceId,
    { HttpRequest: { method: 'POST', url: '/api/cart/checkout', headers: {}, body: { user_id: 123 } } },
    null,
    'api-gateway',
    'thread-1',
    0
  );
  events.push(e1);

  // Event 2: Spawn async task for inventory check
  const inventoryTaskId = uuidv4();
  events.push(createEvent(
    traceId,
    { AsyncSpawn: { task_id: inventoryTaskId, spawned_by: 'checkout_handler' } },
    e1.id,
    'api-gateway',
    'thread-1',
    10
  ));

  // Event 3: Read inventory count (thread 2)
  events.push(createEvent(
    traceId,
    { StateChange: { variable: 'inventory_count', old_value: null, new_value: 10, location: 'inventory.ts:15', access_type: 'Read' } },
    null,
    'inventory-service',
    'thread-2',
    15
  ));

  // Event 4: CONCURRENT - Another checkout on thread 3
  events.push(createEvent(
    traceId,
    { StateChange: { variable: 'inventory_count', old_value: null, new_value: 10, location: 'inventory.ts:15', access_type: 'Read' } },
    null,
    'inventory-service',
    'thread-3',
    17
  ));

  // Event 5: Write inventory (thread 2) - RACE CONDITION
  events.push(createEvent(
    traceId,
    { StateChange: { variable: 'inventory_count', old_value: 10, new_value: 9, location: 'inventory.ts:22', access_type: 'Write' } },
    null,
    'inventory-service',
    'thread-2',
    20
  ));

  // Event 6: Write inventory (thread 3) - RACE CONDITION (concurrent write)
  events.push(createEvent(
    traceId,
    { StateChange: { variable: 'inventory_count', old_value: 10, new_value: 9, location: 'inventory.ts:22', access_type: 'Write' } },
    null,
    'inventory-service',
    'thread-3',
    21
  ));

  // Event 7: ANOMALY - Slow payment processing
  const e7 = createEvent(
    traceId,
    { FunctionCall: { function_name: 'process_payment', module: 'payment', args: { amount: 99.99 }, file: 'payment.ts', line: 50 } },
    e1.id,
    'payment-service',
    'thread-1',
    30
  );
  e7.metadata.duration_ns = 10_000_000_000; // 10 seconds - VERY SLOW
  events.push(e7);

  // Event 8: ANOMALY - Slow database commit
  const e8 = createEvent(
    traceId,
    { DatabaseQuery: { query: 'INSERT INTO orders VALUES (...)', database: 'postgres', duration_ms: 5000 } },
    e1.id,
    'order-service',
    'thread-1',
    10040
  );
  e8.metadata.duration_ns = 5_000_000_000; // 5 seconds - SLOW
  events.push(e8);

  // Event 9: HTTP response
  events.push(createEvent(
    traceId,
    { HttpResponse: { status: 200, headers: {}, body: { order_id: 456 }, duration_ms: 10100 } },
    e1.id,
    'api-gateway',
    'thread-1',
    10150
  ));

  SEED_DATA.trace3.events = events;
  return events;
}

async function clearSupabase() {
  console.log('\n🧹 Clearing Supabase database...');
  console.log('   ⚠️  Note: Currently requires manual clearing via Supabase UI or SQL');
  console.log('   ⚠️  The seed script will append to existing data');
  console.log('   ℹ️  To clear manually, run: TRUNCATE events CASCADE in Supabase SQL Editor');

  // Note: No automatic clearing since server doesn't have a clear endpoint
  // Users should manually clear via Supabase UI if needed
}

async function seedEvents(events: Event[]) {
  console.log(`   Seeding ${events.length} events...`);

  const response = await fetch(`${API_URL}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to seed events: ${response.status} ${text}`);
  }

  console.log(`   ✅ Seeded ${events.length} events`);
}

async function main() {
  console.log('🌱 Raceway Database Seeder\n');
  console.log('═══════════════════════════════════════════════════');

  try {
    // Step 1: Clear database
    await clearSupabase();

    // Step 2: Generate seed data
    console.log('\n📝 Generating seed data...');
    const trace1Events = createTrace1();
    const trace2Events = createTrace2();
    const trace3Events = createTrace3();

    const totalEvents = trace1Events.length + trace2Events.length + trace3Events.length;
    console.log(`   Generated ${totalEvents} events across 3 traces`);

    // Save trace metadata for validation
    const fs = require('fs');
    const path = require('path');
    const metadataPath = path.join(__dirname, '.seed-metadata.json');
    const metadata = {
      seeded_at: new Date().toISOString(),
      traces: [
        {
          trace_id: SEED_DATA.trace1.traceId,
          name: SEED_DATA.trace1.name,
          expected_races: SEED_DATA.trace1.expectedRaces,
          expected_anomalies: SEED_DATA.trace1.expectedAnomalies,
          event_count: trace1Events.length,
        },
        {
          trace_id: SEED_DATA.trace2.traceId,
          name: SEED_DATA.trace2.name,
          expected_races: SEED_DATA.trace2.expectedRaces,
          expected_anomalies: SEED_DATA.trace2.expectedAnomalies,
          event_count: trace2Events.length,
        },
        {
          trace_id: SEED_DATA.trace3.traceId,
          name: SEED_DATA.trace3.name,
          expected_races: SEED_DATA.trace3.expectedRaces,
          expected_anomalies: SEED_DATA.trace3.expectedAnomalies,
          event_count: trace3Events.length,
        },
      ],
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    console.log(`   💾 Saved trace metadata to ${metadataPath}`);

    // Step 3: Seed traces
    console.log('\n🚀 Seeding database...');
    console.log(`\n📊 Trace 1: ${SEED_DATA.trace1.name}`);
    console.log(`   ID: ${SEED_DATA.trace1.traceId}`);
    console.log(`   Events: ${trace1Events.length}`);
    console.log(`   Expected Races: ${SEED_DATA.trace1.expectedRaces}`);
    await seedEvents(trace1Events);

    console.log(`\n📊 Trace 2: ${SEED_DATA.trace2.name}`);
    console.log(`   ID: ${SEED_DATA.trace2.traceId}`);
    console.log(`   Events: ${trace2Events.length}`);
    console.log(`   Expected Anomalies: ${SEED_DATA.trace2.expectedAnomalies}`);
    await seedEvents(trace2Events);

    console.log(`\n📊 Trace 3: ${SEED_DATA.trace3.name}`);
    console.log(`   ID: ${SEED_DATA.trace3.traceId}`);
    console.log(`   Events: ${trace3Events.length}`);
    console.log(`   Expected Races: ${SEED_DATA.trace3.expectedRaces}`);
    console.log(`   Expected Anomalies: ${SEED_DATA.trace3.expectedAnomalies}`);
    await seedEvents(trace3Events);

    // Summary
    console.log('\n═══════════════════════════════════════════════════');
    console.log('✅ Seeding complete!\n');
    console.log('📋 Summary:');
    console.log(`   Total Events: ${totalEvents}`);
    console.log(`   Total Traces: 3`);
    console.log(`   Total Expected Races: ${SEED_DATA.trace1.expectedRaces + SEED_DATA.trace3.expectedRaces}`);
    console.log(`   Total Expected Anomalies: ${SEED_DATA.trace2.expectedAnomalies + SEED_DATA.trace3.expectedAnomalies}`);
    console.log('\n🧪 Run validation with:');
    console.log(`   npx ts-node scripts/validate-trace.ts ${SEED_DATA.trace1.traceId}`);
    console.log(`   npx ts-node scripts/validate-trace.ts ${SEED_DATA.trace2.traceId}`);
    console.log(`   npx ts-node scripts/validate-trace.ts ${SEED_DATA.trace3.traceId}`);

  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}
