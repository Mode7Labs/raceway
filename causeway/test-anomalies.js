#!/usr/bin/env node

/**
 * Test script to generate events with anomalies
 *
 * Strategy:
 * 1. Send 5+ "normal" traces with consistent durations to build baseline
 * 2. Send anomalous traces with significantly longer durations
 * 3. This will trigger anomaly detection
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

async function sendEvents(events) {
    try {
        const response = await fetch(`${SERVER_URL}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ events })
        });

        if (!response.ok) {
            const text = await response.text();
            console.error(`Failed to send events: ${response.status} - ${text}`);
            return false;
        }
        return true;
    } catch (error) {
        console.error('Error sending events:', error.message);
        return false;
    }
}

// Generate a normal trace with consistent durations
async function generateNormalTrace(index) {
    const traceId = generateId();
    const threadId = 'worker-thread-1';
    let offset = 0;

    const events = [];

    console.log(`📊 Creating NORMAL trace #${index} (trace: ${traceId.substring(0, 8)}...)`);

    // Database query - normal duration ~50ms
    events.push({
        id: generateId(),
        trace_id: traceId,
        parent_id: null,
        timestamp: timestamp(offset),
        kind: {
            FunctionCall: {
                function_name: 'fetchUserData',
                module: 'database/users.js',
                args: { userId: 12345 },
                file: 'database/users.js',
                line: 42
            }
        },
        metadata: {
            thread_id: threadId,
            process_id: 1234,
            service_name: 'user-service',
            environment: 'production',
            tags: {},
            duration_ns: 50_000_000  // 50ms - baseline
        },
        causality_vector: [[traceId, 1]],
        lock_set: []
    });
    offset += 50;

    // API call - normal duration ~100ms
    events.push({
        id: generateId(),
        trace_id: traceId,
        parent_id: null,
        timestamp: timestamp(offset),
        kind: {
            FunctionCall: {
                function_name: 'processUserRequest',
                module: 'api/handlers.js',
                args: { method: 'GET' },
                file: 'api/handlers.js',
                line: 89
            }
        },
        metadata: {
            thread_id: threadId,
            process_id: 1234,
            service_name: 'api-service',
            environment: 'production',
            tags: {},
            duration_ns: 100_000_000  // 100ms - baseline
        },
        causality_vector: [[traceId, 2]],
        lock_set: []
    });
    offset += 100;

    // Image processing - normal duration ~200ms
    events.push({
        id: generateId(),
        trace_id: traceId,
        parent_id: null,
        timestamp: timestamp(offset),
        kind: {
            FunctionCall: {
                function_name: 'resizeImage',
                module: 'media/processor.js',
                args: { width: 800, height: 600 },
                file: 'media/processor.js',
                line: 156
            }
        },
        metadata: {
            thread_id: threadId,
            process_id: 1234,
            service_name: 'media-service',
            environment: 'production',
            tags: {},
            duration_ns: 200_000_000  // 200ms - baseline
        },
        causality_vector: [[traceId, 3]],
        lock_set: []
    });

    return { traceId, events };
}

// Generate an anomalous trace with significantly longer durations
async function generateAnomalousTrace(severity = 'warning') {
    const traceId = generateId();
    const threadId = 'worker-thread-1';
    let offset = 0;

    const events = [];

    // Severity multipliers:
    // Minor: 2-3x normal (2-3 std dev)
    // Warning: 4-6x normal (3-5 std dev)
    // Critical: 10x+ normal (>5 std dev)
    const multiplier = severity === 'minor' ? 3 : severity === 'warning' ? 8 : 20;

    console.log(`🚨 Creating ${severity.toUpperCase()} ANOMALY trace (trace: ${traceId.substring(0, 8)}...) - ${multiplier}x slower`);

    // Database query - SLOW (anomalous)
    events.push({
        id: generateId(),
        trace_id: traceId,
        parent_id: null,
        timestamp: timestamp(offset),
        kind: {
            FunctionCall: {
                function_name: 'fetchUserData',
                module: 'database/users.js',
                args: { userId: 12345 },
                file: 'database/users.js',
                line: 42
            }
        },
        metadata: {
            thread_id: threadId,
            process_id: 1234,
            service_name: 'user-service',
            environment: 'production',
            tags: {},
            duration_ns: Math.floor(50_000_000 * multiplier)  // 50ms * multiplier - ANOMALOUS
        },
        causality_vector: [[traceId, 1]],
        lock_set: []
    });
    offset += 50 * multiplier;

    // API call - SLOW (anomalous)
    events.push({
        id: generateId(),
        trace_id: traceId,
        parent_id: null,
        timestamp: timestamp(offset),
        kind: {
            FunctionCall: {
                function_name: 'processUserRequest',
                module: 'api/handlers.js',
                args: { method: 'GET' },
                file: 'api/handlers.js',
                line: 89
            }
        },
        metadata: {
            thread_id: threadId,
            process_id: 1234,
            service_name: 'api-service',
            environment: 'production',
            tags: {},
            duration_ns: Math.floor(100_000_000 * multiplier)  // 100ms * multiplier - ANOMALOUS
        },
        causality_vector: [[traceId, 2]],
        lock_set: []
    });
    offset += 100 * multiplier;

    // Image processing - VERY SLOW (anomalous)
    events.push({
        id: generateId(),
        trace_id: traceId,
        parent_id: null,
        timestamp: timestamp(offset),
        kind: {
            FunctionCall: {
                function_name: 'resizeImage',
                module: 'media/processor.js',
                args: { width: 800, height: 600 },
                file: 'media/processor.js',
                line: 156
            }
        },
        metadata: {
            thread_id: threadId,
            process_id: 1234,
            service_name: 'media-service',
            environment: 'production',
            tags: {},
            duration_ns: Math.floor(200_000_000 * multiplier)  // 200ms * multiplier - ANOMALOUS
        },
        causality_vector: [[traceId, 3]],
        lock_set: []
    });

    return { traceId, events };
}

async function main() {
    console.log('🚀 Starting anomaly test simulation...\n');

    // Phase 1: Build baseline with 6 normal traces
    console.log('📊 PHASE 1: Building baseline with 6 normal traces\n');
    const normalTraces = [];

    for (let i = 1; i <= 6; i++) {
        const { traceId, events } = await generateNormalTrace(i);
        const success = await sendEvents(events);
        if (success) {
            normalTraces.push(traceId);
            console.log(`   ✅ Normal trace #${i} sent successfully`);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`\n✅ Baseline established with ${normalTraces.length} normal traces\n`);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Phase 2: Send anomalous traces
    console.log('🚨 PHASE 2: Sending traces with anomalies\n');

    // Minor anomaly (2.5x slower)
    const minorAnomaly = await generateAnomalousTrace('minor');
    await sendEvents(minorAnomaly.events);
    console.log('   ⚠️  Minor anomaly sent (2.5x slower)\n');
    await new Promise(resolve => setTimeout(resolve, 200));

    // Warning anomaly (5x slower)
    const warningAnomaly = await generateAnomalousTrace('warning');
    await sendEvents(warningAnomaly.events);
    console.log('   ⚠️  Warning anomaly sent (5x slower)\n');
    await new Promise(resolve => setTimeout(resolve, 200));

    // Critical anomaly (12x slower)
    const criticalAnomaly = await generateAnomalousTrace('critical');
    await sendEvents(criticalAnomaly.events);
    console.log('   🚨 Critical anomaly sent (12x slower)\n');

    console.log('\n✅ Anomaly simulation complete!');
    console.log('\n📊 Summary:');
    console.log(`   - Normal traces: ${normalTraces.length}`);
    console.log(`   - Anomalous traces: 3 (1 minor, 1 warning, 1 critical)`);
    console.log(`   - Total traces: ${normalTraces.length + 3}`);
    console.log('\n👉 Check the UI to see detected anomalies!');
    console.log('👉 Open http://localhost:3005 and select an anomalous trace\n');
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
