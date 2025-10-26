# Backend API Optimization Analysis

## Executive Summary

Currently, the Raceway WebUI performs significant client-side data aggregation and filtering. This analysis identifies opportunities to move expensive operations to the backend for better performance, scalability, and reduced network overhead.

---

## Current Issues

### 🔴 Critical - High Impact

#### 1. **SystemPerformance Component**
**Location:** `src/components/SystemPerformance.tsx:95`

**Current Behavior:**
- Fetches 50 trace metadata records
- Makes 5 separate requests for full trace analysis
- Processes hundreds/thousands of events client-side
- Calculates percentiles, averages, groupings in browser

**Client-Side Processing:**
```typescript
// Lines 56-196: Heavy client-side computation
- Trace duration calculations (avg, p50, p95, p99)
- Event type aggregation
- Service latency calculations
- Throughput metrics
- Event duration analysis
```

**Recommended Backend Endpoint:**
```
GET /api/performance/metrics
  ?limit=50
  &include_traces=true
  &include_events=true
  &include_services=true

Response:
{
  "trace_latency": {
    "avg_ms": 234.5,
    "p50_ms": 120.0,
    "p95_ms": 450.0,
    "p99_ms": 890.0,
    "slowest_traces": [
      { "trace_id": "abc", "duration_ms": 1200, "services": ["svc1", "svc2"] }
    ]
  },
  "event_performance": {
    "avg_duration_ms": 12.3,
    "by_type": [
      { "type": "HttpRequest", "count": 1234, "avg_duration_ms": 45.6 }
    ],
    "slow_operations": [...]
  },
  "service_latency": [
    { "service": "api-gateway", "avg_duration_ms": 23.4, "event_count": 567 }
  ],
  "throughput": {
    "events_per_second": 123.45,
    "traces_per_second": 12.34,
    "time_range_seconds": 3600
  }
}
```

**Impact:**
- Current: 6 HTTP requests, ~1000 events transferred, heavy client processing
- Optimized: 1 HTTP request, pre-aggregated data only
- **Estimated Reduction: ~90% data transfer, ~95% client CPU**

---

#### 2. **ServiceTraces Component**
**Location:** `src/components/ServiceTraces.tsx:38`

**Current Behavior:**
- Fetches ALL 100 traces
- Filters client-side by service name
- Only ~10-20% of fetched data is actually used

**TODO Comment Present:**
```typescript
// Line 37: TODO: Add backend endpoint to filter by service for better performance
```

**Client-Side Processing:**
```typescript
const response = await RacewayAPI.getTraces(1, 100);
const filteredTraces = response.data.traces.filter((trace) =>
  trace.services.includes(serviceName)
);
```

**Recommended Backend Endpoint:**
```
GET /api/services/{serviceName}/traces
  ?page=1
  &page_size=100

Response:
{
  "service_name": "api-gateway",
  "total_traces": 234,
  "traces": [...],
  "page": 1,
  "total_pages": 3
}
```

**Impact:**
- Current: 100 traces fetched, ~80-90 discarded
- Optimized: Only matching traces fetched
- **Estimated Reduction: ~80-90% unnecessary data transfer**

---

#### 3. **SystemHealth Component**
**Location:** `src/components/SystemHealth.tsx:36`

**Current Behavior:**
- Fetches 100 traces
- Builds service health map client-side
- Calculates last activity timestamps
- Computes health status based on time thresholds

**Client-Side Processing:**
```typescript
// Lines 44-104: Service health computation
- Iterate through all traces
- Build Map of service activity
- Calculate last seen timestamps
- Determine health status (healthy/warning/critical)
- Count events per service
```

**Recommended Backend Endpoint:**
```
GET /api/services/health
  ?time_window_minutes=60

Response:
{
  "services": [
    {
      "name": "api-gateway",
      "status": "healthy",
      "trace_count": 45,
      "last_activity": "2025-01-15T10:30:00Z",
      "avg_events_per_trace": 23.4,
      "minutes_since_last_activity": 2
    }
  ],
  "summary": {
    "healthy": 5,
    "warning": 1,
    "critical": 0
  }
}
```

**Impact:**
- Current: 100 traces, client-side aggregation
- Optimized: Pre-computed health metrics
- **Estimated Reduction: ~85% data transfer, ~90% client CPU**

---

### 🟡 Medium Impact

#### 4. **Dashboard Component - Multiple Parallel Requests**
**Location:** `src/components/Dashboard.tsx:33-36`

**Current Behavior:**
```typescript
const [racesRes, hotspotsRes, tracesRes] = await Promise.all([
  RacewayAPI.getGlobalRaces(),
  RacewayAPI.getSystemHotspots(),
  RacewayAPI.getTraces(1, 5),
]);
```

**Recommendation:**
Consider a unified dashboard endpoint:
```
GET /api/dashboard/summary

Response:
{
  "global_races": {...},
  "system_hotspots": {...},
  "recent_traces": {...},
  "services_summary": {...}
}
```

**Impact:**
- Current: 3 separate HTTP requests
- Optimized: 1 HTTP request, reduced connection overhead
- **Estimated Reduction: 2 fewer connections, ~30ms latency savings**

---

## Backend Endpoints Currently Available

✅ **Efficient (Backend-Optimized):**
- `/api/services` - Service list with metadata
- `/api/services/{name}/dependencies` - Pre-computed dependencies
- `/api/distributed/edges` - Pre-computed dependency graph
- `/api/distributed/global-races` - Pre-aggregated race data
- `/api/distributed/hotspots` - Pre-aggregated hotspot data

❌ **Inefficient (Client-Side Processing Required):**
- `/api/traces` - Raw trace list, requires filtering/aggregation
- `/api/traces/{id}` - Full trace analysis (heavy payload)

---

## Recommended Implementation Priority

### Phase 1: High Impact, Quick Wins
1. **Add `/api/services/{serviceName}/traces`** (ServiceTraces)
   - Effort: Small (just add filtering to existing endpoint)
   - Impact: High (eliminates 80-90% wasted data transfer)

2. **Add `/api/services/health`** (SystemHealth)
   - Effort: Medium (requires time-based queries)
   - Impact: High (eliminates heavy client processing)

### Phase 2: Performance Critical
3. **Add `/api/performance/metrics`** (SystemPerformance)
   - Effort: Large (complex aggregations)
   - Impact: Very High (eliminates most expensive client operation)

### Phase 3: Nice to Have
4. **Add `/api/dashboard/summary`** (Dashboard)
   - Effort: Small (combines existing endpoints)
   - Impact: Medium (reduces HTTP overhead)

---

## Database Query Considerations

### For `/api/performance/metrics`
```sql
-- Trace latency percentiles
SELECT
  percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) as p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) as p99,
  AVG(duration_ms) as avg_duration
FROM (
  SELECT
    trace_id,
    EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) * 1000 as duration_ms
  FROM events
  WHERE timestamp > NOW() - INTERVAL '1 hour'
  GROUP BY trace_id
) trace_durations;

-- Event type aggregations
SELECT
  event_type,
  COUNT(*) as count,
  AVG(duration_ns / 1000000.0) as avg_duration_ms
FROM events
WHERE timestamp > NOW() - INTERVAL '1 hour'
  AND duration_ns IS NOT NULL
GROUP BY event_type
ORDER BY avg_duration_ms DESC;

-- Service latency
SELECT
  service_name,
  COUNT(*) as event_count,
  AVG(duration_ns / 1000000.0) as avg_duration_ms
FROM events
WHERE timestamp > NOW() - INTERVAL '1 hour'
  AND duration_ns IS NOT NULL
  AND service_name IS NOT NULL
GROUP BY service_name
ORDER BY avg_duration_ms DESC;
```

### For `/api/services/{serviceName}/traces`
```sql
-- Filter traces by service
SELECT DISTINCT t.trace_id, t.first_timestamp, t.last_timestamp, t.event_count
FROM traces t
JOIN trace_services ts ON t.trace_id = ts.trace_id
WHERE ts.service_name = $1
ORDER BY t.last_timestamp DESC
LIMIT 100;
```

### For `/api/services/health`
```sql
-- Service health metrics
SELECT
  service_name,
  COUNT(DISTINCT trace_id) as trace_count,
  MAX(timestamp) as last_activity,
  AVG(events_per_trace) as avg_events_per_trace,
  EXTRACT(EPOCH FROM (NOW() - MAX(timestamp))) / 60 as minutes_since_last_activity
FROM (
  SELECT
    service_name,
    trace_id,
    COUNT(*) as events_per_trace,
    MAX(timestamp) as timestamp
  FROM events
  WHERE timestamp > NOW() - INTERVAL '1 hour'
  GROUP BY service_name, trace_id
) service_traces
GROUP BY service_name
ORDER BY service_name;
```

---

## Expected Performance Improvements

### Current State (Estimated)
- **Dashboard Load:** 3 requests, ~500KB data, ~200ms client processing
- **Performance Tab Load:** 6 requests, ~2MB data, ~800ms client processing
- **Service Traces:** 100 traces fetched, 80-90 discarded, ~400ms wasted
- **Health Tab:** 100 traces, ~300ms client aggregation

### Optimized State (Projected)
- **Dashboard Load:** 1 request, ~100KB data, ~20ms client processing
- **Performance Tab Load:** 1 request, ~50KB data, ~50ms client processing
- **Service Traces:** Only matching traces, no waste, ~50ms saved
- **Health Tab:** 1 request, ~20KB data, ~20ms client processing

### Overall Impact
- **Network Data Reduction:** ~70-85%
- **Client CPU Reduction:** ~80-90%
- **Perceived Load Time:** ~60% faster
- **Server Load:** Slightly increased but more efficient (database is optimized for aggregations)

---

## Additional Recommendations

### Caching Strategy
- Implement backend caching for expensive aggregations (5-30 second TTL)
- Use ETags for conditional requests
- Consider Redis for frequently accessed aggregations

### API Design Patterns
- Add `?summary=true` parameter to existing endpoints for lighter payloads
- Support field selection: `?fields=trace_id,duration,services`
- Add pagination metadata to all list endpoints

### Monitoring
- Track endpoint response times
- Monitor client-side processing duration
- Measure actual data transfer sizes
- Set performance budgets (e.g., no endpoint > 500ms)

---

## Migration Path

1. **Week 1:** Implement `/api/services/{name}/traces` (easy win)
2. **Week 2:** Implement `/api/services/health` (medium complexity)
3. **Week 3-4:** Implement `/api/performance/metrics` (complex aggregations)
4. **Week 5:** Add caching layer and optimization
5. **Week 6:** Performance testing and tuning

---

## Conclusion

The current architecture requires significant client-side processing that should be handled by the backend. Implementing the recommended endpoints would:

- **Reduce network bandwidth by 70-85%**
- **Reduce client CPU usage by 80-90%**
- **Improve perceived performance by 60%**
- **Enable better caching strategies**
- **Scale better as data grows**

The most critical optimizations are:
1. Service-filtered trace endpoint
2. Pre-computed health metrics
3. Performance metrics aggregation endpoint
