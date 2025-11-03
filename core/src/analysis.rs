use crate::config::Config;
use crate::event::{DistributedEdge, DistributedSpan, EdgeLinkType, Event};
use crate::graph::{Anomaly, AuditTrail, CausalGraph, CriticalPath, ServiceDependencies, TreeNode};
use crate::storage::{CrossTraceRace, StorageBackend, TraceAnalysisData};
use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

/// AnalysisService coordinates between storage and computation
/// It maintains a single CausalGraph that works with any storage backend
pub struct AnalysisService {
    storage: Arc<dyn StorageBackend>,
    graph: Arc<RwLock<CausalGraph>>,
    warmup: Arc<RwLock<WarmupStatus>>,
    config: Config,
}

impl AnalysisService {
    /// Create a new AnalysisService with the given storage backend and config
    pub async fn new(storage: Arc<dyn StorageBackend>, config: Config) -> Result<Self> {
        let graph = Arc::new(RwLock::new(CausalGraph::new()));
        let warmup = Arc::new(RwLock::new(WarmupStatus::new()));

        // Load existing baselines from storage
        let baseline_operations = storage.get_all_baseline_operations().await?;
        let mut baseline_metrics = Vec::new();
        for operation in baseline_operations {
            if let Some(baseline) = storage.get_baseline_metric(&operation).await? {
                baseline_metrics.push((operation, baseline));
            }
        }
        {
            let graph_guard = graph.read().await;
            for (operation, baseline) in baseline_metrics {
                graph_guard.set_baseline(&operation, baseline);
            }
        }

        Ok(Self {
            storage,
            graph,
            warmup,
            config,
        })
    }

    /// Add an event (this goes through storage, then updates graph)
    pub async fn add_event(&self, event: Event) -> Result<()> {
        // Debug logging for distributed tracing
        if event.metadata.instance_id.is_some()
            || event.metadata.distributed_span_id.is_some()
            || event.metadata.upstream_span_id.is_some()
        {
            tracing::debug!(
                "Event {} has distributed metadata: instance_id={:?}, span_id={:?}, upstream={:?}",
                event.id,
                event.metadata.instance_id,
                event.metadata.distributed_span_id,
                event.metadata.upstream_span_id
            );
        }

        // Persist to storage first
        self.storage.add_event(event.clone()).await?;

        // Handle distributed tracing metadata if enabled
        if self.config.distributed_tracing.enabled {
            if let Some(span_id) = &event.metadata.distributed_span_id {
                // Create or update distributed span
                let existing_span = self.storage.get_distributed_span(span_id).await?;

                let span = if let Some(mut existing) = existing_span {
                    // Update existing span's last_event timestamp only
                    // DO NOT change service/instance - those belong to whoever created the span
                    existing.last_event = Some(event.timestamp);
                    existing
                } else {
                    // Create new span - this service owns this span ID
                    DistributedSpan {
                        trace_id: event.trace_id,
                        span_id: span_id.clone(),
                        service: event.metadata.service_name.clone(),
                        instance: event.metadata.instance_id.clone().unwrap_or_default(),
                        first_event: event.timestamp,
                        last_event: Some(event.timestamp),
                    }
                };

                self.storage.save_distributed_span(span).await?;

                // Create distributed edge if there's an upstream span
                if let Some(upstream_span_id) = &event.metadata.upstream_span_id {
                    // Determine edge type based on event kind
                    let link_type = match &event.kind {
                        crate::event::EventKind::HttpRequest { .. } => EdgeLinkType::HttpCall,
                        crate::event::EventKind::HttpResponse { .. } => EdgeLinkType::HttpCall,
                        crate::event::EventKind::DatabaseQuery { .. } => {
                            EdgeLinkType::DatabaseQuery
                        }
                        _ => EdgeLinkType::Custom,
                    };

                    let edge = DistributedEdge {
                        from_span: upstream_span_id.clone(),
                        to_span: span_id.clone(),
                        link_type,
                        metadata: serde_json::json!({
                            "event_id": event.id,
                            "timestamp": event.timestamp,
                        }),
                    };

                    self.storage.add_distributed_edge(edge).await?;
                }
            }
        }

        // Then update in-memory graph
        let graph = self.graph.write().await;
        graph.add_event(event)?;

        Ok(())
    }

    /// Update baselines after processing a trace
    pub async fn update_baselines(&self, trace_id: Uuid) -> Result<()> {
        self.ensure_trace_loaded(trace_id).await?;

        // Update baselines and get them in a single write lock scope
        let baselines = {
            let graph = self.graph.write().await;
            graph.update_baselines(trace_id)?;
            graph.get_all_baselines()
        }; // Write lock is dropped here

        // Persist updated baselines to storage in a single batch (without holding the lock)
        self.storage.save_baselines_batch(baselines).await?;

        Ok(())
    }

    /// Get the current warm-up status
    pub async fn warmup_status(&self) -> WarmupStatus {
        self.warmup.read().await.clone()
    }

    /// Detect anomalies in a trace
    pub async fn detect_anomalies(&self, trace_id: Uuid) -> Result<Vec<Anomaly>> {
        self.ensure_trace_loaded(trace_id).await?;

        let graph = self.graph.read().await;
        graph.detect_anomalies(trace_id)
    }

    /// Get critical path for a trace
    pub async fn get_critical_path(&self, trace_id: Uuid) -> Result<CriticalPath> {
        self.ensure_trace_loaded(trace_id).await?;

        let graph = self.graph.read().await;
        graph.get_critical_path(trace_id)
    }

    /// Find concurrent events within a trace
    pub async fn find_concurrent_events(&self, trace_id: Uuid) -> Result<Vec<(Event, Event)>> {
        self.ensure_trace_loaded(trace_id).await?;

        let graph = self.graph.read().await;
        graph.find_concurrent_events(trace_id)
    }

    /// Find concurrent events across all traces
    pub async fn find_global_concurrent_events(&self) -> Result<Vec<(Event, Event)>> {
        let graph = self.graph.read().await;
        graph.find_global_concurrent_events()
    }

    /// Get cross-trace races for a specific variable
    pub async fn get_cross_trace_races(&self, variable: &str) -> Result<Vec<CrossTraceRace>> {
        let graph = self.graph.read().await;
        let concurrent_pairs = graph.find_global_concurrent_events()?;

        let mut races = Vec::new();
        for (event1, event2) in concurrent_pairs {
            if let (
                crate::event::EventKind::StateChange {
                    variable: var1,
                    new_value: val1,
                    location: loc1,
                    ..
                },
                crate::event::EventKind::StateChange {
                    variable: var2,
                    new_value: val2,
                    location: loc2,
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
                        event1_value: val1.clone(),
                        event1_location: loc1.clone(),
                        event2_id: event2.id,
                        event2_trace_id: event2.trace_id,
                        event2_timestamp: event2.timestamp,
                        event2_thread_id: event2.metadata.thread_id.clone(),
                        event2_value: val2.clone(),
                        event2_location: loc2.clone(),
                        confidence: 0.8,
                    });
                }
            }
        }

        Ok(races)
    }

    /// Get service dependencies for a trace
    pub async fn get_service_dependencies(&self, trace_id: Uuid) -> Result<ServiceDependencies> {
        self.ensure_trace_loaded(trace_id).await?;

        let graph = self.graph.read().await;
        graph.get_service_dependencies(trace_id)
    }

    /// Get audit trail for a variable in a trace
    pub async fn get_audit_trail(&self, trace_id: Uuid, variable: &str) -> Result<AuditTrail> {
        self.ensure_trace_loaded(trace_id).await?;

        let graph = self.graph.read().await;
        graph.get_audit_trail(trace_id, variable)
    }

    /// Get trace tree
    pub async fn get_trace_tree(&self, trace_id: Uuid) -> Result<Vec<TreeNode>> {
        self.ensure_trace_loaded(trace_id).await?;

        let graph = self.graph.read().await;
        graph.get_trace_tree(trace_id)
    }

    /// Get causal order of events for a trace
    pub async fn get_causal_order(&self, trace_id: Uuid) -> Result<Vec<Event>> {
        self.ensure_trace_loaded(trace_id).await?;

        let graph = self.graph.read().await;
        graph.get_causal_order(trace_id)
    }

    /// Get merged trace events across distributed spans (Phase 2)
    /// This fetches events from the primary trace and all related traces connected via distributed edges
    /// Uses BFS to recursively follow all edges through arbitrary-length service chains
    async fn get_merged_trace_events(&self, trace_id: Uuid) -> Result<Vec<Event>> {
        use std::collections::{HashMap, HashSet, VecDeque};

        // Start with events from the primary trace
        let mut all_events = self.storage.get_trace_events(trace_id).await?;

        // Get all distributed spans for this trace
        let spans = self.storage.get_distributed_spans(trace_id).await?;

        if spans.is_empty() {
            // No distributed tracing - return just the primary trace events
            return Ok(all_events);
        }

        tracing::debug!(
            "Merging distributed trace {}: found {} initial spans",
            trace_id,
            spans.len()
        );

        // BFS to recursively discover all connected spans through edges
        let mut visited_spans: HashSet<String> = HashSet::new();
        let mut span_queue: VecDeque<(String, Uuid)> = VecDeque::new(); // (span_id, trace_id)

        // Start with all spans from the primary trace
        for span in &spans {
            span_queue.push_back((span.span_id.clone(), span.trace_id));
            visited_spans.insert(span.span_id.clone());
        }

        // Keep track of which traces we've explored for edges (to avoid redundant queries)
        let mut explored_traces: HashSet<Uuid> = HashSet::new();

        // BFS: recursively follow all edges to discover the entire distributed trace graph
        while let Some((current_span_id, current_trace_id)) = span_queue.pop_front() {
            // Skip traces we've already processed (prevents duplicate fetches)
            if !explored_traces.insert(current_trace_id) {
                continue;
            }

            let edges = self.storage.get_distributed_edges(current_trace_id).await?;

            tracing::debug!(
                "Found {} edges from trace {} (span {})",
                edges.len(),
                current_trace_id,
                current_span_id
            );

            // Follow each edge to discover connected spans
            for edge in edges {
                // Add both ends of the edge (from_span and to_span) to ensure we capture everything
                for next_span_id in [&edge.from_span, &edge.to_span] {
                    if visited_spans.insert(next_span_id.clone()) {
                        // New span discovered - look it up to get its trace_id
                        if let Some(span) = self.storage.get_distributed_span(next_span_id).await? {
                            span_queue.push_back((span.span_id.clone(), span.trace_id));

                            tracing::debug!(
                                "Discovered span {} in trace {} via edge",
                                next_span_id,
                                span.trace_id
                            );
                        }
                    }
                }
            }
        }

        tracing::debug!(
            "BFS complete: discovered {} total spans across {} traces",
            visited_spans.len(),
            explored_traces.len()
        );

        // Now collect events from all discovered spans
        // Group spans by trace_id to minimize queries
        let mut trace_to_spans: HashMap<Uuid, Vec<String>> = HashMap::new();

        for span_id in &visited_spans {
            if let Some(span) = self.storage.get_distributed_span(span_id).await? {
                trace_to_spans
                    .entry(span.trace_id)
                    .or_default()
                    .push(span_id.clone());
            }
        }

        // Fetch events from each trace and filter by span_id
        for (tid, span_ids) in trace_to_spans {
            if tid != trace_id {
                // Fetch events from related trace
                let related_events = self.storage.get_trace_events(tid).await?;

                // Filter to only events belonging to our discovered spans
                let span_set: HashSet<&String> = span_ids.iter().collect();
                let filtered_events: Vec<Event> = related_events
                    .into_iter()
                    .filter(|e| {
                        e.metadata
                            .distributed_span_id
                            .as_ref()
                            .is_some_and(|sid| span_set.contains(sid))
                    })
                    .collect();

                tracing::debug!(
                    "Adding {} events from {} spans in trace {}",
                    filtered_events.len(),
                    span_ids.len(),
                    tid
                );

                all_events.extend(filtered_events);
            }
        }

        // Sort all events by timestamp to create a unified timeline
        all_events.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

        tracing::info!(
            "Merged trace {}: {} total events from {} spans across {} traces",
            trace_id,
            all_events.len(),
            visited_spans.len(),
            explored_traces.len()
        );

        Ok(all_events)
    }

    /// Get trace analysis data (batch fetch for UI)
    pub async fn get_trace_analysis_data(&self, trace_id: Uuid) -> Result<TraceAnalysisData> {
        // Fetch events from storage (Phase 2: merge distributed traces)
        let events = self.get_merged_trace_events(trace_id).await?;

        self.ensure_trace_loaded_from_events(trace_id, &events)
            .await?;

        // Collect unique variables referenced in the trace
        let mut variables = HashSet::new();
        for event in &events {
            if let crate::event::EventKind::StateChange { variable, .. } = &event.kind {
                variables.insert(variable.clone());
            }
        }

        // Get analysis results from graph
        let graph = self.graph.read().await;
        let anomalies = graph.detect_anomalies(trace_id)?;
        let critical_path = graph.get_critical_path(trace_id).ok();
        let dependencies = graph.get_service_dependencies(trace_id).ok();

        // Get audit trails in a single pass
        let audit_trails = graph.get_audit_trails_bulk(trace_id, &variables)?;

        Ok(TraceAnalysisData {
            events,
            audit_trails,
            critical_path,
            anomalies,
            dependencies,
        })
    }

    /// Check if graph has cycles
    pub async fn has_cycles(&self) -> Result<bool> {
        let graph = self.graph.read().await;
        Ok(graph.has_cycles())
    }

    /// Clear all data (for testing)
    pub async fn clear(&self) -> Result<()> {
        // Clear storage
        self.storage.clear().await?;

        // Clear graph
        let mut graph = self.graph.write().await;
        *graph = CausalGraph::new();

        // Reset warmup status (callers may choose to trigger a manual warmup afterwards)
        *self.warmup.write().await = WarmupStatus::new();

        Ok(())
    }

    async fn ensure_trace_loaded(&self, trace_id: Uuid) -> Result<()> {
        let events = self.storage.get_trace_events(trace_id).await?;
        self.ensure_trace_loaded_from_events(trace_id, &events)
            .await
    }

    async fn ensure_trace_loaded_from_events(
        &self,
        trace_id: Uuid,
        events: &[Event],
    ) -> Result<()> {
        if events.is_empty() {
            return Ok(());
        }

        let missing_events = {
            let graph = self.graph.read().await;
            events
                .iter()
                .filter(|event| !graph.contains_event(event.id))
                .cloned()
                .collect::<Vec<_>>()
        };

        if missing_events.is_empty() {
            return Ok(());
        }

        {
            let graph = self.graph.write().await;
            let mut pending = missing_events;
            pending.retain(|event| !graph.contains_event(event.id));

            if pending.is_empty() {
                return Ok(());
            }

            graph.ingest_events(pending)?;
        }

        // Load distributed edges if distributed tracing is enabled
        if self.config.distributed_tracing.enabled {
            let mut trace_ids: HashSet<Uuid> = HashSet::new();
            trace_ids.insert(trace_id);
            for event in events {
                trace_ids.insert(event.trace_id);
            }

            for tid in trace_ids {
                let dist_edges = self.storage.get_distributed_edges(tid).await?;
                if !dist_edges.is_empty() {
                    let graph = self.graph.read().await;
                    graph.add_distributed_edges(dist_edges);
                    tracing::debug!("Loaded distributed edges for trace {}", tid);
                }
            }
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WarmupPhase {
    Idle,
    Replaying,
    Completed,
    Failed,
}

#[derive(Debug, Clone)]
pub struct WarmupStatus {
    pub phase: WarmupPhase,
    pub total_traces: usize,
    pub processed_traces: usize,
    pub last_trace: Option<Uuid>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
}

impl Default for WarmupStatus {
    fn default() -> Self {
        Self::new()
    }
}

impl WarmupStatus {
    pub fn new() -> Self {
        Self {
            phase: WarmupPhase::Completed,
            total_traces: 0,
            processed_traces: 0,
            last_trace: None,
            started_at: None,
            completed_at: None,
            last_error: None,
        }
    }

    pub fn is_ready(&self) -> bool {
        matches!(self.phase, WarmupPhase::Completed)
    }
}
