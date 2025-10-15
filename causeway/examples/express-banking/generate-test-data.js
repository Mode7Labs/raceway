/**
 * Test Data Generator for Raceway
 *
 * Generates 20 traces with a mix of:
 * - 50% normal operations (no issues)
 * - 50% problematic operations (anomalies and race conditions)
 */

const { v4: uuidv4 } = require('uuid');

const API_URL = 'http://localhost:8080';

// Helper to create random delays
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Helper to generate timestamps with realistic spacing
let baseTime = Date.now();
const getTimestamp = (offset = 0) => {
  baseTime += offset;
  return new Date(baseTime).toISOString();
};

// Generate a single event
function createEvent({ traceId, parentId, kind, threadId = null, includeAnomaly = false }) {
  const eventId = uuidv4();
  const thread = threadId || `thread-${Math.floor(Math.random() * 4)}`;

  // Normal duration for most operations: 5-50ms
  let durationNs = randomDelay(5, 50) * 1_000_000;

  // For anomalies, make some operations suspiciously slow
  if (includeAnomaly && Math.random() < 0.5) {
    durationNs = randomDelay(500, 2000) * 1_000_000; // 500-2000ms (very slow!)
  }

  return {
    id: eventId,
    trace_id: traceId,
    parent_id: parentId,
    timestamp: getTimestamp(randomDelay(1, 10)),
    kind,
    metadata: {
      thread_id: thread,
      process_id: process.pid,
      service_name: 'banking-api',
      environment: 'development',
      tags: {},
      duration_ns: durationNs,
    },
    causality_vector: [],
    lock_set: [],
  };
}

// Generate a normal trace (no issues)
function generateNormalTrace() {
  const traceId = uuidv4();
  const events = [];

  // HTTP Request
  let parentId = null;
  const httpReq = createEvent({
    traceId,
    parentId,
    kind: { HttpRequest: { method: 'POST', url: '/transfer', headers: {}, body: null } },
  });
  events.push(httpReq);
  parentId = httpReq.id;

  // Function call
  const funcCall = createEvent({
    traceId,
    parentId,
    kind: { FunctionCall: { function_name: 'transferMoney', module: 'banking', args: {}, file: 'index.js', line: 100 } },
  });
  events.push(funcCall);
  parentId = funcCall.id;

  // Read balance (sequential, no race)
  const read = createEvent({
    traceId,
    parentId,
    kind: { StateChange: { variable: 'alice.balance', old_value: null, new_value: 1000, location: 'index.js:150', access_type: 'Read' } },
  });
  events.push(read);
  parentId = read.id;

  // Write new balance
  const write = createEvent({
    traceId,
    parentId,
    kind: { StateChange: { variable: 'alice.balance', old_value: 1000, new_value: 900, location: 'index.js:160', access_type: 'Write' } },
  });
  events.push(write);
  parentId = write.id;

  // HTTP Response
  const httpResp = createEvent({
    traceId,
    parentId,
    kind: { HttpResponse: { status: 200, headers: {}, body: null, duration_ms: 45 } },
  });
  events.push(httpResp);

  return { trace_id: traceId, events, hasIssues: false };
}

// Generate a trace with race condition
function generateRaceConditionTrace() {
  const traceId = uuidv4();
  const events = [];

  // Two concurrent operations accessing the same variable
  const sharedVariable = 'shared_counter';
  const initialValue = 100;

  // Thread 1: Read-Modify-Write
  const thread1 = `thread-${Math.floor(Math.random() * 4)}`;
  const read1 = createEvent({
    traceId,
    parentId: null,
    threadId: thread1,
    kind: { StateChange: { variable: sharedVariable, old_value: null, new_value: initialValue, location: 'worker.js:45', access_type: 'Read' } },
  });
  events.push(read1);

  // Thread 2: Read-Modify-Write (CONCURRENT!)
  const thread2 = `thread-${Math.floor(Math.random() * 4)}`;
  const read2 = createEvent({
    traceId,
    parentId: null,
    threadId: thread2,
    kind: { StateChange: { variable: sharedVariable, old_value: null, new_value: initialValue, location: 'worker.js:45', access_type: 'Read' } },
  });
  events.push(read2);

  // Thread 1 writes
  const write1 = createEvent({
    traceId,
    parentId: read1.id,
    threadId: thread1,
    kind: { StateChange: { variable: sharedVariable, old_value: initialValue, new_value: initialValue + 10, location: 'worker.js:50', access_type: 'Write' } },
  });
  events.push(write1);

  // Thread 2 writes (OVERWRITES thread 1's write!)
  const write2 = createEvent({
    traceId,
    parentId: read2.id,
    threadId: thread2,
    kind: { StateChange: { variable: sharedVariable, old_value: initialValue, new_value: initialValue + 5, location: 'worker.js:50', access_type: 'Write' } },
  });
  events.push(write2);

  return { trace_id: traceId, events, hasIssues: true, issueType: 'race' };
}

// Generate a trace with performance anomaly
function generateAnomalyTrace() {
  const traceId = uuidv4();
  const events = [];

  let parentId = null;

  // Normal HTTP request
  const httpReq = createEvent({
    traceId,
    parentId,
    kind: { HttpRequest: { method: 'GET', url: '/balance/alice', headers: {}, body: null } },
  });
  events.push(httpReq);
  parentId = httpReq.id;

  // Normal function call
  const funcCall = createEvent({
    traceId,
    parentId,
    kind: { FunctionCall: { function_name: 'getBalance', module: 'banking', args: {}, file: 'index.js', line: 200 } },
  });
  events.push(funcCall);
  parentId = funcCall.id;

  // ANOMALY: Extremely slow database read (should be ~10ms, but takes 1500ms)
  const slowRead = createEvent({
    traceId,
    parentId,
    kind: { StateChange: { variable: 'db.balance', old_value: null, new_value: 1000, location: 'db.js:100', access_type: 'Read' } },
    includeAnomaly: true,
  });
  // Force it to be slow
  slowRead.metadata.duration_ns = randomDelay(1000, 2500) * 1_000_000; // 1-2.5 seconds
  events.push(slowRead);
  parentId = slowRead.id;

  // Normal response
  const httpResp = createEvent({
    traceId,
    parentId,
    kind: { HttpResponse: { status: 200, headers: {}, body: null, duration_ms: 1520 } },
  });
  events.push(httpResp);

  return { trace_id: traceId, events, hasIssues: true, issueType: 'anomaly' };
}

// Generate a complex trace with multiple operations
function generateComplexTrace(hasIssues = false) {
  const traceId = uuidv4();
  const events = [];

  let parentId = null;

  // Start with HTTP request
  const httpReq = createEvent({
    traceId,
    parentId,
    kind: { HttpRequest: { method: 'POST', url: '/complex-operation', headers: {}, body: null } },
  });
  events.push(httpReq);
  parentId = httpReq.id;

  // Multiple function calls
  for (let i = 0; i < randomDelay(3, 7); i++) {
    const funcCall = createEvent({
      traceId,
      parentId,
      kind: { FunctionCall: { function_name: `operation${i}`, module: 'service', args: {}, file: 'service.js', line: 100 + i * 10 } },
      includeAnomaly: hasIssues && Math.random() < 0.3,
    });
    events.push(funcCall);
    parentId = funcCall.id;

    // Some state changes
    if (Math.random() < 0.6) {
      const stateChange = createEvent({
        traceId,
        parentId,
        kind: { StateChange: { variable: `var_${i}`, old_value: i * 10, new_value: i * 10 + 5, location: `service.js:${110 + i * 10}`, access_type: Math.random() < 0.5 ? 'Read' : 'Write' } },
        includeAnomaly: hasIssues && Math.random() < 0.2,
      });
      events.push(stateChange);
      parentId = stateChange.id;
    }
  }

  // HTTP Response
  const httpResp = createEvent({
    traceId,
    parentId,
    kind: { HttpResponse: { status: 200, headers: {}, body: null, duration_ms: randomDelay(50, 200) } },
  });
  events.push(httpResp);

  return { trace_id: traceId, events, hasIssues };
}

// Send events to Raceway server
async function sendTrace(trace) {
  try {
    const response = await fetch(`${API_URL}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: trace.events }),
    });

    if (response.ok) {
      console.log(`✓ Trace ${trace.trace_id.substring(0, 8)}: ${trace.events.length} events (${trace.hasIssues ? (trace.issueType || 'issues') : 'clean'})`);
    } else {
      const text = await response.text();
      console.error(`✗ Failed to send trace ${trace.trace_id.substring(0, 8)}: ${response.status} ${text}`);
    }
  } catch (error) {
    console.error(`✗ Error sending trace:`, error.message);
  }
}

async function main() {
  console.log('🧪 Generating test data for Raceway...\n');
  console.log('Creating 20 traces:');
  console.log('  - ~50% clean traces (no issues)');
  console.log('  - ~25% race conditions');
  console.log('  - ~25% performance anomalies\n');

  const traces = [];

  // Generate traces with the desired distribution
  for (let i = 0; i < 20; i++) {
    const rand = Math.random();

    if (rand < 0.5) {
      // 50% normal
      if (Math.random() < 0.5) {
        traces.push(generateNormalTrace());
      } else {
        traces.push(generateComplexTrace(false));
      }
    } else if (rand < 0.75) {
      // 25% race conditions
      traces.push(generateRaceConditionTrace());
    } else {
      // 25% anomalies
      if (Math.random() < 0.5) {
        traces.push(generateAnomalyTrace());
      } else {
        traces.push(generateComplexTrace(true));
      }
    }
  }

  // Send all traces
  console.log('📤 Sending traces to Raceway server...\n');

  for (const trace of traces) {
    await sendTrace(trace);
    await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between traces
  }

  console.log('\n✅ Done! Generated and sent 20 traces.');
  console.log('\n📊 Summary:');
  const cleanCount = traces.filter(t => !t.hasIssues).length;
  const raceCount = traces.filter(t => t.issueType === 'race').length;
  const anomalyCount = traces.filter(t => t.issueType === 'anomaly' || (t.hasIssues && !t.issueType)).length;

  console.log(`   Clean: ${cleanCount}`);
  console.log(`   Race conditions: ${raceCount}`);
  console.log(`   Anomalies: ${anomalyCount}`);
  console.log('\n🔍 View in Raceway WebUI: http://localhost:5173');
}

main().catch(console.error);
