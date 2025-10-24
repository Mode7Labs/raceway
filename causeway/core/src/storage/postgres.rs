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

    async fn get_all_events(&self) -> Result<Vec<Event>> {
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

        // Get paginated summaries
        let offset = (page.saturating_sub(1)) * page_size;

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

        let summaries = rows
            .into_iter()
            .map(|row| TraceSummary {
                trace_id: row.get("trace_id"),
                event_count: row.get("event_count"),
                first_timestamp: row.get("first_timestamp"),
                last_timestamp: row.get("last_timestamp"),
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
            JOIN distributed_spans ds ON de.from_span = ds.span_id
            WHERE ds.trace_id = $1
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

    async fn clear(&self) -> Result<()> {
        sqlx::query("TRUNCATE events, causal_edges, trace_roots, baseline_metrics, cross_trace_index, distributed_spans, distributed_edges CASCADE")
            .execute(&self.pool)
            .await?;

        Ok(())
    }
}
