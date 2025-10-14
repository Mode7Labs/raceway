#!/usr/bin/env node

/**
 * Test script to generate events with parent-child relationships for tree view testing
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

function createEvent(traceId, parentId, vectorClock, kind, durationNs = null) {
    return {
        id: generateId(),
        trace_id: traceId,
        parent_id: parentId,
        timestamp: timestamp(),
        kind: kind,
        metadata: {
            thread_id: 'main-thread',
            process_id: 1234,
            service_name: 'api-service',
            environment: 'test',
            tags: {},
            duration_ns: durationNs
        },
        causality_vector: [[traceId, vectorClock]],
        lock_set: []
    };
}

async function simulateNestedTrace() {
    const traceId = generateId();
    console.log(`🌳 Tree trace ${traceId.substring(0, 8)}...`);

    // Root: HTTP Request Handler
    const rootId = generateId();
    await sendEvent({
        id: rootId,
        trace_id: traceId,
        parent_id: null,
        timestamp: timestamp(),
        kind: {
            FunctionCall: {
                function_name: 'handleHttpRequest',
                module: 'server',
                args: { path: '/api/users', method: 'GET' },
                file: 'server.js',
                line: 10
            }
        },
        metadata: {
            thread_id: 'main-thread',
            process_id: 1234,
            service_name: 'api-service',
            environment: 'test',
            tags: {},
            duration_ns: 150000000
        },
        causality_vector: [[traceId, 1]],
        lock_set: []
    });

    await new Promise(r => setTimeout(r, 10));

    // Child 1: Authenticate
    const authId = generateId();
    await sendEvent({
        id: authId,
        trace_id: traceId,
        parent_id: rootId,
        timestamp: timestamp(),
        kind: {
            FunctionCall: {
                function_name: 'authenticate',
                module: 'auth',
                args: { token: 'abc123' },
                file: 'auth/middleware.js',
                line: 45
            }
        },
        metadata: {
            thread_id: 'main-thread',
            process_id: 1234,
            service_name: 'api-service',
            environment: 'test',
            tags: {},
            duration_ns: 30000000
        },
        causality_vector: [[traceId, 2]],
        lock_set: []
    });

    await new Promise(r => setTimeout(r, 10));

    // Grandchild 1.1: Verify Token
    const verifyId = generateId();
    await sendEvent({
        id: verifyId,
        trace_id: traceId,
        parent_id: authId,
        timestamp: timestamp(),
        kind: {
            FunctionCall: {
                function_name: 'verifyToken',
                module: 'auth',
                args: { token: 'abc123' },
                file: 'auth/jwt.js',
                line: 12
            }
        },
        metadata: {
            thread_id: 'main-thread',
            process_id: 1234,
            service_name: 'api-service',
            environment: 'test',
            tags: {},
            duration_ns: 20000000
        },
        causality_vector: [[traceId, 3]],
        lock_set: []
    });

    await new Promise(r => setTimeout(r, 10));

    // Grandchild 1.2: Load User Permissions
    const permsId = generateId();
    await sendEvent({
        id: permsId,
        trace_id: traceId,
        parent_id: authId,
        timestamp: timestamp(),
        kind: {
            FunctionCall: {
                function_name: 'loadPermissions',
                module: 'auth',
                args: { userId: 42 },
                file: 'auth/permissions.js',
                line: 8
            }
        },
        metadata: {
            thread_id: 'main-thread',
            process_id: 1234,
            service_name: 'api-service',
            environment: 'test',
            tags: {},
            duration_ns: 10000000
        },
        causality_vector: [[traceId, 4]],
        lock_set: []
    });

    await new Promise(r => setTimeout(r, 10));

    // Child 2: Database Query
    const queryId = generateId();
    await sendEvent({
        id: queryId,
        trace_id: traceId,
        parent_id: rootId,
        timestamp: timestamp(),
        kind: {
            FunctionCall: {
                function_name: 'queryDatabase',
                module: 'database',
                args: { sql: 'SELECT * FROM users' },
                file: 'db/query.js',
                line: 23
            }
        },
        metadata: {
            thread_id: 'main-thread',
            process_id: 1234,
            service_name: 'api-service',
            environment: 'test',
            tags: {},
            duration_ns: 80000000
        },
        causality_vector: [[traceId, 5]],
        lock_set: []
    });

    await new Promise(r => setTimeout(r, 10));

    // Grandchild 2.1: Connect to DB
    const connectId = generateId();
    await sendEvent({
        id: connectId,
        trace_id: traceId,
        parent_id: queryId,
        timestamp: timestamp(),
        kind: {
            FunctionCall: {
                function_name: 'getConnection',
                module: 'database',
                args: { pool: 'main' },
                file: 'db/pool.js',
                line: 15
            }
        },
        metadata: {
            thread_id: 'main-thread',
            process_id: 1234,
            service_name: 'api-service',
            environment: 'test',
            tags: {},
            duration_ns: 5000000
        },
        causality_vector: [[traceId, 6]],
        lock_set: []
    });

    await new Promise(r => setTimeout(r, 10));

    // Grandchild 2.2: Execute Query
    const execId = generateId();
    await sendEvent({
        id: execId,
        trace_id: traceId,
        parent_id: queryId,
        timestamp: timestamp(),
        kind: {
            FunctionCall: {
                function_name: 'executeQuery',
                module: 'database',
                args: { timeout: 5000 },
                file: 'db/executor.js',
                line: 42
            }
        },
        metadata: {
            thread_id: 'main-thread',
            process_id: 1234,
            service_name: 'api-service',
            environment: 'test',
            tags: {},
            duration_ns: 70000000
        },
        causality_vector: [[traceId, 7]],
        lock_set: []
    });

    await new Promise(r => setTimeout(r, 10));

    // Child 3: Format Response
    const formatId = generateId();
    await sendEvent({
        id: formatId,
        trace_id: traceId,
        parent_id: rootId,
        timestamp: timestamp(),
        kind: {
            FunctionCall: {
                function_name: 'formatResponse',
                module: 'api',
                args: { format: 'json' },
                file: 'api/formatter.js',
                line: 7
            }
        },
        metadata: {
            thread_id: 'main-thread',
            process_id: 1234,
            service_name: 'api-service',
            environment: 'test',
            tags: {},
            duration_ns: 15000000
        },
        causality_vector: [[traceId, 8]],
        lock_set: []
    });

    await new Promise(r => setTimeout(r, 10));

    // Grandchild 3.1: Serialize Data
    const serializeId = generateId();
    await sendEvent({
        id: serializeId,
        trace_id: traceId,
        parent_id: formatId,
        timestamp: timestamp(),
        kind: {
            FunctionCall: {
                function_name: 'serializeJSON',
                module: 'serializer',
                args: { pretty: true },
                file: 'lib/serializer.js',
                line: 30
            }
        },
        metadata: {
            thread_id: 'main-thread',
            process_id: 1234,
            service_name: 'api-service',
            environment: 'test',
            tags: {},
            duration_ns: 12000000
        },
        causality_vector: [[traceId, 9]],
        lock_set: []
    });
}

async function main() {
    console.log('🌳 Generating tree-structured trace...\n');

    await simulateNestedTrace();

    console.log('\n✅ Done! Launch TUI with: cargo run --release -- tui');
    console.log('📊 Generated a trace with nested function calls:');
    console.log('   handleHttpRequest (root)');
    console.log('   ├── authenticate');
    console.log('   │   ├── verifyToken');
    console.log('   │   └── loadPermissions');
    console.log('   ├── queryDatabase');
    console.log('   │   ├── getConnection');
    console.log('   │   └── executeQuery');
    console.log('   └── formatResponse');
    console.log('       └── serializeJSON');
}

main().catch(console.error);
