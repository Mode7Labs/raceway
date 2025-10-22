use chrono::{TimeZone, Utc};
use raceway_core::event::{AccessType, Event, EventKind, EventMetadata};
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct TraceFixture {
    pub trace_id: Uuid,
    pub events: Vec<Event>,
    pub expected_races: usize,
    pub expected_critical_path_nodes: usize,
}

pub fn sample_trace_fixture() -> TraceFixture {
    let trace_id = Uuid::parse_str("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa").unwrap();
    let root_id = Uuid::parse_str("bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb").unwrap();
    let write_a_id = Uuid::parse_str("cccccccc-cccc-4ccc-cccc-cccccccccccc").unwrap();
    let write_b_id = Uuid::parse_str("dddddddd-dddd-4ddd-dddd-dddddddddddd").unwrap();
    let finish_id = Uuid::parse_str("eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee").unwrap();

    let base_time = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

    let metadata_root = EventMetadata {
        thread_id: "thread-main".into(),
        process_id: 1,
        service_name: "web".into(),
        environment: "test".into(),
        tags: Default::default(),
        duration_ns: Some(17_000_000),
        instance_id: None,
        distributed_span_id: None,
        upstream_span_id: None,
    };

    let metadata_a = EventMetadata {
        thread_id: "worker-1".into(),
        process_id: 1,
        service_name: "web".into(),
        environment: "test".into(),
        tags: Default::default(),
        duration_ns: Some(8_000_000),
        instance_id: None,
        distributed_span_id: None,
        upstream_span_id: None,
    };

    let metadata_b = EventMetadata {
        thread_id: "worker-2".into(),
        process_id: 1,
        service_name: "web".into(),
        environment: "test".into(),
        tags: Default::default(),
        duration_ns: Some(9_000_000),
        instance_id: None,
        distributed_span_id: None,
        upstream_span_id: None,
    };

    let metadata_finish = EventMetadata {
        thread_id: "thread-main".into(),
        process_id: 1,
        service_name: "web".into(),
        environment: "test".into(),
        tags: Default::default(),
        duration_ns: Some(3_000_000),
        instance_id: None,
        distributed_span_id: None,
        upstream_span_id: None,
    };

    let root = Event {
        id: root_id,
        trace_id,
        parent_id: None,
        timestamp: base_time,
        kind: EventKind::FunctionCall {
            function_name: "handle_request".into(),
            module: "app::handlers".into(),
            args: serde_json::json!({"id": 42}),
            file: "app/handlers.rs".into(),
            line: 10,
        },
        metadata: metadata_root,
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    let write_a = Event {
        id: write_a_id,
        trace_id,
        parent_id: Some(root_id),
        timestamp: base_time + chrono::Duration::milliseconds(1),
        kind: EventKind::StateChange {
            variable: "balance".into(),
            old_value: Some(serde_json::json!(10)),
            new_value: serde_json::json!(15),
            location: "balance.rs:12".into(),
            access_type: AccessType::Write,
        },
        metadata: metadata_a,
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    let write_b = Event {
        id: write_b_id,
        trace_id,
        parent_id: Some(root_id),
        timestamp: base_time + chrono::Duration::milliseconds(2),
        kind: EventKind::StateChange {
            variable: "balance".into(),
            old_value: Some(serde_json::json!(15)),
            new_value: serde_json::json!(20),
            location: "balance.rs:45".into(),
            access_type: AccessType::Write,
        },
        metadata: metadata_b,
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    let finish = Event {
        id: finish_id,
        trace_id,
        parent_id: Some(root_id),
        timestamp: base_time + chrono::Duration::milliseconds(5),
        kind: EventKind::FunctionCall {
            function_name: "respond".into(),
            module: "app::handlers".into(),
            args: serde_json::json!({}),
            file: "app/handlers.rs".into(),
            line: 24,
        },
        metadata: metadata_finish,
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    TraceFixture {
        trace_id,
        events: vec![root, write_a, write_b, finish],
        expected_races: 1,
        expected_critical_path_nodes: 1,
    }
}
