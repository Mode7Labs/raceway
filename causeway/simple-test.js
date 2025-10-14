#!/usr/bin/env node

/**
 * Simple test script to generate events matching the server's expected format
 */

const SERVER_URL = 'http://localhost:8080';

function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function timestamp(offsetMs = 0) {
    return new Date(Date.now() + offsetMs).toISOString();
}

async function sendEvent(event) {
    try {
        // Server expects a batch format with events array
        const batch = { events: [event] };
        const response = await fetch(`${SERVER_URL}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(batch)
        });

        if (!response.ok) {
            const text = await response.text();
            console.error(`Failed: ${response.status} - ${text.substring(0, 100)}`);
            return false;
        }
        return true;
    } catch (error) {
        console.error('Error:', error.message);
        return false;
    }
}

// Create a basic event structure
function createEvent(traceId, vectorClock, kind, durationNs = null) {
    return {
        id: generateId(),
        trace_id: traceId,
        parent_id: null,
        timestamp: timestamp(),
        kind: kind,
        metadata: {
            thread_id: 'worker-1',
            process_id: 1234,
            service_name: 'test-service',
            environment: 'test',
            tags: {},
            duration_ns: durationNs
        },
        causality_vector: [[traceId, vectorClock]],
        lock_set: []
    };
}

async function simulateNormalTrace() {
    const traceId = generateId();
    console.log(`📝 Trace ${traceId.substring(0, 8)}...`);

    // Function call 1
    await sendEvent(createEvent(traceId, 1, {
        FunctionCall: {
            function_name: 'processRequest',
            module: 'api',
            args: { user_id: 123 },
            file: 'api/handler.js',
            line: 45
        }
    }, 15000000));

    await new Promise(r => setTimeout(r, 10));

    // Function call 2
    await sendEvent(createEvent(traceId, 2, {
        FunctionCall: {
            function_name: 'fetchData',
            module: 'database',
            args: { query: 'SELECT * FROM users' },
            file: 'db/query.js',
            line: 23
        }
    }, 50000000));

    await new Promise(r => setTimeout(r, 10));

    // Function call 3
    await sendEvent(createEvent(traceId, 3, {
        FunctionCall: {
            function_name: 'formatResponse',
            module: 'api',
            args: { format: 'json' },
            file: 'api/formatter.js',
            line: 12
        }
    }, 8000000));
}

async function simulateRaceCondition() {
    const baseTime = Date.now();
    const trace1 = generateId();
    const trace2 = generateId();

    console.log(`🚨 Race: ${trace1.substring(0, 8)}... & ${trace2.substring(0, 8)}...`);

    // Thread 1: Read counter
    await sendEvent({
        id: generateId(),
        trace_id: trace1,
        parent_id: null,
        timestamp: new Date(baseTime).toISOString(),
        kind: {
            StateChange: {
                variable: 'counter',
                old_value: null,
                new_value: 100,
                location: 'metrics.js:10',
                access_type: 'Read'
            }
        },
        metadata: {
            thread_id: 'worker-1',
            process_id: 1234,
            service_name: 'metrics',
            environment: 'prod',
            tags: {},
            duration_ns: 1000000
        },
        causality_vector: [[trace1, 1]],
        lock_set: []
    });

    // Thread 2: Read counter (concurrent)
    await sendEvent({
        id: generateId(),
        trace_id: trace2,
        parent_id: null,
        timestamp: new Date(baseTime + 1).toISOString(),
        kind: {
            StateChange: {
                variable: 'counter',
                old_value: null,
                new_value: 100,
                location: 'metrics.js:10',
                access_type: 'Read'
            }
        },
        metadata: {
            thread_id: 'worker-2',
            process_id: 1234,
            service_name: 'metrics',
            environment: 'prod',
            tags: {},
            duration_ns: 1000000
        },
        causality_vector: [[trace2, 1]],
        lock_set: []
    });

    // Thread 1: Write counter (starts during read window for better overlap)
    await sendEvent({
        id: generateId(),
        trace_id: trace1,
        parent_id: null,
        timestamp: new Date(baseTime + 2).toISOString(),
        kind: {
            StateChange: {
                variable: 'counter',
                old_value: 100,
                new_value: 101,
                location: 'metrics.js:11',
                access_type: 'Write'
            }
        },
        metadata: {
            thread_id: 'worker-1',
            process_id: 1234,
            service_name: 'metrics',
            environment: 'prod',
            tags: {},
            duration_ns: 5000000  // 5ms to ensure overlap
        },
        causality_vector: [[trace1, 2]],
        lock_set: []
    });

    // Thread 2: Write counter (race! overlaps with Write1)
    await sendEvent({
        id: generateId(),
        trace_id: trace2,
        parent_id: null,
        timestamp: new Date(baseTime + 3).toISOString(),
        kind: {
            StateChange: {
                variable: 'counter',
                old_value: 100,
                new_value: 101,
                location: 'metrics.js:11',
                access_type: 'Write'
            }
        },
        metadata: {
            thread_id: 'worker-2',
            process_id: 1234,
            service_name: 'metrics',
            environment: 'prod',
            tags: {},
            duration_ns: 5000000  // 5ms to ensure overlap
        },
        causality_vector: [[trace2, 2]],
        lock_set: []
    });

    console.log('   ⚠️  Lost update: both wrote 101!');
}

async function simulateSlowOperation(durationMs = 250) {
    const traceId = generateId();
    const emoji = durationMs > 100 ? '🐌' : '⚙️';
    console.log(`${emoji}  slowQuery ${traceId.substring(0, 8)}... (${durationMs}ms)`);

    // Create slowQuery function call with specified duration
    await sendEvent(createEvent(traceId, 1, {
        FunctionCall: {
            function_name: 'slowQuery',
            module: 'database',
            args: { timeout: durationMs },
            file: 'db/query.js',
            line: 100
        }
    }, durationMs * 1000000)); // Convert ms to ns
}

async function main() {
    console.log('🚀 Starting simple test...\n');

    // Create many normal traces to establish baseline (need 5+ samples per event kind)
    console.log('📊 Generating baseline data (5 normal traces)...');
    for (let i = 0; i < 5; i++) {
        await simulateNormalTrace();
        await new Promise(r => setTimeout(r, 50));
    }

    // Race condition
    await simulateRaceCondition();
    await new Promise(r => setTimeout(r, 50));

    // More normal traces for better baseline
    console.log('📊 Adding more normal traces...');
    for (let i = 0; i < 3; i++) {
        await simulateNormalTrace();
        await new Promise(r => setTimeout(r, 50));
    }

    // Multiple slow operations to test anomaly detection
    // First, create some normal slowQuery operations for baseline
    console.log('⚙️  Creating normal slowQuery baseline (5 samples)...');
    for (let i = 0; i < 5; i++) {
        await simulateSlowOperation(50); // 50ms - normal duration
        await new Promise(r => setTimeout(r, 50));
    }

    // Now create anomalously slow queries
    console.log('⚠️  Generating anomalies...');
    await simulateSlowOperation(250); // 250ms - anomaly!
    await new Promise(r => setTimeout(r, 50));

    await simulateSlowOperation(300); // 300ms - anomaly!
    await new Promise(r => setTimeout(r, 50));

    // Final normal traces
    await simulateNormalTrace();
    await simulateNormalTrace();

    console.log('\n✅ Done! Launch TUI with: cargo run --release -- tui');
    console.log('📊 Generated traces with:');
    console.log('   - 10 normal traces (baseline for processRequest, fetchData, formatResponse)');
    console.log('   - 5 normal slowQuery operations (50ms - baseline)');
    console.log('   - 1 race condition (write-write conflict on counter)');
    console.log('   - 2 anomalous slowQuery operations (250ms & 300ms)');
}

main().catch(console.error);
