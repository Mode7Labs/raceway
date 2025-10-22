use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// Represents a span in a distributed trace (Phase 2)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistributedSpan {
    pub trace_id: Uuid,
    pub span_id: String,           // From W3C traceparent header
    pub service: String,
    pub instance: String,
    pub first_event: DateTime<Utc>,
    pub last_event: Option<DateTime<Utc>>,
}

/// Represents an edge between spans in distributed trace (Phase 2)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistributedEdge {
    pub from_span: String,         // Upstream span ID
    pub to_span: String,           // Downstream span ID
    pub link_type: EdgeLinkType,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EdgeLinkType {
    HttpCall,       // HTTP request/response
    GrpcCall,       // gRPC call
    MessageQueue,   // Async messaging (Kafka, SQS, etc.)
    DatabaseQuery,  // Database operation
    Custom,         // User-defined edge type
}

/// Type of memory access
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AccessType {
    Read,
    Write,
    AtomicRead,  // Atomic load
    AtomicWrite, // Atomic store
    AtomicRMW,   // Atomic read-modify-write (CAS, fetch_add, etc.)
}

/// Memory ordering for atomic operations and fences
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MemoryOrdering {
    Relaxed,
    Acquire,
    Release,
    AcqRel,
    SeqCst,
}

/// Represents a single captured event in the system
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: Uuid,
    pub trace_id: Uuid,
    pub parent_id: Option<Uuid>,
    pub timestamp: DateTime<Utc>,
    pub kind: EventKind,
    pub metadata: EventMetadata,
    // Vector clock for causal ordering
    // Format: Vec<(component, clock_value)>
    // - Single-service: component = trace_id.to_string()
    // - Distributed: component = "service#instance"
    pub causality_vector: Vec<(String, u64)>,
    pub lock_set: Vec<String>, // Locks held by the thread at the time of this event
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EventKind {
    FunctionCall {
        function_name: String,
        module: String,
        args: serde_json::Value,
        file: String,
        line: u32,
    },
    AsyncSpawn {
        task_id: Uuid,
        spawned_by: String,
    },
    AsyncAwait {
        future_id: Uuid,
        awaited_at: String,
    },
    StateChange {
        variable: String,
        old_value: Option<serde_json::Value>,
        new_value: serde_json::Value,
        location: String,
        access_type: AccessType,
    },
    LockAcquire {
        lock_id: String,
        lock_type: String, // "Mutex", "RwLock::Read", "RwLock::Write"
        location: String,
    },
    LockRelease {
        lock_id: String,
        lock_type: String,
        location: String,
    },
    MemoryFence {
        ordering: MemoryOrdering,
        location: String,
    },
    HttpRequest {
        method: String,
        url: String,
        headers: HashMap<String, String>,
        body: Option<serde_json::Value>,
    },
    HttpResponse {
        status: u16,
        headers: HashMap<String, String>,
        body: Option<serde_json::Value>,
        duration_ms: u64,
    },
    DatabaseQuery {
        query: String,
        database: String,
        duration_ms: u64,
    },
    DatabaseResult {
        rows_affected: usize,
    },
    Error {
        error_type: String,
        message: String,
        stack_trace: Vec<String>,
    },
    Custom {
        name: String,
        data: serde_json::Value,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventMetadata {
    pub thread_id: String,
    pub process_id: u32,
    pub service_name: String,
    pub environment: String,
    pub tags: HashMap<String, String>,
    pub duration_ns: Option<u64>,

    // Distributed tracing fields (Phase 2)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distributed_span_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream_span_id: Option<String>,
}

impl Event {
    pub fn new(
        kind: EventKind,
        metadata: EventMetadata,
        trace_id: Uuid,
        parent_id: Option<Uuid>,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            trace_id,
            parent_id,
            timestamp: Utc::now(),
            kind,
            metadata,
            causality_vector: Vec::new(),
            lock_set: Vec::new(),
        }
    }

    /// Returns true if this event happened before the other event in causal order
    /// Uses vector clock semantics, not timestamps (which can be skewed in distributed/async systems)
    ///
    /// self -> other if:
    /// 1. For all components in self's vector: self.VC[component] <= other.VC[component]
    /// 2. At least one component has strictly less: self.VC[component] < other.VC[component]
    /// 3. All components from self are present in other (causally connected)
    ///
    /// Components can be:
    /// - Single-service: trace_id.to_string()
    /// - Distributed: "service#instance"
    pub fn happened_before(&self, other: &Event) -> bool {
        if self.causality_vector.is_empty() || other.causality_vector.is_empty() {
            // Without vector clocks, we can't determine causality - assume concurrent
            return false;
        }

        let mut found_strictly_less = false;

        // Check that self's clock is <= other's clock for all components in self
        for (component_self, clock_self) in &self.causality_vector {
            if let Some((_, clock_other)) = other
                .causality_vector
                .iter()
                .find(|(c, _)| c == component_self)
            {
                if clock_self > clock_other {
                    // self has a later clock for this component - definitely not happens-before
                    return false;
                }
                if clock_self < clock_other {
                    found_strictly_less = true;
                }
            } else {
                // other doesn't have this component in its vector clock
                // This means they're independent on this component dimension
                // Can't establish happens-before if not all components are present
                return false;
            }
        }

        // Happens-before requires:
        // 1. All components in self's VC are <= in other's VC (checked above)
        // 2. At least one component is strictly less
        // 3. All components from self are present in other (checked above)
        found_strictly_less
    }

    /// Detects if two events are concurrent (neither happened before the other)
    pub fn is_concurrent_with(&self, other: &Event) -> bool {
        !self.happened_before(other) && !other.happened_before(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_creation() {
        let trace_id = Uuid::new_v4();
        let metadata = EventMetadata {
            thread_id: "main".to_string(),
            process_id: 1234,
            service_name: "test-service".to_string(),
            environment: "dev".to_string(),
            tags: HashMap::new(),
            duration_ns: None,
            instance_id: None,
            distributed_span_id: None,
            upstream_span_id: None,
        };

        let event = Event::new(
            EventKind::FunctionCall {
                function_name: "test_fn".to_string(),
                module: "test_module".to_string(),
                args: serde_json::json!({}),
                file: "test.rs".to_string(),
                line: 42,
            },
            metadata,
            trace_id,
            None,
        );

        assert_eq!(event.trace_id, trace_id);
        assert!(event.parent_id.is_none());
    }
}
