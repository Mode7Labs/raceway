# Anomaly Detection

Spot performance outliers and unexpected behavior in your distributed system with statistical analysis.

## What are Anomalies?

**Anomalies** are events that take significantly longer than expected based on historical data for that event type. They help identify:
- Performance degradations
- Unexpected slow queries
- Resource contention
- Network issues
- Code paths that need optimization

## How It Works

Raceway uses **statistical analysis** to detect anomalies:

### Algorithm

```
For each event kind (e.g., "DatabaseQuery", "HttpRequest"):
  1. Collect all durations for that kind across traces
  2. Compute mean (μ) and standard deviation (σ)
  3. Flag events where duration > μ + 2σ as anomalies
```

**Example:**

```
Event kind: "database_query"
Sample durations: [45ms, 48ms, 52ms, 50ms, 46ms, 150ms, 49ms]

Mean (μ): 54.3ms
Std deviation (σ): 36.7ms
Threshold: 54.3 + (2 × 36.7) = 127.7ms

Anomaly: 150ms > 127.7ms ✓
```

## Severity Levels

Raceway classifies anomalies by how far they deviate from the norm:

| Severity | Threshold | Color | Description |
|----------|-----------|-------|-------------|
| **High** | > μ + 3σ | Red | Extreme outlier (>99.7% of values) |
| **Medium** | > μ + 2.5σ | Orange | Significant outlier (>98.8% of values) |
| **Low** | > μ + 2σ | Yellow | Notable outlier (>95.4% of values) |

## Viewing Anomalies

### Web UI

**Anomalies Tab:**
1. Select a trace from the list
2. Click "Anomalies" tab
3. View detected anomalies sorted by severity

**Features:**
- Color-coded severity indicators
- Duration comparison (actual vs expected)
- Event details and location
- Filter by severity or event kind
- Link to view in Events tab

### Terminal UI (TUI)

1. Select trace
2. Navigate to "Anomalies" view
3. See list with:
   - Event kind
   - Expected vs actual duration
   - Severity level
   - Location in code

**Keyboard shortcuts:**
- `j/k`: Navigate anomalies
- `Enter`: View full event details
- `Tab`: Switch between views

### HTTP API

```bash
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

## Common Causes

### 1. Database Performance

**Symptom:** Database queries taking 10x longer than normal

**Possible causes:**
- Missing index on new query pattern
- Lock contention on hot table
- Query plan regression after statistics update
- Database resource exhaustion (CPU/memory/disk)

**Investigation:**
- Check database slow query log
- Analyze query plan with EXPLAIN
- Review recent schema changes
- Monitor database metrics

### 2. Network Issues

**Symptom:** HTTP requests to external services taking much longer

**Possible causes:**
- Network congestion
- Service degradation
- Increased latency between regions
- Rate limiting

**Investigation:**
- Check network metrics
- Review external service status pages
- Test from different locations
- Check for rate limit headers

### 3. Resource Contention

**Symptom:** CPU-intensive operations slower than usual

**Possible causes:**
- High CPU utilization
- Memory pressure causing swapping
- Disk I/O saturation
- Container/VM resource limits hit

**Investigation:**
- Check system metrics (CPU, memory, disk)
- Review container resource limits
- Look for competing workloads
- Profile application CPU usage

### 4. Code Regressions

**Symptom:** Specific functions suddenly slower

**Possible causes:**
- Recent code changes added inefficiency
- New library version with performance regression
- Configuration change impacting behavior

**Investigation:**
- Review recent deployments
- Compare traces before/after deploy
- Profile the slow function
- Test with previous code version

## Best Practices

### 1. Set Appropriate Thresholds

Default (2σ) catches ~5% of events as anomalies. Adjust if needed:

```toml
# raceway.toml
[analysis]
anomaly_threshold_sigma = 2.5  # More strict (fewer anomalies)
```

### 2. Correlate with Deployments

Track when anomalies started:
- Did they coincide with a deployment?
- New configuration change?
- Infrastructure change?

### 3. Use with Critical Path

Anomalies on the critical path have the biggest impact:

```
Anomaly on critical path:
  Database query: 450ms (normally 50ms)
  Impact: Entire trace 400ms slower

Anomaly off critical path:
  Cache lookup: 200ms (normally 5ms)
  Impact: Minimal (runs in parallel)
```

### 4. Monitor Trends

Track anomaly frequency over time:
- Increasing anomalies = degrading performance
- Anomalies after specific times = pattern (e.g., daily backup)
- Random anomalies = transient issues

## Real-World Examples

### Example 1: Slow Database Query

```json
{
  "kind": "DatabaseQuery",
  "expected_duration_ms": 45.0,
  "actual_duration_ms": 1200.0,
  "deviation_sigma": 5.1,
  "severity": "High",
  "query": "SELECT * FROM orders WHERE user_id = ?"
}
```

**Root cause:** Missing index on `user_id` column
**Fix:** `CREATE INDEX idx_orders_user_id ON orders(user_id)`
**Result:** Query time back to 45ms

### Example 2: External API Timeout

```json
{
  "kind": "HttpRequest",
  "expected_duration_ms": 150.0,
  "actual_duration_ms": 5000.0,
  "deviation_sigma": 8.2,
  "severity": "High",
  "url": "https://api.third-party.com/verify"
}
```

**Root cause:** Third-party service degradation
**Fix:** 
- Added timeout (5s → 2s)
- Implemented circuit breaker
- Added fallback behavior
**Result:** Graceful degradation during outages

## Integration with Other Features

### With Race Detection

Anomalies can indicate races:
- Database query slower because of lock contention
- Check for concurrent writes to same data

### With Critical Path

Focus on anomalies that are on the critical path:
- These directly impact overall latency
- Off-path anomalies may be less urgent

### With Distributed Tracing

Anomalies in distributed systems:
- Which service is slow?
- Is it cascading through services?
- Network or application issue?

## Next Steps

- [Critical Path Analysis](/guide/critical-path) - Find bottlenecks
- [Race Detection](/guide/race-detection) - Find concurrency issues
- [Web UI](/guide/web-ui) - Visualize anomalies
- [Security Guide](/guide/security) - Best practices and security
