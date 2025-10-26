# Performance Optimization Plan

## Overview

This document outlines a systematic approach to optimize Raceway's performance while ensuring zero functional regressions. All optimizations are categorized by risk level and include specific testing strategies.

---

## Table of Contents

- [Risk Assessment Framework](#risk-assessment-framework)
- [Critical User Flows](#critical-user-flows)
- [Phase 1: Zero-Risk Optimizations](#phase-1-zero-risk-optimizations)
- [Phase 2: Low-Risk Database Optimizations](#phase-2-low-risk-database-optimizations)
- [Phase 3: Medium-Risk Backend Optimizations](#phase-3-medium-risk-backend-optimizations)
- [Phase 4: Frontend Optimizations](#phase-4-frontend-optimizations)
- [Testing Strategy](#testing-strategy)
- [Rollback Plan](#rollback-plan)

---

## Risk Assessment Framework

| Risk Level | Description | Testing Required |
|------------|-------------|------------------|
| 🟢 **ZERO** | No functional changes, only performance improvements | Smoke test |
| 🟡 **LOW** | Additive changes that don't modify existing behavior | Integration tests |
| 🟠 **MEDIUM** | Changes to existing logic with equivalent behavior | Full regression tests |
| 🔴 **HIGH** | Significant behavioral changes | Extensive testing + rollback plan |

---

## Critical User Flows

These flows **MUST** continue to work after optimizations:

### 1. **Trace Viewing Flow**
- ✅ User selects a trace from the list
- ✅ Events load and display correctly
- ✅ Event details panel shows on selection
- ✅ All tabs (Overview, Events, Performance, Variables, Anomalies) work

### 2. **Dashboard Flow**
- ✅ Dashboard loads with recent traces
- ✅ Race conditions display correctly
- ✅ Hotspots show top variables and service calls
- ✅ Service breakdown table renders

### 3. **Service Navigation Flow**
- ✅ Service list loads
- ✅ Service details page shows overview
- ✅ Service dependencies render
- ✅ Service traces are filterable

### 4. **Search & Filter Flow**
- ✅ Trace search by ID works
- ✅ Results update as user types
- ✅ Pagination works ("Load More")

### 5. **Real-time Updates Flow**
- ✅ Auto-refresh fetches new data
- ✅ Status badge updates correctly
- ✅ Event counts update

---

## Phase 1: Zero-Risk Optimizations

🟢 **Risk Level:** ZERO
⏱️ **Estimated Time:** 2-4 hours
✅ **Can Deploy:** Immediately after testing

### 1.1 Add Database Indexes

**Location:** `migrations/postgres/004_performance_indexes.sql`

**Changes:**
```sql
-- Events table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_trace_id ON events(trace_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_trace_timestamp ON events(trace_id, timestamp);

-- Distributed spans indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_distributed_spans_service ON distributed_spans(service);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_distributed_spans_trace_service ON distributed_spans(trace_id, service);

-- Cross-trace index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cross_trace_variable ON cross_trace_index(variable);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cross_trace_timestamp ON cross_trace_index(timestamp DESC);

-- Distributed edges
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_distributed_edges_from_span ON distributed_edges(from_span);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_distributed_edges_to_span ON distributed_edges(to_span);
```

**Why Zero-Risk:**
- Indexes only improve query performance
- `CREATE INDEX CONCURRENTLY` doesn't lock tables
- No application code changes required
- Queries return identical results, just faster

**Testing:**
```bash
# 1. Run migration
cargo run -- migrate

# 2. Verify indexes exist
psql -d raceway -c "\di idx_events_*"

# 3. Check query performance
EXPLAIN ANALYZE SELECT * FROM events WHERE trace_id = 'xxx';
```

**Rollback:**
```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_events_trace_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_events_timestamp;
-- ... etc
```

---

### 1.2 Add Result Caching for Expensive Queries

**Location:** New file `core/src/cache.rs`

**Changes:**
- Add in-memory cache with TTL for:
  - Performance metrics (60 second TTL)
  - Service health (30 second TTL)
  - System hotspots (30 second TTL)
  - Global races (30 second TTL)

**Implementation:**
```rust
use std::sync::Arc;
use tokio::sync::RwLock;
use std::time::{Duration, Instant};

pub struct QueryCache<T> {
    value: Arc<RwLock<Option<CachedValue<T>>>>,
    ttl: Duration,
}

struct CachedValue<T> {
    data: T,
    expires_at: Instant,
}

impl<T: Clone> QueryCache<T> {
    pub fn new(ttl: Duration) -> Self {
        Self {
            value: Arc::new(RwLock::new(None)),
            ttl,
        }
    }

    pub async fn get_or_fetch<F, E>(&self, fetch_fn: F) -> Result<T, E>
    where
        F: FnOnce() -> futures::future::BoxFuture<'static, Result<T, E>>,
    {
        // Check cache first
        {
            let cache = self.value.read().await;
            if let Some(cached) = cache.as_ref() {
                if cached.expires_at > Instant::now() {
                    return Ok(cached.data.clone());
                }
            }
        }

        // Cache miss - fetch fresh data
        let data = fetch_fn().await?;

        // Update cache
        {
            let mut cache = self.value.write().await;
            *cache = Some(CachedValue {
                data: data.clone(),
                expires_at: Instant::now() + self.ttl,
            });
        }

        Ok(data)
    }
}
```

**Why Zero-Risk:**
- Cache is transparent - returns same data as uncached queries
- TTL ensures data freshness
- Cache misses fall back to database
- Can be disabled via config flag

**Testing:**
```rust
#[tokio::test]
async fn test_cache_returns_fresh_data() {
    let cache = QueryCache::new(Duration::from_secs(10));

    // First call should hit database
    let result1 = cache.get_or_fetch(|| fetch_data()).await.unwrap();

    // Second call should return cached value
    let result2 = cache.get_or_fetch(|| fetch_data()).await.unwrap();

    assert_eq!(result1, result2);
}

#[tokio::test]
async fn test_cache_expires() {
    let cache = QueryCache::new(Duration::from_millis(100));

    let result1 = cache.get_or_fetch(|| fetch_data()).await.unwrap();

    tokio::time::sleep(Duration::from_millis(150)).await;

    // Should fetch fresh data after TTL
    let result2 = cache.get_or_fetch(|| fetch_data()).await.unwrap();

    assert_eq!(result1, result2); // Data should be identical, just re-fetched
}
```

---

## Phase 2: Low-Risk Database Optimizations

🟡 **Risk Level:** LOW
⏱️ **Estimated Time:** 4-6 hours
✅ **Can Deploy:** After integration tests pass

### 2.1 Fix `/status` Endpoint Full Table Scan

**Location:** `cli/src/server.rs:436-459`

**Current Code:**
```rust
let all_events = state
    .engine
    .storage()
    .get_all_events()
    .await
    .unwrap_or_default();
let all_traces = state
    .engine
    .storage()
    .get_all_trace_ids()
    .await
    .unwrap_or_default();

let status = ServerStatus {
    events_captured: all_events.len(),
    traces_active: all_traces.len(),
    // ...
};
```

**Optimized Code:**
```rust
// Add new storage trait methods
pub trait StorageBackend {
    async fn count_events(&self) -> Result<usize>;
    async fn count_traces(&self) -> Result<usize>;
}

// Postgres implementation
async fn count_events(&self) -> Result<usize> {
    let row = sqlx::query("SELECT COUNT(*) as count FROM events")
        .fetch_one(&self.pool)
        .await?;
    Ok(row.get::<i64, _>("count") as usize)
}

async fn count_traces(&self) -> Result<usize> {
    let row = sqlx::query("SELECT COUNT(DISTINCT trace_id) as count FROM events")
        .fetch_one(&self.pool)
        .await?;
    Ok(row.get::<i64, _>("count") as usize)
}

// In status handler
let events_count = state.engine.storage().count_events().await.unwrap_or(0);
let traces_count = state.engine.storage().count_traces().await.unwrap_or(0);

let status = ServerStatus {
    events_captured: events_count,
    traces_active: traces_count,
    // ...
};
```

**Why Low-Risk:**
- New methods added to trait (backwards compatible)
- Returns same data, just computed differently
- Fallback to 0 on error (same as before)
- Both old and new implementations can coexist during migration

**Testing:**
```rust
#[tokio::test]
async fn test_count_events_matches_len() {
    let storage = setup_test_storage().await;

    // Insert test events
    for i in 0..100 {
        storage.add_event(create_test_event(i)).await.unwrap();
    }

    let count = storage.count_events().await.unwrap();
    let all_events = storage.get_all_events().await.unwrap();

    assert_eq!(count, all_events.len());
}

#[tokio::test]
async fn test_count_traces_matches_len() {
    let storage = setup_test_storage().await;

    // Insert test events across multiple traces
    for trace_id in 0..10 {
        for event_id in 0..5 {
            storage.add_event(create_test_event_for_trace(trace_id, event_id)).await.unwrap();
        }
    }

    let count = storage.count_traces().await.unwrap();
    let all_traces = storage.get_all_trace_ids().await.unwrap();

    assert_eq!(count, all_traces.len());
}
```

**Integration Test:**
```bash
# Start server
cargo run

# Hit status endpoint
curl http://localhost:8080/status | jq

# Verify response structure
# {
#   "success": true,
#   "data": {
#     "events_captured": 1234,
#     "traces_active": 56,
#     ...
#   }
# }
```

**Expected Performance Improvement:**
- Before: O(n) - scans all events
- After: O(1) - single COUNT query
- With 1M events: ~5000ms → ~10ms (500x faster)

---

### 2.2 Optimize Trace Summaries Query

**Location:** `core/src/storage/postgres.rs:298-338`

**Current Query Issues:**
- `ARRAY_AGG(DISTINCT ...)` is expensive
- `ORDER BY MAX(e.timestamp)` computes MAX for all rows

**Optimized Query:**
```sql
-- Option 1: Use window functions
SELECT
    e.trace_id,
    COUNT(DISTINCT e.id) as event_count,
    MIN(e.timestamp) as first_timestamp,
    MAX(e.timestamp) as last_timestamp,
    -- Precomputed service list from distributed_spans
    COALESCE(ds.services, ARRAY[]::TEXT[]) as services,
    COALESCE(ds.service_count, 0) as service_count
FROM events e
LEFT JOIN (
    SELECT
        trace_id,
        ARRAY_AGG(DISTINCT service ORDER BY service) as services,
        COUNT(DISTINCT service) as service_count
    FROM distributed_spans
    GROUP BY trace_id
) ds ON e.trace_id = ds.trace_id
GROUP BY e.trace_id, ds.services, ds.service_count
ORDER BY MAX(e.timestamp) DESC
LIMIT $1 OFFSET $2
```

**Alternative: Denormalized Approach**
```sql
-- Add materialized view
CREATE MATERIALIZED VIEW trace_summaries AS
SELECT
    e.trace_id,
    COUNT(DISTINCT e.id) as event_count,
    MIN(e.timestamp) as first_timestamp,
    MAX(e.timestamp) as last_timestamp,
    COALESCE(
        ARRAY_AGG(DISTINCT s.service ORDER BY s.service)
        FILTER (WHERE s.service IS NOT NULL),
        ARRAY[]::TEXT[]
    ) as services,
    COUNT(DISTINCT s.service) as service_count
FROM events e
LEFT JOIN distributed_spans s ON e.trace_id = s.trace_id
GROUP BY e.trace_id;

-- Add index
CREATE INDEX idx_trace_summaries_timestamp ON trace_summaries(last_timestamp DESC);

-- Refresh periodically (every 30 seconds)
REFRESH MATERIALIZED VIEW CONCURRENTLY trace_summaries;

-- Query becomes simple
SELECT * FROM trace_summaries
ORDER BY last_timestamp DESC
LIMIT $1 OFFSET $2;
```

**Why Low-Risk:**
- Query returns identical data structure
- Materialized view can be refreshed in background
- Can A/B test both approaches
- Easy rollback to original query

**Testing:**
```rust
#[tokio::test]
async fn test_trace_summaries_data_matches() {
    let storage = setup_test_storage().await;

    // Insert test data
    insert_test_traces(&storage, 100).await;

    // Get summaries with old method
    let (old_summaries, old_count) = storage.get_trace_summaries_old(1, 20).await.unwrap();

    // Get summaries with new method
    let (new_summaries, new_count) = storage.get_trace_summaries(1, 20).await.unwrap();

    assert_eq!(old_count, new_count);
    assert_eq!(old_summaries.len(), new_summaries.len());

    for (old, new) in old_summaries.iter().zip(new_summaries.iter()) {
        assert_eq!(old.trace_id, new.trace_id);
        assert_eq!(old.event_count, new.event_count);
        assert_eq!(old.services, new.services);
    }
}
```

---

### 2.3 Add Caching to Performance Metrics Endpoint

**Location:** `cli/src/server.rs:1492-1513`

**Implementation:**
```rust
// Add to AppState
struct AppState {
    engine: Arc<RacewayEngine>,
    verbose: bool,
    auth: AuthConfig,
    // Add cache
    perf_metrics_cache: Arc<QueryCache<serde_json::Value>>,
}

// In handler
async fn get_performance_metrics_handler(
    State(state): State<AppState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let limit = params
        .get("limit")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(50);

    // Try cache first
    let metrics = state.perf_metrics_cache
        .get_or_fetch(|| {
            let storage = state.engine.storage().clone();
            Box::pin(async move {
                storage.get_performance_metrics(limit).await
            })
        })
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::error(format!("Failed to fetch metrics: {}", e))),
            )
        })?;

    Ok((StatusCode::OK, Json(ApiResponse::success(metrics))))
}
```

**Why Low-Risk:**
- Cache is transparent to API consumers
- Same data structure returned
- TTL ensures reasonable freshness
- Cache can be bypassed with query param

**Testing:**
```bash
# Test uncached request
time curl http://localhost:8080/api/performance/metrics?limit=50

# Test cached request (should be faster)
time curl http://localhost:8080/api/performance/metrics?limit=50

# Test cache invalidation
curl http://localhost:8080/api/performance/metrics?limit=50&no_cache=true
```

---

## Phase 3: Medium-Risk Backend Optimizations

🟠 **Risk Level:** MEDIUM
⏱️ **Estimated Time:** 6-8 hours
⚠️ **Requires:** Full regression testing + staged rollout

### 3.1 Optimize Global Analysis Endpoint

**Location:** `cli/src/server.rs:576-724`

**Current Issues:**
- Fetches all events to count them
- Iterates through all concurrent event pairs

**Optimized Approach:**
```rust
// Cache the analysis result
struct AppState {
    // ...
    global_analysis_cache: Arc<QueryCache<GlobalAnalysis>>,
}

async fn analyze_global_handler(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let analysis = state.global_analysis_cache
        .get_or_fetch(|| {
            let engine = state.engine.clone();
            Box::pin(async move {
                // Get counts efficiently
                let total_traces = engine.storage().count_traces().await?;
                let total_events = engine.storage().count_events().await?;

                // Get concurrent events (already optimized in analysis service)
                let concurrent = engine
                    .analysis()
                    .find_global_concurrent_events()
                    .await?;

                // Build analysis without fetching all data
                let mut race_details = Vec::new();

                for (event1, event2) in &concurrent {
                    // ... process race details
                }

                Ok(GlobalAnalysis {
                    total_traces,
                    total_events,
                    concurrent_events: concurrent.len(),
                    potential_races: concurrent.len(),
                    anomalies: vec![],
                    race_details,
                })
            })
        })
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::error(format!("Analysis failed: {}", e))),
            )
        })?;

    Ok((StatusCode::OK, Json(ApiResponse::success(analysis))))
}
```

**Why Medium-Risk:**
- Changes analysis computation logic
- Caching could hide recent race conditions temporarily
- Need to ensure cache invalidation works correctly

**Testing Strategy:**
```rust
#[tokio::test]
async fn test_global_analysis_cache_invalidates() {
    let engine = setup_test_engine().await;
    let state = setup_app_state(engine.clone());

    // Get initial analysis
    let analysis1 = get_global_analysis(&state).await.unwrap();

    // Add new events with race condition
    add_race_condition_events(&engine).await;

    // Wait for cache to expire
    tokio::time::sleep(Duration::from_secs(31)).await;

    // Get updated analysis
    let analysis2 = get_global_analysis(&state).await.unwrap();

    // Should reflect new race condition
    assert!(analysis2.potential_races > analysis1.potential_races);
}
```

**Rollout Strategy:**
1. Deploy with feature flag (cache disabled)
2. Enable cache for 10% of requests
3. Monitor for correctness issues
4. Gradually increase to 100%

---

### 3.2 Limit `get_all_events()` Usage

**Strategy:** Deprecate `get_all_events()` and replace with paginated alternatives

**Changes:**
```rust
// Add warning to trait
pub trait StorageBackend {
    /// DEPRECATED: Use count_events() or paginated queries instead
    /// This method loads ALL events into memory and should not be used
    #[deprecated(note = "Use count_events() or get_paginated_events() instead")]
    async fn get_all_events(&self) -> Result<Vec<Event>>;

    // Add paginated alternative
    async fn get_paginated_events(&self, limit: usize, offset: usize) -> Result<Vec<Event>>;
}
```

**Why Medium-Risk:**
- Requires code review of all `get_all_events()` call sites
- Each usage needs different replacement strategy
- Risk of breaking features that depend on having all events

**Migration Plan:**
1. Audit all call sites (grep for `get_all_events`)
2. Replace each with appropriate alternative
3. Add compile warning
4. Remove after 2 releases

---

## Phase 4: Frontend Optimizations

🟡 **Risk Level:** LOW to MEDIUM
⏱️ **Estimated Time:** 8-12 hours
✅ **Can Deploy:** After component tests pass

### 4.1 Add Virtual Scrolling to EventsView

**Location:** `web/src/components/EventsView.tsx`

**Changes:**
```bash
# Install react-window
cd web
npm install react-window @types/react-window
```

**Implementation:**
```typescript
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';

export function EventsView({ events, selectedEventId, onEventSelect }: EventsViewProps) {
  const EventRow = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const event = events[index];
    const isSelected = event.id === selectedEventId;

    return (
      <div style={style}>
        <button
          onClick={() => onEventSelect(event.id)}
          className={cn(
            "w-full text-left px-3 py-2.5 rounded-md transition-all",
            isSelected ? "bg-muted" : "bg-card/50"
          )}
        >
          {/* Event content */}
        </button>
      </div>
    );
  };

  return (
    <AutoSizer>
      {({ height, width }) => (
        <List
          height={height}
          itemCount={events.length}
          itemSize={60} // Height of each event row
          width={width}
        >
          {EventRow}
        </List>
      )}
    </AutoSizer>
  );
}
```

**Why Low-Risk:**
- Only changes rendering, not data
- Same events displayed, just virtualized
- Easy to test visually
- Can be feature-flagged

**Testing:**
```typescript
// Manual testing checklist
// 1. Load trace with 1000+ events
// 2. Verify scrolling is smooth
// 3. Verify selection still works
// 4. Verify event details panel updates
// 5. Test with different window sizes
```

**Expected Performance:**
- Before: Renders all N events (slow with 10k+ events)
- After: Renders only ~20 visible events (constant time)
- Memory usage: O(n) → O(1)

---

### 4.2 Add Debouncing to Search Input

**Location:** `web/src/App.tsx:503-509`

**Implementation:**
```typescript
import { useMemo } from 'react';
import { debounce } from 'lodash-es'; // or implement custom debounce

export default function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

  // Debounced setter
  const debouncedSetSearch = useMemo(
    () => debounce((value: string) => {
      setDebouncedSearchQuery(value);
    }, 300),
    []
  );

  // Update immediately for input, but debounce the filtering
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value); // Immediate UI feedback
    debouncedSetSearch(value); // Debounced filtering
  };

  // Filter traces with debounced query
  const filteredTraces = traces.filter(trace =>
    trace.trace_id.toLowerCase().includes(debouncedSearchQuery.toLowerCase())
  );

  return (
    <input
      type="text"
      placeholder="Search by ID..."
      value={searchQuery}
      onChange={handleSearchChange}
    />
  );
}
```

**Why Low-Risk:**
- Improves UX (less janky)
- User still sees immediate feedback in input
- Filtering is delayed by 300ms (imperceptible)
- No data changes

**Testing:**
```typescript
// Manual test
// 1. Type quickly in search box
// 2. Verify input updates immediately
// 3. Verify list filters after brief delay
// 4. Type and immediately select trace - should work
```

---

### 4.3 Implement React Query for API Caching

**Location:** `web/src/api.ts` and `web/src/App.tsx`

**Changes:**
```bash
npm install @tanstack/react-query
```

**Implementation:**
```typescript
// In main.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10000, // 10 seconds
      cacheTime: 300000, // 5 minutes
      refetchOnWindowFocus: false,
    },
  },
});

root.render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);

// In Dashboard.tsx
import { useQuery } from '@tanstack/react-query';

export function Dashboard({ ... }: DashboardProps) {
  const { data: races, isLoading: racesLoading } = useQuery({
    queryKey: ['global-races'],
    queryFn: () => RacewayAPI.getGlobalRaces(),
    staleTime: 30000, // 30 seconds
  });

  const { data: hotspots, isLoading: hotspotsLoading } = useQuery({
    queryKey: ['system-hotspots'],
    queryFn: () => RacewayAPI.getSystemHotspots(),
    staleTime: 30000,
  });

  const { data: recentTraces, isLoading: tracesLoading } = useQuery({
    queryKey: ['traces', 1, 5],
    queryFn: () => RacewayAPI.getTraces(1, 5),
    staleTime: 10000, // 10 seconds
  });

  // No need for manual useEffect + useState anymore!
}
```

**Why Medium-Risk:**
- Significant architectural change
- Changes data flow throughout app
- Need to ensure cache invalidation works
- Need to verify refetch logic

**Benefits:**
- Automatic request deduplication
- Background refetching
- Optimistic updates
- Better loading states

**Testing Strategy:**
```typescript
// 1. Network tab should show fewer requests
// 2. Navigating between pages should use cached data
// 3. Manual refresh should fetch fresh data
// 4. Auto-refresh should still work
```

**Migration Plan:**
1. Add React Query to project
2. Migrate one component at a time
3. Test each component thoroughly
4. Keep old implementation as fallback
5. Remove old code after 2 weeks

---

### 4.4 Optimize Auto-Refresh

**Location:** `web/src/App.tsx:189-196`

**Current Issues:**
- Polls every 20 seconds unconditionally
- No conditional requests
- Fetches even when data unchanged

**Optimized Approach:**

**Option 1: Increase Interval + Conditional Requests**
```typescript
// Increase to 30 seconds
const interval = autoRefresh ? setInterval(() => {
  fetchTraces();
  fetchServices();
}, 30000) : null;

// Add ETag support to API
export class RacewayAPI {
  private static etags = new Map<string, string>();

  private static async fetchJSON<T>(url: string): Promise<T> {
    const headers: HeadersInit = {};
    const etag = this.etags.get(url);
    if (etag) {
      headers['If-None-Match'] = etag;
    }

    const response = await fetch(url, { headers });

    if (response.status === 304) {
      // Data unchanged, return cached
      return JSON.parse(sessionStorage.getItem(url) || '{}');
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const newEtag = response.headers.get('ETag');
    if (newEtag) {
      this.etags.set(url, newEtag);
    }

    const data = await response.json();
    sessionStorage.setItem(url, JSON.stringify(data));

    return data;
  }
}
```

**Option 2: WebSocket for Real-time Updates**
```typescript
// More advanced - only fetch when data changes
const useWebSocketUpdates = () => {
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8080/ws');

    ws.onmessage = (event) => {
      const update = JSON.parse(event.data);

      if (update.type === 'new_trace') {
        queryClient.invalidateQueries(['traces']);
      }

      if (update.type === 'new_events') {
        queryClient.invalidateQueries(['traces', update.trace_id]);
      }
    };

    return () => ws.close();
  }, []);
};
```

**Why Medium-Risk:**
- WebSocket approach requires server changes
- ETag approach is simpler but requires server support
- Need to ensure updates don't get missed

**Recommendation:** Start with increased interval (30s → 60s) + React Query's background refetch

---

### 4.5 Add React.memo() to Expensive Components

**Location:** Multiple components

**Changes:**
```typescript
// EventsView.tsx
export const EventsView = React.memo(function EventsView({
  events,
  selectedEventId,
  onEventSelect
}: EventsViewProps) {
  // ... component code
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if these change
  return (
    prevProps.selectedEventId === nextProps.selectedEventId &&
    prevProps.events.length === nextProps.events.length &&
    prevProps.events[0]?.id === nextProps.events[0]?.id
  );
});

// TraceList.tsx
export const TraceList = React.memo(function TraceList({
  traces,
  selectedTraceId,
  onSelect,
}: TraceListProps) {
  // ... component code
}, (prevProps, nextProps) => {
  return (
    prevProps.selectedTraceId === nextProps.selectedTraceId &&
    prevProps.traces.length === nextProps.traces.length
  );
});
```

**Why Low-Risk:**
- Only affects rendering performance
- No functional changes
- Easy to verify with React DevTools
- Can be removed if it causes issues

**Testing:**
```typescript
// Use React DevTools Profiler
// 1. Enable "Highlight updates" in DevTools
// 2. Select different traces
// 3. Verify EventsView only re-renders when events actually change
// 4. Verify TraceList only re-renders when traces change
```

---

## Testing Strategy

### Automated Tests

#### Backend Tests
```bash
# Run all Rust tests
cargo test

# Run specific storage tests
cargo test --package raceway-core --lib storage

# Run integration tests
cargo test --package raceway-cli --test integration_tests

# Check for performance regressions
cargo bench
```

#### Frontend Tests
```bash
# (Add testing framework first)
npm install --save-dev vitest @testing-library/react @testing-library/user-event

# Run component tests
npm test

# Run E2E tests (if implemented)
npm run test:e2e
```

### Manual Testing Checklist

#### Critical Path Testing

**1. Trace Viewing (15 min)**
- [ ] Load dashboard
- [ ] Click on a trace
- [ ] Verify events load
- [ ] Click on an event
- [ ] Verify details panel appears
- [ ] Switch between tabs (Overview, Events, Performance, Variables, Anomalies)
- [ ] Verify all data renders correctly

**2. Search & Filter (10 min)**
- [ ] Type in search box
- [ ] Verify input updates immediately
- [ ] Verify results filter correctly
- [ ] Clear search
- [ ] Verify all traces return

**3. Dashboard (10 min)**
- [ ] Load dashboard
- [ ] Verify race conditions display
- [ ] Verify hotspots display
- [ ] Verify service breakdown renders
- [ ] Click on a service
- [ ] Verify navigation works

**4. Service Navigation (10 min)**
- [ ] Click "Services" tab
- [ ] Select a service
- [ ] Verify overview loads
- [ ] Switch to Dependencies tab
- [ ] Switch to Traces tab
- [ ] Verify all data renders

**5. Auto-Refresh (5 min)**
- [ ] Enable auto-refresh
- [ ] Wait 30 seconds
- [ ] Verify data refreshes
- [ ] Verify no errors in console
- [ ] Disable auto-refresh
- [ ] Verify polling stops

#### Performance Testing

**Load Testing**
```bash
# Generate load
for i in {1..1000}; do
  curl -X POST http://localhost:8080/events \
    -H "Content-Type: application/json" \
    -d "{\"events\": [...]}"
done

# Verify performance
time curl http://localhost:8080/api/traces?page=1&page_size=20
time curl http://localhost:8080/api/performance/metrics
time curl http://localhost:8080/status
```

**Browser Performance**
- [ ] Open Chrome DevTools Performance tab
- [ ] Record page load
- [ ] Verify no long tasks (>50ms)
- [ ] Check memory usage doesn't grow unbounded
- [ ] Verify smooth 60fps scrolling

---

## Rollback Plan

### Database Changes

**If indexes cause issues:**
```sql
-- Drop indexes
DROP INDEX CONCURRENTLY idx_events_trace_id;
DROP INDEX CONCURRENTLY idx_events_timestamp;
-- etc.
```

**If materialized views cause issues:**
```sql
-- Drop materialized view
DROP MATERIALIZED VIEW trace_summaries;

-- Revert to original query
```

### Backend Changes

**Feature Flags:**
```toml
# config.toml
[performance]
enable_query_cache = false
enable_optimized_queries = false
```

**Code Rollback:**
```bash
# Revert specific commit
git revert <optimization-commit-hash>

# Or revert to previous version
git checkout v1.0.0

# Rebuild and redeploy
cargo build --release
```

### Frontend Changes

**NPM Package Rollback:**
```bash
# If React Query causes issues
npm uninstall @tanstack/react-query

# Restore previous package-lock.json
git checkout HEAD^ -- package-lock.json
npm install
```

**Component Rollback:**
```bash
# Revert specific component
git checkout HEAD^ -- web/src/components/EventsView.tsx

# Rebuild
npm run build
```

---

## Monitoring & Validation

### Metrics to Track

**Backend Metrics:**
- API endpoint response times (p50, p95, p99)
- Database query times
- Cache hit rates
- Memory usage
- CPU usage

**Frontend Metrics:**
- Page load time
- Time to interactive
- Largest contentful paint
- Cumulative layout shift
- JavaScript bundle size

### Success Criteria

**Performance Improvements:**
- `/status` endpoint: < 50ms (from ~5s)
- `/api/traces` endpoint: < 200ms (from ~1s)
- `/api/performance/metrics`: < 500ms (from ~3s)
- EventsView render: < 100ms for 10k events (from ~2s)
- Dashboard load: < 1s (from ~3s)

**No Regressions:**
- All critical user flows work
- No increase in error rates
- No memory leaks
- No data correctness issues

---

## Implementation Timeline

### Week 1: Phase 1 (Zero-Risk)
- **Day 1-2:** Add database indexes
- **Day 2-3:** Implement query caching
- **Day 4:** Testing and validation
- **Day 5:** Deploy to production

### Week 2: Phase 2 (Low-Risk)
- **Day 1-2:** Fix `/status` endpoint
- **Day 3:** Optimize trace summaries query
- **Day 4:** Add caching to performance metrics
- **Day 5:** Testing and validation

### Week 3: Phase 3 (Medium-Risk Backend)
- **Day 1-2:** Optimize global analysis endpoint
- **Day 3:** Limit `get_all_events()` usage
- **Day 4-5:** Testing and validation

### Week 4: Phase 4 (Frontend)
- **Day 1-2:** Add virtual scrolling
- **Day 2:** Add debouncing
- **Day 3-4:** Implement React Query
- **Day 5:** Testing and validation

### Week 5: Polish & Monitor
- **Day 1-2:** Optimize auto-refresh
- **Day 3:** Add React.memo()
- **Day 4-5:** Final testing and monitoring

---

## Conclusion

This optimization plan provides a systematic approach to improving Raceway's performance while minimizing risk. By categorizing changes by risk level and providing comprehensive testing strategies, we ensure that functionality remains intact throughout the optimization process.

**Key Principles:**
1. ✅ **Test before deploy** - Every change must pass tests
2. ✅ **Monitor after deploy** - Track metrics to catch issues early
3. ✅ **Rollback ready** - Always have a rollback plan
4. ✅ **Incremental deployment** - Deploy in phases, not all at once
5. ✅ **User-centric** - Preserve all critical user flows

**Expected Overall Impact:**
- 🚀 **Server performance:** 10-500x improvement on slow endpoints
- 🚀 **Frontend performance:** Handle 10k+ events smoothly
- 🚀 **User experience:** Faster load times, smoother interactions
- 🚀 **Scalability:** Support 10x more data without degradation

---

## Questions or Concerns?

If you have questions about any optimization, open an issue with the label `performance` and reference this document.
