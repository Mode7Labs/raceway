use super::storage_trait::StorageBackend;
use super::types::{
    AuditTrailData, CrossTraceRace, DurationStats, TraceAnalysisData, TraceSummary, VariableAccessData,
};
use crate::config::StorageConfig;
use crate::event::{Event, EventKind};
use crate::graph::{
    Anomaly, AuditTrail, CausalGraph, CriticalPath, GraphStats, ServiceDependencies, TreeNode,
    VariableAccess,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::Row;
use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{RwLock, Mutex};
use uuid::Uuid;

/// Cached stats with expiration
#[derive(Clone)]
struct CachedStats {
    stats: GraphStats,
    cached_at: Instant,
}

/// PostgreSQL storage backend
/// Supports both standard PostgreSQL and Supabase
pub struct PostgresBackend {
    pool: PgPool,
    stats_cache: Arc<RwLock<Option<CachedStats>>>,
    stats_mutex: Arc<Mutex<()>>, // Prevents stampeding herd on cache miss
    cache_ttl: Duration,
}

impl PostgresBackend {
    async fn fetch_trace_events(&self, trace_id: Uuid) -> Result<Vec<Event>> {
        let rows = sqlx::query(
            r#"
            SELECT id, trace_id, parent_id, timestamp, kind, metadata, causality_vector, lock_set
            FROM events
            WHERE trace_id = $1
            ORDER BY timestamp ASC
            "#,
        )
        .bind(trace_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(Event {
                    id: row.try_get("id")?,
                    trace_id: row.try_get("trace_id")?,
                    parent_id: row.try_get("parent_id")?,
                    timestamp: row.try_get("timestamp")?,
                    kind: serde_json::from_value(row.try_get("kind")?)?,
                    metadata: serde_json::from_value(row.try_get("metadata")?)?,
                    causality_vector: serde_json::from_value(
                        row.try_get("causality_vector")
                            .unwrap_or(serde_json::json!([])),
                    )?,
                    lock_set: serde_json::from_value(
                        row.try_get("lock_set").unwrap_or(serde_json::json!([])),
                    )?,
                })
            })
            .collect()
    }

    async fn fetch_all_events(&self) -> Result<Vec<Event>> {
        let rows = sqlx::query(
            r#"
            SELECT id, trace_id, parent_id, timestamp, kind, metadata, causality_vector, lock_set
            FROM events
            ORDER BY timestamp ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(Event {
                    id: row.try_get("id")?,
                    trace_id: row.try_get("trace_id")?,
                    parent_id: row.try_get("parent_id")?,
                    timestamp: row.try_get("timestamp")?,
                    kind: serde_json::from_value(row.try_get("kind")?)?,
                    metadata: serde_json::from_value(row.try_get("metadata")?)?,
                    causality_vector: serde_json::from_value(
                        row.try_get("causality_vector")
                            .unwrap_or(serde_json::json!([])),
                    )?,
                    lock_set: serde_json::from_value(
                        row.try_get("lock_set").unwrap_or(serde_json::json!([])),
                    )?,
                })
            })
            .collect()
    }

    async fn build_graph_for_trace(&self, trace_id: Uuid) -> Result<(CausalGraph, Vec<Event>)> {
        let events = self.fetch_trace_events(trace_id).await?;
        let graph = CausalGraph::from_events(events.clone())?;
        Ok((graph, events))
    }

    async fn build_graph_for_all_traces(&self) -> Result<(CausalGraph, Vec<Event>)> {
        let events = self.fetch_all_events().await?;
        let graph = CausalGraph::from_events(events.clone())?;
        Ok((graph, events))
    }

    pub async fn new(config: &StorageConfig) -> Result<Self> {
        let pg_config = &config.postgres;

        let connection_string = pg_config
            .connection_string
            .as_ref()
            .ok_or_else(|| anyhow!("PostgreSQL connection string is required"))?;

        // Create connection pool
        let max_connections = pg_config.max_connections;
        let min_connections = pg_config.min_connections;
        let timeout_seconds = pg_config.connection_timeout_seconds;

        let pool = PgPoolOptions::new()
            .max_connections(max_connections)
            .min_connections(min_connections)
            .acquire_timeout(std::time::Duration::from_secs(timeout_seconds as u64))
            .connect(connection_string)
            .await?;

        // Run migrations if auto_migrate is enabled
        if pg_config.auto_migrate {
            tracing::info!("Running PostgreSQL migrations...");

            // Migration 001: Initial schema
            let migration_001 = include_str!("../../../migrations/postgres/001_initial_schema.sql");
            sqlx::raw_sql(migration_001).execute(&pool).await?;
            tracing::info!("✓ Migration 001 (initial schema) completed");

            // Migration 002: Performance indexes
            let migration_002 = include_str!("../../../migrations/postgres/002_add_performance_indexes.sql");
            sqlx::raw_sql(migration_002).execute(&pool).await?;
            tracing::info!("✓ Migration 002 (performance indexes) completed");

            tracing::info!("All migrations completed successfully");
        }

        Ok(Self {
            pool,
            stats_cache: Arc::new(RwLock::new(None)),
            stats_mutex: Arc::new(Mutex::new(())),
            cache_ttl: Duration::from_secs(5), // Cache stats for 5 seconds
        })
    }
}

#[async_trait]
impl StorageBackend for PostgresBackend {
    async fn add_event(&self, event: Event) -> Result<()> {
        // Invalidate stats cache when adding events
        {
            let mut cache = self.stats_cache.write().await;
            *cache = None;
        }

        // Serialize complex types to JSON
        let kind_json = serde_json::to_value(&event.kind)?;
        let metadata_json = serde_json::to_value(&event.metadata)?;
        let causality_vector_json = serde_json::to_value(&event.causality_vector)?;
        let lock_set_json = serde_json::to_value(&event.lock_set)?;

        sqlx::query(
            r#"
            INSERT INTO events (id, trace_id, parent_id, timestamp, kind, metadata, causality_vector, lock_set)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .bind(event.id)
        .bind(event.trace_id)
        .bind(event.parent_id)
        .bind(event.timestamp)
        .bind(kind_json)
        .bind(metadata_json)
        .bind(causality_vector_json)
        .bind(lock_set_json)
        .execute(&self.pool)
        .await?;

        // If this event has a parent, create a causal edge
        if let Some(parent_id) = event.parent_id {
            let edge_type = match &event.kind {
                EventKind::AsyncSpawn { .. } => "AsyncSpawn",
                EventKind::AsyncAwait { .. } => "AsyncAwait",
                EventKind::HttpResponse { .. } => "HttpRequestResponse",
                EventKind::DatabaseResult { .. } => "DatabaseQueryResult",
                EventKind::StateChange { .. } => "DataDependency",
                _ => "DirectCall",
            };

            sqlx::query(
                r#"
                INSERT INTO causal_edges (from_event_id, to_event_id, edge_type)
                VALUES ($1, $2, $3)
                ON CONFLICT (from_event_id, to_event_id) DO NOTHING
                "#,
            )
            .bind(parent_id)
            .bind(event.id)
            .bind(edge_type)
            .execute(&self.pool)
            .await?;
        } else {
            // This is a root event
            sqlx::query(
                r#"
                INSERT INTO trace_roots (trace_id, root_event_id)
                VALUES ($1, $2)
                ON CONFLICT (trace_id, root_event_id) DO NOTHING
                "#,
            )
            .bind(event.trace_id)
            .bind(event.id)
            .execute(&self.pool)
            .await?;
        }

        // If this is a StateChange event, add to cross-trace index
        if let EventKind::StateChange {
            variable,
            new_value,
            location,
            access_type,
            ..
        } = &event.kind
        {
            let access_type_str = format!("{:?}", access_type);
            let value_json = serde_json::to_value(new_value)?;

            sqlx::query(
                r#"
                INSERT INTO cross_trace_index (variable, event_id, trace_id, timestamp, thread_id, access_type, value, location)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (variable, event_id) DO NOTHING
                "#,
            )
            .bind(variable)
            .bind(event.id)
            .bind(event.trace_id)
            .bind(event.timestamp)
            .bind(&event.metadata.thread_id)
            .bind(access_type_str)
            .bind(value_json)
            .bind(location)
            .execute(&self.pool)
            .await?;
        }

        Ok(())
    }

    async fn get_event(&self, id: Uuid) -> Result<Option<Event>> {
        let row = sqlx::query(
            r#"
            SELECT id, trace_id, parent_id, timestamp, kind, metadata, causality_vector, lock_set
            FROM events
            WHERE id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(row) = row {
            Ok(Some(Event {
                id: row.try_get("id")?,
                trace_id: row.try_get("trace_id")?,
                parent_id: row.try_get("parent_id")?,
                timestamp: row.try_get("timestamp")?,
                kind: serde_json::from_value(row.try_get("kind")?)?,
                metadata: serde_json::from_value(row.try_get("metadata")?)?,
                causality_vector: serde_json::from_value(
                    row.try_get("causality_vector")
                        .unwrap_or(serde_json::json!([])),
                )?,
                lock_set: serde_json::from_value(
                    row.try_get("lock_set").unwrap_or(serde_json::json!([])),
                )?,
            }))
        } else {
            Ok(None)
        }
    }

    async fn get_trace_events(&self, trace_id: Uuid) -> Result<Vec<Event>> {
        self.fetch_trace_events(trace_id).await
    }

    async fn get_causal_order(&self, trace_id: Uuid) -> Result<Vec<Event>> {
        // For now, just return events in timestamp order
        // A more sophisticated implementation would do topological sort based on causal edges
        self.get_trace_events(trace_id).await
    }

    async fn get_trace_analysis_data(&self, trace_id: Uuid) -> Result<TraceAnalysisData> {
        tracing::info!(
            "get_trace_analysis_data(): Fetching data for trace {}",
            trace_id
        );
        let query_start = Instant::now();

        let (graph, events) = self.build_graph_for_trace(trace_id).await?;

        // Collect variables that changed in this trace
        let mut variables = HashSet::new();
        for event in &events {
            if let EventKind::StateChange { variable, .. } = &event.kind {
                variables.insert(variable.clone());
            }
        }

        let mut audit_trails: HashMap<String, Vec<VariableAccess>> = HashMap::new();
        for variable in variables {
            if let Ok(trail) = graph.get_audit_trail(trace_id, &variable) {
                audit_trails.insert(variable, trail.accesses);
            }
        }

        let critical_path = graph.get_critical_path(trace_id).ok();
        let anomalies = graph.detect_anomalies(trace_id).unwrap_or_default();
        let dependencies = graph.get_service_dependencies(trace_id).ok();

        tracing::info!(
            "get_trace_analysis_data(): Prepared {} events (audit trails: {}) in {:?}",
            events.len(),
            audit_trails.len(),
            query_start.elapsed()
        );

        Ok(TraceAnalysisData {
            events,
            audit_trails,
            critical_path,
            anomalies,
            dependencies,
        })
    }

    async fn get_all_trace_ids(&self) -> Result<Vec<Uuid>> {
        let rows = sqlx::query(
            r#"
            SELECT DISTINCT trace_id
            FROM events
            ORDER BY trace_id
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| row.try_get("trace_id"))
            .collect::<Result<Vec<Uuid>, _>>()?)
    }

    async fn get_trace_summaries(
        &self,
        page: usize,
        page_size: usize,
    ) -> Result<(Vec<TraceSummary>, usize)> {
        // Get total count of traces
        let total_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(DISTINCT trace_id) FROM events"
        )
        .fetch_one(&self.pool)
        .await?;

        // Calculate offset
        let offset = (page.saturating_sub(1)) * page_size;

        // Fetch paginated trace summaries
        let rows = sqlx::query(
            r#"
            SELECT
                trace_id,
                COUNT(*) as event_count,
                MIN(timestamp) as first_timestamp,
                MAX(timestamp) as last_timestamp
            FROM events
            GROUP BY trace_id
            ORDER BY MAX(timestamp) DESC
            LIMIT $1 OFFSET $2
            "#,
        )
        .bind(page_size as i64)
        .bind(offset as i64)
        .fetch_all(&self.pool)
        .await?;

        let summaries: Vec<TraceSummary> = rows
            .into_iter()
            .map(|row| {
                Ok(TraceSummary {
                    trace_id: row.try_get("trace_id")?,
                    event_count: row.try_get("event_count")?,
                    first_timestamp: row.try_get("first_timestamp")?,
                    last_timestamp: row.try_get("last_timestamp")?,
                })
            })
            .collect::<Result<Vec<_>>>()?;

        Ok((summaries, total_count as usize))
    }

    async fn get_trace_roots(&self, trace_id: Uuid) -> Result<Vec<Uuid>> {
        let events = self.fetch_trace_events(trace_id).await?;
        Ok(events
            .into_iter()
            .filter(|event| event.parent_id.is_none())
            .map(|event| event.id)
            .collect())
    }

    async fn get_trace_tree(&self, trace_id: Uuid) -> Result<Vec<TreeNode>> {
        let (graph, _) = self.build_graph_for_trace(trace_id).await?;
        graph.get_trace_tree(trace_id)
    }

    async fn find_concurrent_events(&self, trace_id: Uuid) -> Result<Vec<(Event, Event)>> {
        let (graph, _) = self.build_graph_for_trace(trace_id).await?;
        graph.find_concurrent_events(trace_id)
    }

    async fn find_global_concurrent_events(&self) -> Result<Vec<(Event, Event)>> {
        let (graph, _) = self.build_graph_for_all_traces().await?;
        graph.find_global_concurrent_events()
    }

    async fn get_cross_trace_races(&self, variable: &str) -> Result<Vec<CrossTraceRace>> {
        let concurrent = self.find_global_concurrent_events().await?;
        let mut races = Vec::new();

        for (event1, event2) in concurrent {
            if let (
                EventKind::StateChange {
                    variable: var1,
                    new_value: new1,
                    location: loc1,
                    access_type: access1,
                    ..
                },
                EventKind::StateChange {
                    variable: var2,
                    new_value: new2,
                    location: loc2,
                    access_type: access2,
                    ..
                },
            ) = (&event1.kind, &event2.kind)
            {
                if var1 == variable && var2 == variable {
                    races.push(CrossTraceRace {
                        variable: variable.to_string(),
                        event1_id: event1.id,
                        event1_trace_id: event1.trace_id,
                        event1_timestamp: event1.timestamp,
                        event1_thread_id: event1.metadata.thread_id.clone(),
                        event1_value: new1.clone(),
                        event1_location: loc1.clone(),
                        event2_id: event2.id,
                        event2_trace_id: event2.trace_id,
                        event2_timestamp: event2.timestamp,
                        event2_thread_id: event2.metadata.thread_id.clone(),
                        event2_value: new2.clone(),
                        event2_location: loc2.clone(),
                        confidence: if matches!(
                            (access1, access2),
                            (
                                crate::event::AccessType::Write,
                                crate::event::AccessType::Write
                            )
                        ) {
                            0.9
                        } else {
                            0.7
                        },
                    });
                }
            }
        }

        Ok(races)
    }

    async fn get_critical_path(&self, trace_id: Uuid) -> Result<CriticalPath> {
        let (graph, _) = self.build_graph_for_trace(trace_id).await?;
        graph.get_critical_path(trace_id)
    }

    async fn update_baselines(&self, _trace_id: Uuid) -> Result<()> {
        // TODO: Implement baseline metrics update
        Ok(())
    }

    async fn get_baseline_metric(&self, operation: &str) -> Result<Option<DurationStats>> {
        let row = sqlx::query(
            r#"
            SELECT count, total_duration_micros, min_duration_micros, max_duration_micros,
                   mean_duration_micros, variance, std_dev
            FROM baseline_metrics
            WHERE operation = $1
            "#,
        )
        .bind(operation)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| DurationStats {
            count: r.try_get::<i64, _>("count").unwrap_or(0) as usize,
            total_duration_us: r.try_get::<i64, _>("total_duration_micros").unwrap_or(0) as u64,
            min_duration_us: r.try_get::<i64, _>("min_duration_micros").unwrap_or(0) as u64,
            max_duration_us: r.try_get::<i64, _>("max_duration_micros").unwrap_or(0) as u64,
            mean_duration_us: r.try_get("mean_duration_micros").unwrap_or(0.0),
            variance: r.try_get("variance").unwrap_or(0.0),
            std_dev: r.try_get("std_dev").unwrap_or(0.0),
        }))
    }

    async fn detect_anomalies(&self, trace_id: Uuid) -> Result<Vec<Anomaly>> {
        let (graph, _) = self.build_graph_for_all_traces().await?;
        graph.detect_anomalies(trace_id)
    }

    async fn get_service_dependencies(&self, trace_id: Uuid) -> Result<ServiceDependencies> {
        let (graph, _) = self.build_graph_for_trace(trace_id).await?;
        graph.get_service_dependencies(trace_id)
    }

    async fn get_audit_trail(&self, trace_id: Uuid, variable: &str) -> Result<AuditTrail> {
        let (graph, _) = self.build_graph_for_trace(trace_id).await?;
        graph.get_audit_trail(trace_id, variable)
    }

    async fn get_audit_trail_data(&self, variable: &str) -> Result<Option<AuditTrailData>> {
        let (graph, _) = self.build_graph_for_all_traces().await?;

        for trace_id in graph.get_all_trace_ids() {
            if let Ok(trail) = graph.get_audit_trail(trace_id, variable) {
                if trail.accesses.is_empty() {
                    continue;
                }

                let race_count = trail.accesses.iter().filter(|a| a.is_race).count();
                let accesses: Vec<VariableAccessData> = trail
                    .accesses
                    .into_iter()
                    .map(|a| VariableAccessData {
                        event_id: a.event_id,
                        timestamp: a.timestamp,
                        thread_id: a.thread_id,
                        service_name: a.service_name,
                        access_type: a.access_type,
                        old_value: a.old_value,
                        new_value: a.new_value,
                        location: a.location,
                        has_causal_link_to_previous: a.has_causal_link_to_previous,
                        is_race: a.is_race,
                    })
                    .collect();

                return Ok(Some(AuditTrailData {
                    trace_id: trail.trace_id,
                    variable: trail.variable,
                    total_accesses: accesses.len(),
                    race_count,
                    accesses,
                }));
            }
        }

        Ok(None)
    }

    async fn stats(&self) -> Result<GraphStats> {
        // Fast path: Check cache first (read lock)
        {
            let cache = self.stats_cache.read().await;
            if let Some(cached) = cache.as_ref() {
                if cached.cached_at.elapsed() < self.cache_ttl {
                    tracing::debug!(
                        "stats(): Returning cached stats (age: {:?})",
                        cached.cached_at.elapsed()
                    );
                    return Ok(cached.stats.clone());
                }
            }
        }

        // Cache miss - acquire mutex to prevent stampeding herd
        let _guard = self.stats_mutex.lock().await;

        // Double-check cache (another thread might have filled it while we waited for the mutex)
        {
            let cache = self.stats_cache.read().await;
            if let Some(cached) = cache.as_ref() {
                if cached.cached_at.elapsed() < self.cache_ttl {
                    tracing::debug!(
                        "stats(): Returning cached stats after mutex wait (age: {:?})",
                        cached.cached_at.elapsed()
                    );
                    return Ok(cached.stats.clone());
                }
            }
        }

        // Cache still empty/expired, query database with single optimized query
        let query_start = Instant::now();
        tracing::info!("stats(): Cache miss, querying database (holding mutex)...");

        // Single query that fetches all stats at once
        let row = sqlx::query(
            r#"
            SELECT
                (SELECT COUNT(*) FROM events) as event_count,
                (SELECT COUNT(DISTINCT trace_id) FROM events) as trace_count,
                (SELECT COUNT(*) FROM causal_edges) as edge_count
            "#
        )
        .fetch_one(&self.pool)
        .await?;

        let event_count: i64 = row.get("event_count");
        let trace_count: i64 = row.get("trace_count");
        let edge_count: i64 = row.get("edge_count");

        tracing::info!(
            "stats(): Single query completed in {:?} (events: {}, traces: {}, edges: {})",
            query_start.elapsed(),
            event_count,
            trace_count,
            edge_count
        );

        let has_cycles = self.has_cycles().await.unwrap_or(false);

        let stats = GraphStats {
            total_events: event_count as usize,
            total_traces: trace_count as usize,
            total_edges: edge_count as usize,
            has_cycles,
        };

        // Update cache
        {
            let mut cache = self.stats_cache.write().await;
            *cache = Some(CachedStats {
                stats: stats.clone(),
                cached_at: Instant::now(),
            });
        }

        tracing::info!("stats(): Completed and cached (events: {}, traces: {}, edges: {}) - Total query time: {:?}",
            event_count, trace_count, edge_count, query_start.elapsed());
        Ok(stats)
    }

    async fn has_cycles(&self) -> Result<bool> {
        let (graph, _) = self.build_graph_for_all_traces().await?;
        Ok(graph.has_cycles())
    }

    async fn cleanup_old_traces(&self, retention_hours: u64) -> Result<usize> {
        let result = sqlx::query(
            r#"
            WITH deleted AS (
                DELETE FROM events
                WHERE created_at < NOW() - INTERVAL '1 hour' * $1
                RETURNING trace_id
            )
            SELECT COUNT(DISTINCT trace_id)::bigint as count FROM deleted
            "#,
        )
        .bind(retention_hours as i64)
        .fetch_one(&self.pool)
        .await?;

        let count: i64 = result.try_get("count").unwrap_or(0);
        Ok(count as usize)
    }

    async fn clear(&self) -> Result<()> {
        sqlx::query("TRUNCATE events, causal_edges, trace_roots, baseline_metrics, cross_trace_index, anomalies CASCADE")
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
