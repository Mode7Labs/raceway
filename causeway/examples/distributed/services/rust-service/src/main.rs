use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    middleware,
    response::Json,
    routing::{get, post},
    Router,
};
use once_cell::sync::OnceCell;
use raceway::{RacewayClient, TrackedMutex};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::signal;

const PORT: u16 = 6004;
const SERVICE_NAME: &str = "rust-service";

// Global request counter with tracked lock
static GLOBAL_COUNTER: OnceCell<TrackedMutex<i32>> = OnceCell::new();

#[derive(Deserialize)]
struct ProcessRequest {
    #[serde(default)]
    downstream: Option<String>,
    #[serde(default)]
    next_downstream: Option<String>,
    payload: String,
}

#[derive(Serialize)]
struct ProcessResponse {
    service: String,
    #[serde(rename = "receivedHeaders")]
    received_headers: HashMap<String, String>,
    payload: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    downstream: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct HealthResponse {
    service: String,
    status: String,
}

#[tokio::main]
async fn main() {
    let client = Arc::new(RacewayClient::new("http://localhost:8080", SERVICE_NAME));

    // Initialize global counter with tracked lock
    GLOBAL_COUNTER.set(TrackedMutex::new(0, client.clone(), "global_request_counter"))
        .ok();

    // Clone client for shutdown handler before moving into app state
    let client_for_shutdown = client.clone();

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/process", post(process_handler))
        .layer(middleware::from_fn_with_state(
            client.clone(),
            raceway_middleware,
        ))
        .with_state(client);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", PORT))
        .await
        .unwrap();

    println!("{} listening on port {}", SERVICE_NAME, PORT);
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            shutdown_signal().await;
            println!("[{}] Shutting down, flushing events...", SERVICE_NAME);
            client_for_shutdown.shutdown();
        })
        .await
        .unwrap();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}

async fn raceway_middleware(
    State(client): State<Arc<RacewayClient>>,
    headers: HeaderMap,
    request: axum::extract::Request,
    next: middleware::Next,
) -> axum::response::Response {
    RacewayClient::middleware(client, headers, request, next).await
}

async fn health_handler() -> Json<HealthResponse> {
    Json(HealthResponse {
        service: SERVICE_NAME.to_string(),
        status: "healthy".to_string(),
    })
}

async fn process_handler(
    State(client): State<Arc<RacewayClient>>,
    headers: HeaderMap,
    Json(req): Json<ProcessRequest>,
) -> (StatusCode, Json<ProcessResponse>) {
    // Track some work
    client.track_function_call("process_request", &req.payload);

    // Increment request counter with tracked lock (using new TrackedMutex)
    if let Some(counter) = GLOBAL_COUNTER.get() {
        let mut count = counter.lock("Mutex");
        let old_value = *count;
        *count += 1;
        client.track_state_change("request_count", Some(old_value), *count, "Write");
    }

    let mut downstream_response = None;

    // Call downstream service if specified
    if let Some(downstream_url) = &req.downstream {
        if let Ok(prop_headers) = client.propagation_headers(None) {
            let http_client = reqwest::Client::new();
            let payload = serde_json::json!({
                "payload": format!("{} → {}", SERVICE_NAME, req.payload),
                "downstream": req.next_downstream
            });

            if let Ok(resp) = http_client
                .post(downstream_url)
                .json(&payload)
                .header("traceparent", prop_headers.get("traceparent").unwrap())
                .header("raceway-clock", prop_headers.get("raceway-clock").unwrap())
                .send()
                .await
            {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    downstream_response = Some(json);
                }
            }
        }
    }

    let mut received_headers = HashMap::new();
    if let Some(tp) = headers.get("traceparent") {
        received_headers.insert("traceparent".to_string(), tp.to_str().unwrap_or("").to_string());
    }
    if let Some(rc) = headers.get("raceway-clock") {
        received_headers.insert("raceway-clock".to_string(), rc.to_str().unwrap_or("").to_string());
    }

    let response = ProcessResponse {
        service: SERVICE_NAME.to_string(),
        received_headers,
        payload: req.payload,
        downstream: downstream_response,
    };

    (StatusCode::OK, Json(response))
}
