#!/usr/bin/env node

/**
 * Test script to generate StateChange events for Audit Trail demo
 *
 * Creates a realistic scenario with:
 * - Multiple variables being tracked
 * - Read and write operations
 * - Race conditions on shared variables
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

// Simulate an order processing system with state changes
async function simulateOrderProcessing() {
    const traceId = generateId();
    const events = [];
    let offset = 0;

    console.log(`📦 Simulating order processing (trace: ${traceId.substring(0, 8)}...)`);

    // Thread 1: Order creation
    const thread1 = 'order-service-1';

    // Create order
    events.push({
        id: generateId(),
        trace_id: traceId,
        parent_id: null,
        timestamp: timestamp(offset),
        kind: {
            StateChange: {
                variable: 'order_status',
                old_value: null,
                new_value: 'pending',
                location: 'orders/service.js:42',
                access_type: 'Write'
            }
        },
        metadata: {
            thread_id: thread1,
            process_id: 1001,
            service_name: 'order-service',
            environment: 'production',
            tags: {},
            duration_ns: 1_000_000
        },
        causality_vector: [[traceId, 1]],
        lock_set: []
    });
    offset += 10;

    // Set order total
    events.push({
        id: generateId(),
        trace_id: traceId,
        parent_id: null,
        timestamp: timestamp(offset),
        kind: {
            StateChange: {
                variable: 'order_total',
                old_value: null,
                new_value: 149.99,
                location: 'orders/service.js:45',
                access_type: 'Write'
            }
        },
        metadata: {
            thread_id: thread1,
            process_id: 1001,
            service_name: 'order-service',
            environment: 'production',
            tags: {},
            duration_ns: 500_000
        },
        causality_vector: [[traceId, 2]],
        lock_set: []
    });
    offset += 5;

    // Thread 2: Inventory check (concurrent)
    const thread2 = 'inventory-service-1';

    // Read order total
    events.push({
        id: generateId(),
        trace_id: traceId,
        parent_id: null,
        timestamp: timestamp(offset),
        kind: {
            StateChange: {
                variable: 'order_total',
                old_value: null,
                new_value: 149.99,
                location: 'inventory/checker.js:78',
                access_type: 'Read'
            }
        },
        metadata: {
            thread_id: thread2,
            process_id: 1002,
            service_name: 'inventory-service',
            environment: 'production',
            tags: {},
            duration_ns: 300_000
        },
        causality_vector: [[traceId, 1]],
        lock_set: []
    });
    offset += 15;

    // Update inventory count
    events.push({
        id: generateId(),
        trace_id: traceId,
        parent_id: null,
        timestamp: timestamp(offset),
        kind: {
            StateChange: {
                variable: 'inventory_count',
                old_value: 100,
                new_value: 99,
                location: 'inventory/stock.js:123',
                access_type: 'Write'
            }
        },
        metadata: {
            thread_id: thread2,
            process_id: 1002,
            service_name: 'inventory-service',
            environment: 'production',
            tags: {},
            duration_ns: 2_000_000
        },
        causality_vector: [[traceId, 2]],
        lock_set: []
    });
    offset += 20;

    // Thread 3: Payment processing
    const thread3 = 'payment-service-1';

    // Read order total for payment
    events.push({
        id: generateId(),
        trace_id: traceId,
        parent_id: null,
        timestamp: timestamp(offset),
        kind: {
            StateChange: {
                variable: 'order_total',
                old_value: null,
                new_value: 149.99,
                location: 'payment/processor.js:56',
                access_type: 'Read'
            }
        },
        metadata: {
            thread_id: thread3,
            process_id: 1003,
            service_name: 'payment-service',
            environment: 'production',
            tags: {},
            duration_ns: 400_000
        },
        causality_vector: [[traceId, 1]],
        lock_set: []
    });
    offset += 50;

    // Update payment status
    events.push({
        id: generateId(),
        trace_id: traceId,
        parent_id: null,
        timestamp: timestamp(offset),
        kind: {
            StateChange: {
                variable: 'payment_status',
                old_value: null,
                new_value: 'completed',
                location: 'payment/processor.js:89',
                access_type: 'Write'
            }
        },
        metadata: {
            thread_id: thread3,
            process_id: 1003,
            service_name: 'payment-service',
            environment: 'production',
            tags: {},
            duration_ns: 45_000_000
        },
        causality_vector: [[traceId, 2]],
        lock_set: []
    });
    offset += 60;

    // Thread 1: Update order status to confirmed
    events.push({
        id: generateId(),
        trace_id: traceId,
        parent_id: null,
        timestamp: timestamp(offset),
        kind: {
            StateChange: {
                variable: 'order_status',
                old_value: 'pending',
                new_value: 'confirmed',
                location: 'orders/service.js:156',
                access_type: 'Write'
            }
        },
        metadata: {
            thread_id: thread1,
            process_id: 1001,
            service_name: 'order-service',
            environment: 'production',
            tags: {},
            duration_ns: 1_500_000
        },
        causality_vector: [[traceId, 3]],
        lock_set: []
    });
    offset += 30;

    // Thread 1: Final status update
    events.push({
        id: generateId(),
        trace_id: traceId,
        parent_id: null,
        timestamp: timestamp(offset),
        kind: {
            StateChange: {
                variable: 'order_status',
                old_value: 'confirmed',
                new_value: 'shipped',
                location: 'orders/service.js:189',
                access_type: 'Write'
            }
        },
        metadata: {
            thread_id: thread1,
            process_id: 1001,
            service_name: 'order-service',
            environment: 'production',
            tags: {},
            duration_ns: 800_000
        },
        causality_vector: [[traceId, 4]],
        lock_set: []
    });

    return { traceId, events };
}

// Simulate a race condition on shared counter
async function simulateRaceOnCounter() {
    const traceId = generateId();
    const events = [];
    const baseTime = Date.now();

    console.log(`🚨 Simulating RACE CONDITION on counter (trace: ${traceId.substring(0, 8)}...)`);

    const thread1 = 'worker-1';
    const thread2 = 'worker-2';

    // Both threads read the counter at nearly the same time
    events.push({
        id: generateId(),
        trace_id: traceId,
        parent_id: null,
        timestamp: new Date(baseTime).toISOString(),
        kind: {
            StateChange: {
                variable: 'request_counter',
                old_value: null,
                new_value: 100,
                location: 'metrics/counter.js:45',
                access_type: 'Read'
            }
        },
        metadata: {
            thread_id: thread1,
            process_id: 2001,
            service_name: 'api-service',
            environment: 'production',
            tags: {},
            duration_ns: 100_000
        },
        causality_vector: [[traceId, 1]],
        lock_set: []
    });

    events.push({
        id: generateId(),
        trace_id: traceId,
        parent_id: null,
        timestamp: new Date(baseTime + 1).toISOString(),
        kind: {
            StateChange: {
                variable: 'request_counter',
                old_value: null,
                new_value: 100,
                location: 'metrics/counter.js:45',
                access_type: 'Read'
            }
        },
        metadata: {
            thread_id: thread2,
            process_id: 2002,
            service_name: 'api-service',
            environment: 'production',
            tags: {},
            duration_ns: 100_000
        },
        causality_vector: [[traceId, 1]],
        lock_set: []
    });

    // Both threads write 101 (should be 102!)
    events.push({
        id: generateId(),
        trace_id: traceId,
        parent_id: null,
        timestamp: new Date(baseTime + 15).toISOString(),
        kind: {
            StateChange: {
                variable: 'request_counter',
                old_value: 100,
                new_value: 101,
                location: 'metrics/counter.js:46',
                access_type: 'Write'
            }
        },
        metadata: {
            thread_id: thread1,
            process_id: 2001,
            service_name: 'api-service',
            environment: 'production',
            tags: {},
            duration_ns: 200_000
        },
        causality_vector: [[traceId, 2]],
        lock_set: []
    });

    events.push({
        id: generateId(),
        trace_id: traceId,
        parent_id: null,
        timestamp: new Date(baseTime + 16).toISOString(),
        kind: {
            StateChange: {
                variable: 'request_counter',
                old_value: 100,
                new_value: 101,
                location: 'metrics/counter.js:46',
                access_type: 'Write'
            }
        },
        metadata: {
            thread_id: thread2,
            process_id: 2002,
            service_name: 'api-service',
            environment: 'production',
            tags: {},
            duration_ns: 200_000
        },
        causality_vector: [[traceId, 2]],
        lock_set: []
    });

    return { traceId, events };
}

async function main() {
    console.log('🚀 Starting variable tracking test...\n');

    // Generate order processing trace
    const orderTrace = await simulateOrderProcessing();
    const success1 = await sendEvents(orderTrace.events);
    if (success1) {
        console.log(`   ✅ Order processing trace sent (${orderTrace.events.length} events)`);
    }

    await new Promise(resolve => setTimeout(resolve, 200));

    // Generate race condition trace
    const raceTrace = await simulateRaceOnCounter();
    const success2 = await sendEvents(raceTrace.events);
    if (success2) {
        console.log(`   ✅ Race condition trace sent (${raceTrace.events.length} events)`);
    }

    console.log('\n✅ Variable tracking simulation complete!');
    console.log('\n📊 Variables created:');
    console.log('   - order_status (3 writes)');
    console.log('   - order_total (1 write, 2 reads)');
    console.log('   - inventory_count (1 write)');
    console.log('   - payment_status (1 write)');
    console.log('   - request_counter (2 reads, 2 writes with RACE)');
    console.log('\n👉 Open http://localhost:3005 and go to Audit Trail tab!');
    console.log('👉 You should see the variable list auto-populate\n');
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
