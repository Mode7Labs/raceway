use super::storage_trait::StorageBackend;
use super::types::{DurationStats, TraceSummary};
use crate::config::StorageConfig;
use crate::event::{AccessType, DistributedEdge, DistributedSpan, Event, EventKind};
use anyhow::Result;
use async_trait::async_trait;
use dashmap::DashMap;
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::sync::RwLock;
use uuid::Uuid;

/// Pure in-memory storage backend using DashMaps
/// This is now a proper storage layer without computation logic
pub struct MemoryBackend {
    events: DashMap<Uuid, Event>,
    trace_events: DashMap<Uuid, RwLock<Vec<Uuid>>>, // trace_id -> event IDs
    baselines: DashMap<String, DurationStats>,
    // Distributed tracing (Phase 2)
    distributed_spans: DashMap<String, DistributedSpan>, // span_id -> span
    distributed_edges: DashMap<Uuid, RwLock<Vec<DistributedEdge>>>, // trace_id -> edges
    pending_edges: DashMap<String, Vec<DistributedEdge>>, // from_span_id -> edges awaiting upstream span
    pending_edges_targets: DashMap<String, Vec<DistributedEdge>>, // to_span_id -> edges awaiting downstream span
}

impl MemoryBackend {
    pub fn new(_config: &StorageConfig) -> Result<Self> {
        Ok(Self {
            events: DashMap::new(),
            trace_events: DashMap::new(),
            baselines: DashMap::new(),
            distributed_spans: DashMap::new(),
            distributed_edges: DashMap::new(),
            pending_edges: DashMap::new(),
            pending_edges_targets: DashMap::new(),
        })
    }

    fn store_distributed_edge(&self, trace_id: Uuid, edge: DistributedEdge) {
        let entry = self
            .distributed_edges
            .entry(trace_id)
            .or_insert_with(|| RwLock::new(Vec::new()));

        let mut edges = entry.write().unwrap();
        let exists = edges.iter().any(|existing| {
            existing.from_span == edge.from_span
                && existing.to_span == edge.to_span
                && existing.link_type == edge.link_type
                && existing.metadata == edge.metadata
        });
        if !exists {
            edges.push(edge);
        }
    }
}

/// Helper function to calculate percentile from a sorted vector
fn percentile(sorted_values: &[f64], p: f64) -> f64 {
    if sorted_values.is_empty() {
        return 0.0;
    }

    let idx = ((sorted_values.len() as f64 - 1.0) * p).round() as usize;
    sorted_values[idx.min(sorted_values.len() - 1)]
}

/// Helper function to get event type name from EventKind
fn get_event_type_name(kind: &crate::event::EventKind) -> String {
    match kind {
        crate::event::EventKind::FunctionCall { .. } => "FunctionCall".to_string(),
        crate::event::EventKind::AsyncSpawn { .. } => "AsyncSpawn".to_string(),
        crate::event::EventKind::AsyncAwait { .. } => "AsyncAwait".to_string(),
        crate::event::EventKind::StateChange { .. } => "StateChange".to_string(),
        crate::event::EventKind::LockAcquire { .. } => "LockAcquire".to_string(),
        crate::event::EventKind::LockRelease { .. } => "LockRelease".to_string(),
        crate::event::EventKind::MemoryFence { .. } => "MemoryFence".to_string(),
        crate::event::EventKind::HttpRequest { .. } => "HttpRequest".to_string(),
        crate::event::EventKind::HttpResponse { .. } => "HttpResponse".to_string(),
        crate::event::EventKind::DatabaseQuery { .. } => "DatabaseQuery".to_string(),
        crate::event::EventKind::DatabaseResult { .. } => "DatabaseResult".to_string(),
        crate::event::EventKind::Error { .. } => "Error".to_string(),
        crate::event::EventKind::Custom { name, .. } => format!("Custom({})", name),
    }
}

fn access_type_to_string(access: AccessType) -> &'static str {
    match access {
        AccessType::Read => "Read",
        AccessType::Write => "Write",
        AccessType::AtomicRead => "AtomicRead",
        AccessType::AtomicWrite => "AtomicWrite",
        AccessType::AtomicRMW => "AtomicRMW",
    }
}

fn is_write_access(access: &str) -> bool {
    matches!(access, "Write" | "AtomicWrite" | "AtomicRMW")
}

fn is_read_access(access: &str) -> bool {
    matches!(access, "Read" | "AtomicRead")
}

#[async_trait]
impl StorageBackend for MemoryBackend {
    async fn add_event(&self, event: Event) -> Result<()> {
        let event_id = event.id;
        let trace_id = event.trace_id;

        // Store the event
        self.events.insert(event_id, event);

        // Add event ID to trace's event list
        self.trace_events
            .entry(trace_id)
            .or_insert_with(|| RwLock::new(Vec::new()))
            .write()
            .unwrap()
            .push(event_id);

        Ok(())
    }

    async fn get_event(&self, id: Uuid) -> Result<Option<Event>> {
        Ok(self.events.get(&id).map(|e| e.clone()))
    }

    async fn get_trace_events(&self, trace_id: Uuid) -> Result<Vec<Event>> {
        let event_ids = self
            .trace_events
            .get(&trace_id)
            .map(|ids| ids.read().unwrap().clone())
            .unwrap_or_default();

        let mut events = Vec::new();
        for event_id in event_ids {
            if let Some(event) = self.events.get(&event_id) {
                events.push(event.clone());
            }
        }

        // Sort by timestamp (primary), causality depth (secondary), id (tertiary)
        // This ensures chronological ordering with stable sort for identical timestamps
        events.sort_by(|a, b| {
            a.timestamp
                .cmp(&b.timestamp)
                .then(a.causality_vector.len().cmp(&b.causality_vector.len()))
                .then(a.id.cmp(&b.id))
        });

        Ok(events)
    }

    async fn get_all_events(&self) -> Result<Vec<Event>> {
        let mut events: Vec<Event> = self.events.iter().map(|e| e.value().clone()).collect();

        // Sort by timestamp (primary), causality depth (secondary), id (tertiary)
        events.sort_by(|a, b| {
            a.timestamp
                .cmp(&b.timestamp)
                .then(a.causality_vector.len().cmp(&b.causality_vector.len()))
                .then(a.id.cmp(&b.id))
        });

        Ok(events)
    }

    async fn count_events(&self) -> Result<usize> {
        Ok(self.events.len())
    }

    async fn count_traces(&self) -> Result<usize> {
        Ok(self.trace_events.len())
    }

    async fn get_all_trace_ids(&self) -> Result<Vec<Uuid>> {
        Ok(self.trace_events.iter().map(|e| *e.key()).collect())
    }

    async fn get_trace_summaries(
        &self,
        page: usize,
        page_size: usize,
        min_events: Option<usize>,
    ) -> Result<(Vec<TraceSummary>, usize)> {
        let mut summaries: Vec<TraceSummary> = Vec::new();
        let min_event_count = min_events.unwrap_or(1);

        for trace_entry in self.trace_events.iter() {
            let trace_id = *trace_entry.key();
            let event_ids = trace_entry.value().read().unwrap();

            if event_ids.is_empty() {
                continue;
            }

            // Collect events for this trace
            let mut events = Vec::new();
            for event_id in event_ids.iter() {
                if let Some(event) = self.events.get(event_id) {
                    events.push(event.clone());
                }
            }

            if !events.is_empty() {
                let event_count = events.len() as i64;

                // Apply min_events filter
                if (event_count as usize) < min_event_count {
                    continue;
                }

                let first_timestamp = events.iter().map(|e| e.timestamp).min().unwrap();
                let last_timestamp = events.iter().map(|e| e.timestamp).max().unwrap();

                // Extract unique service names from event metadata
                let mut service_set = std::collections::HashSet::new();
                for event in &events {
                    service_set.insert(event.metadata.service_name.clone());
                }
                let mut services: Vec<String> = service_set.into_iter().collect();
                services.sort();
                let service_count = services.len();

                summaries.push(TraceSummary {
                    trace_id,
                    event_count,
                    first_timestamp,
                    last_timestamp,
                    services,
                    service_count,
                });
            }
        }

        // Sort by last_timestamp DESC (newest first)
        summaries.sort_by(|a, b| b.last_timestamp.cmp(&a.last_timestamp));

        let total_count = summaries.len();

        // Apply pagination
        let offset = (page.saturating_sub(1)) * page_size;
        let paginated = summaries.into_iter().skip(offset).take(page_size).collect();

        Ok((paginated, total_count))
    }

    async fn get_trace_summaries_by_service(
        &self,
        service_name: &str,
        page: usize,
        page_size: usize,
    ) -> Result<(Vec<TraceSummary>, usize)> {
        let mut summaries: Vec<TraceSummary> = Vec::new();

        for trace_entry in self.trace_events.iter() {
            let trace_id = *trace_entry.key();
            let event_ids = trace_entry.value().read().unwrap();

            if event_ids.is_empty() {
                continue;
            }

            // Collect events for this trace
            let mut events = Vec::new();
            for event_id in event_ids.iter() {
                if let Some(event) = self.events.get(event_id) {
                    events.push(event.clone());
                }
            }

            if events.is_empty() {
                continue;
            }

            // Extract unique service names
            let mut service_set = std::collections::HashSet::new();
            for event in &events {
                service_set.insert(event.metadata.service_name.clone());
            }

            // Only include this trace if it contains the requested service
            if !service_set.contains(service_name) {
                continue;
            }

            let event_count = events.len() as i64;
            let first_timestamp = events.iter().map(|e| e.timestamp).min().unwrap();
            let last_timestamp = events.iter().map(|e| e.timestamp).max().unwrap();

            let mut services: Vec<String> = service_set.into_iter().collect();
            services.sort();
            let service_count = services.len();

            summaries.push(TraceSummary {
                trace_id,
                event_count,
                first_timestamp,
                last_timestamp,
                services,
                service_count,
            });
        }

        // Sort by last_timestamp DESC (newest first)
        summaries.sort_by(|a, b| b.last_timestamp.cmp(&a.last_timestamp));

        let total_count = summaries.len();

        // Apply pagination
        let offset = (page.saturating_sub(1)) * page_size;
        let paginated = summaries.into_iter().skip(offset).take(page_size).collect();

        Ok((paginated, total_count))
    }

    async fn get_trace_roots(&self, trace_id: Uuid) -> Result<Vec<Uuid>> {
        let events = self.get_trace_events(trace_id).await?;

        // Find events with no parent_id
        let roots: Vec<Uuid> = events
            .into_iter()
            .filter(|e| e.parent_id.is_none())
            .map(|e| e.id)
            .collect();

        Ok(roots)
    }

    async fn save_baseline(&self, operation: &str, stats: DurationStats) -> Result<()> {
        self.baselines.insert(operation.to_string(), stats);
        Ok(())
    }

    async fn save_baselines_batch(
        &self,
        baselines: std::collections::HashMap<String, DurationStats>,
    ) -> Result<()> {
        for (operation, stats) in baselines {
            self.baselines.insert(operation, stats);
        }
        Ok(())
    }

    async fn get_baseline_metric(&self, operation: &str) -> Result<Option<DurationStats>> {
        Ok(self.baselines.get(operation).map(|s| s.clone()))
    }

    async fn get_all_baseline_operations(&self) -> Result<Vec<String>> {
        Ok(self.baselines.iter().map(|e| e.key().clone()).collect())
    }

    async fn save_distributed_span(&self, span: DistributedSpan) -> Result<()> {
        let trace_id = span.trace_id;
        let span_id = span.span_id.clone();
        self.distributed_spans.insert(span_id.clone(), span);

        if let Some((_, pending)) = self.pending_edges.remove(&span_id) {
            for edge in pending {
                self.store_distributed_edge(trace_id, edge);
            }
        }

        if let Some((_, pending)) = self.pending_edges_targets.remove(&span_id) {
            for edge in pending {
                self.store_distributed_edge(trace_id, edge);
            }
        }

        Ok(())
    }

    async fn get_distributed_span(&self, span_id: &str) -> Result<Option<DistributedSpan>> {
        Ok(self.distributed_spans.get(span_id).map(|s| s.clone()))
    }

    async fn get_distributed_spans(&self, trace_id: Uuid) -> Result<Vec<DistributedSpan>> {
        let spans: Vec<DistributedSpan> = self
            .distributed_spans
            .iter()
            .filter(|entry| entry.value().trace_id == trace_id)
            .map(|entry| entry.value().clone())
            .collect();
        Ok(spans)
    }

    async fn add_distributed_edge(&self, edge: DistributedEdge) -> Result<()> {
        let mut from_trace = None;

        // Store immediately if we already know the upstream span (so we have the trace_id)
        if let Some(from_span) = self.distributed_spans.get(&edge.from_span) {
            let trace_id = from_span.trace_id;
            from_trace = Some(trace_id);
            self.store_distributed_edge(trace_id, edge.clone());
        } else {
            // Otherwise cache the edge until the span arrives
            self.pending_edges
                .entry(edge.from_span.clone())
                .or_default()
                .push(edge.clone());
        }

        if let Some(to_span) = self.distributed_spans.get(&edge.to_span) {
            let trace_id = to_span.trace_id;
            if Some(trace_id) != from_trace {
                self.store_distributed_edge(trace_id, edge.clone());
            }
        } else {
            self.pending_edges_targets
                .entry(edge.to_span.clone())
                .or_default()
                .push(edge);
        }

        Ok(())
    }

    async fn get_distributed_edges(&self, trace_id: Uuid) -> Result<Vec<DistributedEdge>> {
        let edges = self
            .distributed_edges
            .get(&trace_id)
            .map(|e| e.read().unwrap().clone())
            .unwrap_or_default();
        Ok(edges)
    }

    async fn cleanup_old_traces(&self, retention_hours: u64) -> Result<usize> {
        let cutoff_time = chrono::Utc::now() - chrono::Duration::hours(retention_hours as i64);
        let mut deleted_count = 0;

        // Collect trace IDs to delete
        let mut traces_to_delete = Vec::new();
        for trace_entry in self.trace_events.iter() {
            let trace_id = *trace_entry.key();
            let event_ids = trace_entry.value().read().unwrap();

            // Check if all events in this trace are older than cutoff
            let mut all_old = true;
            for event_id in event_ids.iter() {
                if let Some(event) = self.events.get(event_id) {
                    if event.timestamp > cutoff_time {
                        all_old = false;
                        break;
                    }
                }
            }

            if all_old && !event_ids.is_empty() {
                traces_to_delete.push(trace_id);
            }
        }

        // Delete traces and their events
        for trace_id in traces_to_delete {
            if let Some((_, event_ids)) = self.trace_events.remove(&trace_id) {
                let event_ids = event_ids.read().unwrap();
                for event_id in event_ids.iter() {
                    self.events.remove(event_id);
                }
                deleted_count += 1;
            }
        }

        Ok(deleted_count)
    }

    async fn get_all_services(&self) -> Result<Vec<(String, usize, usize)>> {
        use std::collections::{HashMap, HashSet};

        let mut service_data: HashMap<String, (usize, HashSet<Uuid>)> = HashMap::new();

        // Iterate through distributed spans to collect service stats
        for span_ref in self.distributed_spans.iter() {
            let span = span_ref.value();
            let service_name = span.service.clone();
            let trace_id = span.trace_id;

            // Count events for this service in this trace
            if let Some(events_ref) = self.trace_events.get(&trace_id) {
                let events_lock = events_ref.read().unwrap();
                let event_count = events_lock
                    .iter()
                    .filter(|&event_id| {
                        if let Some(event_ref) = self.events.get(event_id) {
                            event_ref.metadata.service_name == service_name
                        } else {
                            false
                        }
                    })
                    .count();

                let entry = service_data
                    .entry(service_name)
                    .or_insert((0, HashSet::new()));
                entry.0 += event_count;
                entry.1.insert(trace_id);
            }
        }

        let mut services: Vec<(String, usize, usize)> = service_data
            .into_iter()
            .map(|(name, (event_count, traces))| (name, event_count, traces.len()))
            .collect();

        services.sort_by(|a, b| a.0.cmp(&b.0));
        Ok(services)
    }

    async fn get_service_dependencies_global(
        &self,
        service_name: &str,
    ) -> Result<(Vec<(String, usize, usize)>, Vec<(String, usize, usize)>)> {
        use std::collections::{HashMap, HashSet};

        let mut calls_to_map: HashMap<String, (usize, HashSet<Uuid>)> = HashMap::new();
        let mut called_by_map: HashMap<String, (usize, HashSet<Uuid>)> = HashMap::new();

        // Iterate through distributed edges to find cross-service calls
        for edges_ref in self.distributed_edges.iter() {
            let edges_lock = edges_ref.read().unwrap();
            for edge in edges_lock.iter() {
                if let (Some(from_span_ref), Some(to_span_ref)) = (
                    self.distributed_spans.get(&edge.from_span),
                    self.distributed_spans.get(&edge.to_span),
                ) {
                    let from_span = from_span_ref.value();
                    let to_span = to_span_ref.value();

                    // Only count cross-service edges
                    if from_span.service != to_span.service {
                        if from_span.service == service_name {
                            // This service calls to_span.service
                            let entry = calls_to_map
                                .entry(to_span.service.clone())
                                .or_insert((0, HashSet::new()));
                            entry.0 += 1;
                            entry.1.insert(from_span.trace_id);
                        }

                        if to_span.service == service_name {
                            // This service is called by from_span.service
                            let entry = called_by_map
                                .entry(from_span.service.clone())
                                .or_insert((0, HashSet::new()));
                            entry.0 += 1;
                            entry.1.insert(from_span.trace_id);
                        }
                    }
                }
            }
        }

        let mut calls_to: Vec<(String, usize, usize)> = calls_to_map
            .into_iter()
            .map(|(name, (total_calls, traces))| (name, total_calls, traces.len()))
            .collect();
        calls_to.sort_by(|a, b| b.1.cmp(&a.1));

        let mut called_by: Vec<(String, usize, usize)> = called_by_map
            .into_iter()
            .map(|(name, (total_calls, traces))| (name, total_calls, traces.len()))
            .collect();
        called_by.sort_by(|a, b| b.1.cmp(&a.1));

        Ok((calls_to, called_by))
    }

    async fn get_all_distributed_edges(&self) -> Result<Vec<serde_json::Value>> {
        let mut counts: HashMap<(String, String, String), usize> = HashMap::new();

        for entry in self.distributed_edges.iter() {
            let edges = entry.value().read().unwrap();
            for edge in edges.iter() {
                let Some(from_span) = self.distributed_spans.get(&edge.from_span) else {
                    continue;
                };
                let Some(to_span) = self.distributed_spans.get(&edge.to_span) else {
                    continue;
                };

                // Skip edges that stay within the same service; we only surface cross-service calls
                if from_span.service == to_span.service {
                    continue;
                }

                let link_type = match edge.link_type {
                    crate::event::EdgeLinkType::HttpCall => "HttpCall",
                    crate::event::EdgeLinkType::GrpcCall => "GrpcCall",
                    crate::event::EdgeLinkType::MessageQueue => "MessageQueue",
                    crate::event::EdgeLinkType::DatabaseQuery => "DatabaseQuery",
                    crate::event::EdgeLinkType::Custom => "Custom",
                }
                .to_string();

                let key = (
                    from_span.service.clone(),
                    to_span.service.clone(),
                    link_type,
                );
                *counts.entry(key).or_insert(0) += 1;
            }
        }

        let mut entries: Vec<((String, String, String), usize)> = counts.into_iter().collect();
        entries.sort_by(|a, b| b.1.cmp(&a.1));

        let edges = entries
            .into_iter()
            .map(|((from, to, link_type), count)| {
                json!({
                    "from_service": from,
                    "to_service": to,
                    "link_type": link_type,
                    "call_count": count,
                })
            })
            .collect();

        Ok(edges)
    }

    async fn get_global_race_candidates(&self) -> Result<Vec<serde_json::Value>> {
        #[derive(Default)]
        struct VariableStats {
            trace_ids: HashSet<Uuid>,
            thread_ids: HashSet<String>,
            services: HashSet<String>,
            access_types: HashSet<String>,
            access_count: usize,
        }

        let mut stats: HashMap<String, VariableStats> = HashMap::new();

        for entry in self.events.iter() {
            let event = entry.value();
            if let EventKind::StateChange {
                variable,
                access_type,
                ..
            } = &event.kind
            {
                let stat = stats.entry(variable.clone()).or_default();
                stat.trace_ids.insert(event.trace_id);
                stat.thread_ids.insert(event.metadata.thread_id.clone());
                stat.services.insert(event.metadata.service_name.clone());
                stat.access_types
                    .insert(access_type_to_string(*access_type).to_string());
                stat.access_count += 1;
            }
        }

        let mut results = Vec::new();
        for (variable, stat) in stats {
            let trace_count = stat.trace_ids.len();
            let thread_count = stat.thread_ids.len();

            // Only surface variables that are touched by multiple traces or threads
            if trace_count <= 1 && thread_count <= 1 {
                continue;
            }

            let has_write = stat
                .access_types
                .iter()
                .any(|access| is_write_access(access.as_str()));
            let has_read = stat
                .access_types
                .iter()
                .any(|access| is_read_access(access.as_str()));

            let severity = if has_write && has_read {
                "WARNING"
            } else if has_write && thread_count > 1 {
                "CRITICAL"
            } else if has_write {
                "WARNING"
            } else {
                "INFO"
            };

            let mut trace_ids: Vec<String> =
                stat.trace_ids.iter().map(|id| id.to_string()).collect();
            trace_ids.sort();

            let mut access_types: Vec<String> = stat.access_types.into_iter().collect();
            access_types.sort();

            results.push((
                trace_count,
                stat.access_count,
                json!({
                    "variable": variable,
                    "trace_count": trace_count,
                    "access_count": stat.access_count,
                    "access_types": access_types,
                    "thread_count": thread_count,
                    "severity": severity,
                    "trace_ids": trace_ids,
                }),
            ));
        }

        results.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));

        Ok(results.into_iter().map(|(_, _, value)| value).collect())
    }

    async fn get_system_hotspots(
        &self,
    ) -> Result<(Vec<serde_json::Value>, Vec<serde_json::Value>)> {
        #[derive(Default)]
        struct VariableStats {
            trace_ids: HashSet<Uuid>,
            services: HashSet<String>,
            access_count: usize,
        }

        let mut variable_stats: HashMap<String, VariableStats> = HashMap::new();

        for entry in self.events.iter() {
            let event = entry.value();
            if let EventKind::StateChange { variable, .. } = &event.kind {
                let stat = variable_stats.entry(variable.clone()).or_default();
                stat.trace_ids.insert(event.trace_id);
                stat.services.insert(event.metadata.service_name.clone());
                stat.access_count += 1;
            }
        }

        let mut variables: Vec<(usize, serde_json::Value)> = variable_stats
            .into_iter()
            .map(|(variable, stat)| {
                let mut services: Vec<String> = stat.services.into_iter().collect();
                services.sort();
                (
                    stat.access_count,
                    json!({
                        "variable": variable,
                        "access_count": stat.access_count,
                        "trace_count": stat.trace_ids.len(),
                        "services": services,
                    }),
                )
            })
            .collect();

        variables.sort_by(|a, b| b.0.cmp(&a.0));
        let top_variables: Vec<serde_json::Value> = variables
            .into_iter()
            .take(10)
            .map(|(_, value)| value)
            .collect();

        let mut call_counts: HashMap<(String, String), usize> = HashMap::new();
        for entry in self.distributed_edges.iter() {
            let edges = entry.value().read().unwrap();
            for edge in edges.iter() {
                let Some(from_span) = self.distributed_spans.get(&edge.from_span) else {
                    continue;
                };
                let Some(to_span) = self.distributed_spans.get(&edge.to_span) else {
                    continue;
                };

                if from_span.service == to_span.service {
                    continue;
                }

                let key = (from_span.service.clone(), to_span.service.clone());
                *call_counts.entry(key).or_insert(0) += 1;
            }
        }

        let mut service_calls: Vec<(usize, serde_json::Value)> = call_counts
            .into_iter()
            .map(|((from, to), count)| {
                (
                    count,
                    json!({
                        "from_service": from,
                        "to_service": to,
                        "call_count": count,
                    }),
                )
            })
            .collect();

        service_calls.sort_by(|a, b| b.0.cmp(&a.0));
        let top_service_calls: Vec<serde_json::Value> = service_calls
            .into_iter()
            .take(10)
            .map(|(_, value)| value)
            .collect();

        Ok((top_variables, top_service_calls))
    }

    async fn get_service_health(&self, time_window_minutes: u64) -> Result<Vec<serde_json::Value>> {
        use chrono::{DateTime, Duration, Utc};
        use std::collections::HashMap;

        let cutoff_time = Utc::now() - Duration::minutes(time_window_minutes as i64);

        // Build service activity map
        let mut service_data: HashMap<String, (usize, DateTime<Utc>, usize)> = HashMap::new(); // (trace_count, last_activity, total_events)

        for trace_entry in self.trace_events.iter() {
            let event_ids = trace_entry.value().read().unwrap();

            let mut trace_services = std::collections::HashSet::new();
            let mut max_timestamp: Option<DateTime<Utc>> = None;
            let mut event_count_per_service: HashMap<String, usize> = HashMap::new();

            for event_id in event_ids.iter() {
                if let Some(event) = self.events.get(event_id) {
                    let service = &event.metadata.service_name;
                    trace_services.insert(service.clone());
                    *event_count_per_service.entry(service.clone()).or_insert(0) += 1;

                    if max_timestamp.is_none() || event.timestamp > max_timestamp.unwrap() {
                        max_timestamp = Some(event.timestamp);
                    }
                }
            }

            if let Some(last_ts) = max_timestamp {
                if last_ts >= cutoff_time {
                    for service in trace_services {
                        let entry = service_data
                            .entry(service.clone())
                            .or_insert((0, last_ts, 0));
                        entry.0 += 1; // increment trace count
                        if last_ts > entry.1 {
                            entry.1 = last_ts; // update last activity
                        }
                        entry.2 += event_count_per_service.get(&service).unwrap_or(&0);
                    }
                }
            }
        }

        let now = Utc::now();
        let mut results = Vec::new();

        for (service_name, (trace_count, last_activity, total_events)) in service_data {
            let minutes_since = (now - last_activity).num_minutes().max(0);

            // Determine status
            let status = if minutes_since < 5 {
                "healthy"
            } else if minutes_since < 30 {
                "warning"
            } else {
                "critical"
            };

            let avg_events = if trace_count > 0 {
                total_events as f64 / trace_count as f64
            } else {
                0.0
            };

            results.push(serde_json::json!({
                "name": service_name,
                "status": status,
                "trace_count": trace_count,
                "last_activity": last_activity.to_rfc3339(),
                "avg_events_per_trace": avg_events,
                "minutes_since_last_activity": minutes_since
            }));
        }

        results.sort_by(|a, b| {
            a.get("name")
                .and_then(|v| v.as_str())
                .cmp(&b.get("name").and_then(|v| v.as_str()))
        });

        Ok(results)
    }

    async fn get_performance_metrics(&self, limit: usize) -> Result<serde_json::Value> {
        use std::collections::HashMap;

        // Collect trace summaries (limited)
        let (summaries, _) = self.get_trace_summaries(1, limit, None).await?;

        if summaries.is_empty() {
            return Ok(serde_json::json!({
                "trace_latency": {
                    "avg_ms": 0.0,
                    "p50_ms": 0.0,
                    "p95_ms": 0.0,
                    "p99_ms": 0.0,
                    "slowest_traces": []
                },
                "event_performance": {
                    "avg_duration_ms": 0.0,
                    "by_type": [],
                    "slow_operations": []
                },
                "service_latency": [],
                "throughput": {
                    "events_per_second": 0.0,
                    "traces_per_second": 0.0,
                    "time_range_seconds": 0.0
                }
            }));
        }

        // Calculate trace durations
        let mut trace_durations: Vec<f64> = summaries
            .iter()
            .map(|s| {
                let duration = (s.last_timestamp - s.first_timestamp).num_milliseconds();
                duration.max(0) as f64
            })
            .filter(|d| *d > 0.0)
            .collect();

        trace_durations.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

        let avg_trace_duration = if !trace_durations.is_empty() {
            trace_durations.iter().sum::<f64>() / trace_durations.len() as f64
        } else {
            0.0
        };

        let p50 = percentile(&trace_durations, 0.5);
        let p95 = percentile(&trace_durations, 0.95);
        let p99 = percentile(&trace_durations, 0.99);

        // Slowest traces
        let mut trace_with_durations: Vec<(f64, &TraceSummary)> = summaries
            .iter()
            .map(|s| {
                let duration = (s.last_timestamp - s.first_timestamp)
                    .num_milliseconds()
                    .max(0) as f64;
                (duration, s)
            })
            .collect();
        trace_with_durations
            .sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

        let slowest_traces: Vec<serde_json::Value> = trace_with_durations
            .iter()
            .take(10)
            .map(|(duration, summary)| {
                serde_json::json!({
                    "trace_id": summary.trace_id.to_string(),
                    "duration_ms": duration,
                    "services": summary.services
                })
            })
            .collect();

        // Collect all events from sample traces (first 5 for performance)
        let sample_size = 5.min(summaries.len());
        let mut all_events = Vec::new();
        for summary in summaries.iter().take(sample_size) {
            let events = self.get_trace_events(summary.trace_id).await?;
            all_events.extend(events);
        }

        // Event type aggregations
        let mut event_type_stats: HashMap<String, (usize, f64)> = HashMap::new(); // (count, total_duration_ms)
        for event in &all_events {
            if let Some(duration_ns) = event.metadata.duration_ns {
                if duration_ns > 0 {
                    let duration_ms = duration_ns as f64 / 1_000_000.0;
                    let event_type = get_event_type_name(&event.kind);
                    let entry = event_type_stats.entry(event_type).or_insert((0, 0.0));
                    entry.0 += 1;
                    entry.1 += duration_ms;
                }
            }
        }

        let mut events_by_type: Vec<serde_json::Value> = event_type_stats
            .iter()
            .map(|(event_type, (count, total_duration))| {
                serde_json::json!({
                    "type": event_type,
                    "count": count,
                    "avg_duration_ms": if *count > 0 { total_duration / *count as f64 } else { 0.0 }
                })
            })
            .collect();
        events_by_type.sort_by(|a, b| {
            b.get("avg_duration_ms")
                .and_then(|v| v.as_f64())
                .partial_cmp(&a.get("avg_duration_ms").and_then(|v| v.as_f64()))
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let slow_operations: Vec<serde_json::Value> = events_by_type
            .iter()
            .filter(|e| {
                e.get("avg_duration_ms")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0)
                    > 100.0
            })
            .cloned()
            .collect();

        // Service latency
        let mut service_stats: HashMap<String, (usize, f64)> = HashMap::new();
        for event in &all_events {
            if let Some(duration_ns) = event.metadata.duration_ns {
                if duration_ns > 0 {
                    let duration_ms = duration_ns as f64 / 1_000_000.0;
                    let service = &event.metadata.service_name;
                    let entry = service_stats.entry(service.clone()).or_insert((0, 0.0));
                    entry.0 += 1;
                    entry.1 += duration_ms;
                }
            }
        }

        let mut service_latency: Vec<serde_json::Value> = service_stats
            .iter()
            .map(|(service, (count, total_duration))| {
                serde_json::json!({
                    "service": service,
                    "event_count": count,
                    "avg_duration_ms": if *count > 0 { total_duration / *count as f64 } else { 0.0 }
                })
            })
            .collect();
        service_latency.sort_by(|a, b| {
            b.get("avg_duration_ms")
                .and_then(|v| v.as_f64())
                .partial_cmp(&a.get("avg_duration_ms").and_then(|v| v.as_f64()))
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        // Throughput calculations
        let min_time = summaries.iter().map(|s| s.first_timestamp).min();
        let max_time = summaries.iter().map(|s| s.last_timestamp).max();

        let (events_per_second, traces_per_second, time_range_seconds) =
            if let (Some(min), Some(max)) = (min_time, max_time) {
                let duration_secs = (max - min).num_milliseconds() as f64 / 1000.0;
                let duration_secs = duration_secs.max(1.0); // Minimum 1 second

                let total_events: i64 = summaries.iter().map(|s| s.event_count).sum();
                let eps = total_events as f64 / duration_secs;
                let tps = summaries.len() as f64 / duration_secs;

                (eps, tps, duration_secs)
            } else {
                (0.0, 0.0, 0.0)
            };

        let avg_event_duration = if !all_events.is_empty() {
            let total: f64 = all_events
                .iter()
                .filter_map(|e| e.metadata.duration_ns.map(|d| d as f64 / 1_000_000.0))
                .sum();
            total / all_events.len() as f64
        } else {
            0.0
        };

        Ok(serde_json::json!({
            "trace_latency": {
                "avg_ms": avg_trace_duration,
                "p50_ms": p50,
                "p95_ms": p95,
                "p99_ms": p99,
                "slowest_traces": slowest_traces
            },
            "event_performance": {
                "avg_duration_ms": avg_event_duration,
                "by_type": events_by_type,
                "slow_operations": slow_operations
            },
            "service_latency": service_latency,
            "throughput": {
                "events_per_second": events_per_second,
                "traces_per_second": traces_per_second,
                "time_range_seconds": time_range_seconds
            }
        }))
    }

    async fn clear(&self) -> Result<()> {
        self.events.clear();
        self.trace_events.clear();
        self.baselines.clear();
        self.distributed_spans.clear();
        self.distributed_edges.clear();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::StorageConfig;
    use crate::event::EventMetadata;
    use chrono::{TimeZone, Utc};

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
    async fn memory_backend_distributed_insights() -> Result<()> {
        let backend = MemoryBackend::new(&StorageConfig::default())?;
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
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0]["from_service"], json!("service-a"));
        assert_eq!(edges[0]["to_service"], json!("service-b"));
        assert_eq!(edges[0]["call_count"].as_u64().unwrap(), 1);

        let races = backend.get_global_race_candidates().await?;
        assert_eq!(races.len(), 1);
        let race = &races[0];
        assert_eq!(race["variable"], json!("account.balance"));
        assert_eq!(race["severity"], json!("WARNING"));
        assert_eq!(race["trace_count"].as_u64().unwrap(), 2);

        let (top_variables, top_service_calls) = backend.get_system_hotspots().await?;
        assert!(!top_variables.is_empty());
        assert_eq!(top_variables[0]["variable"], json!("account.balance"));
        assert!(top_service_calls.iter().any(|entry| {
            entry["from_service"] == json!("service-a") && entry["to_service"] == json!("service-b")
        }));

        Ok(())
    }
}
