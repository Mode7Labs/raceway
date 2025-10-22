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
    async fn get_trace_events(&self, trace_id: Uuid) -> Result<Vec<Event>>;

    /// Get all events across all traces (for AnalysisService initialization)
    async fn get_all_events(&self) -> Result<Vec<Event>>;

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
    // Maintenance
    // ========================================================================

    /// Cleanup old traces beyond retention period
    async fn cleanup_old_traces(&self, retention_hours: u64) -> Result<usize>;

    /// Clear all data (useful for testing)
    async fn clear(&self) -> Result<()>;
}
