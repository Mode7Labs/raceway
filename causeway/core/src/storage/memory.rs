use super::storage_trait::StorageBackend;
use super::types::{DurationStats, TraceSummary};
use crate::config::StorageConfig;
use crate::event::{DistributedEdge, DistributedSpan, Event};
use anyhow::Result;
use async_trait::async_trait;
use dashmap::DashMap;
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
}

impl MemoryBackend {
    pub fn new(_config: &StorageConfig) -> Result<Self> {
        Ok(Self {
            events: DashMap::new(),
            trace_events: DashMap::new(),
            baselines: DashMap::new(),
            distributed_spans: DashMap::new(),
            distributed_edges: DashMap::new(),
        })
    }
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

        // Sort by timestamp
        events.sort_by_key(|e| e.timestamp);

        Ok(events)
    }

    async fn get_all_events(&self) -> Result<Vec<Event>> {
        let mut events: Vec<Event> = self.events.iter().map(|e| e.value().clone()).collect();

        // Sort by timestamp for consistent ordering
        events.sort_by_key(|e| e.timestamp);

        Ok(events)
    }

    async fn get_all_trace_ids(&self) -> Result<Vec<Uuid>> {
        Ok(self.trace_events.iter().map(|e| *e.key()).collect())
    }

    async fn get_trace_summaries(
        &self,
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

            if !events.is_empty() {
                let event_count = events.len() as i64;
                let first_timestamp = events.iter().map(|e| e.timestamp).min().unwrap();
                let last_timestamp = events.iter().map(|e| e.timestamp).max().unwrap();

                summaries.push(TraceSummary {
                    trace_id,
                    event_count,
                    first_timestamp,
                    last_timestamp,
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
        self.distributed_spans.insert(span.span_id.clone(), span);
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
        // Get the trace_id from the span (we need to look it up)
        // For now, we'll need to find which trace this edge belongs to
        // by looking up the from_span
        if let Some(from_span) = self.distributed_spans.get(&edge.from_span) {
            let trace_id = from_span.trace_id;
            self.distributed_edges
                .entry(trace_id)
                .or_insert_with(|| RwLock::new(Vec::new()))
                .write()
                .unwrap()
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

                let entry = service_data.entry(service_name).or_insert((0, HashSet::new()));
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

    async fn clear(&self) -> Result<()> {
        self.events.clear();
        self.trace_events.clear();
        self.baselines.clear();
        self.distributed_spans.clear();
        self.distributed_edges.clear();
        Ok(())
    }
}
