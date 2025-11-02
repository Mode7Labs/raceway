# Variable Audit Trails

Track every access to specific variables across your entire distributed system to understand data flow and debug state-related issues.

## What are Audit Trails?

**Variable audit trails** provide a complete history of all reads and writes to a specific variable, including:
- Who accessed it (which thread/service)
- When it was accessed (timestamp and causal order)
- What value it had (before and after)
- Where in the code (source location)
- How it was accessed (Read or Write)

## Use Cases

### 1. Debugging State Issues

"Why does this variable have the wrong value?"

Track all accesses to see:
- Which write set the wrong value
- Whether concurrent writes interfered
- If the value was read before being initialized

### 2. Security Auditing

"Who accessed this sensitive data?"

Audit trails for sensitive variables show:
- All services that read the data
- When and where access occurred
- Whether unauthorized access happened

### 3. Understanding Data Flow

"How does data flow through the system?"

Follow a variable across:
- Multiple services
- Database reads/writes
- Cache operations
- API calls

### 4. Race Condition Investigation

"Why is there a race on this variable?"

See all concurrent accesses:
- Which threads accessed simultaneously
- Vector clock relationships
- Missing synchronization

## Viewing Audit Trails

### Web UI

**Variables Tab:**
1. Select a trace
2. Go to "Variables" tab
3. Select a variable from the list
4. View complete access history

**Features:**
- Timeline view of all accesses
- Read vs Write indicators
- Thread/service information
- Source code locations
- Vector clock ordering
- Cross-trace navigation

### Terminal UI (TUI)

1. Select trace
2. Navigate to "Audit Trail" view
3. Enter variable name
4. See chronological access list

### HTTP API

```bash
GET /api/traces/{trace_id}/audit-trail/{variable_name}
```

**Response:**
```json
{
  "variable": "user.balance",
  "trace_id": "abc123",
  "accesses": [
    {
      "event_id": "evt-001",
      "thread_id": "thread-1",
      "timestamp": "2024-11-02T10:30:00.000Z",
      "access_type": "Read",
      "value": "1000",
      "location": "api.ts:42",
      "vector_clock": {"thread-1": 5}
    },
    {
      "event_id": "evt-002",
      "thread_id": "thread-1",
      "timestamp": "2024-11-02T10:30:00.100Z",
      "access_type": "Write",
      "old_value": "1000",
      "new_value": "900",
      "location": "api.ts:45",
      "vector_clock": {"thread-1": 6}
    }
  ]
}
```

## Tracking Variables

### SDK Integration

::: code-group

```typescript [TypeScript]
import { raceway } from '@mode-7/raceway';

// Track state changes
await raceway.trackStateChange({
  variable: 'user.balance',
  oldValue: 1000,
  newValue: 900,
  location: 'api.ts:42',
  accessType: 'Write'
});
```

```python [Python]
from raceway import raceway

# Track state changes
raceway.track_state_change(
    variable='user.balance',
    old_value=1000,
    new_value=900,
    location='api.py:42',
    access_type='Write'
)
```

```go [Go]
client.TrackStateChange(raceway.StateChange{
    Variable:   "user.balance",
    OldValue:   "1000",
    NewValue:   "900",
    Location:   "main.go:42",
    AccessType: "Write",
})
```

```rust [Rust]
client.track_state_change(
    "user.balance",
    Some("1000"),
    "900",
    "main.rs:42",
    "Write"
).await;
```

:::

## Best Practices

### 1. Consistent Naming

Use consistent variable names across services:

```typescript
// Good: Consistent naming
"user.balance"
"order.total"
"cart.items"

// Bad: Inconsistent
"balance"       // Which object?
"user_balance"  // Different convention
"Balance"       // Different case
```

### 2. Track All Accesses

Track both reads and writes for complete audit:

```typescript
// Track read
await raceway.trackStateChange({
  variable: 'user.balance',
  value: currentBalance,
  accessType: 'Read'
});

// Track write
await raceway.trackStateChange({
  variable: 'user.balance',
  oldValue: currentBalance,
  newValue: newBalance,
  accessType: 'Write'
});
```

### 3. Include Meaningful Locations

Provide accurate source locations:

```typescript
// Good
location: 'api/users/transfer.ts:127'

// Less helpful
location: 'unknown'
location: 'index.js:1'
```

### 4. Track Critical Variables

Focus on variables that matter:
- User data (balances, permissions)
- System state (configuration, feature flags)
- Shared resources (counters, locks)
- Security-sensitive data

## Cross-Trace Analysis

Audit trails can span multiple traces:

```
Trace 1 (Request A):
  - Write: user.balance = 900

Trace 2 (Request B):
  - Read: user.balance = 900
  - Write: user.balance = 800

Trace 3 (Request C):
  - Read: user.balance = 800
```

**Use case:** Track how a value propagates through multiple requests.

## Performance Considerations

### Sampling

For high-throughput variables, use sampling:

```typescript
// Track only 10% of accesses
if (Math.random() < 0.1) {
  await raceway.trackStateChange({...});
}
```

### Aggregation

Aggregate multiple accesses:

```typescript
// Instead of tracking every array element
// Track array modification
await raceway.trackStateChange({
  variable: 'cart.items',
  oldValue: JSON.stringify(oldItems),
  newValue: JSON.stringify(newItems),
  accessType: 'Write'
});
```

## Next Steps

- [Race Detection](/guide/race-detection) - Find concurrent access issues
- [Distributed Tracing](/guide/distributed-tracing) - Cross-service tracking
- [Security Guide](/guide/security) - Best practices and security
