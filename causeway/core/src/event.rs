use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

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
    pub causality_vector: Vec<(Uuid, u64)>, // Vector clock for causal ordering
    pub lock_set: Vec<String>,              // Locks held by the thread at the time of this event
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
    pub fn happened_before(&self, other: &Event) -> bool {
        if self.timestamp < other.timestamp {
            // Check vector clocks for concurrent events
            self.causality_vector.iter().all(|(id, clock)| {
                other
                    .causality_vector
                    .iter()
                    .find(|(other_id, _)| other_id == id)
                    .map(|(_, other_clock)| clock <= other_clock)
                    .unwrap_or(true)
            })
        } else {
            false
        }
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
