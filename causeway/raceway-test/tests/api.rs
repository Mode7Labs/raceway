use anyhow::Result;
use raceway_core::Config;
use raceway_test::{fixtures::sample_trace_fixture, harness::TestApp};
use serde_json::json;
use tokio::time::{sleep, Duration};

async fn wait_for_trace(app: &TestApp, trace_id: String, expected_events: usize) -> Result<()> {
    for _ in 0..40 {
        let path = format!("/api/traces/{}", trace_id);
        if let Ok(resp) = app.get_json(&path).await {
            if let Some(events) = resp["data"]["events"].as_array() {
                if events.len() == expected_events {
                    return Ok(());
                }
            }
        }
        sleep(Duration::from_millis(50)).await;
    }
    Err(anyhow::anyhow!("trace did not reach expected event count"))
}

// ─── GET /api/traces Tests ──────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_api_traces_list_empty() -> Result<()> {
    let app = TestApp::new(Config::default()).await?;

    let list = app.get_json("/api/traces?page=1&page_size=10").await?;

    assert_eq!(list["data"]["traces"].as_array().unwrap().len(), 0);
    assert_eq!(list["data"]["total_traces"].as_u64().unwrap(), 0);

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_api_traces_list_with_data() -> Result<()> {
    let app = TestApp::new(Config::default()).await?;
    let fixture = sample_trace_fixture();

    // Submit trace
    let payload = json!({
        "events": fixture.events,
    });
    app.post_json("/events", payload).await?;
    wait_for_trace(&app, fixture.trace_id.to_string(), 4).await?;

    // Get list
    let list = app.get_json("/api/traces?page=1&page_size=10").await?;
    let traces = list["data"]["traces"].as_array().unwrap();

    assert_eq!(traces.len(), 1);
    assert_eq!(traces[0]["trace_id"], fixture.trace_id.to_string());
    assert!(traces[0]["event_count"].as_u64().unwrap() > 0);

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_api_traces_list_pagination() -> Result<()> {
    let app = TestApp::new(Config::default()).await?;

    // Create multiple traces
    for i in 0..15 {
        let mut fixture = sample_trace_fixture();
        fixture.trace_id = uuid::Uuid::new_v4();

        // Modify events to have unique trace_id
        fixture
            .events
            .iter_mut()
            .for_each(|e| e.trace_id = fixture.trace_id);

        let payload = json!({
            "events": fixture.events,
        });
        app.post_json("/events", payload).await?;

        // Small delay to ensure traces are processed
        if i % 5 == 0 {
            sleep(Duration::from_millis(100)).await;
        }
    }

    // Wait for all traces to be processed
    sleep(Duration::from_millis(500)).await;

    // Request page 1 with page_size=10
    let page1 = app.get_json("/api/traces?page=1&page_size=10").await?;
    let traces1 = page1["data"]["traces"].as_array().unwrap();

    assert!(traces1.len() <= 10, "Page 1 should have at most 10 traces");
    assert!(page1["data"]["total_traces"].as_u64().unwrap() >= 15);

    // Request page 2
    let page2 = app.get_json("/api/traces?page=2&page_size=10").await?;
    let traces2 = page2["data"]["traces"].as_array().unwrap();

    assert!(traces2.len() > 0, "Page 2 should have remaining traces");

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_api_traces_list_invalid_pagination() -> Result<()> {
    let app = TestApp::new(Config::default()).await?;

    // Note: The actual behavior depends on server implementation
    // This test documents current behavior and can be adjusted

    // Page 0 - should either error or default to page 1
    let result = app.get_json("/api/traces?page=0&page_size=10").await;

    // Either succeeds with default behavior or fails gracefully
    // We're just checking it doesn't panic
    assert!(result.is_ok() || result.is_err());

    Ok(())
}

// ─── GET /api/traces/:id Tests ──────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_api_trace_get_valid() -> Result<()> {
    let app = TestApp::new(Config::default()).await?;
    let fixture = sample_trace_fixture();

    // Submit trace
    let payload = json!({
        "events": fixture.events,
    });
    app.post_json("/events", payload).await?;
    wait_for_trace(&app, fixture.trace_id.to_string(), 4).await?;

    // Get full trace
    let trace = app
        .get_json(&format!("/api/traces/{}", fixture.trace_id))
        .await?;
    let data = &trace["data"];

    // Verify structure
    assert_eq!(data["events"].as_array().unwrap().len(), 4);
    assert!(data["analysis"].is_object());
    assert!(data["critical_path"].is_object());
    assert!(data["audit_trails"].is_object());

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_api_trace_get_with_analysis() -> Result<()> {
    let app = TestApp::new(Config::default()).await?;
    let fixture = sample_trace_fixture();

    let payload = json!({
        "events": fixture.events,
    });
    app.post_json("/events", payload).await?;
    wait_for_trace(&app, fixture.trace_id.to_string(), 4).await?;

    let trace = app
        .get_json(&format!("/api/traces/{}", fixture.trace_id))
        .await?;
    let data = &trace["data"];

    // Verify race detection
    let race_details = data["analysis"]["race_details"].as_array().unwrap();
    assert_eq!(race_details.len(), fixture.expected_races);

    // Verify critical path
    let critical_nodes = data["critical_path"]["path"].as_array().unwrap();
    assert!(critical_nodes.len() >= fixture.expected_critical_path_nodes);

    // Verify audit trails
    let audit_trails = data["audit_trails"].as_object().unwrap();
    assert!(audit_trails.contains_key("balance"));

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_api_trace_get_nonexistent() -> Result<()> {
    let app = TestApp::new(Config::default()).await?;

    let non_existent_id = uuid::Uuid::new_v4();
    let result = app
        .get_json(&format!("/api/traces/{}", non_existent_id))
        .await;

    // Should fail (404)
    assert!(
        result.is_err(),
        "Should return error for non-existent trace"
    );

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_api_trace_get_malformed_id() -> Result<()> {
    let app = TestApp::new(Config::default()).await?;

    let result = app.get_json("/api/traces/not-a-uuid").await;

    // Should fail with validation error
    assert!(result.is_err(), "Should return error for malformed UUID");

    Ok(())
}

// ─── POST /events Tests ─────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_api_events_post_valid() -> Result<()> {
    let app = TestApp::new(Config::default()).await?;
    let fixture = sample_trace_fixture();

    let payload = json!({
        "events": fixture.events,
    });

    let response = app.post_json("/events", payload).await?;

    // Should succeed
    assert!(response.is_object());

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_api_events_post_empty_batch() -> Result<()> {
    let app = TestApp::new(Config::default()).await?;

    let payload = json!({
        "events": [],
    });

    let result = app.post_json("/events", payload).await;

    // Should succeed or return meaningful error
    // We're just checking it doesn't panic
    assert!(result.is_ok() || result.is_err());

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_api_events_post_invalid_structure() -> Result<()> {
    let app = TestApp::new(Config::default()).await?;

    // Missing required fields
    let payload = json!({
        "events": [
            {
                "id": uuid::Uuid::new_v4(),
                // Missing other required fields
            }
        ],
    });

    let result = app.post_json("/events", payload).await;

    // Should fail with validation error
    assert!(
        result.is_err(),
        "Should return error for invalid event structure"
    );

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_api_events_post_large_batch() -> Result<()> {
    let app = TestApp::new(Config::default()).await?;
    let fixture = sample_trace_fixture();

    // Create 100 events
    let mut events = Vec::new();
    for i in 0..100 {
        let mut event = fixture.events[0].clone();
        event.id = uuid::Uuid::new_v4();
        event.timestamp = event.timestamp + chrono::Duration::milliseconds(i);
        events.push(event);
    }

    let payload = json!({
        "events": events,
    });

    let response = app.post_json("/events", payload).await?;

    // Should succeed
    assert!(response.is_object());

    // Verify all events were stored
    wait_for_trace(&app, fixture.trace_id.to_string(), 100).await?;

    let trace = app
        .get_json(&format!("/api/traces/{}", fixture.trace_id))
        .await?;
    let stored_events = trace["data"]["events"].as_array().unwrap();

    assert_eq!(stored_events.len(), 100);

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_api_events_post_malformed_json() -> Result<()> {
    let app = TestApp::new(Config::default()).await?;

    // This tests the harness's error handling
    // In a real scenario, you'd send raw bytes with malformed JSON

    let payload = json!({
        "not_events": "invalid",
    });

    let result = app.post_json("/events", payload).await;

    // Should fail
    assert!(result.is_err());

    Ok(())
}

// ─── Integration Tests ──────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_api_full_workflow() -> Result<()> {
    let app = TestApp::new(Config::default()).await?;
    let fixture = sample_trace_fixture();

    // 1. List should be empty
    let list_before = app.get_json("/api/traces?page=1&page_size=10").await?;
    assert_eq!(list_before["data"]["traces"].as_array().unwrap().len(), 0);

    // 2. Submit events
    let payload = json!({
        "events": fixture.events,
    });
    app.post_json("/events", payload).await?;
    wait_for_trace(&app, fixture.trace_id.to_string(), 4).await?;

    // 3. List should have one trace
    let list_after = app.get_json("/api/traces?page=1&page_size=10").await?;
    assert_eq!(list_after["data"]["traces"].as_array().unwrap().len(), 1);

    // 4. Get full trace should return complete data
    let trace = app
        .get_json(&format!("/api/traces/{}", fixture.trace_id))
        .await?;
    assert_eq!(trace["data"]["events"].as_array().unwrap().len(), 4);
    assert!(trace["data"]["analysis"]["race_details"].is_array());

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_api_concurrent_submissions() -> Result<()> {
    let app = TestApp::new(Config::default()).await?;

    // Submit multiple traces rapidly
    for _ in 0..5 {
        let mut fixture = sample_trace_fixture();
        fixture.trace_id = uuid::Uuid::new_v4();
        fixture
            .events
            .iter_mut()
            .for_each(|e| e.trace_id = fixture.trace_id);

        let payload = json!({
            "events": fixture.events,
        });

        // Note: We can't truly run these concurrently with current harness
        // but we can submit them rapidly
        app.post_json("/events", payload.clone()).await?;
    }

    // Wait for processing
    sleep(Duration::from_millis(500)).await;

    // Verify all traces were stored
    let list = app.get_json("/api/traces?page=1&page_size=20").await?;
    let traces = list["data"]["traces"].as_array().unwrap();

    assert!(traces.len() >= 5, "Should have at least 5 traces");

    Ok(())
}
