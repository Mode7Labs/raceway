use crate::event::Event;
use crate::graph::{Anomaly, AuditTrail, CausalGraph, CriticalPath, ServiceDependencies, TreeNode};
use crate::storage::{CrossTraceRace, TraceAnalysisData, StorageBackend};
use anyhow::Result;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

/// AnalysisService coordinates between storage and computation
/// It maintains a single CausalGraph that works with any storage backend
pub struct AnalysisService {
    storage: Arc<dyn StorageBackend>,
    graph: Arc<RwLock<CausalGraph>>,
}

impl AnalysisService {
    /// Create a new AnalysisService with the given storage backend
    pub async fn new(storage: Arc<dyn StorageBackend>) -> Result<Self> {
        // Initialize graph by loading all events from storage
        let events = storage.get_all_events().await?;
        let graph = CausalGraph::from_events(events)?;

        // Load existing baselines from storage
        let baseline_operations = storage.get_all_baseline_operations().await?;
        for operation in baseline_operations {
            if let Some(baseline) = storage.get_baseline_metric(&operation).await? {
                graph.set_baseline(&operation, baseline);
            }
        }

        Ok(Self {
            storage,
            graph: Arc::new(RwLock::new(graph)),
        })
    }

    /// Add an event (this goes through storage, then updates graph)
    pub async fn add_event(&self, event: Event) -> Result<()> {
        // Persist to storage first
        self.storage.add_event(event.clone()).await?;

        // Then update in-memory graph
        let graph = self.graph.write().await;
        graph.add_event(event)?;

        Ok(())
    }

    /// Update baselines after processing a trace
    pub async fn update_baselines(&self, trace_id: Uuid) -> Result<()> {
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

    /// Detect anomalies in a trace
    pub async fn detect_anomalies(&self, trace_id: Uuid) -> Result<Vec<Anomaly>> {
        let graph = self.graph.read().await;
        graph.detect_anomalies(trace_id)
    }

    /// Get critical path for a trace
    pub async fn get_critical_path(&self, trace_id: Uuid) -> Result<CriticalPath> {
        let graph = self.graph.read().await;
        graph.get_critical_path(trace_id)
    }

    /// Find concurrent events within a trace
    pub async fn find_concurrent_events(&self, trace_id: Uuid) -> Result<Vec<(Event, Event)>> {
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
        let graph = self.graph.read().await;
        graph.get_service_dependencies(trace_id)
    }

    /// Get audit trail for a variable in a trace
    pub async fn get_audit_trail(&self, trace_id: Uuid, variable: &str) -> Result<AuditTrail> {
        let graph = self.graph.read().await;
        graph.get_audit_trail(trace_id, variable)
    }

    /// Get trace tree
    pub async fn get_trace_tree(&self, trace_id: Uuid) -> Result<Vec<TreeNode>> {
        let graph = self.graph.read().await;
        graph.get_trace_tree(trace_id)
    }

    /// Get causal order of events for a trace
    pub async fn get_causal_order(&self, trace_id: Uuid) -> Result<Vec<Event>> {
        let graph = self.graph.read().await;
        graph.get_causal_order(trace_id)
    }

    /// Get trace analysis data (batch fetch for UI)
    pub async fn get_trace_analysis_data(&self, trace_id: Uuid) -> Result<TraceAnalysisData> {
        // Fetch events from storage
        let events = self.storage.get_trace_events(trace_id).await?;

        // Get analysis results from graph
        let graph = self.graph.read().await;
        let anomalies = graph.detect_anomalies(trace_id)?;
        let critical_path = graph.get_critical_path(trace_id).ok();
        let dependencies = graph.get_service_dependencies(trace_id).ok();

        // Collect variables and their audit trails
        let mut variables = std::collections::HashSet::new();
        for event in &events {
            if let crate::event::EventKind::StateChange { variable, .. } = &event.kind {
                variables.insert(variable.clone());
            }
        }

        // Get audit trails for each variable
        let mut audit_trails = std::collections::HashMap::new();
        for variable in variables {
            if let Ok(trail) = graph.get_audit_trail(trace_id, &variable) {
                audit_trails.insert(variable, trail.accesses);
            }
        }

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

        Ok(())
    }
}
