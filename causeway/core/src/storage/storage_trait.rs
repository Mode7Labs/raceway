use super::types::{AuditTrailData, CrossTraceRace, DurationStats, TraceAnalysisData, TraceSummary};
use crate::event::Event;
use crate::graph::{Anomaly, AuditTrail, CriticalPath, GraphStats, ServiceDependencies, TreeNode};
use anyhow::Result;
use async_trait::async_trait;
use uuid::Uuid;

/// Storage backend trait that all storage implementations must implement
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

    /// Get all events in causal (topological) order for a trace
    async fn get_causal_order(&self, trace_id: Uuid) -> Result<Vec<Event>>;

    /// Batch fetch all data needed for trace analysis (events + audit trails)
    /// This is optimized to minimize database round-trips
    async fn get_trace_analysis_data(&self, trace_id: Uuid) -> Result<TraceAnalysisData>;

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

    /// Build a hierarchical tree view of events for a trace
    async fn get_trace_tree(&self, trace_id: Uuid) -> Result<Vec<TreeNode>>;

    // ========================================================================
    // Race Detection
    // ========================================================================

    /// Find concurrent events (potential races) within a single trace
    async fn find_concurrent_events(&self, trace_id: Uuid) -> Result<Vec<(Event, Event)>>;

    /// Find concurrent events across ALL traces (global race detection)
    async fn find_global_concurrent_events(&self) -> Result<Vec<(Event, Event)>>;

    /// Get cross-trace races for a specific variable
    async fn get_cross_trace_races(&self, variable: &str) -> Result<Vec<CrossTraceRace>>;

    // ========================================================================
    // Critical Path Analysis
    // ========================================================================

    /// Find the critical path (longest path by duration) through a trace
    async fn get_critical_path(&self, trace_id: Uuid) -> Result<CriticalPath>;

    // ========================================================================
    // Baseline Metrics & Anomaly Detection
    // ========================================================================

    /// Update baseline metrics with events from a trace
    async fn update_baselines(&self, trace_id: Uuid) -> Result<()>;

    /// Get baseline metric for a specific operation type
    async fn get_baseline_metric(&self, operation: &str) -> Result<Option<DurationStats>>;

    /// Detect anomalies in a trace based on baseline metrics
    async fn detect_anomalies(&self, trace_id: Uuid) -> Result<Vec<Anomaly>>;

    // ========================================================================
    // Service Dependencies
    // ========================================================================

    /// Extract service dependency graph from a trace
    async fn get_service_dependencies(&self, trace_id: Uuid) -> Result<ServiceDependencies>;

    // ========================================================================
    // Audit Trail
    // ========================================================================

    /// Get audit trail for a specific variable in a trace
    async fn get_audit_trail(&self, trace_id: Uuid, variable: &str) -> Result<AuditTrail>;

    /// Get audit trail data (API response format)
    async fn get_audit_trail_data(&self, variable: &str) -> Result<Option<AuditTrailData>>;

    // ========================================================================
    // Statistics & Maintenance
    // ========================================================================

    /// Get overall graph statistics
    async fn stats(&self) -> Result<GraphStats>;

    /// Check if the graph has cycles (shouldn't happen in proper causal graph)
    async fn has_cycles(&self) -> Result<bool>;

    /// Cleanup old traces beyond retention period
    async fn cleanup_old_traces(&self, retention_hours: u64) -> Result<usize>;

    /// Clear all data (useful for testing)
    async fn clear(&self) -> Result<()>;
}
