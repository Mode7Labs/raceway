use super::types::{DurationStats, TraceSummary};
use crate::event::{DistributedEdge, DistributedSpan, Event};
use anyhow::Result;
use async_trait::async_trait;
use uuid::Uuid;

/// Pure storage backend trait for CRUD operations only
/// All computation logic has been moved to AnalysisService
/// This allows pluggable backends (memory, postgres, mysql, sqlite, etc.)
#[async_trait]
pub trait StorageBackend: Send + Sync {
    // ========================================================================
    // Event Operations
    // ========================================================================

    /// Add an event to storage
    async fn add_event(&self, event: Event) -> Result<()>;

    /// Get a specific event by ID
    async fn get_event(&self, id: Uuid) -> Result<Option<Event>>;

    /// Get all events for a specific trace
    /// Events are ordered by: timestamp (primary), causality_vector.len() (secondary), id (tertiary)
    /// This ensures chronological ordering with stable sort for identical timestamps
    async fn get_trace_events(&self, trace_id: Uuid) -> Result<Vec<Event>>;

    /// Get all events across all traces (for AnalysisService initialization)
    /// Events are ordered by: timestamp (primary), causality_vector.len() (secondary), id (tertiary)
    async fn get_all_events(&self) -> Result<Vec<Event>>;

    /// Get total number of events in the system
    async fn count_events(&self) -> Result<usize>;

    /// Get total number of traces in the system
    async fn count_traces(&self) -> Result<usize>;

    // ========================================================================
    // Trace Operations
    // ========================================================================

    /// Get all trace IDs in the system
    async fn get_all_trace_ids(&self) -> Result<Vec<Uuid>>;

    /// Get paginated trace summaries with metadata
    async fn get_trace_summaries(
        &self,
        page: usize,
        page_size: usize,
    ) -> Result<(Vec<TraceSummary>, usize)>;

    /// Get paginated trace summaries filtered by service name
    async fn get_trace_summaries_by_service(
        &self,
        service_name: &str,
        page: usize,
        page_size: usize,
    ) -> Result<(Vec<TraceSummary>, usize)>;

    /// Get trace roots (entry point events) for a specific trace
    async fn get_trace_roots(&self, trace_id: Uuid) -> Result<Vec<Uuid>>;

    // ========================================================================
    // Baseline Metrics (CRUD only)
    // ========================================================================

    /// Save baseline metric for a specific operation type
    async fn save_baseline(&self, operation: &str, stats: DurationStats) -> Result<()>;

    /// Save multiple baseline metrics at once (batched for performance)
    async fn save_baselines_batch(
        &self,
        baselines: std::collections::HashMap<String, DurationStats>,
    ) -> Result<()>;

    /// Get baseline metric for a specific operation type
    async fn get_baseline_metric(&self, operation: &str) -> Result<Option<DurationStats>>;

    /// Get all operation names that have baseline metrics
    async fn get_all_baseline_operations(&self) -> Result<Vec<String>>;

    // ========================================================================
    // Distributed Tracing (Phase 2)
    // ========================================================================

    /// Add or update a distributed span
    async fn save_distributed_span(&self, span: DistributedSpan) -> Result<()>;

    /// Get a distributed span by span_id
    async fn get_distributed_span(&self, span_id: &str) -> Result<Option<DistributedSpan>>;

    /// Get all distributed spans for a trace
    async fn get_distributed_spans(&self, trace_id: Uuid) -> Result<Vec<DistributedSpan>>;

    /// Add a distributed edge (link between spans)
    async fn add_distributed_edge(&self, edge: DistributedEdge) -> Result<()>;

    /// Get all distributed edges for a trace
    async fn get_distributed_edges(&self, trace_id: Uuid) -> Result<Vec<DistributedEdge>>;

    // ========================================================================
    // Service Catalog & Dependencies (Phase 3 - Optimized Queries)
    // ========================================================================

    /// Get aggregated service statistics across all traces
    /// Returns (service_name, event_count, trace_count) tuples
    async fn get_all_services(&self) -> Result<Vec<(String, usize, usize)>>;

    /// Get service dependencies for a specific service across all traces
    /// Returns (calls_to, called_by) where each is a Vec of (service_name, total_calls, trace_count)
    async fn get_service_dependencies_global(
        &self,
        service_name: &str,
    ) -> Result<(Vec<(String, usize, usize)>, Vec<(String, usize, usize)>)>;

    // ========================================================================
    // Global System Analysis (Phase 4 - Cross-Trace Insights)
    // ========================================================================

    /// Get all distributed edges with service names resolved
    /// Returns Vec of (from_service, to_service, link_type, call_count)
    async fn get_all_distributed_edges(&self) -> Result<Vec<serde_json::Value>>;

    /// Get global race candidates from cross_trace_index
    /// Returns variables with concurrent access across traces
    async fn get_global_race_candidates(&self) -> Result<Vec<serde_json::Value>>;

    /// Get system hotspots - most accessed variables and busiest service calls
    /// Returns (top_variables, top_service_calls)
    async fn get_system_hotspots(&self)
        -> Result<(Vec<serde_json::Value>, Vec<serde_json::Value>)>;

    /// Get service health metrics
    /// Returns health status for all services including last activity and trace counts
    async fn get_service_health(&self, time_window_minutes: u64) -> Result<Vec<serde_json::Value>>;

    /// Get performance metrics across the system
    /// Returns aggregated performance data including latencies, throughput, and event metrics
    async fn get_performance_metrics(&self, limit: usize) -> Result<serde_json::Value>;

    // ========================================================================
    // Maintenance
    // ========================================================================

    /// Cleanup old traces beyond retention period
    async fn cleanup_old_traces(&self, retention_hours: u64) -> Result<usize>;

    /// Clear all data (useful for testing)
    async fn clear(&self) -> Result<()>;
}
