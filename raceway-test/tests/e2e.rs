use anyhow::Result;
use raceway_core::Config;
use raceway_test::{fixtures::sample_trace_fixture, harness::TestApp};
use serde_json::json;
use tokio::time::{sleep, Duration};

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn end_to_end_trace_flow() -> Result<()> {
    let app = TestApp::new(Config::default()).await?;
    let fixture = sample_trace_fixture();

    let payload = json!({
        "events": fixture.events,
    });

    app.post_json("/events", payload).await?;

    wait_for_trace(&app, fixture.trace_id.to_string(), 4).await?;

    let list = app.get_json("/api/traces?page=1&page_size=10").await?;
    let traces = list["data"]["traces"].as_array().expect("traces array");
    assert_eq!(traces.len(), 1);
    assert_eq!(traces[0]["trace_id"], fixture.trace_id.to_string());
    assert_eq!(traces[0]["event_count"].as_u64().unwrap() as usize, 4);

    let full_path = format!("/api/traces/{}", fixture.trace_id);
    let full = app.get_json(&full_path).await?;
    let data = &full["data"];

    assert_eq!(data["events"].as_array().unwrap().len(), 4);

    let race_details = data["analysis"]["race_details"].as_array().unwrap();
    assert_eq!(race_details.len(), fixture.expected_races);

    let critical_nodes = data["critical_path"]["path"].as_array().unwrap();
    assert!(critical_nodes.len() >= fixture.expected_critical_path_nodes);

    let audit_trails = data["audit_trails"].as_object().unwrap();
    assert!(audit_trails.contains_key("balance"));

    Ok(())
}

async fn wait_for_trace(app: &TestApp, trace_id: String, expected_events: usize) -> Result<()> {
    for _ in 0..40 {
        let path = format!("/api/traces/{trace_id}");
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
