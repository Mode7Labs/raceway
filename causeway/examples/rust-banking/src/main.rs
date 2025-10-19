/*!
# Rust Banking API - Raceway Demo

This demonstrates how Raceway can detect race conditions in a Rust/Axum banking API.

To run:
1. Start Raceway server: cd ../.. && cargo run --release -- serve
2. Start this server: cargo run --release
3. Open browser: http://localhost:3051
4. Click "Trigger Race Condition" to see the bug
5. View results: http://localhost:8080
*/

use axum::{
    body::Body,
    extract::{Path, Request},
    extract::State,
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{Json, Response},
    routing::{get, post},
    Router,
};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::time::{sleep, Duration};
use tower_http::services::ServeDir;

// Inline Raceway SDK (in production, use: use raceway_sdk::RacewayClient;)
mod raceway_sdk {
    use super::*;
    use std::collections::HashMap;
    use std::cell::RefCell;

    tokio::task_local! {
        pub static RACEWAY_CONTEXT: RefCell<RacewayContext>;
    }

    #[derive(Clone)]
    pub struct RacewayClient {
        endpoint: String,
        service_name: String,
        traces: Arc<RwLock<HashMap<String, TraceContext>>>,
        event_buffer: Arc<RwLock<Vec<Event>>>,
        http_client: reqwest::Client,
    }

    #[derive(Clone)]
    pub struct TraceContext {
        pub trace_id: String,
        pub events: Vec<Event>,
    }

    // Context that propagates through async tasks
    #[derive(Clone, Debug)]
    pub struct RacewayContext {
        pub trace_id: String,
        pub parent_id: Option<String>,
        pub root_id: Option<String>,
        pub clock: u64,
    }

    impl RacewayContext {
        pub fn new(trace_id: String) -> Self {
            Self {
                trace_id,
                parent_id: None,
                root_id: None,
                clock: 0,
            }
        }

        pub fn with_parent(mut self, parent_id: String, root_id: String, clock: u64) -> Self {
            self.parent_id = Some(parent_id);
            self.root_id = Some(root_id);
            self.clock = clock;
            self
        }
    }

    #[derive(Debug, Clone, Serialize)]
    struct Event {
        id: String,
        trace_id: String,
        parent_id: Option<String>,
        timestamp: String,
        kind: EventKind,
        metadata: Metadata,
        causality_vector: Vec<(String, u64)>,
        lock_set: Vec<String>,
    }

    #[derive(Debug, Clone, Serialize)]
    struct Metadata {
        thread_id: String,
        process_id: u32,
        service_name: String,
        environment: String,
        tags: HashMap<String, String>,
        duration_ns: Option<u64>,
    }

    #[derive(Debug, Clone, Serialize)]
    #[serde(untagged)]
    enum EventKind {
        StateChange {
            #[serde(rename = "StateChange")]
            state_change: StateChangeData,
        },
        FunctionCall {
            #[serde(rename = "FunctionCall")]
            function_call: FunctionCallData,
        },
        HttpRequest {
            #[serde(rename = "HttpRequest")]
            http_request: HttpRequestData,
        },
        HttpResponse {
            #[serde(rename = "HttpResponse")]
            http_response: HttpResponseData,
        },
    }

    #[derive(Debug, Clone, Serialize)]
    struct StateChangeData {
        variable: String,
        old_value: serde_json::Value,
        new_value: serde_json::Value,
        location: String,
        access_type: String,
    }

    #[derive(Debug, Clone, Serialize)]
    struct FunctionCallData {
        function_name: String,
        module: String,
        args: serde_json::Value,
        file: String,
        line: u32,
    }

    #[derive(Debug, Clone, Serialize)]
    struct HttpRequestData {
        method: String,
        url: String,
        headers: HashMap<String, String>,
        body: Option<serde_json::Value>,
    }

    #[derive(Debug, Clone, Serialize)]
    struct HttpResponseData {
        status: u16,
        headers: HashMap<String, String>,
        body: Option<serde_json::Value>,
        duration_ms: u64,
    }

    impl RacewayClient {
        pub fn new(endpoint: &str, service_name: &str) -> Self {
            let client = Self {
                endpoint: endpoint.to_string(),
                service_name: service_name.to_string(),
                traces: Arc::new(RwLock::new(HashMap::new())),
                event_buffer: Arc::new(RwLock::new(Vec::new())),
                http_client: reqwest::Client::new(),
            };

            // Start auto-flush background task
            let client_clone = client.clone();
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(1));
                loop {
                    interval.tick().await;
                    client_clone.flush().await;
                }
            });

            client
        }

        // Middleware to initialize trace context from headers
        pub async fn middleware(
            client: Arc<RacewayClient>,
            headers: HeaderMap,
            request: Request,
            next: Next,
        ) -> Response {
            // Extract or generate trace ID
            let trace_id = headers
                .get("x-trace-id")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

            // Initialize context for this request
            let ctx = RacewayContext::new(trace_id.clone());

            // Run the rest of the request within this context
            RACEWAY_CONTEXT
                .scope(RefCell::new(ctx), async move {
                    // Track HTTP request as root event
                    let method = request.method().to_string();
                    let uri = request.uri().to_string();
                    client.track_http_request(&method, &uri);

                    next.run(request).await
                })
                .await
        }

        // Simplified track methods that use context automatically
        pub fn track_state_change<T: Serialize>(
            &self,
            variable: &str,
            old_value: Option<T>,
            new_value: T,
            access_type: &str,
        ) {
            RACEWAY_CONTEXT.try_with(|ctx_cell| {
                let ctx = ctx_cell.borrow().clone();
                let location = format!("{}:{}", file!(), line!());

                let event_id = self.capture_event(
                    &ctx.trace_id,
                    ctx.parent_id.clone(),
                    ctx.root_id.clone(),
                    ctx.clock,
                    EventKind::StateChange {
                        state_change: StateChangeData {
                            variable: variable.to_string(),
                            old_value: serde_json::to_value(old_value).unwrap_or(serde_json::Value::Null),
                            new_value: serde_json::to_value(new_value).unwrap_or(serde_json::Value::Null),
                            location,
                            access_type: access_type.to_string(),
                        },
                    },
                );

                // Update context: new parent and increment clock
                let mut ctx_mut = ctx_cell.borrow_mut();
                if ctx_mut.root_id.is_none() {
                    ctx_mut.root_id = Some(event_id.clone());
                }
                ctx_mut.parent_id = Some(event_id);
                ctx_mut.clock += 1;
            }).ok();
        }

        pub fn track_function_call<T: Serialize>(
            &self,
            function_name: &str,
            args: T,
        ) {
            RACEWAY_CONTEXT.try_with(|ctx_cell| {
                let ctx = ctx_cell.borrow().clone();

                let event_id = self.capture_event(
                    &ctx.trace_id,
                    ctx.parent_id.clone(),
                    ctx.root_id.clone(),
                    ctx.clock,
                    EventKind::FunctionCall {
                        function_call: FunctionCallData {
                            function_name: function_name.to_string(),
                            module: "banking".to_string(),
                            args: serde_json::to_value(args).unwrap_or(serde_json::Value::Null),
                            file: file!().to_string(),
                            line: line!(),
                        },
                    },
                );

                // Update context
                let mut ctx_mut = ctx_cell.borrow_mut();
                if ctx_mut.root_id.is_none() {
                    ctx_mut.root_id = Some(event_id.clone());
                }
                ctx_mut.parent_id = Some(event_id);
                ctx_mut.clock += 1;
            }).ok();
        }

        fn track_http_request(&self, method: &str, url: &str) {
            RACEWAY_CONTEXT.try_with(|ctx_cell| {
                let ctx = ctx_cell.borrow().clone();

                let event_id = self.capture_event(
                    &ctx.trace_id,
                    ctx.parent_id.clone(),
                    ctx.root_id.clone(),
                    ctx.clock,
                    EventKind::HttpRequest {
                        http_request: HttpRequestData {
                            method: method.to_string(),
                            url: url.to_string(),
                            headers: HashMap::new(),
                            body: None,
                        },
                    },
                );

                // Update context
                let mut ctx_mut = ctx_cell.borrow_mut();
                if ctx_mut.root_id.is_none() {
                    ctx_mut.root_id = Some(event_id.clone());
                }
                ctx_mut.parent_id = Some(event_id);
                ctx_mut.clock += 1;
            }).ok();
        }

        pub fn track_http_response(&self, status: u16, duration_ms: u64) {
            RACEWAY_CONTEXT.try_with(|ctx_cell| {
                let ctx = ctx_cell.borrow().clone();

                let event_id = self.capture_event(
                    &ctx.trace_id,
                    ctx.parent_id.clone(),
                    ctx.root_id.clone(),
                    ctx.clock,
                    EventKind::HttpResponse {
                        http_response: HttpResponseData {
                            status,
                            headers: HashMap::new(),
                            body: None,
                            duration_ms,
                        },
                    },
                );

                // Update context
                let mut ctx_mut = ctx_cell.borrow_mut();
                ctx_mut.parent_id = Some(event_id);
                ctx_mut.clock += 1;
            }).ok();
        }

        fn capture_event(&self, trace_id: &str, parent_id: Option<String>, root_event_id: Option<String>, clock: u64, kind: EventKind) -> String {
            // Get or create trace
            let mut traces = self.traces.write();

            // Create trace if it doesn't exist
            if !traces.contains_key(trace_id) {
                traces.insert(trace_id.to_string(), TraceContext {
                    trace_id: trace_id.to_string(),
                    events: Vec::new(),
                });
            }

            let trace = traces.get_mut(trace_id).unwrap();

            // Build causality vector
            let causality_vector = if let Some(root_id) = root_event_id {
                vec![(root_id, clock)]
            } else {
                vec![]  // Root event has empty vector
            };

            let event = Event {
                id: uuid::Uuid::new_v4().to_string(),
                trace_id: trace.trace_id.clone(),
                parent_id,
                timestamp: chrono::Utc::now().to_rfc3339(),
                kind,
                metadata: Metadata {
                    thread_id: format!("{:?}", std::thread::current().id()),
                    process_id: std::process::id(),
                    service_name: self.service_name.clone(),
                    environment: "development".to_string(),
                    tags: HashMap::new(),
                    duration_ns: None,
                },
                causality_vector,
                lock_set: vec![],
            };
            let event_id = event.id.clone();
            trace.events.push(event);
            event_id
        }

        async fn flush(&self) {
            // First, move events from all active traces to the buffer
            {
                let mut traces = self.traces.write();
                let mut buffer = self.event_buffer.write();

                for (_trace_id, trace) in traces.iter_mut() {
                    if !trace.events.is_empty() {
                        let event_count = trace.events.len();
                        eprintln!("[Raceway] Moving {} events from trace {} to buffer", event_count, trace.trace_id);
                        buffer.extend(trace.events.drain(..));
                    }
                }
            }

            // Now flush the buffer
            let events: Vec<Event> = self.event_buffer.write().drain(..).collect();
            if events.is_empty() {
                return;
            }

            eprintln!("[Raceway] Flushing {} events to server", events.len());
            let payload = serde_json::json!({ "events": events });
            if let Err(e) = self
                .http_client
                .post(format!("{}/events", self.endpoint))
                .json(&payload)
                .send()
                .await
            {
                eprintln!("[Raceway] Error sending events: {}", e);
            } else {
                eprintln!("[Raceway] Successfully sent {} events", events.len());
            }
        }
    }
}

// Application state
#[derive(Clone)]
struct AppState {
    accounts: Arc<RwLock<HashMap<String, Account>>>,
    raceway: Arc<raceway_sdk::RacewayClient>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Account {
    balance: i64,
}

#[derive(Debug, Serialize, Deserialize)]
struct TransferRequest {
    from: String,
    to: String,
    amount: i64,
}

#[derive(Debug, Serialize)]
struct TransferResponse {
    success: bool,
    from: AccountInfo,
    to: AccountInfo,
}

#[derive(Debug, Serialize)]
struct AccountInfo {
    account: String,
    #[serde(rename = "newBalance")]
    new_balance: i64,
}

#[derive(Debug, Serialize)]
struct AccountsResponse {
    accounts: HashMap<String, Account>,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

#[tokio::main]
async fn main() {
    // Initialize state
    let mut accounts = HashMap::new();
    accounts.insert("alice".to_string(), Account { balance: 1000 });
    accounts.insert("bob".to_string(), Account { balance: 500 });
    accounts.insert("charlie".to_string(), Account { balance: 300 });

    let raceway = Arc::new(raceway_sdk::RacewayClient::new("http://localhost:8080", "banking-api"));

    let state = AppState {
        accounts: Arc::new(RwLock::new(accounts)),
        raceway: raceway.clone(),
    };

    // Build router with Raceway middleware for automatic trace context
    let app = Router::new()
        .route("/api/accounts", get(get_accounts))
        .route("/api/balance/:account", get(get_balance))
        .route("/api/transfer", post(transfer))
        .route("/api/reset", post(reset_accounts))
        .layer(middleware::from_fn(move |headers, request, next| {
            let client = raceway.clone();
            async move {
                raceway_sdk::RacewayClient::middleware(client, headers, request, next).await
            }
        }))
        .nest_service("/", ServeDir::new("public"))
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3051".to_string());
    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();

    println!("\n💰 Banking API running on http://localhost:{}", port);
    println!("🔍 Raceway integration enabled");
    println!("\n📊 Web UI: http://localhost:{}", port);
    println!("📊 Raceway Analysis: http://localhost:8080");
    println!("\n🚨 Click \"Trigger Race Condition\" in the UI to see the bug!\n");

    axum::serve(listener, app).await.unwrap();
}

async fn get_accounts(State(state): State<AppState>) -> Json<AccountsResponse> {
    state.raceway.track_function_call("get_accounts", serde_json::json!({}));
    let accounts = state.accounts.read().clone();
    state.raceway.track_http_response(200, 0);

    Json(AccountsResponse { accounts })
}

async fn get_balance(
    State(state): State<AppState>,
    Path(account): Path<String>,
) -> Result<Json<Account>, (StatusCode, Json<ErrorResponse>)> {
    state.raceway.track_function_call("get_balance", serde_json::json!({ "account": &account }));

    let accounts = state.accounts.read();
    let account_data = accounts.get(&account).cloned();

    if let Some(acc) = account_data {
        state.raceway.track_state_change(&format!("{}.balance", account), None::<i64>, acc.balance, "Read");
        state.raceway.track_http_response(200, 0);
        Ok(Json(acc))
    } else {
        state.raceway.track_http_response(404, 0);
        Err((StatusCode::NOT_FOUND, Json(ErrorResponse { error: "Account not found".to_string() })))
    }
}

async fn transfer(
    State(state): State<AppState>,
    Json(req): Json<TransferRequest>,
) -> Result<Json<TransferResponse>, (StatusCode, Json<ErrorResponse>)> {
    let start = Instant::now();

    // Track function call - SDK auto-manages trace context
    state.raceway.track_function_call(
        "transfer",
        serde_json::json!({ "from": &req.from, "to": &req.to, "amount": req.amount }),
    );

    // Simulate some processing time (makes race conditions more likely)
    sleep(Duration::from_millis(10)).await;

    // READ: Get current balance (without holding lock - RACE CONDITION!)
    let current_balance = {
        let accounts = state.accounts.read();
        accounts.get(&req.from).map(|a| a.balance)
    };

    let Some(balance) = current_balance else {
        state.raceway.track_http_response(404, start.elapsed().as_millis() as u64);
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Account not found".to_string(),
            }),
        ));
    };

    // Track the READ - SDK auto-captures location via file!() and line!()
    state.raceway.track_state_change(
        &format!("{}.balance", req.from),
        None::<i64>,
        balance,
        "Read",
    );

    println!("[{}] Read balance: {}", req.from, balance);

    // Check sufficient funds
    if balance < req.amount {
        state.raceway.track_http_response(400, start.elapsed().as_millis() as u64);
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Insufficient funds".to_string(),
            }),
        ));
    }

    // Simulate more processing (window for race condition!)
    sleep(Duration::from_millis(10)).await;

    // WRITE: Update balance (RACE CONDITION HERE!)
    let new_balance = balance - req.amount;
    {
        let mut accounts = state.accounts.write();
        if let Some(account) = accounts.get_mut(&req.from) {
            account.balance = new_balance;
        }
    }

    // Track the WRITE - SDK auto-captures location
    state.raceway.track_state_change(
        &format!("{}.balance", req.from),
        Some(balance),
        new_balance,
        "Write",
    );

    println!("[{}] Wrote balance: {}", req.from, new_balance);

    // Credit the recipient
    let to_balance = {
        let mut accounts = state.accounts.write();
        if let Some(account) = accounts.get_mut(&req.to) {
            let old = account.balance;
            account.balance += req.amount;

            // Track recipient balance change
            state.raceway.track_state_change(
                &format!("{}.balance", req.to),
                Some(old),
                account.balance,
                "Write",
            );

            account.balance
        } else {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "Recipient account not found".to_string(),
                }),
            ));
        }
    };

    state.raceway.track_http_response(200, start.elapsed().as_millis() as u64);

    Ok(Json(TransferResponse {
        success: true,
        from: AccountInfo {
            account: req.from.clone(),
            new_balance,
        },
        to: AccountInfo {
            account: req.to.clone(),
            new_balance: to_balance,
        },
    }))
}

async fn reset_accounts(State(state): State<AppState>) -> Json<serde_json::Value> {
    state.raceway.track_function_call("reset_accounts", serde_json::json!({}));

    let mut accounts = state.accounts.write();
    accounts.insert("alice".to_string(), Account { balance: 1000 });
    accounts.insert("bob".to_string(), Account { balance: 500 });
    accounts.insert("charlie".to_string(), Account { balance: 300 });

    state.raceway.track_http_response(200, 0);

    Json(serde_json::json!({"message": "Accounts reset", "accounts": *accounts}))
}
