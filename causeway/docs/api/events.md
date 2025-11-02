# Events API

Event ingestion and retrieval endpoints.

## Ingest Event

Submit an event to the Raceway server.

```http
POST /events
Content-Type: application/json
```

**Request Body:**

```json
{
  "trace_id": "abc123",
  "event_id": "evt-001",
  "kind": "StateChange",
  "timestamp": "2024-11-02T10:30:00.000Z",
  "duration_ms": 0.5,
  "location": "api.ts:42",
  "vector_clock": {
    "thread-1": 5
  },
  "metadata": {
    "variable": "user.balance",
    "old_value": "1000",
    "new_value": "900",
    "access_type": "Write"
  }
}
```

**Response:**

```json
{
  "success": true,
  "event_id": "evt-001"
}
```

## Event Types

### StateChange

Variable read/write operations.

**Metadata:**
- `variable`: Variable name
- `old_value`: Previous value (optional for reads)
- `new_value`: New value
- `access_type`: "Read" or "Write"

### FunctionCall

Function entry/exit.

**Metadata:**
- `function_name`: Function name
- `args`: Function arguments (optional)
- `return_value`: Return value (optional)

### HttpRequest

HTTP request/response.

**Metadata:**
- `method`: HTTP method
- `url`: Request URL
- `status_code`: Response status
- `headers`: Request/response headers (optional)

### Lock Acquire/Release

Lock operations.

**Metadata:**
- `lock_name`: Lock identifier
- `blocked_ms`: Time spent waiting (optional)

### Error

Exception or error.

**Metadata:**
- `error_type`: Error type/class
- `error_message`: Error message
- `stack_trace`: Stack trace (optional)

## Next Steps

- [Traces API](/api/traces) - Trace management
- [Analysis API](/api/analysis) - Analysis endpoints
- [Services API](/api/services) - Service metrics
