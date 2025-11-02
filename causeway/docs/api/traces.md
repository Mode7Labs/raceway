# Traces API

Trace management and retrieval endpoints.

## List Traces

Get paginated list of traces.

```http
GET /api/traces?page=1&per_page=20
```

**Query Parameters:**
- `page`: Page number (default: 1)
- `per_page`: Items per page (default: 20, max: 100)
- `service`: Filter by service name (optional)
- `sort`: Sort order, "asc" or "desc" (default: "desc")

**Response:**

```json
{
  "traces": [
    {
      "trace_id": "abc123",
      "service_name": "api-service",
      "start_time": "2024-11-02T10:30:00.000Z",
      "end_time": "2024-11-02T10:30:00.500Z",
      "duration_ms": 500.0,
      "event_count": 42,
      "has_races": true,
      "has_anomalies": false
    }
  ],
  "page": 1,
  "per_page": 20,
  "total_traces": 150,
  "total_pages": 8
}
```

## Get Trace Analysis

Get complete trace data including events, critical path, anomalies, dependencies, and audit trails.

```http
GET /api/traces/{trace_id}
```

**Response:**

```json
{
  "trace_id": "abc123",
  "events": [...],
  "analysis": {
    "potential_races": 2,
    "anomalies": [...]
  },
  "critical_path": {...},
  "anomalies": [...],
  "dependencies": {...},
  "audit_trails": {...}
}
```

## Next Steps

- [Events API](/api/events) - Event ingestion
- [Analysis API](/api/analysis) - Analysis endpoints
- [Services API](/api/services) - Service metrics
