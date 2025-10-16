# Raceway Persistence Implementation Plan

## Overview

This document outlines the implementation plan for adding pluggable database-backed persistence to Raceway. Currently, all data is stored in-memory using `CausalGraph` with `DashMap` and `petgraph`. This plan will enable production-ready persistence with support for PostgreSQL, MySQL, SQLite, and Supabase.

## Current State Analysis

### Current Architecture
- **Storage**: All in-memory using `DashMap` for concurrent access
- **Graph Structure**: `petgraph::DiGraph` wrapped in `Mutex`
- **Implementation**: `core/src/graph.rs` (~1100 lines)
- **Key Data Structures**:
  ```rust
  pub struct CausalGraph {
      graph: Mutex<DiGraph<Uuid, CausalEdge>>,
      nodes: DashMap<Uuid, (NodeIndex, CausalNode)>,
      trace_roots: DashMap<Uuid, Vec<Uuid>>,
      analysis_cache: DashMap<Uuid, Vec<(Event, Event)>>,
      baseline_metrics: DashMap<String, DurationStats>,
      cross_trace_index: DashMap<String, Vec<Uuid>>,
  }
  ```

### Limitations
- Data lost on server restart
- No scalability beyond single machine memory
- No persistence for production deployments
- No data durability guarantees

## Target Architecture

### Storage Trait
Define an async trait that all storage backends must implement:

```rust
#[async_trait]
pub trait StorageBackend: Send + Sync {
    // Event operations
    async fn add_event(&self, event: Event) -> Result<()>;
    async fn get_event(&self, id: Uuid) -> Result<Option<Event>>;
    async fn get_trace_events(&self, trace_id: Uuid) -> Result<Vec<Event>>;

    // Causal edge operations
    async fn add_edge(&self, from: Uuid, to: Uuid, edge: CausalEdge) -> Result<()>;
    async fn get_edges(&self, event_id: Uuid) -> Result<Vec<(Uuid, CausalEdge)>>;

    // Trace operations
    async fn get_trace_roots(&self, trace_id: Uuid) -> Result<Vec<Uuid>>;
    async fn set_trace_root(&self, trace_id: Uuid, root_id: Uuid) -> Result<()>;

    // Race detection
    async fn detect_races(&self, trace_id: Uuid) -> Result<Vec<(Event, Event)>>;
    async fn get_cross_trace_races(&self, variable: &str) -> Result<Vec<CrossTraceRace>>;

    // Metrics and analysis
    async fn record_baseline_metric(&self, op: &str, duration: Duration) -> Result<()>;
    async fn get_baseline_metric(&self, op: &str) -> Result<Option<DurationStats>>;

    // Audit trail
    async fn get_audit_trail(&self, variable: &str) -> Result<Option<AuditTrailData>>;

    // Graph queries
    async fn find_happens_before(&self, event1: Uuid, event2: Uuid) -> Result<bool>;
    async fn get_critical_path(&self, trace_id: Uuid) -> Result<Vec<Event>>;

    // Cleanup
    async fn cleanup_old_traces(&self, retention_hours: u64) -> Result<usize>;
    async fn clear(&self) -> Result<()>;
}
```

### Backend Implementations

1. **MemoryBackend** - Refactored from current `CausalGraph`
2. **PostgresBackend** - Production-ready with Supabase support
3. **MySQLBackend** - Alternative SQL backend
4. **SqliteBackend** - Embedded database for single-node deployments

### Factory Pattern

```rust
pub async fn create_storage_backend(config: &StorageConfig) -> Result<Arc<dyn StorageBackend>> {
    match config.backend.as_str() {
        "memory" => Ok(Arc::new(MemoryBackend::new(config)?)),
        "postgres" | "supabase" => Ok(Arc::new(PostgresBackend::new(config).await?)),
        "mysql" => Ok(Arc::new(MySQLBackend::new(config).await?)),
        "sqlite" => Ok(Arc::new(SqliteBackend::new(config).await?)),
        _ => anyhow::bail!("Unknown storage backend: {}", config.backend),
    }
}
```

## Database Schema Design

### Events Table
```sql
CREATE TABLE events (
    id UUID PRIMARY KEY,
    trace_id UUID NOT NULL,
    parent_id UUID,
    kind JSONB NOT NULL,  -- EventKind enum serialized
    timestamp TIMESTAMPTZ NOT NULL,
    metadata JSONB NOT NULL,
    causality_vector JSONB,  -- Map<Uuid, u64>
    lock_set JSONB,  -- Set<String>
    created_at TIMESTAMPTZ DEFAULT NOW(),

    INDEX idx_trace_id (trace_id),
    INDEX idx_timestamp (timestamp),
    INDEX idx_parent_id (parent_id)
);
```

### Causal Edges Table
```sql
CREATE TABLE causal_edges (
    id SERIAL PRIMARY KEY,
    from_event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    to_event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    edge_type VARCHAR(50) NOT NULL,  -- "HappensBefore", "ConcurrentWith", etc.
    weight INTEGER,
    metadata JSONB,

    UNIQUE(from_event_id, to_event_id),
    INDEX idx_from_event (from_event_id),
    INDEX idx_to_event (to_event_id)
);
```

### Trace Roots Table
```sql
CREATE TABLE trace_roots (
    trace_id UUID NOT NULL,
    root_event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (trace_id, root_event_id),
    INDEX idx_trace_id (trace_id)
);
```

### Baseline Metrics Table
```sql
CREATE TABLE baseline_metrics (
    operation VARCHAR(255) PRIMARY KEY,
    count BIGINT NOT NULL DEFAULT 0,
    total_duration_micros BIGINT NOT NULL DEFAULT 0,
    min_duration_micros BIGINT NOT NULL,
    max_duration_micros BIGINT NOT NULL,
    mean_duration_micros DOUBLE PRECISION NOT NULL,
    variance DOUBLE PRECISION NOT NULL,
    std_dev DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Cross-Trace Index Table
```sql
CREATE TABLE cross_trace_index (
    variable VARCHAR(255) NOT NULL,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    trace_id UUID NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,

    PRIMARY KEY (variable, event_id),
    INDEX idx_variable (variable),
    INDEX idx_trace_id (trace_id)
);
```

## Implementation Phases

### Phase 1: Define Storage Trait
**Files to Create**:
- `core/src/storage/mod.rs` - Module definition
- `core/src/storage/trait.rs` - StorageBackend trait
- `core/src/storage/types.rs` - Shared types (DurationStats, CrossTraceRace, etc.)

**Dependencies to Add**:
```toml
[dependencies]
async-trait = "0.1"
```

**Estimated Effort**: 1-2 days

### Phase 2: Refactor CausalGraph → MemoryBackend
**Files to Modify**:
- `core/src/graph.rs` → `core/src/storage/memory.rs`
- Implement `StorageBackend` trait for existing `CausalGraph` logic
- Keep all existing DashMap-based implementation
- Make methods async (most will be simple wrappers)

**Files to Create**:
- `core/src/storage/memory.rs`

**Estimated Effort**: 2-3 days

### Phase 3: Database Schema & Migrations
**Files to Create**:
- `migrations/postgres/001_initial_schema.sql`
- `migrations/mysql/001_initial_schema.sql`
- `migrations/sqlite/001_initial_schema.sql`

**Dependencies to Add**:
```toml
[dependencies]
sqlx = { version = "0.7", features = ["runtime-tokio", "postgres", "mysql", "sqlite", "uuid", "chrono", "json"] }
```

**Estimated Effort**: 1-2 days

### Phase 4: Implement PostgresBackend
**Files to Create**:
- `core/src/storage/postgres.rs`

**Key Implementation Details**:
- Connection pooling with `sqlx::PgPool`
- Batch inserts for performance
- JSONB for complex types (causality vectors, lock sets)
- Transactions for consistency
- Prepared statements for common queries

**Example Implementation**:
```rust
pub struct PostgresBackend {
    pool: PgPool,
    config: PostgresConfig,
    // Optional in-memory cache layer
    cache: Option<Arc<MemoryBackend>>,
}

impl PostgresBackend {
    pub async fn new(config: &StorageConfig) -> Result<Self> {
        let pg_config = &config.postgres;
        let pool = PgPool::connect(&pg_config.connection_string).await?;

        // Auto-migrate if enabled
        if pg_config.auto_migrate.unwrap_or(true) {
            sqlx::migrate!("./migrations/postgres").run(&pool).await?;
        }

        Ok(Self { pool, config: pg_config.clone(), cache: None })
    }
}

#[async_trait]
impl StorageBackend for PostgresBackend {
    async fn add_event(&self, event: Event) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO events (id, trace_id, parent_id, kind, timestamp, metadata, causality_vector, lock_set)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            "#,
            event.id,
            event.trace_id,
            event.parent_id,
            serde_json::to_value(&event.kind)?,
            event.timestamp,
            serde_json::to_value(&event.metadata)?,
            serde_json::to_value(&event.causality_vector)?,
            serde_json::to_value(&event.lock_set)?
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn get_trace_events(&self, trace_id: Uuid) -> Result<Vec<Event>> {
        let rows = sqlx::query!(
            r#"
            SELECT id, trace_id, parent_id, kind, timestamp, metadata, causality_vector, lock_set
            FROM events
            WHERE trace_id = $1
            ORDER BY timestamp
            "#,
            trace_id
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(Event {
                    id: row.id,
                    trace_id: row.trace_id,
                    parent_id: row.parent_id,
                    kind: serde_json::from_value(row.kind)?,
                    timestamp: row.timestamp,
                    metadata: serde_json::from_value(row.metadata)?,
                    causality_vector: serde_json::from_value(row.causality_vector.unwrap_or_default())?,
                    lock_set: serde_json::from_value(row.lock_set.unwrap_or_default())?,
                })
            })
            .collect()
    }

    // ... implement remaining trait methods
}
```

**Estimated Effort**: 5-7 days

### Phase 5: Implement MySQL & SQLite Backends
**Files to Create**:
- `core/src/storage/mysql.rs`
- `core/src/storage/sqlite.rs`

**Notes**:
- Very similar to PostgresBackend
- Main differences in connection strings and SQL dialect
- SQLite doesn't support concurrent writes as well (use WAL mode)

**Estimated Effort**: 3-4 days (leveraging Postgres implementation)

### Phase 6: Wire Up in Engine
**Files to Modify**:
- `core/src/engine.rs` - Accept `Arc<dyn StorageBackend>` instead of `CausalGraph`
- `core/src/storage/mod.rs` - Add factory function
- `cli/src/server.rs` - Create storage backend from config

**Example**:
```rust
// In server.rs
use raceway_core::storage::{create_storage_backend, StorageBackend};

pub async fn start_server(config: Config) -> Result<()> {
    // ... existing setup ...

    // Create storage backend based on config
    let storage: Arc<dyn StorageBackend> = create_storage_backend(&config.storage).await?;

    // Create engine with storage
    let engine = CausalEngine::new(engine_config, storage);

    // ... rest of server setup ...
}
```

**Estimated Effort**: 2-3 days

### Phase 7: Testing & Migration Tools
**Tasks**:
1. Write integration tests for each backend
2. Create data migration tool (memory → database)
3. Performance benchmarks (compare to in-memory)
4. Load testing with various backends

**Files to Create**:
- `core/tests/storage_integration.rs`
- `cli/src/commands/migrate.rs` - Data migration command
- `benches/storage_benchmark.rs`

**Estimated Effort**: 3-5 days

## Key Technical Decisions

### 1. Async Trait
Use `async-trait` for storage backend to support async database operations while maintaining clean trait interface.

### 2. JSONB for Complex Types
Store causality vectors, lock sets, and metadata as JSONB rather than normalized tables:
- **Pros**: Flexible schema, easier to evolve, good query performance with indexes
- **Cons**: Less type safety, harder to query complex relationships

### 3. Connection Pooling
Use sqlx's built-in connection pooling with configurable pool sizes:
```toml
[storage.postgres]
max_connections = 10
min_connections = 2
connection_timeout_seconds = 30
```

### 4. Optional Caching Layer
For SQL backends, optionally use MemoryBackend as a write-through cache:
- Writes go to both cache and database
- Reads hit cache first, fall back to database
- Configurable cache size and eviction policy

### 5. Batch Operations
Implement batch insert/update methods for performance:
```rust
async fn add_events_batch(&self, events: Vec<Event>) -> Result<()>;
```

### 6. Race Detection Strategy
Two approaches for SQL backends:
1. **Lazy**: Detect races on-demand using complex SQL queries
2. **Eager**: Pre-compute and store in dedicated races table (better performance)

Recommendation: Start with lazy, optimize to eager if needed.

## Migration Path for Existing Deployments

### Step 1: Default to Memory Backend
Update `raceway.toml.example` to use `backend = "memory"` - no breaking changes.

### Step 2: Add Migration Command
```bash
raceway migrate --from memory --to postgres --config raceway.toml
```

### Step 3: Gradual Rollout
1. Deploy with memory backend (default)
2. Users opt-in to database backends
3. Provide migration guide and tools

## Performance Considerations

### Expected Performance Impact
- **Memory Backend**: No change (same as current)
- **SQLite Backend**: 2-5x slower for writes, similar read performance
- **Postgres/MySQL**: 5-10x slower for writes, potentially faster for complex queries with proper indexing

### Optimization Strategies
1. **Connection Pooling**: Reuse database connections
2. **Batch Inserts**: Insert multiple events in single transaction
3. **Prepared Statements**: Cache query plans
4. **Indexing**: Proper indexes on trace_id, timestamp, variable names
5. **Caching**: Optional in-memory cache layer
6. **Async I/O**: Non-blocking database operations

## Configuration Examples

### Memory Backend (Default)
```toml
[storage]
backend = "memory"
retention_hours = 24
max_events_in_memory = 100000
```

### PostgreSQL Backend
```toml
[storage]
backend = "postgres"
retention_hours = 168  # 7 days

[storage.postgres]
connection_string = "postgres://user:password@localhost/raceway"
max_connections = 10
min_connections = 2
connection_timeout_seconds = 30
auto_migrate = true
```

### Supabase Backend
```toml
[storage]
backend = "supabase"

[storage.postgres]
connection_string = "postgres://postgres.xxxxxxxxxxxx:password@aws-0-region.pooler.supabase.com:5432/postgres"
max_connections = 10
```

### SQLite Backend
```toml
[storage]
backend = "sqlite"

[storage.sqlite]
database_path = "./raceway.db"
auto_migrate = true
```

## Total Estimated Timeline

- **Phase 1** (Storage Trait): 1-2 days
- **Phase 2** (MemoryBackend): 2-3 days
- **Phase 3** (Schema): 1-2 days
- **Phase 4** (Postgres): 5-7 days
- **Phase 5** (MySQL/SQLite): 3-4 days
- **Phase 6** (Integration): 2-3 days
- **Phase 7** (Testing): 3-5 days

**Total**: 17-26 days (3-5 weeks) for full implementation

## Success Criteria

- [ ] All storage backends pass integration tests
- [ ] Zero data loss on server restart with database backends
- [ ] Performance benchmarks show acceptable overhead (< 10x for writes)
- [ ] Migration tool successfully moves data from memory to database
- [ ] Documentation updated with configuration examples
- [ ] Supabase integration tested and working

## Future Enhancements

1. **Distributed Storage**: Add Redis/etcd backends for distributed deployments
2. **Time-Series Database**: Consider TimescaleDB for better time-series query performance
3. **Read Replicas**: Support read replicas for scaling read-heavy workloads
4. **Sharding**: Shard traces across multiple databases by trace_id
5. **Compression**: Compress old trace data for cost savings
6. **Export/Import**: Tools to export traces to JSON/Parquet for archival

---

**Document Version**: 1.0
**Last Updated**: 2025-10-16
**Status**: Ready for Implementation
