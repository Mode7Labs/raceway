use crate::event::{AccessType, Event, EventKind};
use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use lru::LruCache;
use petgraph::algo::is_cyclic_directed;
use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::visit::EdgeRef;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::num::NonZeroUsize;
use std::sync::Mutex;
use uuid::Uuid;

/// Edge type representing the causal relationship between events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CausalEdge {
    DirectCall,          // Function A directly called function B
    AsyncSpawn,          // A spawned async task B
    AsyncAwait,          // A awaited future B
    DataDependency,      // B read data written by A
    HttpRequestResponse, // Request-response pair
    DatabaseQueryResult, // Query-result pair
}

/// Node in the causal graph
#[derive(Debug, Clone)]
pub struct CausalNode {
    pub event: Event,
    pub children: Vec<Uuid>,
    pub anomaly_score: f64, // automated anomaly score
}

/// Hierarchical tree node for trace visualization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeNode {
    pub id: String,
    pub kind: String,
    pub location: String,
    pub timestamp: DateTime<Utc>,
    pub duration_ms: Option<f64>,
    pub thread_id: String,
    pub children: Vec<TreeNode>,
}

/// Critical path through a trace (longest path by duration)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CriticalPath {
    pub path: Vec<Event>,
    pub total_duration_ms: f64,
    pub trace_total_duration_ms: f64,
    pub percentage_of_total: f64,
}

/// Baseline metrics for an event type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaselineMetrics {
    pub count: usize,
    pub mean_duration_ms: f64,
    pub std_dev: f64,
    pub p95: f64,
    pub min: f64,
    pub max: f64,
}

/// Detected anomaly
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Anomaly {
    pub event_id: String,
    pub event_kind: String,
    pub severity: AnomalySeverity,
    pub actual_duration_ms: f64,
    pub expected_duration_ms: f64,
    pub std_dev_from_mean: f64,
    pub description: String,
    pub location: String,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AnomalySeverity {
    Minor,    // 2-3 std dev
    Warning,  // 3-5 std dev
    Critical, // > 5 std dev
}

/// Service dependency information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceDependencies {
    pub trace_id: String,
    pub services: Vec<ServiceInfo>,
    pub dependencies: Vec<ServiceDependency>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceInfo {
    pub name: String,
    pub event_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceDependency {
    pub from: String,
    pub to: String,
    pub call_count: usize,
}

/// Audit trail for a specific variable
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditTrail {
    pub trace_id: String,
    pub variable: String,
    pub accesses: Vec<VariableAccess>,
}

/// A single access to a variable in the audit trail
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariableAccess {
    pub event_id: String,
    pub timestamp: DateTime<Utc>,
    pub thread_id: String,
    pub service_name: String,
    pub access_type: String,
    pub old_value: Option<serde_json::Value>,
    pub new_value: serde_json::Value,
    pub location: String,
    pub has_causal_link_to_previous: bool,
    pub is_race: bool,
}

const ANALYSIS_CACHE_CAPACITY: usize = 256;
const ANOMALY_CACHE_CAPACITY: usize = 256;

/// The causal graph maintains relationships between all captured events
pub struct CausalGraph {
    graph: Mutex<DiGraph<Uuid, CausalEdge>>,
    nodes: DashMap<Uuid, (NodeIndex, CausalNode)>,
    trace_roots: DashMap<Uuid, Vec<Uuid>>, // trace_id -> root event IDs
    analysis_cache: Mutex<LruCache<Uuid, Vec<(Event, Event)>>>, // bounded cache of concurrent pairs
    anomaly_cache: Mutex<LruCache<Uuid, Vec<Anomaly>>>, // bounded cache of anomalies
    vector_clocks: DashMap<Uuid, u64>, // trace_id -> logical clock value (fixes async migration)
    lock_sets: DashMap<String, HashSet<String>>, // thread_id -> currently held locks
    baseline_metrics: DashMap<String, BaselineMetrics>, // event_kind -> metrics
    baseline_durations: DashMap<String, Vec<f64>>, // event_kind -> all observed durations
    baselines_updated: DashMap<Uuid, bool>, // track which traces have been added to baselines
    variable_index: DashMap<String, Vec<Uuid>>, // variable_name -> event IDs accessing it (for fast race detection)
    /// External edges connecting events across services via distributed tracing
    /// Maps from downstream event_id to upstream event_ids
    distributed_edges: DashMap<Uuid, Vec<Uuid>>, // downstream_event_id -> upstream_event_ids
}

impl CausalGraph {
    pub fn new() -> Self {
        Self {
            graph: Mutex::new(DiGraph::new()),
            nodes: DashMap::new(),
            trace_roots: DashMap::new(),
            analysis_cache: Mutex::new(LruCache::new(
                NonZeroUsize::new(ANALYSIS_CACHE_CAPACITY)
                    .expect("analysis cache capacity must be > 0"),
            )),
            anomaly_cache: Mutex::new(LruCache::new(
                NonZeroUsize::new(ANOMALY_CACHE_CAPACITY)
                    .expect("anomaly cache capacity must be > 0"),
            )),
            vector_clocks: DashMap::new(),
            lock_sets: DashMap::new(),
            baseline_metrics: DashMap::new(),
            baseline_durations: DashMap::new(),
            baselines_updated: DashMap::new(),
            variable_index: DashMap::new(),
            distributed_edges: DashMap::new(),
        }
    }

    /// Add an event to the graph
    pub fn add_event(&self, mut event: Event) -> Result<()> {
        // Update vector clock for this trace (not thread, to handle async task migration)
        let trace_id = event.trace_id;
        let mut clock_value = self.vector_clocks.entry(trace_id).or_insert(0);
        *clock_value += 1;
        let current_clock = *clock_value;
        drop(clock_value);

        // Build the causality vector for this event
        // For single-service traces: component = trace_id.to_string()
        // For distributed traces: component = "service#instance"
        // Start with any pre-existing causality vector (from distributed propagation via SDKs)
        let mut causality_vector: Vec<(String, u64)> = event.causality_vector.clone();

        // If there's a parent, merge parent's vector clock (take max of each component)
        if let Some(parent_id) = event.parent_id {
            if let Some(parent_entry) = self.nodes.get(&parent_id) {
                let parent_event = &parent_entry.value().1.event;

                // Merge vector clocks: for each component in parent, take max with existing
                for (parent_component, parent_clock) in &parent_event.causality_vector {
                    if let Some(existing) = causality_vector
                        .iter_mut()
                        .find(|(c, _)| c == parent_component)
                    {
                        // Component exists in both - take the maximum
                        existing.1 = existing.1.max(*parent_clock);
                    } else {
                        // Component only in parent - add it
                        causality_vector.push((parent_component.clone(), *parent_clock));
                    }
                }
            }
        }

        // Determine the component key for this event's clock
        // Use distributed span info if available, otherwise use trace_id
        let component = if let Some(instance) = &event.metadata.instance_id {
            // Distributed trace: use "service#instance" format
            format!("{}#{}", event.metadata.service_name, instance)
        } else {
            // Single-service trace: use trace_id as component
            trace_id.to_string()
        };

        // Update or add this component's entry in the causality vector
        if let Some(existing) = causality_vector.iter_mut().find(|(c, _)| c == &component) {
            existing.1 = current_clock;
        } else {
            causality_vector.push((component, current_clock));
        }

        event.causality_vector = causality_vector;

        // Capture the current lock set for this thread BEFORE modifying it
        // (locks are still thread-local, not trace-local)
        let thread_id = event.metadata.thread_id.clone();
        let current_locks: Vec<String> = self
            .lock_sets
            .get(&thread_id)
            .map(|locks| locks.value().iter().cloned().collect())
            .unwrap_or_else(Vec::new);

        event.lock_set = current_locks;

        // Track lock operations (update lock set AFTER capturing for this event)
        match &event.kind {
            EventKind::LockAcquire { lock_id, .. } => {
                self.lock_sets
                    .entry(thread_id.clone())
                    .or_insert_with(HashSet::new)
                    .insert(lock_id.clone());
            }
            EventKind::LockRelease { lock_id, .. } => {
                if let Some(mut locks) = self.lock_sets.get_mut(&thread_id) {
                    locks.remove(lock_id);
                }
            }
            _ => {}
        }

        let mut graph = self.graph.lock().unwrap();
        let node_index = graph.add_node(event.id);

        let causal_node = CausalNode {
            event: event.clone(),
            children: Vec::new(),
            anomaly_score: 0.0,
        };

        // Link to parent if exists
        if let Some(parent_id) = event.parent_id {
            if let Some(parent_entry) = self.nodes.get(&parent_id) {
                let parent_idx = parent_entry.value().0;
                let edge = self.infer_edge_type(&event);
                graph.add_edge(parent_idx, node_index, edge);
            }
        } else {
            // This is a root event
            self.trace_roots
                .entry(event.trace_id)
                .or_insert_with(Vec::new)
                .push(event.id);
        }

        drop(graph); // Release lock before inserting into nodes
        self.nodes.insert(event.id, (node_index, causal_node));

        // Update variable index for fast race detection
        if let EventKind::StateChange { variable, .. } = &event.kind {
            self.variable_index
                .entry(variable.clone())
                .or_insert_with(Vec::new)
                .push(event.id);
        }

        // Invalidate per-trace caches so subsequent queries see fresh data
        self.invalidate_trace_caches(trace_id);

        Ok(())
    }

    /// Returns true if the graph already contains the specified event
    pub fn contains_event(&self, event_id: Uuid) -> bool {
        self.nodes.contains_key(&event_id)
    }

    /// Returns true if the graph has seen the given trace
    pub fn has_trace(&self, trace_id: Uuid) -> bool {
        self.trace_roots.contains_key(&trace_id)
    }

    /// Bulk-ingest a collection of events into the graph
    /// Events are replayed in timestamp order; children whose parents have not
    /// arrived yet are retried in subsequent passes.
    pub fn ingest_events(&self, mut events: Vec<Event>) -> Result<()> {
        if events.is_empty() {
            return Ok(());
        }

        events.sort_by_key(|event| event.timestamp);
        let mut pending = events;

        while !pending.is_empty() {
            let mut remaining = Vec::new();
            let mut progress = false;

            for event in pending.drain(..) {
                if let Some(parent_id) = event.parent_id {
                    if !self.contains_event(parent_id) {
                        remaining.push(event);
                        continue;
                    }
                }

                self.add_event(event)?;
                progress = true;
            }

            if !progress {
                // If no progress was made, insert remaining events anyway to avoid infinite loops.
                for event in remaining.drain(..) {
                    self.add_event(event)?;
                }
                break;
            }

            pending = remaining;
        }

        Ok(())
    }

    /// Construct a new causal graph by replaying the provided events.
    pub fn from_events(events: Vec<Event>) -> Result<Self> {
        let graph = Self::new();
        graph.ingest_events(events)?;
        Ok(graph)
    }

    /// Find an event ID by its distributed_span_id
    fn find_event_by_span(&self, span_id: &str) -> Option<Uuid> {
        for node_entry in self.nodes.iter() {
            let (event_id, (_, node)) = node_entry.pair();
            if let Some(ref event_span) = node.event.metadata.distributed_span_id {
                if event_span == span_id {
                    return Some(*event_id);
                }
            }
        }
        None
    }

    /// Add distributed edges from DistributedEdge records
    /// This connects events across services based on span relationships
    pub fn add_distributed_edges(&self, dist_edges: Vec<crate::event::DistributedEdge>) {
        for edge in dist_edges {
            // Find the upstream and downstream events by their span IDs
            let upstream_event_id = self.find_event_by_span(&edge.from_span);
            let downstream_event_id = self.find_event_by_span(&edge.to_span);

            if let (Some(up_id), Some(down_id)) = (upstream_event_id, downstream_event_id) {
                // Add to distributed_edges map
                self.distributed_edges
                    .entry(down_id)
                    .or_insert_with(Vec::new)
                    .push(up_id);

                tracing::debug!(
                    "Added distributed edge: {} (span {}) -> {} (span {})",
                    up_id,
                    edge.from_span,
                    down_id,
                    edge.to_span
                );
            } else {
                tracing::warn!(
                    "Could not find events for distributed edge: {} -> {} (events may not be loaded yet)",
                    edge.from_span,
                    edge.to_span
                );
            }
        }
    }

    /// Infer the type of causal edge based on event kinds
    fn infer_edge_type(&self, event: &Event) -> CausalEdge {
        match &event.kind {
            EventKind::AsyncSpawn { .. } => CausalEdge::AsyncSpawn,
            EventKind::AsyncAwait { .. } => CausalEdge::AsyncAwait,
            EventKind::HttpResponse { .. } => CausalEdge::HttpRequestResponse,
            EventKind::DatabaseResult { .. } => CausalEdge::DatabaseQueryResult,
            EventKind::StateChange { .. } => CausalEdge::DataDependency,
            _ => CausalEdge::DirectCall,
        }
    }

    /// Get all events in topological order (causal order)
    pub fn get_causal_order(&self, trace_id: Uuid) -> Result<Vec<Event>> {
        let root_ids = self
            .trace_roots
            .get(&trace_id)
            .ok_or_else(|| anyhow!("Trace not found: {}", trace_id))?;

        let mut events = Vec::new();
        let mut visited = HashSet::new();

        for root_id in root_ids.value() {
            self.collect_events_dfs(*root_id, &mut events, &mut visited);
        }

        Ok(events)
    }

    fn collect_events_dfs(
        &self,
        event_id: Uuid,
        events: &mut Vec<Event>,
        visited: &mut HashSet<Uuid>,
    ) {
        if visited.contains(&event_id) {
            return;
        }
        visited.insert(event_id);

        if let Some(entry) = self.nodes.get(&event_id) {
            let (node_idx, causal_node) = entry.value();
            events.push(causal_node.event.clone());

            // Get children from graph
            let graph = self.graph.lock().unwrap();
            let children: Vec<_> = graph
                .edges(*node_idx)
                .map(|edge| graph[edge.target()])
                .collect();
            drop(graph);

            for child_id in children {
                self.collect_events_dfs(child_id, events, visited);
            }
        }
    }

    /// Find all concurrent events (potential race conditions)
    /// Uses variable index for O(m * k²) complexity instead of O(n²)
    /// where m = number of variables, k = avg accesses per variable
    pub fn find_concurrent_events(&self, trace_id: Uuid) -> Result<Vec<(Event, Event)>> {
        // Check cache first
        if let Some(cached) = self.get_cached_concurrent(trace_id) {
            return Ok(cached);
        }

        let mut concurrent_pairs = Vec::new();

        let events = self.get_causal_order(trace_id)?;
        let mut per_variable: HashMap<String, Vec<Event>> = HashMap::new();

        for event in events.into_iter() {
            if let EventKind::StateChange { variable, .. } = &event.kind {
                per_variable
                    .entry(variable.clone())
                    .or_insert_with(Vec::new)
                    .push(event);
            }
        }

        for trace_events in per_variable.values_mut() {
            trace_events.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

            for i in 0..trace_events.len() {
                for j in (i + 1)..trace_events.len() {
                    if let (
                        EventKind::StateChange {
                            access_type: access1,
                            ..
                        },
                        EventKind::StateChange {
                            access_type: access2,
                            ..
                        },
                    ) = (&trace_events[i].kind, &trace_events[j].kind)
                    {
                        // Skip safe access patterns
                        if self.is_safe_access_pattern(*access1, *access2) {
                            continue;
                        }

                        // Different threads
                        if trace_events[i].metadata.thread_id != trace_events[j].metadata.thread_id
                        {
                            // Use vector clocks for happens-before check
                            if !self.happens_before_vc(&trace_events[i], &trace_events[j])
                                && !self.happens_before_vc(&trace_events[j], &trace_events[i])
                            {
                                // Check if accesses were protected by the same lock
                                if !self.protected_by_same_lock(&trace_events[i], &trace_events[j])
                                {
                                    concurrent_pairs
                                        .push((trace_events[i].clone(), trace_events[j].clone()));
                                }
                            }
                        }
                    }
                }
            }
        }

        // Store in cache unless we saw no relevant state changes (trace may still be ingesting)
        if !per_variable.is_empty() {
            self.cache_concurrent(trace_id, concurrent_pairs.clone());
        }

        Ok(concurrent_pairs)
    }

    fn get_cached_concurrent(&self, trace_id: Uuid) -> Option<Vec<(Event, Event)>> {
        let mut cache = self.analysis_cache.lock().unwrap();
        cache.get(&trace_id).cloned()
    }

    fn cache_concurrent(&self, trace_id: Uuid, pairs: Vec<(Event, Event)>) {
        let mut cache = self.analysis_cache.lock().unwrap();
        cache.put(trace_id, pairs);
    }

    fn get_cached_anomalies(&self, trace_id: Uuid) -> Option<Vec<Anomaly>> {
        let mut cache = self.anomaly_cache.lock().unwrap();
        cache.get(&trace_id).cloned()
    }

    fn cache_anomalies(&self, trace_id: Uuid, anomalies: Vec<Anomaly>) {
        let mut cache = self.anomaly_cache.lock().unwrap();
        cache.put(trace_id, anomalies);
    }

    fn invalidate_trace_caches(&self, trace_id: Uuid) {
        self.analysis_cache.lock().unwrap().pop(&trace_id);
        self.anomaly_cache.lock().unwrap().pop(&trace_id);
        self.baselines_updated.remove(&trace_id);
    }

    /// Check if event1 happens-before event2 using vector clocks
    /// This is more precise than graph paths as it captures all causal relationships
    /// Vector clocks use trace IDs (not thread IDs) to handle async task migration
    fn happens_before_vc(&self, event1: &Event, event2: &Event) -> bool {
        // event1 -> event2 if for all traces in VC1:
        // VC1[trace] <= VC2[trace]
        // AND there exists at least one trace where VC1[trace] < VC2[trace]

        if event1.causality_vector.is_empty() && event2.causality_vector.is_empty() {
            // Neither has vector clocks - they're concurrent (can't determine ordering)
            return false;
        }

        if event1.causality_vector.is_empty() {
            // event1 has no clock but event2 does - assume no happens-before
            return false;
        }

        if event2.causality_vector.is_empty() {
            // event2 has no clock but event1 does - assume no happens-before
            return false;
        }

        // Special case: If both events are on different threads in the same trace,
        // check if they're on concurrent branches (no ancestor relationship)
        if event1.trace_id == event2.trace_id
            && event1.metadata.thread_id != event2.metadata.thread_id
        {
            // Check if either event is an ancestor of the other
            // If neither is an ancestor, they're on concurrent branches
            if !self.is_ancestor(event1.id, event2.id) && !self.is_ancestor(event2.id, event1.id) {
                // Neither is an ancestor of the other - they're on concurrent branches
                return false;
            }
        }

        let mut found_less = false;
        let mut all_traces_match = true;

        // Check that event1's clock is <= event2's clock for all components in event1
        for (trace1, clock1) in &event1.causality_vector {
            if let Some((_, clock2)) = event2.causality_vector.iter().find(|(t, _)| t == trace1) {
                if clock1 > clock2 {
                    // event1 has a later clock for this trace - definitely not happens-before
                    return false;
                }
                if clock1 < clock2 {
                    found_less = true;
                }
            } else {
                // event2 doesn't have this trace in its vector clock
                // This means they're independent on this trace dimension
                // Can't establish happens-before if not all traces are present
                all_traces_match = false;
            }
        }

        // Happens-before requires:
        // 1. All traces in event1's VC are <= in event2's VC
        // 2. At least one trace is strictly less
        // 3. All traces from event1 are present in event2 (causally connected)
        found_less && all_traces_match
    }

    /// Check if ancestor_id is an ancestor of descendant_id in the parent chain
    fn is_ancestor(&self, ancestor_id: Uuid, descendant_id: Uuid) -> bool {
        if ancestor_id == descendant_id {
            return false; // An event is not its own ancestor
        }

        let mut visited = HashSet::new();

        // Trace back through parent chain and distributed edges
        let mut to_visit = vec![descendant_id];

        while let Some(current_id) = to_visit.pop() {
            if visited.contains(&current_id) {
                // Already checked this node
                continue;
            }
            visited.insert(current_id);

            // Check local parent
            if let Some(entry) = self.nodes.get(&current_id) {
                let event = &entry.value().1.event;
                if let Some(parent_id) = event.parent_id {
                    if parent_id == ancestor_id {
                        return true; // Found the ancestor through local parent
                    }
                    to_visit.push(parent_id);
                }
            }

            // Check distributed edges (upstream events in other services)
            if let Some(upstreams) = self.distributed_edges.get(&current_id) {
                for &upstream_id in upstreams.value() {
                    if upstream_id == ancestor_id {
                        return true; // Found the ancestor through distributed edge
                    }
                    to_visit.push(upstream_id);
                }
            }
        }

        false
    }

    /// Determine if two access types form a safe (non-racing) pattern
    /// This implements the rules from C++11/Rust memory model
    fn is_safe_access_pattern(&self, access1: AccessType, access2: AccessType) -> bool {
        use AccessType::*;

        match (access1, access2) {
            // Read-Read is always safe (even non-atomic)
            (Read, Read) => true,

            // Atomic reads can race with each other safely
            (AtomicRead, AtomicRead) => true,

            // Atomic RMW operations synchronize with each other
            // (they have implicit ordering semantics)
            (AtomicRMW, AtomicRMW) => false, // Still need to check - they can race

            // All other combinations need further checking
            _ => false,
        }
    }

    /// Check if two events were protected by the same lock
    /// Uses the historical lock sets captured at the time of each event
    fn protected_by_same_lock(&self, event1: &Event, event2: &Event) -> bool {
        // Use the lock sets that were captured when the events occurred
        let set1: HashSet<_> = event1.lock_set.iter().collect();
        let set2: HashSet<_> = event2.lock_set.iter().collect();

        // If they share any locks, they're protected from racing
        // This is correct because if both events held the same lock,
        // they must have executed in some serial order
        !set1.is_disjoint(&set2)
    }

    /// Find the causal path between two events
    pub fn find_causal_path(&self, from: Uuid, to: Uuid) -> Result<Vec<Event>> {
        let from_node = self
            .nodes
            .get(&from)
            .ok_or_else(|| anyhow!("Event not found: {}", from))?;
        let to_node = self
            .nodes
            .get(&to)
            .ok_or_else(|| anyhow!("Event not found: {}", to))?;

        let from_idx = from_node.value().0;
        let to_idx = to_node.value().0;

        let graph = self.graph.lock().unwrap();
        let path =
            petgraph::algo::astar(&*graph, from_idx, |finish| finish == to_idx, |_| 1, |_| 0);

        match path {
            Some((_, node_path)) => {
                let events: Vec<Event> = node_path
                    .into_iter()
                    .filter_map(|idx| {
                        let event_id = graph[idx];
                        self.nodes
                            .get(&event_id)
                            .map(|entry| entry.value().1.event.clone())
                    })
                    .collect();
                Ok(events)
            }
            None => Err(anyhow!("No causal path found between {} and {}", from, to)),
        }
    }

    /// Detect cycles in the graph (shouldn't happen in a proper causal graph)
    pub fn has_cycles(&self) -> bool {
        let graph = self.graph.lock().unwrap();
        is_cyclic_directed(&*graph)
    }

    /// Get statistics about the graph
    pub fn stats(&self) -> GraphStats {
        let graph = self.graph.lock().unwrap();
        GraphStats {
            total_events: self.nodes.len(),
            total_traces: self.trace_roots.len(),
            total_edges: graph.edge_count(),
            has_cycles: is_cyclic_directed(&*graph),
        }
    }

    /// Get all trace IDs
    pub fn get_all_trace_ids(&self) -> Vec<Uuid> {
        self.trace_roots.iter().map(|entry| *entry.key()).collect()
    }

    /// Build a hierarchical tree view of events for a trace
    pub fn get_trace_tree(&self, trace_id: Uuid) -> Result<Vec<TreeNode>> {
        let root_ids = self
            .trace_roots
            .get(&trace_id)
            .ok_or_else(|| anyhow!("Trace not found: {}", trace_id))?;

        let mut trees = Vec::new();
        for root_id in root_ids.value() {
            if let Some(tree) = self.build_tree_node(*root_id) {
                trees.push(tree);
            }
        }

        Ok(trees)
    }

    fn build_tree_node(&self, event_id: Uuid) -> Option<TreeNode> {
        let entry = self.nodes.get(&event_id)?;
        let (node_idx, causal_node) = entry.value();
        let event = &causal_node.event;

        // Get children from graph
        let graph = self.graph.lock().unwrap();
        let children: Vec<Uuid> = graph
            .edges(*node_idx)
            .map(|edge| graph[edge.target()])
            .collect();
        drop(graph);

        // Recursively build child nodes
        let child_trees: Vec<TreeNode> = children
            .into_iter()
            .filter_map(|child_id| self.build_tree_node(child_id))
            .collect();

        // Extract location information from event kind
        let location = self.get_event_location(event);

        // Calculate duration
        let duration_ms = event.metadata.duration_ns.map(|ns| ns as f64 / 1_000_000.0);

        Some(TreeNode {
            id: event.id.to_string(),
            kind: self.event_kind_name(&event.kind),
            location,
            timestamp: event.timestamp,
            duration_ms,
            thread_id: event.metadata.thread_id.clone(),
            children: child_trees,
        })
    }

    fn get_event_location(&self, event: &Event) -> String {
        match &event.kind {
            EventKind::FunctionCall {
                file,
                line,
                function_name,
                ..
            } => {
                format!("{}:{} ({})", file, line, function_name)
            }
            EventKind::StateChange { location, .. } => location.clone(),
            EventKind::LockAcquire { location, .. } => location.clone(),
            EventKind::LockRelease { location, .. } => location.clone(),
            EventKind::MemoryFence { location, .. } => location.clone(),
            EventKind::HttpRequest { url, .. } => url.clone(),
            EventKind::DatabaseQuery { database, .. } => database.clone(),
            _ => String::from("unknown"),
        }
    }

    fn event_kind_name(&self, kind: &EventKind) -> String {
        match kind {
            EventKind::FunctionCall { function_name, .. } => {
                format!("FunctionCall({})", function_name)
            }
            EventKind::AsyncSpawn { .. } => "AsyncSpawn".to_string(),
            EventKind::AsyncAwait { .. } => "AsyncAwait".to_string(),
            EventKind::StateChange { variable, .. } => format!("StateChange({})", variable),
            EventKind::LockAcquire { lock_type, .. } => format!("LockAcquire({})", lock_type),
            EventKind::LockRelease { lock_type, .. } => format!("LockRelease({})", lock_type),
            EventKind::MemoryFence { .. } => "MemoryFence".to_string(),
            EventKind::HttpRequest { method, .. } => format!("HttpRequest({})", method),
            EventKind::HttpResponse { status, .. } => format!("HttpResponse({})", status),
            EventKind::DatabaseQuery { .. } => "DatabaseQuery".to_string(),
            EventKind::DatabaseResult { .. } => "DatabaseResult".to_string(),
            EventKind::Error { error_type, .. } => format!("Error({})", error_type),
            EventKind::Custom { name, .. } => format!("Custom({})", name),
        }
    }

    /// Find the critical path (longest path by duration) through a trace
    /// This is async-aware: parallel branches are handled by taking MAX duration, not SUM
    pub fn get_critical_path(&self, trace_id: Uuid) -> Result<CriticalPath> {
        let events = self.get_causal_order(trace_id)?;

        if events.is_empty() {
            return Err(anyhow!("No events found for trace {}", trace_id));
        }

        // Build a map of event_id -> cumulative duration to that point
        let mut cumulative_durations: HashMap<Uuid, f64> = HashMap::new();
        let mut predecessors: HashMap<Uuid, Uuid> = HashMap::new();

        // Start with root events (no parent)
        for event in &events {
            if event.parent_id.is_none() {
                let duration = event.metadata.duration_ns.unwrap_or(0) as f64 / 1_000_000.0;
                cumulative_durations.insert(event.id, duration);
            }
        }

        // Process events in topological order
        for event in &events {
            // Get children and their edge types from graph
            if let Some(entry) = self.nodes.get(&event.id) {
                let (node_idx, _) = entry.value();
                let graph = self.graph.lock().unwrap();
                let mut children_with_edges: Vec<(Uuid, CausalEdge)> = graph
                    .edges(*node_idx)
                    .map(|edge| (graph[edge.target()], edge.weight().clone()))
                    .collect();
                drop(graph);

                // Also add distributed edges as children
                // Distributed edges point FROM this event TO downstream events in other services
                for node_entry in self.nodes.iter() {
                    let (child_id, _) = node_entry.pair();
                    if let Some(upstreams) = self.distributed_edges.get(child_id) {
                        if upstreams.value().contains(&event.id) {
                            // This event is upstream of child_id
                            children_with_edges.push((*child_id, CausalEdge::HttpRequestResponse));
                        }
                    }
                }

                if children_with_edges.is_empty() {
                    continue;
                }

                let current_cumulative =
                    cumulative_durations.get(&event.id).copied().unwrap_or(0.0);

                // Group children by whether they're concurrent (spawned) or sequential
                let mut spawned_children = Vec::new();
                let mut sequential_children = Vec::new();

                for (child_id, edge_type) in children_with_edges {
                    match edge_type {
                        CausalEdge::AsyncSpawn => spawned_children.push(child_id),
                        _ => sequential_children.push(child_id),
                    }
                }

                // For spawned (concurrent) children, we need to handle them specially:
                // Multiple spawned tasks run in parallel, so we take MAX not SUM
                // However, each spawned task still needs to propagate its own cumulative
                if !spawned_children.is_empty() {
                    // Check if these spawned children are truly concurrent with each other
                    let mut concurrent_groups: Vec<Vec<Uuid>> = Vec::new();

                    for &child_id in &spawned_children {
                        if let Some(child_entry) = self.nodes.get(&child_id) {
                            let child_event = &child_entry.value().1.event;

                            // Find which group this child belongs to (concurrent with existing group members)
                            let mut found_group = false;
                            for group in &mut concurrent_groups {
                                // Check if this child is concurrent with all members of the group
                                let is_concurrent_with_group = group.iter().all(|&other_id| {
                                    if let Some(other_entry) = self.nodes.get(&other_id) {
                                        let other_event = &other_entry.value().1.event;
                                        !self.happens_before_vc(child_event, other_event)
                                            && !self.happens_before_vc(other_event, child_event)
                                    } else {
                                        false
                                    }
                                });

                                if is_concurrent_with_group {
                                    group.push(child_id);
                                    found_group = true;
                                    break;
                                }
                            }

                            if !found_group {
                                concurrent_groups.push(vec![child_id]);
                            }
                        }
                    }

                    // For each concurrent group, they share the same base cumulative from parent
                    // But each calculates its own branch duration
                    for child_id in spawned_children {
                        if let Some(child_entry) = self.nodes.get(&child_id) {
                            let child_event = &child_entry.value().1.event;
                            let child_duration =
                                child_event.metadata.duration_ns.unwrap_or(0) as f64 / 1_000_000.0;

                            // For spawned tasks, the cumulative is parent's time + this task's time
                            // (The max logic happens when branches rejoin at an await point)
                            let new_cumulative = current_cumulative + child_duration;

                            let should_update = cumulative_durations
                                .get(&child_id)
                                .map(|&existing| new_cumulative > existing)
                                .unwrap_or(true);

                            if should_update {
                                cumulative_durations.insert(child_id, new_cumulative);
                                predecessors.insert(child_id, event.id);
                            }
                        }
                    }
                }

                // For sequential children, add durations normally
                for child_id in sequential_children {
                    if let Some(child_entry) = self.nodes.get(&child_id) {
                        let child_event = &child_entry.value().1.event;
                        let child_duration =
                            child_event.metadata.duration_ns.unwrap_or(0) as f64 / 1_000_000.0;
                        let new_cumulative = current_cumulative + child_duration;

                        let should_update = cumulative_durations
                            .get(&child_id)
                            .map(|&existing| new_cumulative > existing)
                            .unwrap_or(true);

                        if should_update {
                            cumulative_durations.insert(child_id, new_cumulative);
                            predecessors.insert(child_id, event.id);
                        }
                    }
                }
            }
        }

        // Find the event with maximum cumulative duration
        let (terminal_event_id, max_duration) = cumulative_durations
            .iter()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
            .ok_or_else(|| anyhow!("No events with durations found"))?;

        // Reconstruct the path
        let mut path = Vec::new();
        let mut current_id = *terminal_event_id;

        while let Some(entry) = self.nodes.get(&current_id) {
            let event = &entry.value().1.event;
            path.push(event.clone());

            if let Some(&pred_id) = predecessors.get(&current_id) {
                current_id = pred_id;
            } else {
                break;
            }
        }

        path.reverse(); // Start from root to terminal

        // Calculate total trace duration
        let total_duration: f64 = events
            .iter()
            .map(|e| e.metadata.duration_ns.unwrap_or(0) as f64 / 1_000_000.0)
            .sum();

        let percentage = if total_duration > 0.0 {
            (*max_duration / total_duration) * 100.0
        } else {
            0.0
        };

        Ok(CriticalPath {
            path,
            total_duration_ms: *max_duration,
            trace_total_duration_ms: total_duration,
            percentage_of_total: percentage,
        })
    }

    /// Update baseline metrics with events from a trace
    /// This accumulates durations across all traces, not just the current one
    pub fn update_baselines(&self, trace_id: Uuid) -> Result<()> {
        // Check if we've already processed this trace
        if self.baselines_updated.contains_key(&trace_id) {
            return Ok(());
        }

        let events = self.get_causal_order(trace_id)?;

        // Collect new durations from this trace by event kind
        let mut new_durations_by_kind: HashMap<String, Vec<f64>> = HashMap::new();

        for event in &events {
            if let Some(duration_ns) = event.metadata.duration_ns {
                let duration_ms = duration_ns as f64 / 1_000_000.0;
                let kind = self.event_kind_name(&event.kind);
                new_durations_by_kind
                    .entry(kind)
                    .or_insert_with(Vec::new)
                    .push(duration_ms);
            }
        }

        // Add new durations to the cumulative baseline durations
        for (kind, new_durations) in new_durations_by_kind {
            let mut entry = self
                .baseline_durations
                .entry(kind.clone())
                .or_insert_with(Vec::new);
            entry.extend(new_durations);
        }

        // Mark this trace as processed
        self.baselines_updated.insert(trace_id, true);

        // Recalculate metrics for all event kinds that have data
        for entry in self.baseline_durations.iter() {
            let kind = entry.key().clone();
            let mut all_durations = entry.value().clone();

            if all_durations.is_empty() {
                continue;
            }

            all_durations.sort_by(|a, b| a.partial_cmp(b).unwrap());

            let count = all_durations.len();
            let mean = all_durations.iter().sum::<f64>() / count as f64;

            // Calculate standard deviation
            let variance: f64 = all_durations
                .iter()
                .map(|d| (d - mean).powi(2))
                .sum::<f64>()
                / count as f64;
            let std_dev = variance.sqrt();

            // Calculate p95
            let p95_index = ((count as f64) * 0.95) as usize;
            let p95 = all_durations[p95_index.min(count - 1)];

            let min = all_durations[0];
            let max = all_durations[count - 1];

            // Update or insert baseline
            self.baseline_metrics.insert(
                kind,
                BaselineMetrics {
                    count,
                    mean_duration_ms: mean,
                    std_dev,
                    p95,
                    min,
                    max,
                },
            );
        }

        Ok(())
    }

    /// Set baseline metric for an operation (used when loading from storage)
    pub fn set_baseline(&self, operation: &str, stats: crate::storage::DurationStats) {
        // Convert DurationStats (storage format) to BaselineMetrics (graph format)
        let metrics = BaselineMetrics {
            count: stats.count,
            mean_duration_ms: stats.mean_duration_us / 1000.0,
            std_dev: stats.std_dev / 1000.0,
            p95: 0.0, // Not stored in DurationStats, will be recalculated if needed
            min: stats.min_duration_us as f64 / 1000.0,
            max: stats.max_duration_us as f64 / 1000.0,
        };

        self.baseline_metrics.insert(operation.to_string(), metrics);
    }

    /// Get all baseline metrics (used when persisting to storage)
    pub fn get_all_baselines(&self) -> HashMap<String, crate::storage::DurationStats> {
        self.baseline_metrics
            .iter()
            .map(|entry| {
                let operation = entry.key().clone();
                let metrics = entry.value();

                // Convert BaselineMetrics (graph format) to DurationStats (storage format)
                let stats = crate::storage::DurationStats {
                    count: metrics.count,
                    total_duration_us: (metrics.mean_duration_ms * 1000.0 * metrics.count as f64)
                        as u64,
                    min_duration_us: (metrics.min * 1000.0) as u64,
                    max_duration_us: (metrics.max * 1000.0) as u64,
                    mean_duration_us: metrics.mean_duration_ms * 1000.0,
                    variance: metrics.std_dev.powi(2) * 1_000_000.0, // Convert ms² to μs²
                    std_dev: metrics.std_dev * 1000.0,
                };

                (operation, stats)
            })
            .collect()
    }

    /// Detect anomalies in a trace based on baseline metrics
    pub fn detect_anomalies(&self, trace_id: Uuid) -> Result<Vec<Anomaly>> {
        // Check cache first - if we've already analyzed this trace, return cached results
        if let Some(cached) = self.get_cached_anomalies(trace_id) {
            return Ok(cached);
        }

        let events = self.get_causal_order(trace_id)?;

        // Check if we have sufficient baseline data before analyzing
        // If not, we should not cache empty results
        let mut has_sufficient_baseline = false;
        for event in &events {
            if event.metadata.duration_ns.is_some() {
                let kind = self.event_kind_name(&event.kind);
                if let Some(baseline) = self.baseline_metrics.get(&kind) {
                    if baseline.value().count >= 5 {
                        has_sufficient_baseline = true;
                        break;
                    }
                }
            }
        }

        // If we don't have sufficient baseline, don't cache and add this trace to baseline
        if !has_sufficient_baseline {
            self.update_baselines(trace_id)?;
            return Ok(Vec::new());
        }

        // Check for anomalies BEFORE adding this trace to baselines
        // This prevents the anomalous values from skewing the baseline
        let mut anomalies = Vec::new();

        for event in &events {
            if let Some(duration_ns) = event.metadata.duration_ns {
                let duration_ms = duration_ns as f64 / 1_000_000.0;
                let kind = self.event_kind_name(&event.kind);

                if let Some(baseline) = self.baseline_metrics.get(&kind) {
                    let baseline = baseline.value();

                    // Skip if we don't have enough samples
                    if baseline.count < 5 {
                        continue;
                    }

                    // Calculate how many standard deviations away from mean
                    let (std_dev_from_mean, is_anomaly) = if baseline.std_dev > 0.0 {
                        let sigma =
                            (duration_ms - baseline.mean_duration_ms).abs() / baseline.std_dev;
                        (sigma, sigma > 1.5)
                    } else {
                        // When std_dev is 0 (all baseline values are identical),
                        // flag as anomaly if the value differs by more than 20% from the mean
                        let percent_diff = ((duration_ms - baseline.mean_duration_ms).abs()
                            / baseline.mean_duration_ms)
                            * 100.0;
                        (percent_diff / 10.0, percent_diff > 20.0) // Scale percent to pseudo-sigma
                    };

                    // Only flag if significantly different
                    if is_anomaly {
                        let severity = if std_dev_from_mean > 5.0 {
                            AnomalySeverity::Critical
                        } else if std_dev_from_mean > 3.0 {
                            AnomalySeverity::Warning
                        } else {
                            AnomalySeverity::Minor
                        };

                        let description = format!(
                            "{} took {:.2}ms (expected {:.2}ms ± {:.2}ms, {:.1}σ from mean)",
                            kind,
                            duration_ms,
                            baseline.mean_duration_ms,
                            baseline.std_dev,
                            std_dev_from_mean
                        );

                        anomalies.push(Anomaly {
                            event_id: event.id.to_string(),
                            event_kind: kind.clone(),
                            severity,
                            actual_duration_ms: duration_ms,
                            expected_duration_ms: baseline.mean_duration_ms,
                            std_dev_from_mean,
                            description,
                            location: self.get_event_location(event),
                            timestamp: event.timestamp,
                        });
                    }
                }
            }
        }

        // Cache the anomalies BEFORE adding this trace to baselines
        // This ensures the cached results reflect the "first time" analysis
        self.cache_anomalies(trace_id, anomalies.clone());

        // AFTER caching and checking for anomalies, add this trace to baselines
        // Even if it's anomalous - this allows gradual adaptation to changing patterns
        self.update_baselines(trace_id)?;

        Ok(anomalies)
    }

    /// Find concurrent events across ALL traces (global race detection)
    pub fn find_global_concurrent_events(&self) -> Result<Vec<(Event, Event)>> {
        let mut all_state_changes = Vec::new();

        // Collect all StateChange events from all traces
        for node_entry in self.nodes.iter() {
            let (_node_idx, causal_node) = node_entry.value();
            if matches!(causal_node.event.kind, EventKind::StateChange { .. }) {
                all_state_changes.push(causal_node.event.clone());
            }
        }

        let mut concurrent_pairs = Vec::new();

        // Compare all state changes across traces
        for i in 0..all_state_changes.len() {
            for j in (i + 1)..all_state_changes.len() {
                let event1 = &all_state_changes[i];
                let event2 = &all_state_changes[j];

                if let (
                    EventKind::StateChange {
                        variable: var1,
                        access_type: access1,
                        ..
                    },
                    EventKind::StateChange {
                        variable: var2,
                        access_type: access2,
                        ..
                    },
                ) = (&event1.kind, &event2.kind)
                {
                    // Same variable access
                    if var1 == var2 {
                        // Skip safe access patterns
                        if self.is_safe_access_pattern(*access1, *access2) {
                            continue;
                        }

                        // Different threads OR different traces
                        if event1.metadata.thread_id != event2.metadata.thread_id
                            || event1.trace_id != event2.trace_id
                        {
                            // Use vector clocks for happens-before check
                            if !self.happens_before_vc(event1, event2)
                                && !self.happens_before_vc(event2, event1)
                            {
                                // Check if accesses were protected by the same lock
                                if !self.protected_by_same_lock(event1, event2) {
                                    concurrent_pairs.push((event1.clone(), event2.clone()));
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(concurrent_pairs)
    }

    /// Extract service dependencies from a trace
    /// Returns a map of services and their call relationships
    pub fn get_service_dependencies(&self, trace_id: Uuid) -> Result<ServiceDependencies> {
        let events = self.get_causal_order(trace_id)?;

        let mut service_event_counts: HashMap<String, usize> = HashMap::new();
        let mut dependencies: HashMap<(String, String), usize> = HashMap::new();

        // Count events per service
        for event in &events {
            let service = &event.metadata.service_name;
            *service_event_counts.entry(service.clone()).or_insert(0) += 1;
        }

        // Build dependency graph by analyzing parent-child relationships
        for event in &events {
            if let Some(parent_id) = event.parent_id {
                if let Some(parent_entry) = self.nodes.get(&parent_id) {
                    let parent_event = &parent_entry.value().1.event;
                    let parent_service = &parent_event.metadata.service_name;
                    let child_service = &event.metadata.service_name;

                    // Only count cross-service calls
                    if parent_service != child_service {
                        let key = (parent_service.clone(), child_service.clone());
                        *dependencies.entry(key).or_insert(0) += 1;
                    }
                }
            }
        }

        // Convert to response format
        let services: Vec<ServiceInfo> = service_event_counts
            .into_iter()
            .map(|(name, event_count)| ServiceInfo { name, event_count })
            .collect();

        let deps: Vec<ServiceDependency> = dependencies
            .into_iter()
            .map(|((from, to), call_count)| ServiceDependency {
                from,
                to,
                call_count,
            })
            .collect();

        Ok(ServiceDependencies {
            trace_id: trace_id.to_string(),
            services,
            dependencies: deps,
        })
    }

    /// Get audit trail for a specific variable in a trace
    /// Shows all accesses to that variable in chronological order with causal links
    pub fn get_audit_trail(&self, trace_id: Uuid, variable: &str) -> Result<AuditTrail> {
        let events = self.get_causal_order(trace_id)?;

        // Filter to only StateChange events for this variable
        let mut variable_events: Vec<Event> = events
            .into_iter()
            .filter(|e| {
                if let EventKind::StateChange { variable: var, .. } = &e.kind {
                    var == variable
                } else {
                    false
                }
            })
            .collect();

        // Sort by timestamp
        variable_events.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

        let accesses = self.build_variable_accesses(&variable_events);

        Ok(AuditTrail {
            trace_id: trace_id.to_string(),
            variable: variable.to_string(),
            accesses,
        })
    }

    /// Build audit trails for multiple variables in a single pass
    pub fn get_audit_trails_bulk(
        &self,
        trace_id: Uuid,
        variables: &HashSet<String>,
    ) -> Result<HashMap<String, Vec<VariableAccess>>> {
        if variables.is_empty() {
            return Ok(HashMap::new());
        }

        let events = self.get_causal_order(trace_id)?;
        let mut grouped: HashMap<String, Vec<Event>> = HashMap::new();

        for event in events.into_iter() {
            if let EventKind::StateChange { variable, .. } = &event.kind {
                if variables.contains(variable) {
                    grouped
                        .entry(variable.clone())
                        .or_insert_with(Vec::new)
                        .push(event);
                }
            }
        }

        let mut trails = HashMap::with_capacity(grouped.len());
        for (variable, mut variable_events) in grouped {
            variable_events.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
            let accesses = self.build_variable_accesses(&variable_events);
            trails.insert(variable, accesses);
        }

        Ok(trails)
    }

    fn build_variable_accesses(&self, variable_events: &[Event]) -> Vec<VariableAccess> {
        let mut accesses = Vec::new();

        for (i, event) in variable_events.iter().enumerate() {
            if let EventKind::StateChange {
                variable: _,
                old_value,
                new_value,
                location,
                access_type,
            } = &event.kind
            {
                // Check if there's a causal link to the previous access
                let has_causal_link_to_previous = if i > 0 {
                    let prev_event = &variable_events[i - 1];
                    self.happens_before_vc(prev_event, event)
                } else {
                    true // First access has no previous
                };

                // Check if this access is part of a race
                let is_race = if i > 0 {
                    let prev_event = &variable_events[i - 1];
                    // It's a race if:
                    // 1. Different threads
                    // 2. No causal link (already checked above)
                    // 3. Not protected by same lock
                    // 4. At least one write
                    event.metadata.thread_id != prev_event.metadata.thread_id
                        && !has_causal_link_to_previous
                        && !self.protected_by_same_lock(prev_event, event)
                        && (*access_type == AccessType::Write
                            || matches!(
                                prev_event.kind,
                                EventKind::StateChange {
                                    access_type: AccessType::Write,
                                    ..
                                }
                            ))
                } else {
                    false
                };

                let access_type_str = match access_type {
                    AccessType::Read => "Read",
                    AccessType::Write => "Write",
                    AccessType::AtomicRead => "AtomicRead",
                    AccessType::AtomicWrite => "AtomicWrite",
                    AccessType::AtomicRMW => "AtomicRMW",
                };

                accesses.push(VariableAccess {
                    event_id: event.id.to_string(),
                    timestamp: event.timestamp,
                    thread_id: event.metadata.thread_id.clone(),
                    service_name: event.metadata.service_name.clone(),
                    access_type: access_type_str.to_string(),
                    old_value: old_value.clone(),
                    new_value: new_value.clone(),
                    location: location.clone(),
                    has_causal_link_to_previous,
                    is_race,
                });
            }
        }

        accesses
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphStats {
    pub total_events: usize,
    pub total_traces: usize,
    pub total_edges: usize,
    pub has_cycles: bool,
}

impl Default for GraphStats {
    fn default() -> Self {
        Self {
            total_events: 0,
            total_traces: 0,
            total_edges: 0,
            has_cycles: false,
        }
    }
}

impl Default for CausalGraph {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::EventMetadata;
    use crate::storage::DurationStats;
    use chrono::{Duration as ChronoDuration, TimeZone, Utc};
    use std::collections::HashMap;

    #[test]
    fn test_add_event() {
        let graph = CausalGraph::new();
        let trace_id = Uuid::new_v4();

        let metadata = EventMetadata {
            thread_id: "main".to_string(),
            process_id: 1234,
            service_name: "test".to_string(),
            environment: "dev".to_string(),
            tags: HashMap::new(),
            duration_ns: None,
            instance_id: None,
            distributed_span_id: None,
            upstream_span_id: None,
        };

        let event = Event::new(
            EventKind::FunctionCall {
                function_name: "test".to_string(),
                module: "main".to_string(),
                args: serde_json::json!({}),
                file: "main.rs".to_string(),
                line: 1,
            },
            metadata,
            trace_id,
            None,
        );

        assert!(graph.add_event(event).is_ok());
        assert_eq!(graph.stats().total_events, 1);
    }

    #[test]
    fn concurrent_events_detect_race() {
        let graph = CausalGraph::new();
        let trace_id = Uuid::new_v4();
        let root_id = Uuid::new_v4();
        let base = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        graph
            .add_event(make_root(root_id, trace_id, base, "root"))
            .unwrap();

        for (id, thread, offset_ms) in [
            (Uuid::new_v4(), "worker-a", 1),
            (Uuid::new_v4(), "worker-b", 2),
        ] {
            graph
                .add_event(Event {
                    id,
                    trace_id,
                    parent_id: Some(root_id),
                    timestamp: base + ChronoDuration::milliseconds(offset_ms),
                    kind: EventKind::StateChange {
                        variable: "balance".into(),
                        old_value: Some(serde_json::json!(10)),
                        new_value: serde_json::json!(15),
                        location: "tests.rs:20".into(),
                        access_type: AccessType::Write,
                    },
                    metadata: metadata(thread, 8),
                    causality_vector: Vec::new(),
                    lock_set: Vec::new(),
                })
                .unwrap();
        }

        let races = graph.find_concurrent_events(trace_id).unwrap();
        assert_eq!(races.len(), 1);
    }

    #[test]
    fn lock_protected_events_do_not_race() {
        let graph = CausalGraph::new();
        let trace_id = Uuid::new_v4();
        let root_id = Uuid::new_v4();
        let base = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        graph
            .add_event(make_root(root_id, trace_id, base, "root"))
            .unwrap();

        // Both threads acquire the same lock before writing.
        for (thread, offset_ms) in [("worker-a", 1), ("worker-b", 1)] {
            graph
                .add_event(Event {
                    id: Uuid::new_v4(),
                    trace_id,
                    parent_id: Some(root_id),
                    timestamp: base + ChronoDuration::milliseconds(offset_ms),
                    kind: EventKind::LockAcquire {
                        lock_id: "balance-lock".into(),
                        lock_type: "Mutex".into(),
                        location: "tests.rs:12".into(),
                    },
                    metadata: metadata(thread, 1),
                    causality_vector: Vec::new(),
                    lock_set: Vec::new(),
                })
                .unwrap();
        }

        for (thread, offset_ms) in [("worker-a", 2), ("worker-b", 3)] {
            graph
                .add_event(Event {
                    id: Uuid::new_v4(),
                    trace_id,
                    parent_id: Some(root_id),
                    timestamp: base + ChronoDuration::milliseconds(offset_ms),
                    kind: EventKind::StateChange {
                        variable: "balance".into(),
                        old_value: Some(serde_json::json!(10)),
                        new_value: serde_json::json!(15),
                        location: "tests.rs:22".into(),
                        access_type: AccessType::Write,
                    },
                    metadata: metadata(thread, 5),
                    causality_vector: Vec::new(),
                    lock_set: Vec::new(),
                })
                .unwrap();
        }

        let races = graph.find_concurrent_events(trace_id).unwrap();
        assert!(races.is_empty());
    }

    #[test]
    fn critical_path_prefers_longer_branch() {
        let graph = CausalGraph::new();
        let trace_id = Uuid::new_v4();
        let root_id = Uuid::new_v4();
        let fast_id = Uuid::new_v4();
        let slow_id = Uuid::new_v4();
        let base = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        graph
            .add_event(make_root(root_id, trace_id, base, "root"))
            .unwrap();

        graph
            .add_event(Event {
                id: fast_id,
                trace_id,
                parent_id: Some(root_id),
                timestamp: base + ChronoDuration::milliseconds(1),
                kind: EventKind::FunctionCall {
                    function_name: "fast".into(),
                    module: "tests".into(),
                    args: serde_json::json!({}),
                    file: "tests.rs".into(),
                    line: 20,
                },
                metadata: metadata("fast", 5),
                causality_vector: Vec::new(),
                lock_set: Vec::new(),
            })
            .unwrap();

        graph
            .add_event(Event {
                id: slow_id,
                trace_id,
                parent_id: Some(root_id),
                timestamp: base + ChronoDuration::milliseconds(2),
                kind: EventKind::FunctionCall {
                    function_name: "slow".into(),
                    module: "tests".into(),
                    args: serde_json::json!({}),
                    file: "tests.rs".into(),
                    line: 30,
                },
                metadata: metadata("slow", 20),
                causality_vector: Vec::new(),
                lock_set: Vec::new(),
            })
            .unwrap();

        let path = graph.get_critical_path(trace_id).unwrap();
        assert!(path.path.iter().any(|event| matches!(
            &event.kind,
            EventKind::FunctionCall { function_name, .. } if function_name == "slow"
        )));
    }

    #[test]
    fn anomalies_ignore_baseline_duration() {
        let graph = CausalGraph::new();
        let trace_id = Uuid::new_v4();
        let base = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        graph.set_baseline(
            "HttpResponse(200)",
            DurationStats {
                count: 10,
                total_duration_us: 170_000,
                min_duration_us: 15_000,
                max_duration_us: 19_000,
                mean_duration_us: 17_000.0,
                variance: (2_000.0_f64).powi(2),
                std_dev: 2_000.0,
            },
        );

        graph
            .add_event(Event {
                id: Uuid::new_v4(),
                trace_id,
                parent_id: None,
                timestamp: base,
                kind: EventKind::HttpResponse {
                    status: 200,
                    headers: HashMap::new(),
                    body: None,
                    duration_ms: 0,
                },
                metadata: metadata("http", 17),
                causality_vector: Vec::new(),
                lock_set: Vec::new(),
            })
            .unwrap();

        assert!(graph.detect_anomalies(trace_id).unwrap().is_empty());
    }

    #[test]
    fn anomalies_trigger_when_duration_exceeds_baseline() {
        let graph = CausalGraph::new();
        let trace_id = Uuid::new_v4();
        let base = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        graph
            .add_event(Event {
                id: Uuid::new_v4(),
                trace_id,
                parent_id: None,
                timestamp: base,
                kind: EventKind::HttpResponse {
                    status: 200,
                    headers: HashMap::new(),
                    body: None,
                    duration_ms: 0,
                },
                metadata: metadata("http", 17),
                causality_vector: Vec::new(),
                lock_set: Vec::new(),
            })
            .unwrap();

        graph.set_baseline(
            "HttpResponse(200)",
            DurationStats {
                count: 10,
                total_duration_us: 170_000,
                min_duration_us: 15_000,
                max_duration_us: 19_000,
                mean_duration_us: 17_000.0,
                variance: (2_000.0_f64).powi(2),
                std_dev: 2_000.0,
            },
        );

        graph
            .add_event(Event {
                id: Uuid::new_v4(),
                trace_id,
                parent_id: None,
                timestamp: base + ChronoDuration::milliseconds(1),
                kind: EventKind::HttpResponse {
                    status: 200,
                    headers: HashMap::new(),
                    body: None,
                    duration_ms: 0,
                },
                metadata: metadata("http", 40),
                causality_vector: Vec::new(),
                lock_set: Vec::new(),
            })
            .unwrap();

        let anomalies = graph.detect_anomalies(trace_id).unwrap();
        assert_eq!(anomalies.len(), 1);
    }

    #[test]
    fn audit_trail_flags_race_access() {
        let graph = CausalGraph::new();
        let trace_id = Uuid::new_v4();
        let root_id = Uuid::new_v4();
        let base = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        graph
            .add_event(make_root(root_id, trace_id, base, "root"))
            .unwrap();

        for (thread, offset_ms, new_value) in [("worker-a", 1_i64, 15), ("worker-b", 2_i64, 20)] {
            graph
                .add_event(Event {
                    id: Uuid::new_v4(),
                    trace_id,
                    parent_id: Some(root_id),
                    timestamp: base + ChronoDuration::milliseconds(offset_ms),
                    kind: EventKind::StateChange {
                        variable: "balance".into(),
                        old_value: Some(serde_json::json!(10)),
                        new_value: serde_json::json!(new_value),
                        location: format!("tests.rs:{}", 10 + offset_ms),
                        access_type: AccessType::Write,
                    },
                    metadata: metadata(thread, 5),
                    causality_vector: Vec::new(),
                    lock_set: Vec::new(),
                })
                .unwrap();
        }

        let trail = graph.get_audit_trail(trace_id, "balance").unwrap();
        assert_eq!(trail.accesses.len(), 2);
        assert!(trail.accesses.iter().any(|access| access.is_race));
    }

    #[test]
    fn service_dependencies_capture_cross_service_calls() {
        let graph = CausalGraph::new();
        let trace_id = Uuid::new_v4();
        let root_id = Uuid::new_v4();
        let child_id = Uuid::new_v4();
        let base = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        graph
            .add_event(Event {
                id: root_id,
                trace_id,
                parent_id: None,
                timestamp: base,
                kind: EventKind::FunctionCall {
                    function_name: "root".into(),
                    module: "svc_a".into(),
                    args: serde_json::json!({}),
                    file: "svc_a.rs".into(),
                    line: 10,
                },
                metadata: metadata_with_service("main", "svc-a", 5),
                causality_vector: Vec::new(),
                lock_set: Vec::new(),
            })
            .unwrap();

        graph
            .add_event(Event {
                id: child_id,
                trace_id,
                parent_id: Some(root_id),
                timestamp: base + ChronoDuration::milliseconds(1),
                kind: EventKind::FunctionCall {
                    function_name: "child".into(),
                    module: "svc_b".into(),
                    args: serde_json::json!({}),
                    file: "svc_b.rs".into(),
                    line: 20,
                },
                metadata: metadata_with_service("worker", "svc-b", 7),
                causality_vector: Vec::new(),
                lock_set: Vec::new(),
            })
            .unwrap();

        let deps = graph.get_service_dependencies(trace_id).unwrap();
        assert_eq!(deps.services.len(), 2);
        assert!(deps
            .dependencies
            .iter()
            .any(|dep| dep.from == "svc-a" && dep.to == "svc-b" && dep.call_count == 1));
    }

    #[test]
    fn global_concurrency_detects_cross_trace_races() {
        let graph = CausalGraph::new();
        let base = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        let traces = [
            (Uuid::new_v4(), Uuid::new_v4(), "worker-a"),
            (Uuid::new_v4(), Uuid::new_v4(), "worker-b"),
        ];

        for (trace_id, root_id, thread) in traces {
            graph
                .add_event(make_root(root_id, trace_id, base, "root"))
                .unwrap();

            graph
                .add_event(Event {
                    id: Uuid::new_v4(),
                    trace_id,
                    parent_id: Some(root_id),
                    timestamp: base + ChronoDuration::milliseconds(1),
                    kind: EventKind::StateChange {
                        variable: "shared".into(),
                        old_value: Some(serde_json::json!(0)),
                        new_value: serde_json::json!(1),
                        location: "tests.rs:50".into(),
                        access_type: AccessType::Write,
                    },
                    metadata: metadata(thread, 4),
                    causality_vector: Vec::new(),
                    lock_set: Vec::new(),
                })
                .unwrap();
        }

        let global = graph.find_global_concurrent_events().unwrap();
        assert!(
            global
                .iter()
                .any(|(a, b)| a.trace_id != b.trace_id
                    && a.metadata.thread_id != b.metadata.thread_id),
            "expected cross-trace concurrent pair, got {:?}",
            global
        );
    }

    #[test]
    fn vector_clocks_establish_happens_before() {
        let graph = CausalGraph::new();
        let trace_id = Uuid::new_v4();
        let root_id = Uuid::new_v4();
        let child_id = Uuid::new_v4();
        let sibling_id = Uuid::new_v4();
        let base = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        graph
            .add_event(make_root(root_id, trace_id, base, "root"))
            .unwrap();

        graph
            .add_event(Event {
                id: child_id,
                trace_id,
                parent_id: Some(root_id),
                timestamp: base + ChronoDuration::milliseconds(1),
                kind: EventKind::AsyncSpawn {
                    task_id: Uuid::new_v4(),
                    spawned_by: "root".into(),
                },
                metadata: metadata("spawn", 2),
                causality_vector: Vec::new(),
                lock_set: Vec::new(),
            })
            .unwrap();

        graph
            .add_event(Event {
                id: sibling_id,
                trace_id,
                parent_id: Some(root_id),
                timestamp: base + ChronoDuration::milliseconds(2),
                kind: EventKind::FunctionCall {
                    function_name: "sibling".into(),
                    module: "tests".into(),
                    args: serde_json::json!({}),
                    file: "tests.rs".into(),
                    line: 60,
                },
                metadata: metadata("sibling", 3),
                causality_vector: Vec::new(),
                lock_set: Vec::new(),
            })
            .unwrap();

        let child_event = graph.nodes.get(&child_id).unwrap().value().1.event.clone();
        let sibling_event = graph
            .nodes
            .get(&sibling_id)
            .unwrap()
            .value()
            .1
            .event
            .clone();
        let root_event = graph.nodes.get(&root_id).unwrap().value().1.event.clone();

        assert!(graph.happens_before_vc(&root_event, &child_event));
        assert!(graph.happens_before_vc(&root_event, &sibling_event));
        assert!(
            !graph.happens_before_vc(&child_event, &sibling_event)
                && !graph.happens_before_vc(&sibling_event, &child_event),
            "spawned child and sibling should be concurrent"
        );
    }

    fn metadata(thread: &str, duration_ms: u64) -> EventMetadata {
        metadata_with_service(thread, "test-service", duration_ms)
    }

    fn metadata_with_service(thread: &str, service: &str, duration_ms: u64) -> EventMetadata {
        EventMetadata {
            thread_id: thread.to_string(),
            process_id: 1,
            service_name: service.into(),
            environment: "test".into(),
            tags: HashMap::new(),
            duration_ns: Some(duration_ms * 1_000_000),
            instance_id: None,
            distributed_span_id: None,
            upstream_span_id: None,
        }
    }

    fn make_root(id: Uuid, trace_id: Uuid, timestamp: DateTime<Utc>, name: &str) -> Event {
        Event {
            id,
            trace_id,
            parent_id: None,
            timestamp,
            kind: EventKind::FunctionCall {
                function_name: name.into(),
                module: "tests".into(),
                args: serde_json::json!({}),
                file: "tests.rs".into(),
                line: 1,
            },
            metadata: metadata("main", 5),
            causality_vector: Vec::new(),
            lock_set: Vec::new(),
        }
    }

    // ─── Vector Clock Tests ─────────────────────────────────────────────────

    #[test]
    fn vector_clock_merge_during_event_ingestion() {
        let graph = CausalGraph::new();
        let trace_id = Uuid::new_v4();
        let base = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        // Event 1: service-a#instance-1
        let event1_id = Uuid::new_v4();
        let mut metadata1 = metadata_with_service("thread-1", "service-a", 5);
        metadata1.instance_id = Some("instance-1".into());

        graph
            .add_event(Event {
                id: event1_id,
                trace_id,
                parent_id: None,
                timestamp: base,
                kind: EventKind::FunctionCall {
                    function_name: "handler1".into(),
                    module: "svc-a".into(),
                    args: serde_json::json!({}),
                    file: "svc_a.rs".into(),
                    line: 10,
                },
                metadata: metadata1,
                causality_vector: Vec::new(),
                lock_set: Vec::new(),
            })
            .unwrap();

        // Get event1's clock and pass it to event2 to simulate distributed propagation
        let event1 = graph.nodes.get(&event1_id).unwrap().value().1.event.clone();
        let inherited_clock = event1.causality_vector.clone();

        // Event 2: service-b#instance-1, receives inherited clock from service-a
        let event2_id = Uuid::new_v4();
        let mut metadata2 = metadata_with_service("thread-2", "service-b", 7);
        metadata2.instance_id = Some("instance-1".into());

        graph
            .add_event(Event {
                id: event2_id,
                trace_id,
                parent_id: None,
                timestamp: base + ChronoDuration::milliseconds(5),
                kind: EventKind::FunctionCall {
                    function_name: "handler2".into(),
                    module: "svc-b".into(),
                    args: serde_json::json!({}),
                    file: "svc_b.rs".into(),
                    line: 20,
                },
                metadata: metadata2,
                causality_vector: inherited_clock,
                lock_set: Vec::new(),
            })
            .unwrap();

        let event2 = graph.nodes.get(&event2_id).unwrap().value().1.event.clone();

        // Verify event2 has both service-a and service-b in its clock vector
        // service-a component was inherited, service-b component was added by add_event
        let has_service_a = event2
            .causality_vector
            .iter()
            .any(|(component, _)| component.starts_with("service-a#"));
        let has_service_b = event2
            .causality_vector
            .iter()
            .any(|(component, _)| component.starts_with("service-b#"));

        assert!(
            has_service_a,
            "event2 should inherit service-a component, clock: {:?}",
            event2.causality_vector
        );
        assert!(
            has_service_b,
            "event2 should have service-b component, clock: {:?}",
            event2.causality_vector
        );
        assert_eq!(
            event2.causality_vector.len(),
            2,
            "event2 should have exactly 2 components (service-a + service-b)"
        );
    }

    #[test]
    fn vector_clock_concurrent_events_different_services() {
        let graph = CausalGraph::new();
        let trace_id = Uuid::new_v4();
        let base = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        // Create two events in different services with independent clocks
        let event1_id = Uuid::new_v4();
        let mut metadata1 = metadata_with_service("thread-1", "service-a", 5);
        metadata1.instance_id = Some("instance-1".into());

        graph
            .add_event(Event {
                id: event1_id,
                trace_id,
                parent_id: None,
                timestamp: base,
                kind: EventKind::StateChange {
                    variable: "balance".into(),
                    old_value: Some(serde_json::json!(100)),
                    new_value: serde_json::json!(50),
                    location: "account.rs:10".into(),
                    access_type: AccessType::Write,
                },
                metadata: metadata1,
                causality_vector: vec![("service-a#instance-1".into(), 5)],
                lock_set: Vec::new(),
            })
            .unwrap();

        let event2_id = Uuid::new_v4();
        let mut metadata2 = metadata_with_service("thread-2", "service-b", 7);
        metadata2.instance_id = Some("instance-1".into());

        graph
            .add_event(Event {
                id: event2_id,
                trace_id,
                parent_id: None,
                timestamp: base + ChronoDuration::milliseconds(1),
                kind: EventKind::StateChange {
                    variable: "balance".into(),
                    old_value: Some(serde_json::json!(100)),
                    new_value: serde_json::json!(75),
                    location: "account.rs:20".into(),
                    access_type: AccessType::Write,
                },
                metadata: metadata2,
                causality_vector: vec![("service-b#instance-1".into(), 4)],
                lock_set: Vec::new(),
            })
            .unwrap();

        let event1 = graph.nodes.get(&event1_id).unwrap().value().1.event.clone();
        let event2 = graph.nodes.get(&event2_id).unwrap().value().1.event.clone();

        // Neither should happen-before the other (concurrent)
        assert!(
            !graph.happens_before_vc(&event1, &event2),
            "event1 should not happen-before event2"
        );
        assert!(
            !graph.happens_before_vc(&event2, &event1),
            "event2 should not happen-before event1"
        );
    }

    #[test]
    fn vector_clock_merge_distributed_context() {
        let graph = CausalGraph::new();
        let trace_id = Uuid::new_v4();
        let base = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        // Event A: First event in service-a
        let event_a_id = Uuid::new_v4();
        let mut metadata_a = metadata_with_service("thread-1", "service-a", 5);
        metadata_a.instance_id = Some("inst-1".into());

        graph
            .add_event(Event {
                id: event_a_id,
                trace_id,
                parent_id: None,
                timestamp: base,
                kind: EventKind::FunctionCall {
                    function_name: "handleRequest".into(),
                    module: "api".into(),
                    args: serde_json::json!({}),
                    file: "api.rs".into(),
                    line: 10,
                },
                metadata: metadata_a,
                causality_vector: Vec::new(),
                lock_set: Vec::new(),
            })
            .unwrap();

        let event_a = graph
            .nodes
            .get(&event_a_id)
            .unwrap()
            .value()
            .1
            .event
            .clone();
        let clock_from_a = event_a.causality_vector.clone();

        // Event B: In service-b, receives clock from service-a via distributed propagation
        // This simulates what happens when an SDK sends a pre-populated causality_vector
        let event_b_id = Uuid::new_v4();
        let mut metadata_b = metadata_with_service("thread-2", "service-b", 7);
        metadata_b.instance_id = Some("inst-1".into());

        graph
            .add_event(Event {
                id: event_b_id,
                trace_id,
                parent_id: None,
                timestamp: base + ChronoDuration::milliseconds(10),
                kind: EventKind::FunctionCall {
                    function_name: "processData".into(),
                    module: "processor".into(),
                    args: serde_json::json!({}),
                    file: "processor.rs".into(),
                    line: 20,
                },
                metadata: metadata_b,
                causality_vector: clock_from_a, // Inherited from service-a
                lock_set: Vec::new(),
            })
            .unwrap();

        let event_b = graph
            .nodes
            .get(&event_b_id)
            .unwrap()
            .value()
            .1
            .event
            .clone();

        // Verify that event B's clock contains BOTH service-a and service-b components
        // This validates the bug fix: incoming causality_vector is preserved AND merged
        let service_a_component = event_b
            .causality_vector
            .iter()
            .find(|(c, _)| c.starts_with("service-a#"));
        let service_b_component = event_b
            .causality_vector
            .iter()
            .find(|(c, _)| c.starts_with("service-b#"));

        assert!(
            service_a_component.is_some(),
            "Event B should have service-a component (inherited): {:?}",
            event_b.causality_vector
        );
        assert!(
            service_b_component.is_some(),
            "Event B should have service-b component (added): {:?}",
            event_b.causality_vector
        );

        // Verify clock values make sense
        let (_, a_clock) = service_a_component.unwrap();
        let (_, b_clock) = service_b_component.unwrap();

        assert!(
            *a_clock > 0,
            "service-a clock should be > 0 (inherited from A)"
        );
        assert!(
            *b_clock > 0,
            "service-b clock should be > 0 (incremented by add_event)"
        );

        // Verify that the merge preserved the original service-a clock value
        let (_, original_a_clock) = event_a
            .causality_vector
            .iter()
            .find(|(c, _)| c.starts_with("service-a#"))
            .expect("Event A should have service-a component");

        assert_eq!(
            a_clock, original_a_clock,
            "service-a clock should be preserved from A to B"
        );
    }

    #[test]
    fn vector_clock_increment_on_event_ingestion() {
        let graph = CausalGraph::new();
        let trace_id = Uuid::new_v4();
        let base = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        let mut metadata = metadata_with_service("thread-1", "service-a", 5);
        metadata.instance_id = Some("inst-1".into());

        // Add first event
        let event1_id = Uuid::new_v4();
        graph
            .add_event(Event {
                id: event1_id,
                trace_id,
                parent_id: None,
                timestamp: base,
                kind: EventKind::FunctionCall {
                    function_name: "step1".into(),
                    module: "app".into(),
                    args: serde_json::json!({}),
                    file: "app.rs".into(),
                    line: 10,
                },
                metadata: metadata.clone(),
                causality_vector: Vec::new(),
                lock_set: Vec::new(),
            })
            .unwrap();

        // Add second event
        let event2_id = Uuid::new_v4();
        graph
            .add_event(Event {
                id: event2_id,
                trace_id,
                parent_id: Some(event1_id),
                timestamp: base + ChronoDuration::milliseconds(1),
                kind: EventKind::FunctionCall {
                    function_name: "step2".into(),
                    module: "app".into(),
                    args: serde_json::json!({}),
                    file: "app.rs".into(),
                    line: 20,
                },
                metadata: metadata.clone(),
                causality_vector: Vec::new(),
                lock_set: Vec::new(),
            })
            .unwrap();

        // Add third event
        let event3_id = Uuid::new_v4();
        graph
            .add_event(Event {
                id: event3_id,
                trace_id,
                parent_id: Some(event2_id),
                timestamp: base + ChronoDuration::milliseconds(2),
                kind: EventKind::FunctionCall {
                    function_name: "step3".into(),
                    module: "app".into(),
                    args: serde_json::json!({}),
                    file: "app.rs".into(),
                    line: 30,
                },
                metadata: metadata.clone(),
                causality_vector: Vec::new(),
                lock_set: Vec::new(),
            })
            .unwrap();

        let event1 = graph.nodes.get(&event1_id).unwrap().value().1.event.clone();
        let event2 = graph.nodes.get(&event2_id).unwrap().value().1.event.clone();
        let event3 = graph.nodes.get(&event3_id).unwrap().value().1.event.clone();

        // Verify clock values increment
        let clock1 = event1
            .causality_vector
            .iter()
            .find(|(c, _)| c.starts_with("service-a#"))
            .map(|(_, v)| v)
            .expect("event1 should have service-a clock");

        let clock2 = event2
            .causality_vector
            .iter()
            .find(|(c, _)| c.starts_with("service-a#"))
            .map(|(_, v)| v)
            .expect("event2 should have service-a clock");

        let clock3 = event3
            .causality_vector
            .iter()
            .find(|(c, _)| c.starts_with("service-a#"))
            .map(|(_, v)| v)
            .expect("event3 should have service-a clock");

        assert!(
            clock2 > clock1,
            "event2 clock ({}) should be > event1 clock ({})",
            clock2,
            clock1
        );
        assert!(
            clock3 > clock2,
            "event3 clock ({}) should be > event2 clock ({})",
            clock3,
            clock2
        );
    }

    #[test]
    fn vector_clock_serialization_roundtrip() {
        let trace_id = Uuid::new_v4();
        let event_id = Uuid::new_v4();
        let base = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        let causality_vector = vec![
            ("service-a#instance-1".into(), 5),
            ("service-b#instance-2".into(), 3),
            ("service-c#instance-1".into(), 7),
        ];

        let original_event = Event {
            id: event_id,
            trace_id,
            parent_id: None,
            timestamp: base,
            kind: EventKind::FunctionCall {
                function_name: "test".into(),
                module: "tests".into(),
                args: serde_json::json!({"key": "value"}),
                file: "test.rs".into(),
                line: 42,
            },
            metadata: metadata_with_service("thread-1", "service-a", 10),
            causality_vector: causality_vector.clone(),
            lock_set: Vec::new(),
        };

        // Serialize to JSON
        let json = serde_json::to_string(&original_event).expect("serialization should succeed");

        // Deserialize from JSON
        let deserialized_event: Event =
            serde_json::from_str(&json).expect("deserialization should succeed");

        // Verify causality vector is preserved
        assert_eq!(
            deserialized_event.causality_vector.len(),
            3,
            "should have 3 components in vector clock"
        );

        for (component, clock_value) in &causality_vector {
            let found = deserialized_event
                .causality_vector
                .iter()
                .find(|(c, v)| c == component && v == clock_value);
            assert!(
                found.is_some(),
                "component {} with value {} should be preserved",
                component,
                clock_value
            );
        }

        // Verify other fields
        assert_eq!(deserialized_event.id, event_id);
        assert_eq!(deserialized_event.trace_id, trace_id);
    }

    #[test]
    fn vector_clock_empty_vectors_are_concurrent() {
        let graph = CausalGraph::new();
        let trace_id = Uuid::new_v4();
        let base = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        let event1 = Event {
            id: Uuid::new_v4(),
            trace_id,
            parent_id: None,
            timestamp: base,
            kind: EventKind::FunctionCall {
                function_name: "f1".into(),
                module: "test".into(),
                args: serde_json::json!({}),
                file: "test.rs".into(),
                line: 1,
            },
            metadata: metadata("thread-1", 5),
            causality_vector: Vec::new(),
            lock_set: Vec::new(),
        };

        let event2 = Event {
            id: Uuid::new_v4(),
            trace_id,
            parent_id: None,
            timestamp: base + ChronoDuration::milliseconds(1),
            kind: EventKind::FunctionCall {
                function_name: "f2".into(),
                module: "test".into(),
                args: serde_json::json!({}),
                file: "test.rs".into(),
                line: 2,
            },
            metadata: metadata("thread-2", 5),
            causality_vector: Vec::new(),
            lock_set: Vec::new(),
        };

        // Empty vector clocks mean events are concurrent
        assert!(
            !graph.happens_before_vc(&event1, &event2),
            "empty clocks should not establish happens-before"
        );
        assert!(
            !graph.happens_before_vc(&event2, &event1),
            "empty clocks should not establish happens-before"
        );
    }

    #[test]
    fn distributed_edges_connect_cross_service_events() {
        let graph = CausalGraph::new();
        let trace_id = Uuid::new_v4();
        let base = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        // Service A event
        let mut metadata_a = metadata("service-a-thread", 5);
        metadata_a.distributed_span_id = Some("span-a".into());
        metadata_a.service_name = "service-a".into();

        let event_a = Event {
            id: Uuid::new_v4(),
            trace_id,
            parent_id: None,
            timestamp: base,
            kind: EventKind::FunctionCall {
                function_name: "process_a".into(),
                module: "service_a".into(),
                args: serde_json::json!({}),
                file: "a.rs".into(),
                line: 1,
            },
            metadata: metadata_a,
            causality_vector: Vec::new(),
            lock_set: Vec::new(),
        };

        // Service B event (calls from service A)
        let mut metadata_b = metadata("service-b-thread", 5);
        metadata_b.distributed_span_id = Some("span-b".into());
        metadata_b.upstream_span_id = Some("span-a".into());
        metadata_b.service_name = "service-b".into();

        let event_b = Event {
            id: Uuid::new_v4(),
            trace_id,
            parent_id: None,
            timestamp: base + ChronoDuration::milliseconds(10),
            kind: EventKind::FunctionCall {
                function_name: "process_b".into(),
                module: "service_b".into(),
                args: serde_json::json!({}),
                file: "b.rs".into(),
                line: 1,
            },
            metadata: metadata_b,
            causality_vector: Vec::new(),
            lock_set: Vec::new(),
        };

        graph.add_event(event_a.clone());
        graph.add_event(event_b.clone());

        // Create distributed edge
        let dist_edge = crate::event::DistributedEdge {
            from_span: "span-a".into(),
            to_span: "span-b".into(),
            link_type: crate::event::EdgeLinkType::HttpCall,
            metadata: serde_json::json!({}),
        };

        graph.add_distributed_edges(vec![dist_edge]);

        // Verify distributed edge was created
        assert!(graph.distributed_edges.contains_key(&event_b.id));
        let upstreams = graph.distributed_edges.get(&event_b.id).unwrap();
        assert_eq!(upstreams.len(), 1);
        assert_eq!(upstreams[0], event_a.id);
    }

    #[test]
    fn find_event_by_span_locates_correct_event() {
        let graph = CausalGraph::new();
        let trace_id = Uuid::new_v4();
        let base = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        let mut metadata_a = metadata("thread-a", 5);
        metadata_a.distributed_span_id = Some("unique-span-123".into());

        let event_a = Event {
            id: Uuid::new_v4(),
            trace_id,
            parent_id: None,
            timestamp: base,
            kind: EventKind::FunctionCall {
                function_name: "test".into(),
                module: "test".into(),
                args: serde_json::json!({}),
                file: "test.rs".into(),
                line: 1,
            },
            metadata: metadata_a,
            causality_vector: Vec::new(),
            lock_set: Vec::new(),
        };

        let event_id = event_a.id;
        graph.add_event(event_a);

        // Should find event by span ID
        let found = graph.find_event_by_span("unique-span-123");
        assert_eq!(found, Some(event_id));

        // Should not find non-existent span
        let not_found = graph.find_event_by_span("non-existent");
        assert_eq!(not_found, None);
    }

    #[test]
    fn is_ancestor_traverses_distributed_edges() {
        let graph = CausalGraph::new();
        let trace_id = Uuid::new_v4();
        let base = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        // Service A event
        let mut metadata_a = metadata("service-a-thread", 5);
        metadata_a.distributed_span_id = Some("span-a".into());

        let event_a = Event {
            id: Uuid::new_v4(),
            trace_id,
            parent_id: None,
            timestamp: base,
            kind: EventKind::FunctionCall {
                function_name: "a".into(),
                module: "a".into(),
                args: serde_json::json!({}),
                file: "a.rs".into(),
                line: 1,
            },
            metadata: metadata_a,
            causality_vector: Vec::new(),
            lock_set: Vec::new(),
        };

        // Service B event (downstream of A)
        let mut metadata_b = metadata("service-b-thread", 5);
        metadata_b.distributed_span_id = Some("span-b".into());

        let event_b = Event {
            id: Uuid::new_v4(),
            trace_id,
            parent_id: None,
            timestamp: base + ChronoDuration::milliseconds(10),
            kind: EventKind::FunctionCall {
                function_name: "b".into(),
                module: "b".into(),
                args: serde_json::json!({}),
                file: "b.rs".into(),
                line: 1,
            },
            metadata: metadata_b,
            causality_vector: Vec::new(),
            lock_set: Vec::new(),
        };

        graph.add_event(event_a.clone());
        graph.add_event(event_b.clone());

        // Add distributed edge A -> B
        let dist_edge = crate::event::DistributedEdge {
            from_span: "span-a".into(),
            to_span: "span-b".into(),
            link_type: crate::event::EdgeLinkType::HttpCall,
            metadata: serde_json::json!({}),
        };

        graph.add_distributed_edges(vec![dist_edge]);

        // A should be ancestor of B via distributed edge
        assert!(
            graph.is_ancestor(event_a.id, event_b.id),
            "event_a should be ancestor of event_b via distributed edge"
        );

        // B should not be ancestor of A
        assert!(
            !graph.is_ancestor(event_b.id, event_a.id),
            "event_b should not be ancestor of event_a"
        );
    }

    #[test]
    fn is_ancestor_traverses_multi_hop_distributed_chain() {
        let graph = CausalGraph::new();
        let trace_id = Uuid::new_v4();
        let base = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        // Create 4-service chain: A -> B -> C -> D
        let mut events = Vec::new();
        let spans = vec!["span-a", "span-b", "span-c", "span-d"];

        for (i, span) in spans.iter().enumerate() {
            let mut md = metadata(&format!("service-{}-thread", i), 5);
            md.distributed_span_id = Some((*span).into());

            let event = Event {
                id: Uuid::new_v4(),
                trace_id,
                parent_id: None,
                timestamp: base + ChronoDuration::milliseconds(i as i64 * 10),
                kind: EventKind::FunctionCall {
                    function_name: format!("func_{}", i),
                    module: format!("mod_{}", i),
                    args: serde_json::json!({}),
                    file: format!("{}.rs", i),
                    line: 1,
                },
                metadata: md,
                causality_vector: Vec::new(),
                lock_set: Vec::new(),
            };

            graph.add_event(event.clone());
            events.push(event);
        }

        // Create distributed edges A->B, B->C, C->D
        let edges = vec![
            crate::event::DistributedEdge {
                from_span: "span-a".into(),
                to_span: "span-b".into(),
                link_type: crate::event::EdgeLinkType::HttpCall,
                metadata: serde_json::json!({}),
            },
            crate::event::DistributedEdge {
                from_span: "span-b".into(),
                to_span: "span-c".into(),
                link_type: crate::event::EdgeLinkType::HttpCall,
                metadata: serde_json::json!({}),
            },
            crate::event::DistributedEdge {
                from_span: "span-c".into(),
                to_span: "span-d".into(),
                link_type: crate::event::EdgeLinkType::HttpCall,
                metadata: serde_json::json!({}),
            },
        ];

        graph.add_distributed_edges(edges);

        // A should be ancestor of D (3 hops)
        assert!(
            graph.is_ancestor(events[0].id, events[3].id),
            "event A should be ancestor of event D via 3-hop distributed chain"
        );

        // B should be ancestor of D (2 hops)
        assert!(
            graph.is_ancestor(events[1].id, events[3].id),
            "event B should be ancestor of event D via 2-hop distributed chain"
        );

        // C should be ancestor of D (1 hop)
        assert!(
            graph.is_ancestor(events[2].id, events[3].id),
            "event C should be ancestor of event D via 1-hop distributed chain"
        );

        // D should not be ancestor of A
        assert!(
            !graph.is_ancestor(events[3].id, events[0].id),
            "event D should not be ancestor of event A"
        );
    }

    #[test]
    fn critical_path_includes_distributed_edges() {
        let graph = CausalGraph::new();
        let trace_id = Uuid::new_v4();
        let base = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        // Service A event (10ms)
        let mut metadata_a = metadata("service-a", 10); // 10 milliseconds
        metadata_a.distributed_span_id = Some("span-a".into());

        let event_a = Event {
            id: Uuid::new_v4(),
            trace_id,
            parent_id: None,
            timestamp: base,
            kind: EventKind::FunctionCall {
                function_name: "process_a".into(),
                module: "a".into(),
                args: serde_json::json!({}),
                file: "a.rs".into(),
                line: 1,
            },
            metadata: metadata_a,
            causality_vector: Vec::new(),
            lock_set: Vec::new(),
        };

        // Service B event (20ms, downstream of A)
        let mut metadata_b = metadata("service-b", 20); // 20 milliseconds
        metadata_b.distributed_span_id = Some("span-b".into());

        let event_b = Event {
            id: Uuid::new_v4(),
            trace_id,
            parent_id: None,
            timestamp: base + ChronoDuration::milliseconds(10),
            kind: EventKind::FunctionCall {
                function_name: "process_b".into(),
                module: "b".into(),
                args: serde_json::json!({}),
                file: "b.rs".into(),
                line: 1,
            },
            metadata: metadata_b,
            causality_vector: Vec::new(),
            lock_set: Vec::new(),
        };

        graph.add_event(event_a.clone());
        graph.add_event(event_b.clone());

        // Add distributed edge
        let dist_edge = crate::event::DistributedEdge {
            from_span: "span-a".into(),
            to_span: "span-b".into(),
            link_type: crate::event::EdgeLinkType::HttpCall,
            metadata: serde_json::json!({}),
        };

        graph.add_distributed_edges(vec![dist_edge]);

        let critical_path = graph.get_critical_path(trace_id).unwrap();

        // Critical path should include both A and B
        assert!(
            critical_path.path.len() >= 2,
            "critical path should include events from both services"
        );

        // Total duration should be 30ms (A's 10ms + B's 20ms)
        let total_duration: u64 = critical_path
            .path
            .iter()
            .filter_map(|e| e.metadata.duration_ns)
            .sum();

        assert_eq!(
            total_duration, 30_000_000,
            "critical path should span across distributed services"
        );
    }

    #[test]
    fn distributed_edges_handle_missing_spans_gracefully() {
        let graph = CausalGraph::new();
        let trace_id = Uuid::new_v4();
        let base = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        // Add event with span-a
        let mut metadata = metadata("thread", 5);
        metadata.distributed_span_id = Some("span-a".into());

        let event = Event {
            id: Uuid::new_v4(),
            trace_id,
            parent_id: None,
            timestamp: base,
            kind: EventKind::FunctionCall {
                function_name: "test".into(),
                module: "test".into(),
                args: serde_json::json!({}),
                file: "test.rs".into(),
                line: 1,
            },
            metadata,
            causality_vector: Vec::new(),
            lock_set: Vec::new(),
        };

        graph.add_event(event);

        // Try to create edge with non-existent span-b
        let dist_edge = crate::event::DistributedEdge {
            from_span: "span-a".into(),
            to_span: "span-b-nonexistent".into(),
            link_type: crate::event::EdgeLinkType::HttpCall,
            metadata: serde_json::json!({}),
        };

        // Should not crash
        graph.add_distributed_edges(vec![dist_edge]);

        // Should have no distributed edges since span-b doesn't exist
        assert_eq!(
            graph.distributed_edges.len(),
            0,
            "should not create edge for missing span"
        );
    }
}
