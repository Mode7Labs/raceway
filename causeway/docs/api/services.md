# Services API

Service metrics and dependency endpoints.

## List Services

Get list of all services with metrics.

```http
GET /api/services
```

**Response:**

```json
{
  "services": [
    {
      "name": "api-service",
      "trace_count": 1500,
      "avg_duration_ms": 250.0,
      "error_rate": 0.02,
      "last_seen": "2024-11-02T10:35:00.000Z"
    },
    {
      "name": "auth-service",
      "trace_count": 800,
      "avg_duration_ms": 50.0,
      "error_rate": 0.001,
      "last_seen": "2024-11-02T10:35:00.000Z"
    }
  ]
}
```

## Get Service Traces

Get all traces for a specific service.

```http
GET /api/services/{service_name}/traces
```

**Query Parameters:**
- `page`: Page number (default: 1)
- `per_page`: Items per page (default: 20, max: 100)
- `sort`: Sort order, "asc" or "desc" (default: "desc")

**Response:**

```json
{
  "service_name": "api-service",
  "traces": [
    {
      "trace_id": "abc123",
      "start_time": "2024-11-02T10:30:00.000Z",
      "end_time": "2024-11-02T10:30:00.500Z",
      "duration_ms": 500.0,
      "has_races": false,
      "has_anomalies": true
    }
  ],
  "page": 1,
  "per_page": 20,
  "total_traces": 1500,
  "total_pages": 75
}
```

## Get Service Dependencies

Get dependency graph for a service.

```http
GET /api/services/{service_name}/dependencies
```

**Response:**

```json
{
  "service": "api-service",
  "depends_on": [
    {
      "service": "auth-service",
      "call_count": 1200,
      "avg_duration_ms": 50.0,
      "error_rate": 0.001
    },
    {
      "service": "payment-service",
      "call_count": 300,
      "avg_duration_ms": 200.0,
      "error_rate": 0.05
    }
  ],
  "depended_by": [
    {
      "service": "frontend",
      "call_count": 1500,
      "avg_duration_ms": 250.0
    }
  ]
}
```

## Get Service Health

Get health status for all services.

```http
GET /api/services/health?time_window_minutes=60
```

**Query Parameters:**
- `time_window_minutes`: Time window for health calculation (default: 60)

**Response:**

```json
{
  "services": [
    {
      "name": "api-service",
      "status": "healthy",
      "error_rate": 0.02,
      "avg_response_time_ms": 250.0,
      "request_count": 1500,
      "last_seen": "2024-11-02T10:35:00.000Z"
    },
    {
      "name": "auth-service",
      "status": "healthy",
      "error_rate": 0.001,
      "avg_response_time_ms": 50.0,
      "request_count": 800,
      "last_seen": "2024-11-02T10:35:00.000Z"
    }
  ]
}
```

## Next Steps

- [Events API](/api/events) - Event ingestion
- [Traces API](/api/traces) - Trace management
- [Analysis API](/api/analysis) - Analysis endpoints
