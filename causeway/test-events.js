#!/usr/bin/env node

/**
 * Test script to simulate realistic system events with one race condition
 *
 * This script simulates:
 * - Multiple concurrent traces from different operations
 * - Various event types (function calls, state changes, async operations)
 * - Realistic timing patterns
 * - One intentional race condition on a shared counter
 */

const SERVER_URL = 'http://localhost:8080';

// Helper to generate UUIDs (simple version)
function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Helper to create timestamps with slight delays
function timestamp(offsetMs = 0) {
    const now = new Date(Date.now() + offsetMs);
    return now.toISOString();
}

// Helper to send event
async function sendEvent(event) {
    try {
        const response = await fetch(`${SERVER_URL}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ events: [event] })
        });

        if (!response.ok) {
            const text = await response.text();
            console.error(`Failed to send event: ${response.status} - ${text}`);
        }
    } catch (error) {
        console.error('Error sending event:', error.message);
    }
}

// Simulate a successful user registration flow
async function simulateUserRegistration() {
    const traceId = generateId();
    const threadId = 'web-worker-1';
    let offset = 0;

    console.log(`📝 Simulating user registration (trace: ${traceId.substring(0, 8)}...)`);

    // Function call: validateEmail
    await sendEvent({
        id: generateId(),
        trace_id: traceId,
        parent_id: null,
        timestamp: timestamp(offset),
        kind: {
            FunctionCall: {
                function_name: 'validateEmail',
                module: 'auth/validator.js',
                args: { email: 'user@example.com' },
                file: 'auth/validator.js',
                line: 12
            }
        },
        metadata: {
            thread_id: threadId,
            process_id: 1234,
            service_name: 'auth-service',
            environment: 'production',
            tags: {},
            duration_ns: 5000000
        },
        causality_vector: [[traceId, 1]],
        lock_set: []
    });
    offset += 5;

    // Function enter: hashPassword
    await sendEvent({
        id: generateId(),
        trace_id: traceId,
        kind: { FunctionEnter: { name: 'hashPassword', module: 'auth/crypto.js' } },
        location: 'auth/crypto.js:45',
        timestamp: timestamp(offset),
        thread_id: threadId,
        vector_clock: { [traceId]: 3 }
    });
    offset += 50; // Password hashing is slow

    // Function exit: hashPassword
    await sendEvent({
        id: generateId(),
        trace_id: traceId,
        kind: { FunctionExit: { name: 'hashPassword', module: 'auth/crypto.js' } },
        location: 'auth/crypto.js:52',
        timestamp: timestamp(offset),
        thread_id: threadId,
        vector_clock: { [traceId]: 4 },
        metadata: { duration_ns: 50000000 }
    });
    offset += 5;

    // Database insert
    await sendEvent({
        id: generateId(),
        trace_id: traceId,
        kind: { FunctionEnter: { name: 'insertUser', module: 'db/users.js' } },
        location: 'db/users.js:89',
        timestamp: timestamp(offset),
        thread_id: threadId,
        vector_clock: { [traceId]: 5 }
    });
    offset += 25;

    await sendEvent({
        id: generateId(),
        trace_id: traceId,
        kind: { FunctionExit: { name: 'insertUser', module: 'db/users.js' } },
        location: 'db/users.js:95',
        timestamp: timestamp(offset),
        thread_id: threadId,
        vector_clock: { [traceId]: 6 },
        metadata: { duration_ns: 25000000 }
    });
}

// Simulate a data processing job
async function simulateDataProcessing() {
    const traceId = generateId();
    const threadId = 'worker-thread-1';
    let offset = 0;

    console.log(`⚙️  Simulating data processing (trace: ${traceId.substring(0, 8)}...)`);

    // Load data
    await sendEvent({
        id: generateId(),
        trace_id: traceId,
        kind: { FunctionEnter: { name: 'loadDataset', module: 'processing/loader.js' } },
        location: 'processing/loader.js:23',
        timestamp: timestamp(offset),
        thread_id: threadId,
        vector_clock: { [traceId]: 1 }
    });
    offset += 100; // Loading is slow

    await sendEvent({
        id: generateId(),
        trace_id: traceId,
        kind: { FunctionExit: { name: 'loadDataset', module: 'processing/loader.js' } },
        location: 'processing/loader.js:45',
        timestamp: timestamp(offset),
        thread_id: threadId,
        vector_clock: { [traceId]: 2 },
        metadata: { duration_ns: 100000000 }
    });
    offset += 10;

    // Transform data
    await sendEvent({
        id: generateId(),
        trace_id: traceId,
        kind: { FunctionEnter: { name: 'transformRecords', module: 'processing/transform.js' } },
        location: 'processing/transform.js:67',
        timestamp: timestamp(offset),
        thread_id: threadId,
        vector_clock: { [traceId]: 3 }
    });
    offset += 45;

    await sendEvent({
        id: generateId(),
        trace_id: traceId,
        kind: { FunctionExit: { name: 'transformRecords', module: 'processing/transform.js' } },
        location: 'processing/transform.js:89',
        timestamp: timestamp(offset),
        thread_id: threadId,
        vector_clock: { [traceId]: 4 },
        metadata: { duration_ns: 45000000 }
    });
    offset += 5;

    // Save results
    await sendEvent({
        id: generateId(),
        trace_id: traceId,
        kind: { FunctionEnter: { name: 'saveResults', module: 'processing/saver.js' } },
        location: 'processing/saver.js:12',
        timestamp: timestamp(offset),
        thread_id: threadId,
        vector_clock: { [traceId]: 5 }
    });
    offset += 30;

    await sendEvent({
        id: generateId(),
        trace_id: traceId,
        kind: { FunctionExit: { name: 'saveResults', module: 'processing/saver.js' } },
        location: 'processing/saver.js:28',
        timestamp: timestamp(offset),
        thread_id: threadId,
        vector_clock: { [traceId]: 6 },
        metadata: { duration_ns: 30000000 }
    });
}

// Simulate API request handling
async function simulateApiRequest(endpoint, duration = 20) {
    const traceId = generateId();
    const threadId = 'api-server-1';
    let offset = 0;

    console.log(`🌐 Simulating API request to ${endpoint} (trace: ${traceId.substring(0, 8)}...)`);

    // Request received
    await sendEvent({
        id: generateId(),
        trace_id: traceId,
        kind: { FunctionEnter: { name: 'handleRequest', module: 'api/server.js' } },
        location: 'api/server.js:156',
        timestamp: timestamp(offset),
        thread_id: threadId,
        vector_clock: { [traceId]: 1 }
    });
    offset += 2;

    // Authenticate
    await sendEvent({
        id: generateId(),
        trace_id: traceId,
        kind: { FunctionEnter: { name: 'authenticate', module: 'api/auth.js' } },
        location: 'api/auth.js:34',
        timestamp: timestamp(offset),
        thread_id: threadId,
        vector_clock: { [traceId]: 2 }
    });
    offset += 8;

    await sendEvent({
        id: generateId(),
        trace_id: traceId,
        kind: { FunctionExit: { name: 'authenticate', module: 'api/auth.js' } },
        location: 'api/auth.js:42',
        timestamp: timestamp(offset),
        thread_id: threadId,
        vector_clock: { [traceId]: 3 },
        metadata: { duration_ns: 8000000 }
    });
    offset += 3;

    // Business logic
    await sendEvent({
        id: generateId(),
        trace_id: traceId,
        kind: { FunctionEnter: { name: endpoint, module: 'api/handlers.js' } },
        location: 'api/handlers.js:78',
        timestamp: timestamp(offset),
        thread_id: threadId,
        vector_clock: { [traceId]: 4 }
    });
    offset += duration;

    await sendEvent({
        id: generateId(),
        trace_id: traceId,
        kind: { FunctionExit: { name: endpoint, module: 'api/handlers.js' } },
        location: 'api/handlers.js:112',
        timestamp: timestamp(offset),
        thread_id: threadId,
        vector_clock: { [traceId]: 5 },
        metadata: { duration_ns: duration * 1000000 }
    });
    offset += 2;

    // Response sent
    await sendEvent({
        id: generateId(),
        trace_id: traceId,
        kind: { FunctionExit: { name: 'handleRequest', module: 'api/server.js' } },
        location: 'api/server.js:178',
        timestamp: timestamp(offset),
        thread_id: threadId,
        vector_clock: { [traceId]: 6 },
        metadata: { duration_ns: (offset) * 1000000 }
    });
}

// Simulate a RACE CONDITION on a shared counter
async function simulateRaceCondition() {
    const baseTime = Date.now();

    // Two concurrent requests trying to increment a counter
    const trace1 = generateId();
    const trace2 = generateId();
    const thread1 = 'worker-1';
    const thread2 = 'worker-2';

    console.log(`🚨 Simulating RACE CONDITION (traces: ${trace1.substring(0, 8)}... & ${trace2.substring(0, 8)}...)`);

    // Thread 1: Read counter (value = 100)
    const read1Id = generateId();
    await sendEvent({
        id: read1Id,
        trace_id: trace1,
        kind: {
            StateChange: {
                variable: 'requestCounter',
                old_value: null,
                new_value: '100',
                location: 'metrics/counter.js:45',
                access_type: 'Read'
            }
        },
        location: 'metrics/counter.js:45',
        timestamp: new Date(baseTime).toISOString(),
        thread_id: thread1,
        vector_clock: { [trace1]: 1 }
    });

    // Thread 2: Read counter (value = 100) - CONCURRENT READ
    const read2Id = generateId();
    await sendEvent({
        id: read2Id,
        trace_id: trace2,
        kind: {
            StateChange: {
                variable: 'requestCounter',
                old_value: null,
                new_value: '100',
                location: 'metrics/counter.js:45',
                access_type: 'Read'
            }
        },
        location: 'metrics/counter.js:45',
        timestamp: new Date(baseTime + 1).toISOString(), // Nearly simultaneous
        thread_id: thread2,
        vector_clock: { [trace2]: 1 }
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    // Thread 1: Write counter (value = 101)
    const write1Id = generateId();
    await sendEvent({
        id: write1Id,
        trace_id: trace1,
        kind: {
            StateChange: {
                variable: 'requestCounter',
                old_value: '100',
                new_value: '101',
                location: 'metrics/counter.js:46',
                access_type: 'Write'
            }
        },
        location: 'metrics/counter.js:46',
        timestamp: new Date(baseTime + 15).toISOString(),
        thread_id: thread1,
        vector_clock: { [trace1]: 2 },
        metadata: {
            locks_held: [],
            related_events: [read1Id]
        }
    });

    // Thread 2: Write counter (value = 101) - RACE! Should be 102
    const write2Id = generateId();
    await sendEvent({
        id: write2Id,
        trace_id: trace2,
        kind: {
            StateChange: {
                variable: 'requestCounter',
                old_value: '100',
                new_value: '101',
                location: 'metrics/counter.js:46',
                access_type: 'Write'
            }
        },
        location: 'metrics/counter.js:46',
        timestamp: new Date(baseTime + 16).toISOString(), // Nearly simultaneous write
        thread_id: thread2,
        vector_clock: { [trace2]: 2 },
        metadata: {
            locks_held: [],
            related_events: [read2Id]
        }
    });

    console.log('   ⚠️  Both threads wrote 101, but final value should be 102!');
}

// Main execution
async function main() {
    console.log('🚀 Starting test event simulation...\n');

    // Run various scenarios with slight delays between them
    await simulateUserRegistration();
    await new Promise(resolve => setTimeout(resolve, 100));

    await simulateApiRequest('getUserProfile', 15);
    await new Promise(resolve => setTimeout(resolve, 100));

    await simulateDataProcessing();
    await new Promise(resolve => setTimeout(resolve, 100));

    await simulateApiRequest('updateSettings', 22);
    await new Promise(resolve => setTimeout(resolve, 100));

    // Generate the race condition
    await simulateRaceCondition();
    await new Promise(resolve => setTimeout(resolve, 100));

    // A few more normal operations
    await simulateApiRequest('listItems', 18);
    await new Promise(resolve => setTimeout(resolve, 100));

    await simulateUserRegistration();

    console.log('\n✅ Test simulation complete!');
    console.log('📊 Check the TUI to see the events and detected race condition');
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
