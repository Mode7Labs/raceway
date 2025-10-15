use crate::event::{Event, EventKind, AccessType};
use dashmap::DashMap;
use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::algo::is_cyclic_directed;
use petgraph::visit::EdgeRef;
use serde::{Deserialize, Serialize};
use std::collections::{HashSet, HashMap};
use std::sync::Mutex;
use uuid::Uuid;
use anyhow::{Result, anyhow};
use chrono::{DateTime, Utc};

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
    pub anomaly_score: f64, // AI-computed anomaly score
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

/// The causal graph maintains relationships between all captured events
pub struct CausalGraph {
    graph: Mutex<DiGraph<Uuid, CausalEdge>>,
    nodes: DashMap<Uuid, (NodeIndex, CausalNode)>,
    trace_roots: DashMap<Uuid, Vec<Uuid>>, // trace_id -> root event IDs
    analysis_cache: DashMap<Uuid, Vec<(Event, Event)>>, // trace_id -> cached concurrent pairs
    anomaly_cache: DashMap<Uuid, Vec<Anomaly>>, // trace_id -> cached anomalies
    vector_clocks: DashMap<String, u64>, // thread_id -> logical clock value
    lock_sets: DashMap<String, HashSet<String>>, // thread_id -> currently held locks
    baseline_metrics: DashMap<String, BaselineMetrics>, // event_kind -> metrics
    baseline_durations: DashMap<String, Vec<f64>>, // event_kind -> all observed durations
    baselines_updated: DashMap<Uuid, bool>, // track which traces have been added to baselines
}

impl CausalGraph {
    pub fn new() -> Self {
        Self {
            graph: Mutex::new(DiGraph::new()),
            nodes: DashMap::new(),
            trace_roots: DashMap::new(),
            analysis_cache: DashMap::new(),
            anomaly_cache: DashMap::new(),
            vector_clocks: DashMap::new(),
            lock_sets: DashMap::new(),
            baseline_metrics: DashMap::new(),
            baseline_durations: DashMap::new(),
            baselines_updated: DashMap::new(),
        }
    }

    /// Add an event to the graph
    pub fn add_event(&self, mut event: Event) -> Result<()> {
        // Update vector clock for this thread
        let thread_id = event.metadata.thread_id.clone();
        let mut clock_value = self.vector_clocks.entry(thread_id.clone()).or_insert(0);
        *clock_value += 1;
        let current_clock = *clock_value;
        drop(clock_value);

        // Build the causality vector for this event
        let mut causality_vector: Vec<(Uuid, u64)> = Vec::new();

        // If there's a parent, merge parent's vector clock
        if let Some(parent_id) = event.parent_id {
            if let Some(parent_entry) = self.nodes.get(&parent_id) {
                let parent_event = &parent_entry.value().1.event;

                // Merge vector clocks (take max of each component)
                for (parent_thread_uuid, parent_clock) in &parent_event.causality_vector {
                    causality_vector.push((*parent_thread_uuid, *parent_clock));
                }
            }
        }

        // Add or update this thread's clock in the vector
        let thread_uuid = Uuid::parse_str(&thread_id).unwrap_or_else(|_| {
            // If thread_id isn't a valid UUID, create a deterministic one from the thread name
            Uuid::new_v5(&Uuid::NAMESPACE_OID, thread_id.as_bytes())
        });

        // Update or add this thread's entry
        if let Some(existing) = causality_vector.iter_mut().find(|(id, _)| *id == thread_uuid) {
            existing.1 = current_clock;
        } else {
            causality_vector.push((thread_uuid, current_clock));
        }

        event.causality_vector = causality_vector;

        // Capture the current lock set for this thread BEFORE modifying it
        let current_locks: Vec<String> = self.lock_sets
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
        Ok(())
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
        let root_ids = self.trace_roots
            .get(&trace_id)
            .ok_or_else(|| anyhow!("Trace not found: {}", trace_id))?;

        let mut events = Vec::new();
        let mut visited = HashSet::new();

        for root_id in root_ids.value() {
            self.collect_events_dfs(*root_id, &mut events, &mut visited);
        }

        Ok(events)
    }

    fn collect_events_dfs(&self, event_id: Uuid, events: &mut Vec<Event>, visited: &mut HashSet<Uuid>) {
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
    pub fn find_concurrent_events(&self, trace_id: Uuid) -> Result<Vec<(Event, Event)>> {
        // Check cache first
        if let Some(cached) = self.analysis_cache.get(&trace_id) {
            return Ok(cached.value().clone());
        }
        let events = self.get_causal_order(trace_id)?;
        let mut concurrent_pairs = Vec::new();

        // Look for StateChange events that access the same variable
        for i in 0..events.len() {
            for j in (i + 1)..events.len() {
                // Check if both are state changes
                if let (EventKind::StateChange { variable: var1, access_type: access1, .. },
                        EventKind::StateChange { variable: var2, access_type: access2, .. }) = (&events[i].kind, &events[j].kind) {

                    // Same variable access
                    if var1 == var2 {
                        // Skip safe access patterns
                        if self.is_safe_access_pattern(*access1, *access2) {
                            continue;
                        }

                        // Different threads
                        if events[i].metadata.thread_id != events[j].metadata.thread_id {
                            // Use vector clocks for happens-before check (more precise than graph path)
                            if !self.happens_before_vc(&events[i], &events[j])
                               && !self.happens_before_vc(&events[j], &events[i]) {
                                // Check if accesses were protected by the same lock
                                if !self.protected_by_same_lock(&events[i], &events[j]) {
                                    concurrent_pairs.push((events[i].clone(), events[j].clone()));
                                }
                            }
                        }
                    }
                }
            }
        }

        // Store in cache
        self.analysis_cache.insert(trace_id, concurrent_pairs.clone());

        Ok(concurrent_pairs)
    }

    /// Check if event1 happens-before event2 using vector clocks
    /// This is more precise than graph paths as it captures all causal relationships
    fn happens_before_vc(&self, event1: &Event, event2: &Event) -> bool {
        // event1 -> event2 if for all threads in VC1:
        // VC1[thread] <= VC2[thread]
        // AND there exists at least one thread where VC1[thread] < VC2[thread]

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

        let mut found_less = false;
        let mut all_threads_match = true;

        // Check that event1's clock is <= event2's clock for all components in event1
        for (thread1, clock1) in &event1.causality_vector {
            if let Some((_, clock2)) = event2.causality_vector.iter().find(|(t, _)| t == thread1) {
                if clock1 > clock2 {
                    // event1 has a later clock for this thread - definitely not happens-before
                    return false;
                }
                if clock1 < clock2 {
                    found_less = true;
                }
            } else {
                // event2 doesn't have this thread in its vector clock
                // This means they're independent on this thread dimension
                // Can't establish happens-before if not all threads are present
                all_threads_match = false;
            }
        }

        // Happens-before requires:
        // 1. All threads in event1's VC are <= in event2's VC
        // 2. At least one thread is strictly less
        // 3. All threads from event1 are present in event2 (causally connected)
        found_less && all_threads_match
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

    /// Check if there's a causal path between two events
    fn has_causal_path(&self, from: Uuid, to: Uuid) -> bool {
        let from_node = match self.nodes.get(&from) {
            Some(n) => n,
            None => return false,
        };
        let to_node = match self.nodes.get(&to) {
            Some(n) => n,
            None => return false,
        };

        let from_idx = from_node.value().0;
        let to_idx = to_node.value().0;

        let graph = self.graph.lock().unwrap();
        petgraph::algo::has_path_connecting(&*graph, from_idx, to_idx, None)
    }

    /// Check if two events overlap in time
    /// Events are considered to overlap if their time windows intersect
    fn events_overlap_in_time(&self, event1: &Event, event2: &Event) -> bool {
        use chrono::Duration;

        // Calculate end times for both events
        let event1_start = event1.timestamp;
        let event1_end = if let Some(duration_ns) = event1.metadata.duration_ns {
            event1_start + Duration::nanoseconds(duration_ns as i64)
        } else {
            // If no duration, assume instantaneous (1ms window for overlap detection)
            event1_start + Duration::milliseconds(1)
        };

        let event2_start = event2.timestamp;
        let event2_end = if let Some(duration_ns) = event2.metadata.duration_ns {
            event2_start + Duration::nanoseconds(duration_ns as i64)
        } else {
            // If no duration, assume instantaneous (1ms window for overlap detection)
            event2_start + Duration::milliseconds(1)
        };

        // Check if time windows overlap
        // Two intervals [a1, a2] and [b1, b2] overlap if: a1 < b2 AND b1 < a2
        event1_start < event2_end && event2_start < event1_end
    }

    /// Find the causal path between two events
    pub fn find_causal_path(&self, from: Uuid, to: Uuid) -> Result<Vec<Event>> {
        let from_node = self.nodes.get(&from)
            .ok_or_else(|| anyhow!("Event not found: {}", from))?;
        let to_node = self.nodes.get(&to)
            .ok_or_else(|| anyhow!("Event not found: {}", to))?;

        let from_idx = from_node.value().0;
        let to_idx = to_node.value().0;

        let graph = self.graph.lock().unwrap();
        let path = petgraph::algo::astar(
            &*graph,
            from_idx,
            |finish| finish == to_idx,
            |_| 1,
            |_| 0,
        );

        match path {
            Some((_, node_path)) => {
                let events: Vec<Event> = node_path
                    .into_iter()
                    .filter_map(|idx| {
                        let event_id = graph[idx];
                        self.nodes.get(&event_id).map(|entry| entry.value().1.event.clone())
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
        let root_ids = self.trace_roots
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
        let duration_ms = event.metadata.duration_ns
            .map(|ns| ns as f64 / 1_000_000.0);

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
            EventKind::FunctionCall { file, line, function_name, .. } => {
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
            EventKind::FunctionCall { function_name, .. } => format!("FunctionCall({})", function_name),
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
            let current_duration = event.metadata.duration_ns.unwrap_or(0) as f64 / 1_000_000.0;

            // Get children from graph
            if let Some(entry) = self.nodes.get(&event.id) {
                let (node_idx, _) = entry.value();
                let graph = self.graph.lock().unwrap();
                let children: Vec<Uuid> = graph
                    .edges(*node_idx)
                    .map(|edge| graph[edge.target()])
                    .collect();
                drop(graph);

                // Update cumulative durations for children
                let current_cumulative = cumulative_durations.get(&event.id).copied().unwrap_or(0.0);

                for child_id in children {
                    if let Some(child_entry) = self.nodes.get(&child_id) {
                        let child_event = &child_entry.value().1.event;
                        let child_duration = child_event.metadata.duration_ns.unwrap_or(0) as f64 / 1_000_000.0;
                        let new_cumulative = current_cumulative + child_duration;

                        // Update if this path is longer
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
            let mut entry = self.baseline_durations.entry(kind.clone()).or_insert_with(Vec::new);
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
                .sum::<f64>() / count as f64;
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

    /// Detect anomalies in a trace based on baseline metrics
    pub fn detect_anomalies(&self, trace_id: Uuid) -> Result<Vec<Anomaly>> {
        // Check cache first - if we've already analyzed this trace, return cached results
        if let Some(cached) = self.anomaly_cache.get(&trace_id) {
            return Ok(cached.value().clone());
        }

        // Build baselines from ALL other traces
        // This ensures we have comprehensive baseline data
        for other_trace_id in self.get_all_trace_ids() {
            if other_trace_id != trace_id {
                // Add all other traces to baseline
                let _ = self.update_baselines(other_trace_id);
            }
        }

        let events = self.get_causal_order(trace_id)?;

        // Check if we have sufficient baseline data before analyzing
        // If not, we should not cache empty results
        let mut has_sufficient_baseline = false;
        for event in &events {
            if let Some(duration_ns) = event.metadata.duration_ns {
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
                        let sigma = (duration_ms - baseline.mean_duration_ms).abs() / baseline.std_dev;
                        (sigma, sigma > 1.5)
                    } else {
                        // When std_dev is 0 (all baseline values are identical),
                        // flag as anomaly if the value differs by more than 20% from the mean
                        let percent_diff = ((duration_ms - baseline.mean_duration_ms).abs() / baseline.mean_duration_ms) * 100.0;
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
        self.anomaly_cache.insert(trace_id, anomalies.clone());

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

                if let (EventKind::StateChange { variable: var1, access_type: access1, .. },
                        EventKind::StateChange { variable: var2, access_type: access2, .. }) = (&event1.kind, &event2.kind) {

                    // Same variable access
                    if var1 == var2 {
                        // Skip safe access patterns
                        if self.is_safe_access_pattern(*access1, *access2) {
                            continue;
                        }

                        // Different threads OR different traces
                        if event1.metadata.thread_id != event2.metadata.thread_id ||
                           event1.trace_id != event2.trace_id {
                            // Use vector clocks for happens-before check
                            if !self.happens_before_vc(event1, event2)
                               && !self.happens_before_vc(event2, event1) {
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
            .map(|((from, to), call_count)| ServiceDependency { from, to, call_count })
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

        let mut accesses = Vec::new();

        for (i, event) in variable_events.iter().enumerate() {
            if let EventKind::StateChange {
                variable: _,
                old_value,
                new_value,
                location,
                access_type
            } = &event.kind {
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
                        && (*access_type == AccessType::Write ||
                            matches!(prev_event.kind, EventKind::StateChange { access_type: AccessType::Write, .. }))
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

        Ok(AuditTrail {
            trace_id: trace_id.to_string(),
            variable: variable.to_string(),
            accesses,
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GraphStats {
    pub total_events: usize,
    pub total_traces: usize,
    pub total_edges: usize,
    pub has_cycles: bool,
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
}
