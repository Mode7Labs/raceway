use super::storage_trait::StorageBackend;
use super::types::{DurationStats, TraceSummary};
use crate::config::StorageConfig;
use crate::event::{DistributedEdge, DistributedSpan, Event, EventKind};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::Row;
use uuid::Uuid;

/// Pure PostgreSQL storage backend (CRUD operations only)
/// Supports both standard PostgreSQL and Supabase
pub struct PostgresBackend {
    pool: PgPool,
}

impl PostgresBackend {
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
            let migration_002 =
                include_str!("../../../migrations/postgres/002_add_performance_indexes.sql");
            sqlx::raw_sql(migration_002).execute(&pool).await?;
            tracing::info!("✓ Migration 002 (performance indexes) completed");

            // Migration 003: Distributed tracing
            let migration_003 =
                include_str!("../../../migrations/postgres/003_distributed_tracing.sql");
            sqlx::raw_sql(migration_003).execute(&pool).await?;
            tracing::info!("✓ Migration 003 (distributed tracing) completed");

            tracing::info!("All migrations completed successfully");
        }

        Ok(Self { pool })
    }
}

#[async_trait]
impl StorageBackend for PostgresBackend {
    async fn add_event(&self, event: Event) -> Result<()> {
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
        let rows = sqlx::query(
            r#"
            SELECT id, trace_id, parent_id, timestamp, kind, metadata, causality_vector, lock_set
            FROM events
            WHERE trace_id = $1
            ORDER BY timestamp ASC,
                     array_length(causality_vector, 1) ASC NULLS FIRST,
                     id ASC
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

    async fn get_all_events(&self) -> Result<Vec<Event>> {
        let rows = sqlx::query(
            r#"
            SELECT id, trace_id, parent_id, timestamp, kind, metadata, causality_vector, lock_set
            FROM events
            ORDER BY timestamp ASC,
                     array_length(causality_vector, 1) ASC NULLS FIRST,
                     id ASC
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

    async fn count_events(&self) -> Result<usize> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events")
            .fetch_one(&self.pool)
            .await?;
        Ok(count as usize)
    }

    async fn count_traces(&self) -> Result<usize> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(DISTINCT trace_id) FROM events")
            .fetch_one(&self.pool)
            .await?;
        Ok(count as usize)
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

        Ok(rows.into_iter().map(|row| row.get("trace_id")).collect())
    }

    async fn get_trace_summaries(
        &self,
        page: usize,
        page_size: usize,
    ) -> Result<(Vec<TraceSummary>, usize)> {
        // Get total count
        let count_row = sqlx::query(
            r#"
            SELECT COUNT(DISTINCT trace_id) as total
            FROM events
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        let total_count: i64 = count_row.get("total");

        // Get paginated summaries with optimized query
        // Pre-aggregate services in a subquery to avoid expensive ARRAY_AGG in main query
        let offset = (page.saturating_sub(1)) * page_size;

        let rows = sqlx::query(
            r#"
            SELECT
                e.trace_id,
                COUNT(DISTINCT e.id) as event_count,
                MIN(e.timestamp) as first_timestamp,
                MAX(e.timestamp) as last_timestamp,
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
            "#,
        )
        .bind(page_size as i64)
        .bind(offset as i64)
        .fetch_all(&self.pool)
        .await?;

        let summaries = rows
            .into_iter()
            .map(|row| {
                let services: Vec<String> = row.get("services");
                let service_count: i64 = row.get("service_count");
                TraceSummary {
                    trace_id: row.get("trace_id"),
                    event_count: row.get("event_count"),
                    first_timestamp: row.get("first_timestamp"),
                    last_timestamp: row.get("last_timestamp"),
                    services,
                    service_count: service_count as usize,
                }
            })
            .collect();

        Ok((summaries, total_count as usize))
    }

    async fn get_trace_summaries_by_service(
        &self,
        service_name: &str,
        page: usize,
        page_size: usize,
    ) -> Result<(Vec<TraceSummary>, usize)> {
        // Get total count of traces containing this service
        let count_row = sqlx::query(
            r#"
            SELECT COUNT(DISTINCT e.trace_id) as total
            FROM events e
            JOIN distributed_spans s ON e.trace_id = s.trace_id
            WHERE s.service = $1
            "#,
        )
        .bind(service_name)
        .fetch_one(&self.pool)
        .await?;

        let total_count: i64 = count_row.get("total");

        // Get paginated summaries filtered by service with optimized query
        // Pre-aggregate services in a subquery to avoid expensive ARRAY_AGG in main query
        let offset = (page.saturating_sub(1)) * page_size;

        let rows = sqlx::query(
            r#"
            SELECT
                e.trace_id,
                COUNT(DISTINCT e.id) as event_count,
                MIN(e.timestamp) as first_timestamp,
                MAX(e.timestamp) as last_timestamp,
                COALESCE(ds.services, ARRAY[]::TEXT[]) as services,
                COALESCE(ds.service_count, 0) as service_count
            FROM events e
            JOIN distributed_spans s ON e.trace_id = s.trace_id
            LEFT JOIN (
                SELECT
                    trace_id,
                    ARRAY_AGG(DISTINCT service ORDER BY service) as services,
                    COUNT(DISTINCT service) as service_count
                FROM distributed_spans
                GROUP BY trace_id
            ) ds ON e.trace_id = ds.trace_id
            WHERE s.service = $1
            GROUP BY e.trace_id, ds.services, ds.service_count
            ORDER BY MAX(e.timestamp) DESC
            LIMIT $2 OFFSET $3
            "#,
        )
        .bind(service_name)
        .bind(page_size as i64)
        .bind(offset as i64)
        .fetch_all(&self.pool)
        .await?;

        let summaries = rows
            .into_iter()
            .map(|row| {
                let services: Vec<String> = row.get("services");
                let service_count: i64 = row.get("service_count");
                TraceSummary {
                    trace_id: row.get("trace_id"),
                    event_count: row.get("event_count"),
                    first_timestamp: row.get("first_timestamp"),
                    last_timestamp: row.get("last_timestamp"),
                    services,
                    service_count: service_count as usize,
                }
            })
            .collect();

        Ok((summaries, total_count as usize))
    }

    async fn get_trace_roots(&self, trace_id: Uuid) -> Result<Vec<Uuid>> {
        let rows = sqlx::query(
            r#"
            SELECT root_event_id
            FROM trace_roots
            WHERE trace_id = $1
            "#,
        )
        .bind(trace_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| row.get("root_event_id"))
            .collect())
    }

    async fn save_baseline(&self, operation: &str, stats: DurationStats) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO baseline_metrics (
                operation, count, total_duration_micros, min_duration_micros,
                max_duration_micros, mean_duration_micros, variance, std_dev
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (operation) DO UPDATE SET
                count = EXCLUDED.count,
                total_duration_micros = EXCLUDED.total_duration_micros,
                min_duration_micros = EXCLUDED.min_duration_micros,
                max_duration_micros = EXCLUDED.max_duration_micros,
                mean_duration_micros = EXCLUDED.mean_duration_micros,
                variance = EXCLUDED.variance,
                std_dev = EXCLUDED.std_dev,
                updated_at = NOW()
            "#,
        )
        .bind(operation)
        .bind(stats.count as i64)
        .bind(stats.total_duration_us as i64)
        .bind(stats.min_duration_us as i64)
        .bind(stats.max_duration_us as i64)
        .bind(stats.mean_duration_us)
        .bind(stats.variance)
        .bind(stats.std_dev)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn save_baselines_batch(
        &self,
        baselines: std::collections::HashMap<String, DurationStats>,
    ) -> Result<()> {
        // Use a transaction for batched inserts
        let mut tx = self.pool.begin().await?;

        for (operation, stats) in baselines {
            sqlx::query(
                r#"
                INSERT INTO baseline_metrics (
                    operation, count, total_duration_micros, min_duration_micros,
                    max_duration_micros, mean_duration_micros, variance, std_dev
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (operation) DO UPDATE SET
                    count = EXCLUDED.count,
                    total_duration_micros = EXCLUDED.total_duration_micros,
                    min_duration_micros = EXCLUDED.min_duration_micros,
                    max_duration_micros = EXCLUDED.max_duration_micros,
                    mean_duration_micros = EXCLUDED.mean_duration_micros,
                    variance = EXCLUDED.variance,
                    std_dev = EXCLUDED.std_dev,
                    updated_at = NOW()
                "#,
            )
            .bind(&operation)
            .bind(stats.count as i64)
            .bind(stats.total_duration_us as i64)
            .bind(stats.min_duration_us as i64)
            .bind(stats.max_duration_us as i64)
            .bind(stats.mean_duration_us)
            .bind(stats.variance)
            .bind(stats.std_dev)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
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

    async fn get_all_baseline_operations(&self) -> Result<Vec<String>> {
        let rows = sqlx::query(
            r#"
            SELECT operation
            FROM baseline_metrics
            ORDER BY operation
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(|row| row.get("operation")).collect())
    }

    async fn save_distributed_span(&self, span: DistributedSpan) -> Result<()> {
        let span_json = serde_json::to_value(&span)?;

        sqlx::query(
            r#"
            INSERT INTO distributed_spans (trace_id, span_id, service, instance, first_event, last_event, span_data)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (span_id) DO UPDATE SET
                last_event = EXCLUDED.last_event,
                span_data = EXCLUDED.span_data
            "#,
        )
        .bind(span.trace_id)
        .bind(&span.span_id)
        .bind(&span.service)
        .bind(&span.instance)
        .bind(span.first_event)
        .bind(span.last_event)
        .bind(span_json)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn get_distributed_span(&self, span_id: &str) -> Result<Option<DistributedSpan>> {
        let row = sqlx::query(
            r#"
            SELECT span_data
            FROM distributed_spans
            WHERE span_id = $1
            "#,
        )
        .bind(span_id)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(row) = row {
            let span_json: serde_json::Value = row.get("span_data");
            let span: DistributedSpan = serde_json::from_value(span_json)?;
            Ok(Some(span))
        } else {
            Ok(None)
        }
    }

    async fn get_distributed_spans(&self, trace_id: Uuid) -> Result<Vec<DistributedSpan>> {
        let rows = sqlx::query(
            r#"
            SELECT span_data
            FROM distributed_spans
            WHERE trace_id = $1
            ORDER BY first_event
            "#,
        )
        .bind(trace_id)
        .fetch_all(&self.pool)
        .await?;

        let mut spans = Vec::new();
        for row in rows {
            let span_json: serde_json::Value = row.get("span_data");
            let span: DistributedSpan = serde_json::from_value(span_json)?;
            spans.push(span);
        }

        Ok(spans)
    }

    async fn add_distributed_edge(&self, edge: DistributedEdge) -> Result<()> {
        let edge_json = serde_json::to_value(&edge)?;
        let link_type_str = format!("{:?}", edge.link_type);

        sqlx::query(
            r#"
            INSERT INTO distributed_edges (from_span, to_span, link_type, edge_data)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (from_span, to_span) DO NOTHING
            "#,
        )
        .bind(&edge.from_span)
        .bind(&edge.to_span)
        .bind(link_type_str)
        .bind(edge_json)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn get_distributed_edges(&self, trace_id: Uuid) -> Result<Vec<DistributedEdge>> {
        let rows = sqlx::query(
            r#"
            SELECT de.edge_data
            FROM distributed_edges de
            LEFT JOIN distributed_spans ds_from ON de.from_span = ds_from.span_id
            LEFT JOIN distributed_spans ds_to ON de.to_span = ds_to.span_id
            WHERE (ds_from.trace_id = $1) OR (ds_to.trace_id = $1)
            "#,
        )
        .bind(trace_id)
        .fetch_all(&self.pool)
        .await?;

        let mut edges = Vec::new();
        for row in rows {
            let edge_json: serde_json::Value = row.get("edge_data");
            let edge: DistributedEdge = serde_json::from_value(edge_json)?;
            edges.push(edge);
        }

        Ok(edges)
    }

    async fn cleanup_old_traces(&self, retention_hours: u64) -> Result<usize> {
        let result = sqlx::query(
            r#"
            WITH deleted AS (
                DELETE FROM events
                WHERE timestamp < NOW() - INTERVAL '1 hour' * $1
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

    async fn get_all_services(&self) -> Result<Vec<(String, usize, usize)>> {
        // Optimized query using distributed_spans table
        // Counts total events and distinct traces per service
        let rows = sqlx::query(
            r#"
            SELECT
                ds.service,
                COUNT(e.id)::bigint as event_count,
                COUNT(DISTINCT ds.trace_id)::bigint as trace_count
            FROM distributed_spans ds
            LEFT JOIN events e ON e.trace_id = ds.trace_id
                AND e.metadata->>'service_name' = ds.service
            GROUP BY ds.service
            ORDER BY ds.service
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let mut services = Vec::new();
        for row in rows {
            let service_name: String = row.try_get("service")?;
            let event_count: i64 = row.try_get("event_count").unwrap_or(0);
            let trace_count: i64 = row.try_get("trace_count").unwrap_or(0);
            services.push((service_name, event_count as usize, trace_count as usize));
        }

        Ok(services)
    }

    async fn get_service_dependencies_global(
        &self,
        service_name: &str,
    ) -> Result<(Vec<(String, usize, usize)>, Vec<(String, usize, usize)>)> {
        // Optimized query for "calls_to" - services this service calls
        let calls_to_rows = sqlx::query(
            r#"
            SELECT
                ds_to.service as to_service,
                COUNT(de.from_span)::bigint as total_calls,
                COUNT(DISTINCT ds_from.trace_id)::bigint as trace_count
            FROM distributed_edges de
            JOIN distributed_spans ds_from ON de.from_span = ds_from.span_id
            JOIN distributed_spans ds_to ON de.to_span = ds_to.span_id
            WHERE ds_from.service = $1
                AND ds_from.service != ds_to.service
            GROUP BY ds_to.service
            ORDER BY total_calls DESC
            "#,
        )
        .bind(service_name)
        .fetch_all(&self.pool)
        .await?;

        let mut calls_to = Vec::new();
        for row in calls_to_rows {
            let to_service: String = row.try_get("to_service")?;
            let total_calls: i64 = row.try_get("total_calls").unwrap_or(0);
            let trace_count: i64 = row.try_get("trace_count").unwrap_or(0);
            calls_to.push((to_service, total_calls as usize, trace_count as usize));
        }

        // Optimized query for "called_by" - services that call this service
        let called_by_rows = sqlx::query(
            r#"
            SELECT
                ds_from.service as from_service,
                COUNT(de.from_span)::bigint as total_calls,
                COUNT(DISTINCT ds_from.trace_id)::bigint as trace_count
            FROM distributed_edges de
            JOIN distributed_spans ds_from ON de.from_span = ds_from.span_id
            JOIN distributed_spans ds_to ON de.to_span = ds_to.span_id
            WHERE ds_to.service = $1
                AND ds_from.service != ds_to.service
            GROUP BY ds_from.service
            ORDER BY total_calls DESC
            "#,
        )
        .bind(service_name)
        .fetch_all(&self.pool)
        .await?;

        let mut called_by = Vec::new();
        for row in called_by_rows {
            let from_service: String = row.try_get("from_service")?;
            let total_calls: i64 = row.try_get("total_calls").unwrap_or(0);
            let trace_count: i64 = row.try_get("trace_count").unwrap_or(0);
            called_by.push((from_service, total_calls as usize, trace_count as usize));
        }

        Ok((calls_to, called_by))
    }

    async fn get_all_distributed_edges(&self) -> Result<Vec<serde_json::Value>> {
        let rows = sqlx::query(
            r#"
            SELECT
              ds_from.service as from_service,
              ds_to.service as to_service,
              de.link_type,
              COUNT(*) as call_count
            FROM distributed_edges de
            JOIN distributed_spans ds_from ON de.from_span = ds_from.span_id
            JOIN distributed_spans ds_to ON de.to_span = ds_to.span_id
            GROUP BY ds_from.service, ds_to.service, de.link_type
            ORDER BY call_count DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let mut edges = Vec::new();
        for row in rows {
            edges.push(serde_json::json!({
                "from_service": row.try_get::<String, _>("from_service")?,
                "to_service": row.try_get::<String, _>("to_service")?,
                "link_type": row.try_get::<String, _>("link_type")?,
                "call_count": row.try_get::<i64, _>("call_count")? as usize,
            }));
        }

        Ok(edges)
    }

    async fn get_global_race_candidates(&self) -> Result<Vec<serde_json::Value>> {
        let rows = sqlx::query(
            r#"
            SELECT
              variable,
              COUNT(DISTINCT trace_id) as trace_count,
              COUNT(*) as access_count,
              array_agg(DISTINCT access_type) as access_types,
              COUNT(DISTINCT thread_id) as thread_count,
              array_agg(DISTINCT trace_id::text) as trace_ids
            FROM cross_trace_index
            GROUP BY variable
            HAVING COUNT(DISTINCT trace_id) > 1 OR COUNT(DISTINCT thread_id) > 1
            ORDER BY trace_count DESC, access_count DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let mut races = Vec::new();
        for row in rows {
            let access_types: Vec<String> = row.try_get("access_types")?;
            let trace_ids: Vec<String> = row.try_get("trace_ids")?;
            let thread_count: i64 = row.try_get("thread_count")?;

            // Check for any write-type operations (Write, AtomicWrite, AtomicRMW)
            let has_write = access_types
                .iter()
                .any(|t| t == "Write" || t == "AtomicWrite" || t == "AtomicRMW");
            let has_read = access_types
                .iter()
                .any(|t| t == "Read" || t == "AtomicRead");

            // Determine severity based on access patterns
            let severity = if has_write && has_read {
                // Mix of reads and writes = read-write race
                "WARNING"
            } else if has_write && thread_count > 1 {
                // Multiple threads writing (no reads) = write-write race
                "CRITICAL"
            } else if has_write {
                // Single thread writing
                "WARNING"
            } else {
                // Only reads
                "INFO"
            };

            races.push(serde_json::json!({
                "variable": row.try_get::<String, _>("variable")?,
                "trace_count": row.try_get::<i64, _>("trace_count")? as usize,
                "access_count": row.try_get::<i64, _>("access_count")? as usize,
                "access_types": access_types,
                "thread_count": row.try_get::<i64, _>("thread_count")? as usize,
                "severity": severity,
                "trace_ids": trace_ids,
            }));
        }

        Ok(races)
    }

    async fn get_system_hotspots(
        &self,
    ) -> Result<(Vec<serde_json::Value>, Vec<serde_json::Value>)> {
        // Top variables by access count
        let variable_rows = sqlx::query(
            r#"
            SELECT
              cti.variable,
              COUNT(*) as access_count,
              COUNT(DISTINCT cti.trace_id) as trace_count,
              array_agg(DISTINCT e.metadata->>'service_name') as services
            FROM cross_trace_index cti
            JOIN events e ON cti.event_id = e.id
            WHERE e.metadata->>'service_name' IS NOT NULL
            GROUP BY cti.variable
            ORDER BY access_count DESC
            LIMIT 10
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let mut top_variables = Vec::new();
        for row in variable_rows {
            let services: Vec<String> = row.try_get("services")?;
            top_variables.push(serde_json::json!({
                "variable": row.try_get::<String, _>("variable")?,
                "access_count": row.try_get::<i64, _>("access_count")? as usize,
                "trace_count": row.try_get::<i64, _>("trace_count")? as usize,
                "services": services,
            }));
        }

        // Top service calls by frequency
        let service_rows = sqlx::query(
            r#"
            SELECT
              ds_from.service as from_service,
              ds_to.service as to_service,
              COUNT(*) as call_count
            FROM distributed_edges de
            JOIN distributed_spans ds_from ON de.from_span = ds_from.span_id
            JOIN distributed_spans ds_to ON de.to_span = ds_to.span_id
            GROUP BY ds_from.service, ds_to.service
            ORDER BY call_count DESC
            LIMIT 10
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let mut top_service_calls = Vec::new();
        for row in service_rows {
            top_service_calls.push(serde_json::json!({
                "from_service": row.try_get::<String, _>("from_service")?,
                "to_service": row.try_get::<String, _>("to_service")?,
                "call_count": row.try_get::<i64, _>("call_count")? as usize,
            }));
        }

        Ok((top_variables, top_service_calls))
    }

    async fn get_service_health(&self, time_window_minutes: u64) -> Result<Vec<serde_json::Value>> {
        let rows = sqlx::query(
            r#"
            SELECT
                s.service as service_name,
                COUNT(DISTINCT CASE WHEN e.timestamp > NOW() - INTERVAL '1 minute' * $1 THEN e.trace_id END) as trace_count,
                MAX(e.timestamp) as last_activity,
                CAST(COALESCE(AVG(trace_events.event_count), 0) AS DOUBLE PRECISION) as avg_events_per_trace,
                CAST(EXTRACT(EPOCH FROM (NOW() - COALESCE(MAX(e.timestamp), NOW()))) / 60.0 AS DOUBLE PRECISION) as minutes_since_last_activity
            FROM distributed_spans s
            LEFT JOIN events e ON s.trace_id = e.trace_id
            LEFT JOIN (
                SELECT trace_id, COUNT(*) as event_count
                FROM events
                WHERE timestamp > NOW() - INTERVAL '1 minute' * $1
                GROUP BY trace_id
            ) trace_events ON e.trace_id = trace_events.trace_id AND e.timestamp > NOW() - INTERVAL '1 minute' * $1
            GROUP BY s.service
            ORDER BY s.service
            "#,
        )
        .bind(time_window_minutes as i64)
        .fetch_all(&self.pool)
        .await?;

        let mut services = Vec::new();
        for row in rows {
            let minutes_since: f64 = row.try_get("minutes_since_last_activity")?;
            let status = if minutes_since < 5.0 {
                "healthy"
            } else if minutes_since < 30.0 {
                "warning"
            } else {
                "critical"
            };

            // Get last_activity, handling NULL case
            let last_activity =
                row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_activity")?;

            services.push(serde_json::json!({
                "name": row.try_get::<String, _>("service_name")?,
                "status": status,
                "trace_count": row.try_get::<i64, _>("trace_count")? as usize,
                "last_activity": last_activity.unwrap_or_else(chrono::Utc::now),
                "avg_events_per_trace": row.try_get::<f64, _>("avg_events_per_trace")?,
                "minutes_since_last_activity": minutes_since,
            }));
        }

        Ok(services)
    }

    async fn get_performance_metrics(&self, limit: usize) -> Result<serde_json::Value> {
        // Get trace durations and calculate percentiles
        let trace_rows = sqlx::query(
            r#"
            SELECT
                e.trace_id,
                CAST(EXTRACT(EPOCH FROM (MAX(e.timestamp) - MIN(e.timestamp))) * 1000.0 AS DOUBLE PRECISION) as duration_ms,
                array_agg(DISTINCT s.service) FILTER (WHERE s.service IS NOT NULL) as services
            FROM events e
            LEFT JOIN distributed_spans s ON e.trace_id = s.trace_id
            GROUP BY e.trace_id
            ORDER BY duration_ms DESC
            LIMIT $1
            "#,
        )
        .bind(limit as i64)
        .fetch_all(&self.pool)
        .await?;

        let mut trace_durations: Vec<f64> = Vec::new();
        let mut slowest_traces = Vec::new();

        for row in trace_rows {
            let duration: f64 = row.try_get("duration_ms")?;
            let trace_id: Uuid = row.try_get("trace_id")?;
            let services: Vec<String> = row.try_get("services").unwrap_or_default();

            trace_durations.push(duration);
            slowest_traces.push(serde_json::json!({
                "trace_id": trace_id.to_string(),
                "duration_ms": duration,
                "services": services,
            }));
        }

        // Calculate percentiles using PostgreSQL
        let percentile_row = sqlx::query(
            r#"
            SELECT
                CAST(AVG(duration_ms) AS DOUBLE PRECISION) as avg_duration,
                CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) AS DOUBLE PRECISION) as p50,
                CAST(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS DOUBLE PRECISION) as p95,
                CAST(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms) AS DOUBLE PRECISION) as p99
            FROM (
                SELECT
                    CAST(EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) * 1000.0 AS DOUBLE PRECISION) as duration_ms
                FROM events
                GROUP BY trace_id
            ) durations
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        let avg_duration: f64 = percentile_row.try_get("avg_duration").unwrap_or(0.0);
        let p50: f64 = percentile_row.try_get("p50").unwrap_or(0.0);
        let p95: f64 = percentile_row.try_get("p95").unwrap_or(0.0);
        let p99: f64 = percentile_row.try_get("p99").unwrap_or(0.0);

        // Event type performance
        let event_type_rows = sqlx::query(
            r#"
            WITH event_types AS (
                SELECT
                    jsonb_object_keys(kind) as event_type,
                    CAST(metadata->>'duration_ns' AS BIGINT) as duration_ns
                FROM events
                WHERE metadata->>'duration_ns' IS NOT NULL
                  AND CAST(metadata->>'duration_ns' AS BIGINT) > 0
            )
            SELECT
                event_type,
                COUNT(*) as count,
                CAST(AVG(duration_ns / 1000000.0) AS DOUBLE PRECISION) as avg_duration_ms
            FROM event_types
            GROUP BY event_type
            ORDER BY avg_duration_ms DESC
            LIMIT 20
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let mut event_types = Vec::new();
        for row in event_type_rows {
            event_types.push(serde_json::json!({
                "type": row.try_get::<String, _>("event_type")?,
                "count": row.try_get::<i64, _>("count")? as usize,
                "avg_duration_ms": row.try_get::<f64, _>("avg_duration_ms").unwrap_or(0.0),
            }));
        }

        // Service latency
        let service_rows = sqlx::query(
            r#"
            SELECT
                s.service,
                COUNT(DISTINCT e.id) as event_count,
                CAST(AVG(CAST(e.metadata->>'duration_ns' AS BIGINT) / 1000000.0) AS DOUBLE PRECISION) as avg_duration_ms
            FROM distributed_spans s
            JOIN events e ON s.trace_id = e.trace_id
            WHERE e.metadata->>'duration_ns' IS NOT NULL
            GROUP BY s.service
            ORDER BY avg_duration_ms DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let mut service_latency = Vec::new();
        for row in service_rows {
            service_latency.push(serde_json::json!({
                "service": row.try_get::<String, _>("service")?,
                "event_count": row.try_get::<i64, _>("event_count")? as usize,
                "avg_duration_ms": row.try_get::<f64, _>("avg_duration_ms").unwrap_or(0.0),
            }));
        }

        // Throughput metrics
        let throughput_row = sqlx::query(
            r#"
            SELECT
                COUNT(DISTINCT id) as total_events,
                COUNT(DISTINCT trace_id) as total_traces,
                CAST(EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) AS DOUBLE PRECISION) as time_range_seconds
            FROM events
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        let total_events: i64 = throughput_row.try_get("total_events").unwrap_or(0);
        let total_traces: i64 = throughput_row.try_get("total_traces").unwrap_or(0);
        let time_range: f64 = throughput_row.try_get("time_range_seconds").unwrap_or(1.0);

        let events_per_second = if time_range > 0.0 {
            total_events as f64 / time_range
        } else {
            0.0
        };

        let traces_per_second = if time_range > 0.0 {
            total_traces as f64 / time_range
        } else {
            0.0
        };

        Ok(serde_json::json!({
            "trace_latency": {
                "avg_ms": avg_duration,
                "p50_ms": p50,
                "p95_ms": p95,
                "p99_ms": p99,
                "slowest_traces": slowest_traces,
            },
            "event_performance": {
                "by_type": event_types,
            },
            "service_latency": service_latency,
            "throughput": {
                "events_per_second": events_per_second,
                "traces_per_second": traces_per_second,
                "time_range_seconds": time_range,
            },
        }))
    }

    async fn clear(&self) -> Result<()> {
        sqlx::query("TRUNCATE events, causal_edges, trace_roots, baseline_metrics, cross_trace_index, distributed_spans, distributed_edges CASCADE")
            .execute(&self.pool)
            .await?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::StorageConfig;
    use crate::event::{AccessType, EventKind, EventMetadata};
    use chrono::{TimeZone, Utc};
    use serde_json::json;
    use std::collections::HashMap;

    fn make_state_change_event(
        trace_id: Uuid,
        thread_id: &str,
        service: &str,
        access_type: AccessType,
        variable: &str,
        timestamp: chrono::DateTime<Utc>,
    ) -> Event {
        Event {
            id: Uuid::new_v4(),
            trace_id,
            parent_id: None,
            timestamp,
            kind: EventKind::StateChange {
                variable: variable.to_string(),
                old_value: Some(json!(123)),
                new_value: json!(456),
                location: "test.rs:1".to_string(),
                access_type,
            },
            metadata: EventMetadata {
                thread_id: thread_id.to_string(),
                process_id: 1,
                service_name: service.to_string(),
                environment: "test".to_string(),
                tags: HashMap::new(),
                duration_ns: Some(1),
                instance_id: None,
                distributed_span_id: None,
                upstream_span_id: None,
            },
            causality_vector: Vec::new(),
            lock_set: Vec::new(),
        }
    }

    #[tokio::test]
    async fn postgres_backend_distributed_insights() -> Result<()> {
        let url = match std::env::var("RACEWAY_TEST_PG_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping postgres_backend_distributed_insights (set RACEWAY_TEST_PG_URL to run)");
                return Ok(());
            }
        };

        let mut storage_config = StorageConfig::default();
        storage_config.backend = "postgres".to_string();
        storage_config.postgres.connection_string = Some(url);
        storage_config.postgres.auto_migrate = true;

        let backend = PostgresBackend::new(&storage_config).await?;
        backend.clear().await?;

        let now = Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap();

        let trace_a = Uuid::new_v4();
        let trace_b = Uuid::new_v4();

        let span_a = DistributedSpan {
            trace_id: trace_a,
            span_id: "span-a".to_string(),
            service: "service-a".to_string(),
            instance: "inst-a".to_string(),
            first_event: now,
            last_event: Some(now),
        };
        let span_b = DistributedSpan {
            trace_id: trace_a,
            span_id: "span-b".to_string(),
            service: "service-b".to_string(),
            instance: "inst-b".to_string(),
            first_event: now,
            last_event: Some(now),
        };

        backend.save_distributed_span(span_a.clone()).await?;
        backend.save_distributed_span(span_b.clone()).await?;

        backend
            .add_distributed_edge(DistributedEdge {
                from_span: span_a.span_id.clone(),
                to_span: span_b.span_id.clone(),
                link_type: crate::event::EdgeLinkType::HttpCall,
                metadata: json!({}),
            })
            .await?;

        backend
            .add_event(make_state_change_event(
                trace_a,
                "thread-1",
                "service-a",
                AccessType::Write,
                "account.balance",
                now,
            ))
            .await?;

        backend
            .add_event(make_state_change_event(
                trace_b,
                "thread-2",
                "service-b",
                AccessType::Read,
                "account.balance",
                now + chrono::Duration::milliseconds(1),
            ))
            .await?;

        let edges = backend.get_all_distributed_edges().await?;
        assert!(!edges.is_empty());
        assert_eq!(edges[0]["from_service"], json!("service-a"));
        assert_eq!(edges[0]["to_service"], json!("service-b"));
        assert_eq!(edges[0]["call_count"].as_u64().unwrap(), 1);

        let races = backend.get_global_race_candidates().await?;
        assert!(!races.is_empty());
        let race = &races[0];
        assert_eq!(race["variable"], json!("account.balance"));
        assert_eq!(race["severity"], json!("WARNING"));

        let (top_variables, top_service_calls) = backend.get_system_hotspots().await?;
        assert!(!top_variables.is_empty());
        assert!(!top_service_calls.is_empty());

        backend.clear().await?;
        Ok(())
    }
}
