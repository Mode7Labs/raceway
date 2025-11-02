# Analysis API

Critical path, anomalies, and race detection endpoints.

## Get Critical Path

Get the critical path for a trace.

```http
GET /api/traces/{trace_id}/critical-path
```

**Response:**

```json
{
  "trace_id": "abc123",
  "path_events": 12,
  "total_duration_ms": 450.5,
  "trace_total_duration_ms": 500.0,
  "percentage_of_total": 90.1,
  "path": [
    {
      "id": "evt-001",
      "kind": "DatabaseQuery",
      "timestamp": "2024-11-02T10:30:00.000Z",
      "duration_ms": 100.0,
      "location": "api.ts:42",
      "vector_clock": {"thread-1": 5}
    }
  ]
}
```

## Get Anomalies

Get performance anomalies and race conditions for a trace.

```http
GET /api/traces/{trace_id}/anomalies
```

**Response:**

```json
{
  "trace_id": "abc123",
  "anomaly_count": 3,
  "anomalies": [
    {
      "event_id": "evt-042",
      "kind": "DatabaseQuery",
      "expected_duration_ms": 50.0,
      "actual_duration_ms": 450.0,
      "deviation_sigma": 3.2,
      "severity": "High",
      "location": "api.ts:127"
    }
  ]
}
```

## Get Dependencies

Get service dependency graph for a trace.

```http
GET /api/traces/{trace_id}/dependencies
```

**Response:**

```json
{
  "trace_id": "abc123",
  "services": ["api-service", "auth-service", "payment-service"],
  "dependencies": [
    {
      "from": "api-service",
      "to": "auth-service",
      "call_count": 1,
      "avg_duration_ms": 50.0
    }
  ]
}
```

## Get Audit Trail

Get complete access history for a specific variable.

```http
GET /api/traces/{trace_id}/audit-trail/{variable}
```

**Example:**
```http
GET /api/traces/abc123/audit-trail/user.balance
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
    }
  ]
}
```

## Get Global Races

Get race conditions across all traces (distributed tracing).

```http
GET /api/distributed/global-races
```

**Query Parameters:**
- `page`: Page number (default: 1)
- `per_page`: Items per page (default: 20)
- `severity`: Filter by severity (optional): "Critical" or "Warning"

**Response:**

```json
{
  "races": [
    {
      "variable": "user.balance",
      "severity": "Critical",
      "race_type": "WriteWrite",
      "events": [
        {
          "event_id": "evt-001",
          "trace_id": "trace-1",
          "access_type": "Write",
          "value": "900",
          "location": "api.ts:45"
        },
        {
          "event_id": "evt-002",
          "trace_id": "trace-2",
          "access_type": "Write",
          "value": "800",
          "location": "api.ts:45"
        }
      ]
    }
  ],
  "page": 1,
  "total_races": 15
}
```

## Next Steps

- [Events API](/api/events) - Event ingestion
- [Traces API](/api/traces) - Trace management
- [Services API](/api/services) - Service metrics
