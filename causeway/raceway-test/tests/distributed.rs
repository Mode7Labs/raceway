use anyhow::Result;
use chrono::{TimeZone, Utc};
use raceway_core::event::{AccessType, Event, EventKind, EventMetadata};
use raceway_core::Config;
use raceway_test::harness::TestApp;
use serde_json::json;
use tokio::time::{sleep, Duration};
use uuid::Uuid;

// Helper to create distributed event metadata
fn create_metadata(
    service: &str,
    instance: &str,
    span_id: Option<String>,
    parent_span: Option<String>,
) -> EventMetadata {
    EventMetadata {
        thread_id: format!("{}-thread-1", service),
        process_id: 1,
        service_name: service.into(),
        environment: "test".into(),
        tags: Default::default(),
        duration_ns: Some(5_000_000),
        instance_id: Some(instance.into()),
        distributed_span_id: span_id,
        upstream_span_id: parent_span,
    }
}

// Helper to wait for trace to have expected event count
async fn wait_for_trace_events(app: &TestApp, trace_id: &Uuid, expected: usize) -> Result<()> {
    for _ in 0..50 {
        let path = format!("/api/traces/{}", trace_id);
        if let Ok(resp) = app.get_json(&path).await {
            if let Some(events) = resp["data"]["events"].as_array() {
                if events.len() == expected {
                    return Ok(());
                }
            }
        }
        sleep(Duration::from_millis(50)).await;
    }
    Err(anyhow::anyhow!("trace did not reach {} events", expected))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_two_service_chain() -> Result<()> {
    let app = TestApp::new(Config::default()).await?;
    let trace_id = Uuid::new_v4();
    let base_time = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

    // Service A events
    let span_a = "span-a-001";
    let event_a1 = Event {
        id: Uuid::new_v4(),
        trace_id,
        parent_id: None,
        timestamp: base_time,
        kind: EventKind::FunctionCall {
            function_name: "handle_request".into(),
            module: "service_a".into(),
            args: json!({"request_id": 1}),
            file: "main.rs".into(),
            line: 10,
        },
        metadata: create_metadata("service-a", "a1", Some(span_a.into()), None),
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    let event_a2 = Event {
        id: Uuid::new_v4(),
        trace_id,
        parent_id: Some(event_a1.id),
        timestamp: base_time + chrono::Duration::milliseconds(5),
        kind: EventKind::StateChange {
            variable: "counter".into(),
            old_value: Some(json!(0)),
            new_value: json!(1),
            location: "main.rs:15".into(),
            access_type: AccessType::Write,
        },
        metadata: create_metadata("service-a", "a1", Some(span_a.into()), None),
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    // Service B events (calls made by service A)
    let span_b = "span-b-001";
    let event_b1 = Event {
        id: Uuid::new_v4(),
        trace_id,
        parent_id: None,
        timestamp: base_time + chrono::Duration::milliseconds(10),
        kind: EventKind::FunctionCall {
            function_name: "process".into(),
            module: "service_b".into(),
            args: json!({"data": "test"}),
            file: "main.rs".into(),
            line: 20,
        },
        metadata: create_metadata("service-b", "b1", Some(span_b.into()), Some(span_a.into())),
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    let event_b2 = Event {
        id: Uuid::new_v4(),
        trace_id,
        parent_id: Some(event_b1.id),
        timestamp: base_time + chrono::Duration::milliseconds(15),
        kind: EventKind::StateChange {
            variable: "result".into(),
            old_value: None,
            new_value: json!("processed"),
            location: "main.rs:25".into(),
            access_type: AccessType::Write,
        },
        metadata: create_metadata("service-b", "b1", Some(span_b.into()), Some(span_a.into())),
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    // Submit all events
    let payload = json!({
        "events": [event_a1, event_a2, event_b1, event_b2],
    });
    app.post_json("/events", payload).await?;

    // Wait for all events to be processed
    wait_for_trace_events(&app, &trace_id, 4).await?;

    // Verify trace has distributed events from both services
    let trace = app.get_json(&format!("/api/traces/{}", trace_id)).await?;
    let events = trace["data"]["events"].as_array().unwrap();

    assert_eq!(events.len(), 4);

    let services: std::collections::HashSet<_> = events
        .iter()
        .filter_map(|e| e["metadata"]["service_name"].as_str())
        .collect();

    assert_eq!(services.len(), 2);
    assert!(services.contains("service-a"));
    assert!(services.contains("service-b"));

    // Verify distributed edges exist
    // Note: The actual distributed_edges structure depends on backend implementation
    // This test verifies that events from both services are present in the same trace

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_three_service_chain() -> Result<()> {
    let app = TestApp::new(Config::default()).await?;
    let trace_id = Uuid::new_v4();
    let base_time = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

    let span_a = "span-a";
    let span_b = "span-b";
    let span_c = "span-c";

    // Service A
    let event_a = Event {
        id: Uuid::new_v4(),
        trace_id,
        parent_id: None,
        timestamp: base_time,
        kind: EventKind::FunctionCall {
            function_name: "start".into(),
            module: "a".into(),
            args: json!({}),
            file: "a.rs".into(),
            line: 1,
        },
        metadata: create_metadata("service-a", "a1", Some(span_a.into()), None),
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    // Service B (called by A)
    let event_b = Event {
        id: Uuid::new_v4(),
        trace_id,
        parent_id: None,
        timestamp: base_time + chrono::Duration::milliseconds(5),
        kind: EventKind::FunctionCall {
            function_name: "middle".into(),
            module: "b".into(),
            args: json!({}),
            file: "b.rs".into(),
            line: 1,
        },
        metadata: create_metadata("service-b", "b1", Some(span_b.into()), Some(span_a.into())),
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    // Service C (called by B)
    let event_c = Event {
        id: Uuid::new_v4(),
        trace_id,
        parent_id: None,
        timestamp: base_time + chrono::Duration::milliseconds(10),
        kind: EventKind::FunctionCall {
            function_name: "end".into(),
            module: "c".into(),
            args: json!({}),
            file: "c.rs".into(),
            line: 1,
        },
        metadata: create_metadata("service-c", "c1", Some(span_c.into()), Some(span_b.into())),
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    let payload = json!({
        "events": [event_a, event_b, event_c],
    });
    app.post_json("/events", payload).await?;

    wait_for_trace_events(&app, &trace_id, 3).await?;

    let trace = app.get_json(&format!("/api/traces/{}", trace_id)).await?;
    let events = trace["data"]["events"].as_array().unwrap();

    assert_eq!(events.len(), 3);

    // Verify all three services present
    let services: std::collections::HashSet<_> = events
        .iter()
        .filter_map(|e| e["metadata"]["service_name"].as_str())
        .collect();

    assert_eq!(services.len(), 3);
    assert!(services.contains("service-a"));
    assert!(services.contains("service-b"));
    assert!(services.contains("service-c"));

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_parallel_service_calls() -> Result<()> {
    let app = TestApp::new(Config::default()).await?;
    let trace_id = Uuid::new_v4();
    let base_time = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

    let span_a = "span-a";
    let span_b = "span-b";
    let span_c = "span-c";

    // Service A makes parallel calls to B and C
    let event_a = Event {
        id: Uuid::new_v4(),
        trace_id,
        parent_id: None,
        timestamp: base_time,
        kind: EventKind::FunctionCall {
            function_name: "orchestrate".into(),
            module: "a".into(),
            args: json!({}),
            file: "a.rs".into(),
            line: 1,
        },
        metadata: create_metadata("service-a", "a1", Some(span_a.into()), None),
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    // Service B (parallel call 1)
    let event_b = Event {
        id: Uuid::new_v4(),
        trace_id,
        parent_id: None,
        timestamp: base_time + chrono::Duration::milliseconds(5),
        kind: EventKind::FunctionCall {
            function_name: "task1".into(),
            module: "b".into(),
            args: json!({}),
            file: "b.rs".into(),
            line: 1,
        },
        metadata: create_metadata("service-b", "b1", Some(span_b.into()), Some(span_a.into())),
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    // Service C (parallel call 2)
    let event_c = Event {
        id: Uuid::new_v4(),
        trace_id,
        parent_id: None,
        timestamp: base_time + chrono::Duration::milliseconds(6),
        kind: EventKind::FunctionCall {
            function_name: "task2".into(),
            module: "c".into(),
            args: json!({}),
            file: "c.rs".into(),
            line: 1,
        },
        metadata: create_metadata("service-c", "c1", Some(span_c.into()), Some(span_a.into())),
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    let payload = json!({
        "events": [event_a, event_b, event_c],
    });
    app.post_json("/events", payload).await?;

    wait_for_trace_events(&app, &trace_id, 3).await?;

    let trace = app.get_json(&format!("/api/traces/{}", trace_id)).await?;
    let events = trace["data"]["events"].as_array().unwrap();

    assert_eq!(events.len(), 3);

    // Verify both B and C are in the same trace (parallel branches)
    let services: std::collections::HashSet<_> = events
        .iter()
        .filter_map(|e| e["metadata"]["service_name"].as_str())
        .collect();

    assert_eq!(services.len(), 3);

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_orphaned_span_handling() -> Result<()> {
    let app = TestApp::new(Config::default()).await?;
    let trace_id = Uuid::new_v4();
    let base_time = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

    // Service B has upstream_span_id pointing to non-existent span
    let event_b = Event {
        id: Uuid::new_v4(),
        trace_id,
        parent_id: None,
        timestamp: base_time,
        kind: EventKind::FunctionCall {
            function_name: "orphaned".into(),
            module: "b".into(),
            args: json!({}),
            file: "b.rs".into(),
            line: 1,
        },
        metadata: create_metadata(
            "service-b",
            "b1",
            Some("span-b".into()),
            Some("non-existent-span".into()),
        ),
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    let payload = json!({
        "events": [event_b],
    });
    app.post_json("/events", payload).await?;

    wait_for_trace_events(&app, &trace_id, 1).await?;

    // Should not crash - orphaned spans should be handled gracefully
    let trace = app.get_json(&format!("/api/traces/{}", trace_id)).await?;
    let events = trace["data"]["events"].as_array().unwrap();

    assert_eq!(events.len(), 1);

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_four_service_chain_realistic() -> Result<()> {
    // This mirrors the actual distributed demo: TS → Py → Go → Rust
    let app = TestApp::new(Config::default()).await?;
    let trace_id = Uuid::new_v4();
    let base_time = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

    let span_ts = "ts-span-001";
    let span_py = "py-span-001";
    let span_go = "go-span-001";
    let span_rust = "rust-span-001";

    // TypeScript service
    let event_ts = Event {
        id: Uuid::new_v4(),
        trace_id,
        parent_id: None,
        timestamp: base_time,
        kind: EventKind::FunctionCall {
            function_name: "processRequest".into(),
            module: "typescript-service".into(),
            args: json!({"payload": "test"}),
            file: "server.ts".into(),
            line: 50,
        },
        metadata: create_metadata("typescript-service", "ts-1", Some(span_ts.into()), None),
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    // Python service (called by TS)
    let event_py = Event {
        id: Uuid::new_v4(),
        trace_id,
        parent_id: None,
        timestamp: base_time + chrono::Duration::milliseconds(10),
        kind: EventKind::FunctionCall {
            function_name: "process".into(),
            module: "python-service".into(),
            args: json!({"payload": "test"}),
            file: "server.py".into(),
            line: 40,
        },
        metadata: create_metadata(
            "python-service",
            "py-1",
            Some(span_py.into()),
            Some(span_ts.into()),
        ),
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    // Go service (called by Python)
    let event_go = Event {
        id: Uuid::new_v4(),
        trace_id,
        parent_id: None,
        timestamp: base_time + chrono::Duration::milliseconds(20),
        kind: EventKind::FunctionCall {
            function_name: "Process".into(),
            module: "go-service".into(),
            args: json!({"payload": "test"}),
            file: "main.go".into(),
            line: 30,
        },
        metadata: create_metadata(
            "go-service",
            "go-1",
            Some(span_go.into()),
            Some(span_py.into()),
        ),
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    // Rust service (called by Go)
    let event_rust = Event {
        id: Uuid::new_v4(),
        trace_id,
        parent_id: None,
        timestamp: base_time + chrono::Duration::milliseconds(30),
        kind: EventKind::FunctionCall {
            function_name: "process_request".into(),
            module: "rust-service".into(),
            args: json!({"payload": "test"}),
            file: "main.rs".into(),
            line: 100,
        },
        metadata: create_metadata(
            "rust-service",
            "rust-1",
            Some(span_rust.into()),
            Some(span_go.into()),
        ),
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    let payload = json!({
        "events": [event_ts, event_py, event_go, event_rust],
    });
    app.post_json("/events", payload).await?;

    wait_for_trace_events(&app, &trace_id, 4).await?;

    let trace = app.get_json(&format!("/api/traces/{}", trace_id)).await?;
    let events = trace["data"]["events"].as_array().unwrap();

    assert_eq!(events.len(), 4);

    // Verify all four services present
    let services: std::collections::HashSet<_> = events
        .iter()
        .filter_map(|e| e["metadata"]["service_name"].as_str())
        .collect();

    assert_eq!(services.len(), 4);
    assert!(services.contains("typescript-service"));
    assert!(services.contains("python-service"));
    assert!(services.contains("go-service"));
    assert!(services.contains("rust-service"));

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_multiple_traces_isolated() -> Result<()> {
    // Verify that events from different traces don't get mixed
    let app = TestApp::new(Config::default()).await?;
    let trace1 = Uuid::new_v4();
    let trace2 = Uuid::new_v4();
    let base_time = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

    // Trace 1: Service A → Service B
    let event_1a = Event {
        id: Uuid::new_v4(),
        trace_id: trace1,
        parent_id: None,
        timestamp: base_time,
        kind: EventKind::FunctionCall {
            function_name: "func1".into(),
            module: "a".into(),
            args: json!({}),
            file: "a.rs".into(),
            line: 1,
        },
        metadata: create_metadata("service-a", "a1", Some("span-1a".into()), None),
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    let event_1b = Event {
        id: Uuid::new_v4(),
        trace_id: trace1,
        parent_id: None,
        timestamp: base_time + chrono::Duration::milliseconds(5),
        kind: EventKind::FunctionCall {
            function_name: "func2".into(),
            module: "b".into(),
            args: json!({}),
            file: "b.rs".into(),
            line: 1,
        },
        metadata: create_metadata(
            "service-b",
            "b1",
            Some("span-1b".into()),
            Some("span-1a".into()),
        ),
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    // Trace 2: Service C → Service D
    let event_2c = Event {
        id: Uuid::new_v4(),
        trace_id: trace2,
        parent_id: None,
        timestamp: base_time,
        kind: EventKind::FunctionCall {
            function_name: "func3".into(),
            module: "c".into(),
            args: json!({}),
            file: "c.rs".into(),
            line: 1,
        },
        metadata: create_metadata("service-c", "c1", Some("span-2c".into()), None),
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    let event_2d = Event {
        id: Uuid::new_v4(),
        trace_id: trace2,
        parent_id: None,
        timestamp: base_time + chrono::Duration::milliseconds(5),
        kind: EventKind::FunctionCall {
            function_name: "func4".into(),
            module: "d".into(),
            args: json!({}),
            file: "d.rs".into(),
            line: 1,
        },
        metadata: create_metadata(
            "service-d",
            "d1",
            Some("span-2d".into()),
            Some("span-2c".into()),
        ),
        causality_vector: Vec::new(),
        lock_set: Vec::new(),
    };

    // Submit all events
    let payload = json!({
        "events": [event_1a, event_1b, event_2c, event_2d],
    });
    app.post_json("/events", payload).await?;

    wait_for_trace_events(&app, &trace1, 2).await?;
    wait_for_trace_events(&app, &trace2, 2).await?;

    // Verify trace 1 only has service-a and service-b
    let t1 = app.get_json(&format!("/api/traces/{}", trace1)).await?;
    let t1_services: std::collections::HashSet<_> = t1["data"]["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|e| e["metadata"]["service_name"].as_str())
        .collect();

    assert_eq!(t1_services.len(), 2);
    assert!(t1_services.contains("service-a"));
    assert!(t1_services.contains("service-b"));

    // Verify trace 2 only has service-c and service-d
    let t2 = app.get_json(&format!("/api/traces/{}", trace2)).await?;
    let t2_services: std::collections::HashSet<_> = t2["data"]["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|e| e["metadata"]["service_name"].as_str())
        .collect();

    assert_eq!(t2_services.len(), 2);
    assert!(t2_services.contains("service-c"));
    assert!(t2_services.contains("service-d"));

    Ok(())
}
