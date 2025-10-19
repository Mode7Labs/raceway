use super::storage_trait::StorageBackend;
use super::types::{
    AuditTrailData, CrossTraceRace, DurationStats, TraceAnalysisData, TraceSummary, VariableAccessData,
};
use crate::config::StorageConfig;
use crate::event::Event;
use crate::graph::{
    Anomaly, AuditTrail, CausalGraph, CriticalPath, GraphStats, ServiceDependencies, TreeNode,
};
use anyhow::Result;
use async_trait::async_trait;
use std::collections::HashMap;
use uuid::Uuid;

/// In-memory storage backend wrapping the existing CausalGraph
/// This will be fully refactored in Phase 2 to directly implement the trait
pub struct MemoryBackend {
    graph: CausalGraph,
}

impl MemoryBackend {
    pub fn new(_config: &StorageConfig) -> Result<Self> {
        Ok(Self {
            graph: CausalGraph::new(),
        })
    }
}

#[async_trait]
impl StorageBackend for MemoryBackend {
    async fn add_event(&self, event: Event) -> Result<()> {
        self.graph.add_event(event)
    }

    async fn get_event(&self, id: Uuid) -> Result<Option<Event>> {
        // Not currently implemented in CausalGraph
        // For now, we'll search through all events
        let trace_ids = self.graph.get_all_trace_ids();
        for trace_id in trace_ids {
            if let Ok(events) = self.graph.get_causal_order(trace_id) {
                if let Some(event) = events.into_iter().find(|e| e.id == id) {
                    return Ok(Some(event));
                }
            }
        }
        Ok(None)
    }

    async fn get_trace_events(&self, trace_id: Uuid) -> Result<Vec<Event>> {
        self.graph.get_causal_order(trace_id)
    }

    async fn get_causal_order(&self, trace_id: Uuid) -> Result<Vec<Event>> {
        self.graph.get_causal_order(trace_id)
    }

    async fn get_trace_analysis_data(&self, trace_id: Uuid) -> Result<TraceAnalysisData> {
        // Get events
        let events = self.graph.get_causal_order(trace_id)?;

        // Extract unique variables from StateChange events
        let mut variables = std::collections::HashSet::new();
        for event in &events {
            if let crate::event::EventKind::StateChange { variable, .. } = &event.kind {
                variables.insert(variable.clone());
            }
        }

        // Build audit trails for each variable
        let mut audit_trails = HashMap::new();
        for variable in variables {
            if let Ok(audit_trail) = self.graph.get_audit_trail(trace_id, &variable) {
                audit_trails.insert(variable, audit_trail.accesses);
            }
        }

        // Get critical path, anomalies, and dependencies from CausalGraph
        let critical_path = self.graph.get_critical_path(trace_id).ok();
        let anomalies = self.graph.detect_anomalies(trace_id).unwrap_or_default();
        let dependencies = self.graph.get_service_dependencies(trace_id).ok();

        Ok(TraceAnalysisData {
            events,
            audit_trails,
            critical_path,
            anomalies,
            dependencies,
        })
    }

    async fn get_all_trace_ids(&self) -> Result<Vec<Uuid>> {
        Ok(self.graph.get_all_trace_ids())
    }

    async fn get_trace_summaries(
        &self,
        page: usize,
        page_size: usize,
    ) -> Result<(Vec<TraceSummary>, usize)> {
        let all_trace_ids = self.graph.get_all_trace_ids();

        // Build summaries for all traces
        let mut summaries: Vec<TraceSummary> = Vec::new();
        for trace_id in all_trace_ids {
            if let Ok(events) = self.graph.get_causal_order(trace_id) {
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
        }

        // Sort by last_timestamp DESC (newest first)
        summaries.sort_by(|a, b| b.last_timestamp.cmp(&a.last_timestamp));

        let total_count = summaries.len();

        // Apply pagination
        let offset = (page.saturating_sub(1)) * page_size;
        let paginated = summaries
            .into_iter()
            .skip(offset)
            .take(page_size)
            .collect();

        Ok((paginated, total_count))
    }

    async fn get_trace_roots(&self, _trace_id: Uuid) -> Result<Vec<Uuid>> {
        // Not directly exposed by CausalGraph
        // Would need to access trace_roots DashMap
        Ok(Vec::new())
    }

    async fn get_trace_tree(&self, trace_id: Uuid) -> Result<Vec<TreeNode>> {
        self.graph.get_trace_tree(trace_id)
    }

    async fn find_concurrent_events(&self, trace_id: Uuid) -> Result<Vec<(Event, Event)>> {
        self.graph.find_concurrent_events(trace_id)
    }

    async fn find_global_concurrent_events(&self) -> Result<Vec<(Event, Event)>> {
        self.graph.find_global_concurrent_events()
    }

    async fn get_cross_trace_races(&self, variable: &str) -> Result<Vec<CrossTraceRace>> {
        // Not currently implemented in CausalGraph
        // This would need to be added or we can compute it from global concurrent events
        let concurrent_pairs = self.graph.find_global_concurrent_events()?;

        let mut races = Vec::new();
        for (event1, event2) in concurrent_pairs {
            // Extract variable names from StateChange events
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
                        confidence: 0.8, // Default confidence
                    });
                }
            }
        }

        Ok(races)
    }

    async fn get_critical_path(&self, trace_id: Uuid) -> Result<CriticalPath> {
        self.graph.get_critical_path(trace_id)
    }

    async fn update_baselines(&self, trace_id: Uuid) -> Result<()> {
        self.graph.update_baselines(trace_id)
    }

    async fn get_baseline_metric(&self, _operation: &str) -> Result<Option<DurationStats>> {
        // Not directly exposed by CausalGraph in the right format
        // Would need to access baseline_metrics DashMap and convert
        Ok(None)
    }

    async fn detect_anomalies(&self, trace_id: Uuid) -> Result<Vec<Anomaly>> {
        self.graph.detect_anomalies(trace_id)
    }

    async fn get_service_dependencies(&self, trace_id: Uuid) -> Result<ServiceDependencies> {
        self.graph.get_service_dependencies(trace_id)
    }

    async fn get_audit_trail(&self, trace_id: Uuid, variable: &str) -> Result<AuditTrail> {
        self.graph.get_audit_trail(trace_id, variable)
    }

    async fn get_audit_trail_data(&self, variable: &str) -> Result<Option<AuditTrailData>> {
        // Find all traces that have this variable
        let all_trace_ids = self.graph.get_all_trace_ids();

        for trace_id in all_trace_ids {
            if let Ok(audit_trail) = self.graph.get_audit_trail(trace_id, variable) {
                if !audit_trail.accesses.is_empty() {
                    // Convert AuditTrail to AuditTrailData
                    let race_count = audit_trail.accesses.iter().filter(|a| a.is_race).count();
                    let accesses: Vec<VariableAccessData> = audit_trail
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
                        trace_id: audit_trail.trace_id,
                        variable: audit_trail.variable,
                        total_accesses: accesses.len(),
                        race_count,
                        accesses,
                    }));
                }
            }
        }

        Ok(None)
    }

    async fn stats(&self) -> Result<GraphStats> {
        Ok(self.graph.stats())
    }

    async fn has_cycles(&self) -> Result<bool> {
        Ok(self.graph.has_cycles())
    }

    async fn cleanup_old_traces(&self, _retention_hours: u64) -> Result<usize> {
        // Not implemented in CausalGraph yet
        // Would need to iterate through traces and check timestamps
        Ok(0)
    }

    async fn clear(&self) -> Result<()> {
        // Not implemented in CausalGraph
        // Would need to clear all DashMaps and the graph
        Ok(())
    }
}
