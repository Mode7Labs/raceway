# API Reference

Raceway provides a comprehensive HTTP API for programmatic access to trace data and analysis.

## Base URL

```
http://localhost:8080
```

## Authentication

If authentication is enabled in your configuration, include the API key in requests:

```bash
# Header method (recommended)
curl -H "Authorization: Bearer YOUR_API_KEY" http://localhost:8080/api/traces
```

## Endpoints

### Health Check

```http
GET /health
```

Returns server health status.

**Response:**
```json
{
  "status": "ok"
}
```

### Server Status

```http
GET /status
```

Returns detailed server statistics.

**Response:**
```json
{
  "version": "0.1.0",
  "uptime_seconds": 3600,
  "events_captured": 15420,
  "traces_active": 342,
  "warmup": {
    "phase": "Complete",
    "started_at": "2024-11-02T10:00:00Z",
    "completed_at": "2024-11-02T10:00:05Z"
  }
}
```

### Event Ingestion

```http
POST /events
```

Submit events to the Raceway server.

**Request Body:**
```json
{
  "trace_id": "abc123",
  "event_id": "evt-001",
  "kind": "StateChange",
  "timestamp": "2024-11-02T10:30:00Z",
  "vector_clock": {
    "thread-1": 5
  },
  "metadata": {
    "variable": "counter",
    "new_value": "42",
    "access_type": "Write"
  }
}
```

### List Traces

```http
GET /api/traces?page=1&per_page=20
```

Get paginated list of traces.

**Response:**
```json
{
  "traces": [...],
  "page": 1,
  "per_page": 20,
  "total_traces": 150,
  "total_pages": 8
}
```

See [Traces API](/api/traces) for complete documentation.

### Get Trace Analysis

```http
GET /api/traces/{trace_id}
```

Get complete trace analysis including events, critical path, anomalies, and dependencies.

See [Analysis API](/api/analysis) for complete documentation.

## Rate Limiting

If rate limiting is enabled, you may receive:

```json
{
  "error": "Rate limit exceeded",
  "retry_after": 60
}
```

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message here"
}
```

Common status codes:
- `400` - Bad Request (invalid input)
- `401` - Unauthorized (missing/invalid API key)
- `404` - Not Found (trace doesn't exist)
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error

## Next Steps

- [Events API](/api/events) - Event ingestion and retrieval
- [Traces API](/api/traces) - Trace management
- [Analysis API](/api/analysis) - Critical path, anomalies, races
- [Services API](/api/services) - Service metrics and dependencies
