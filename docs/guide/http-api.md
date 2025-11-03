# HTTP API

REST API reference for programmatic access to Raceway.

## Base URL

```
http://localhost:8080
```

## Authentication

Include API key in requests if auth is enabled:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:8080/api/traces
```

## Endpoints

See detailed API reference:

- [Events API](/api/events) - Event ingestion and retrieval
- [Traces API](/api/traces) - Trace management
- [Analysis API](/api/analysis) - Critical path, anomalies, races
- [Services API](/api/services) - Service metrics

## Quick Reference

### Health Check

```bash
GET /health
```

### Ingest Events

```bash
POST /events
Content-Type: application/json

{
  "trace_id": "abc123",
  "event_id": "evt-001",
  "kind": "HttpRequest",
  ...
}
```

### List Traces

```bash
GET /api/traces?page=1&per_page=20
```

### Get Trace Analysis

```bash
GET /api/traces/{trace_id}
```

### Get Critical Path

```bash
GET /api/traces/{trace_id}/critical-path
```

### Get Anomalies

```bash
GET /api/traces/{trace_id}/anomalies
```

### Get Race Conditions

```bash
GET /api/distributed/global-races
```

## Rate Limiting

Default: 1000 requests/minute

Headers:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1672531200
```

## Error Responses

```json
{
  "error": "Error message"
}
```

Status codes:
- `400` - Bad Request
- `401` - Unauthorized
- `404` - Not Found
- `429` - Too Many Requests
- `500` - Internal Server Error

## Next Steps

- [API Reference](/api/overview) - Complete API documentation
- [SDKs](/sdks/overview) - Use language-specific SDKs
- [Security](/guide/security) - API authentication
