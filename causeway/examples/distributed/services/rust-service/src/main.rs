use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    middleware,
    response::Json,
    routing::{get, post},
    Router,
};
use raceway_sdk::RacewayClient;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

const PORT: u16 = 6004;
const SERVICE_NAME: &str = "rust-service";

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
    axum::serve(listener, app).await.unwrap();
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
    println!("\n[{}] Received request", SERVICE_NAME);
    println!("  traceparent: {:?}", headers.get("traceparent"));
    println!("  raceway-clock: {:?}", headers.get("raceway-clock"));
    println!("  downstream: {:?}", req.downstream);

    // Track some work
    client.track_function_call("process_request", &req.payload);
    client.track_state_change("request_count", Some(0), 1, "Write");

    let mut downstream_response = None;

    // Call downstream service if specified
    if let Some(downstream_url) = &req.downstream {
        println!("  Calling downstream: {}", downstream_url);

        match client.propagation_headers(None) {
            Ok(prop_headers) => {
                println!("  Propagating headers:");
                println!("    traceparent: {:?}", prop_headers.get("traceparent"));
                println!("    raceway-clock: {:?}", prop_headers.get("raceway-clock"));

                let http_client = reqwest::Client::new();
                let payload = serde_json::json!({
                    "payload": format!("{} → {}", SERVICE_NAME, req.payload),
                    "downstream": req.next_downstream
                });

                match http_client
                    .post(downstream_url)
                    .json(&payload)
                    .header("traceparent", prop_headers.get("traceparent").unwrap())
                    .header("raceway-clock", prop_headers.get("raceway-clock").unwrap())
                    .send()
                    .await
                {
                    Ok(resp) => {
                        if let Ok(json) = resp.json::<serde_json::Value>().await {
                            downstream_response = Some(json);
                        }
                    }
                    Err(e) => println!("  Error calling downstream: {}", e),
                }
            }
            Err(e) => println!("  Error getting propagation headers: {}", e),
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
