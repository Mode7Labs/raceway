use anyhow::Result;
use axum::{
    extract::{Path, State},
    http::{Method, StatusCode},
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use raceway_core::{RacewayEngine, Event, Config};
use raceway_core::engine::EngineConfig;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    engine: Arc<RacewayEngine>,
    verbose: bool,
}

#[derive(Debug, Deserialize)]
struct EventBatch {
    events: Vec<Event>,
}

#[derive(Debug, Serialize)]
struct ApiResponse<T: Serialize> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

impl<T: Serialize> ApiResponse<T> {
    fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }
}

impl ApiResponse<String> {
    fn error(message: String) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(message),
        }
    }
}

#[derive(Debug, Serialize)]
struct ServerStatus {
    version: String,
    uptime_seconds: u64,
    events_captured: usize,
    traces_active: usize,
}

pub async fn start_server(config: Config) -> Result<()> {
    // Initialize tracing based on config
    let log_level = match config.logging.level.to_lowercase().as_str() {
        "trace" => tracing::Level::TRACE,
        "debug" => tracing::Level::DEBUG,
        "info" => tracing::Level::INFO,
        "warn" => tracing::Level::WARN,
        "error" => tracing::Level::ERROR,
        _ => tracing::Level::INFO,
    };

    tracing_subscriber::fmt()
        .with_target(config.logging.include_modules)
        .with_max_level(log_level)
        .compact()
        .init();

    if config.server.verbose {
        println!("[{}] 🔍 Verbose logging enabled", chrono::Local::now().format("%H:%M:%S%.3f"));
        println!("[{}] 📝 Loaded configuration from raceway.toml", chrono::Local::now().format("%H:%M:%S%.3f"));
        println!("[{}] 💾 Storage backend: {}", chrono::Local::now().format("%H:%M:%S%.3f"), config.storage.backend);
    }

    // Create engine config from main config
    let engine_config = EngineConfig {
        buffer_size: config.engine.buffer_size,
        batch_size: config.engine.batch_size,
        flush_interval_ms: config.engine.flush_interval_ms,
        enable_anomaly_detection: config.anomaly_detection.enabled,
        enable_race_detection: config.race_detection.enabled,
    };

    let engine = Arc::new(RacewayEngine::new(engine_config));
    engine.start().await?;

    let state = AppState {
        engine,
        verbose: config.server.verbose,
    };

    // Configure CORS based on config
    let cors = if config.server.cors_enabled {
        if config.development.cors_allow_all || config.server.cors_origins.contains(&"*".to_string()) {
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
                .allow_headers(Any)
        } else {
            // TODO: Parse specific origins from config.server.cors_origins
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
                .allow_headers(Any)
        }
    } else {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
            .allow_headers(Any)
    };

    // Build router
    let app = Router::new()
        .route("/", get(root_handler))
        .route("/health", get(health_handler))
        .route("/status", get(status_handler))
        .route("/events", post(ingest_events_handler))
        .route("/api/traces", get(list_traces_handler))
        .route("/api/traces/:trace_id", get(get_trace_handler))
        .route("/api/traces/:trace_id/tree", get(get_trace_tree_handler))
        .route("/api/traces/:trace_id/critical-path", get(get_critical_path_handler))
        .route("/api/traces/:trace_id/anomalies", get(get_anomalies_handler))
        .route("/api/traces/:trace_id/dependencies", get(get_dependencies_handler))
        .route("/api/traces/:trace_id/audit-trail/:variable", get(get_audit_trail_handler))
        .route("/api/traces/:trace_id/analyze", get(analyze_trace_handler))
        .route("/api/analyze/global", get(analyze_global_handler))
        .layer(cors)
        .with_state(state);

    let addr = format!("{}:{}", config.server.host, config.server.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;

    println!("\n🏁 Raceway Server Started!");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("   🌐 Server:        http://{}", addr);
    println!("   📥 Ingest:        http://{}/events", addr);
    println!("   📊 Status:        http://{}/status", addr);
    println!("   🔍 List traces:   http://{}/api/traces", addr);
    println!("   🎯 Get trace:     http://{}/api/traces/:id", addr);
    println!("   🤖 Analyze:       http://{}/api/traces/:id/analyze", addr);
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    if config.server.verbose {
        println!("   💾 Storage:       {} backend", config.storage.backend);
        println!("   🔍 Race detect:   {}", if config.race_detection.enabled { "enabled" } else { "disabled" });
        println!("   🚨 Anomalies:     {}", if config.anomaly_detection.enabled { "enabled" } else { "disabled" });
    }
    println!("\n✨ Ready to detect races!\n");

    axum::serve(listener, app).await?;

    Ok(())
}

async fn root_handler() -> impl IntoResponse {
    let html = r#"
<!DOCTYPE html>
<html>
<head>
    <title>Raceway - Concurrency Debugger</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        .container {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
        }
        h1 { font-size: 3em; margin: 0; }
        .tagline { font-size: 1.2em; opacity: 0.9; margin-top: 10px; }
        .endpoints {
            margin-top: 30px;
            background: rgba(0, 0, 0, 0.2);
            padding: 20px;
            border-radius: 10px;
        }
        .endpoint {
            margin: 10px 0;
            font-family: monospace;
        }
        .method {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 0.8em;
            font-weight: bold;
            margin-right: 10px;
        }
        .get { background: #10b981; }
        .post { background: #3b82f6; }
        a { color: #60a5fa; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🏁 Raceway</h1>
        <p class="tagline">AI-Powered Concurrency Debugger</p>

        <div class="endpoints">
            <h2>API Endpoints</h2>
            <div class="endpoint">
                <span class="method get">GET</span>
                <a href="/health">/health</a> - Health check
            </div>
            <div class="endpoint">
                <span class="method get">GET</span>
                <a href="/status">/status</a> - Server status
            </div>
            <div class="endpoint">
                <span class="method post">POST</span>
                /events - Ingest events
            </div>
            <div class="endpoint">
                <span class="method get">GET</span>
                <a href="/api/traces">/api/traces</a> - List traces
            </div>
            <div class="endpoint">
                <span class="method get">GET</span>
                /api/traces/:id - Get specific trace
            </div>
            <div class="endpoint">
                <span class="method get">GET</span>
                /api/traces/:id/analyze - Analyze trace
            </div>
        </div>

        <p style="margin-top: 30px; opacity: 0.7;">
            Run <code>raceway tui</code> to launch the interactive terminal UI
        </p>
    </div>
</body>
</html>
    "#;

    (StatusCode::OK, [("content-type", "text/html")], html)
}

async fn health_handler() -> impl IntoResponse {
    Json(ApiResponse::success("OK".to_string()))
}

async fn status_handler(State(state): State<AppState>) -> impl IntoResponse {
    let stats = state.engine.graph().stats();

    let status = ServerStatus {
        version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_seconds: 0, // TODO: Track uptime
        events_captured: stats.total_events,
        traces_active: stats.total_traces,
    };

    Json(ApiResponse::success(status))
}

async fn ingest_events_handler(
    State(state): State<AppState>,
    Json(batch): Json<EventBatch>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let mut success_count = 0;
    let mut error_count = 0;

    for event in batch.events {
        match state.engine.graph().add_event(event) {
            Ok(_) => success_count += 1,
            Err(_) => error_count += 1,
        }
    }

    if error_count == 0 {
        Ok((
            StatusCode::OK,
            Json(ApiResponse::success(format!(
                "Ingested {} events",
                success_count
            ))),
        ))
    } else {
        Ok((
            StatusCode::PARTIAL_CONTENT,
            Json(ApiResponse::success(format!(
                "Ingested {} events, {} errors",
                success_count, error_count
            ))),
        ))
    }
}

async fn list_traces_handler(State(state): State<AppState>) -> impl IntoResponse {
    if state.verbose {
        println!("[{}] 📋 list_traces_handler called", chrono::Local::now().format("%H:%M:%S%.3f"));
    }

    let stats = state.engine.graph().stats();
    let trace_ids = state.engine.graph().get_all_trace_ids();

    if state.verbose {
        println!("[{}] 📊 Found {} traces, {} events",
            chrono::Local::now().format("%H:%M:%S%.3f"),
            stats.total_traces,
            stats.total_events);
    }

    #[derive(Serialize)]
    struct TraceSummary {
        total_traces: usize,
        total_events: usize,
        trace_ids: Vec<String>,
    }

    let summary = TraceSummary {
        total_traces: stats.total_traces,
        total_events: stats.total_events,
        trace_ids: trace_ids.iter().map(|id| id.to_string()).collect(),
    };

    if state.verbose {
        println!("[{}] ✅ list_traces_handler complete", chrono::Local::now().format("%H:%M:%S%.3f"));
    }

    Json(ApiResponse::success(summary))
}

async fn get_trace_handler(
    State(state): State<AppState>,
    Path(trace_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let trace_uuid = match Uuid::parse_str(&trace_id) {
        Ok(id) => id,
        Err(_) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::error(
                    "Invalid trace ID format".to_string(),
                )),
            ))
        }
    };

    match state.engine.graph().get_causal_order(trace_uuid) {
        Ok(events) => {
            #[derive(Serialize)]
            struct TraceData {
                trace_id: String,
                event_count: usize,
                events: Vec<serde_json::Value>,
            }

            let events_json: Vec<serde_json::Value> = events
                .iter()
                .map(|e| serde_json::to_value(e).unwrap_or(serde_json::json!({})))
                .collect();

            let data = TraceData {
                trace_id,
                event_count: events.len(),
                events: events_json,
            };

            Ok((StatusCode::OK, Json(ApiResponse::success(data))))
        }
        Err(e) => Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error(format!(
                "Trace not found: {}",
                e
            ))),
        )),
    }
}

async fn analyze_global_handler(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    if state.verbose {
        println!("[{}] 🌐 analyze_global_handler called", chrono::Local::now().format("%H:%M:%S%.3f"));
    }

    if state.verbose {
        println!("[{}] 🔍 Calling find_global_concurrent_events()...", chrono::Local::now().format("%H:%M:%S%.3f"));
    }

    match state.engine.graph().find_global_concurrent_events() {
        Ok(concurrent) => {
            if state.verbose {
                println!("[{}] ✅ find_global_concurrent_events() returned {} pairs",
                    chrono::Local::now().format("%H:%M:%S%.3f"),
                    concurrent.len());
            }

            #[derive(Serialize)]
            struct RaceDetail {
                severity: String,
                variable: String,
                trace1_id: String,
                trace2_id: String,
                event1_thread: String,
                event2_thread: String,
                event1_location: String,
                event2_location: String,
                event1_timestamp: String,
                event2_timestamp: String,
                description: String,
            }

            #[derive(Serialize)]
            struct GlobalAnalysis {
                total_traces: usize,
                total_events: usize,
                concurrent_events: usize,
                potential_races: usize,
                anomalies: Vec<String>,
                race_details: Vec<RaceDetail>,
            }

            let stats = state.engine.graph().stats();
            let mut anomalies = Vec::new();
            let mut race_details = Vec::new();

            if !concurrent.is_empty() {
                anomalies.push(format!(
                    "🌐 GLOBAL: Found {} pairs of concurrent events across all traces",
                    concurrent.len()
                ));

                // Analyze each race for details
                for (event1, event2) in &concurrent {
                    use raceway_core::event::EventKind;

                    if let (EventKind::StateChange { variable: var1, old_value: old1, new_value: new1, location: loc1, access_type: access1 },
                            EventKind::StateChange { variable: var2, old_value: old2, new_value: new2, location: loc2, access_type: access2 }) =
                        (&event1.kind, &event2.kind) {

                        // Determine severity using AccessType
                        use raceway_core::event::AccessType;
                        let is_write1 = *access1 == AccessType::Write;
                        let is_write2 = *access2 == AccessType::Write;

                        let (severity, description) = if is_write1 && is_write2 {
                            ("CRITICAL", format!(
                                "Cross-trace write-write race on {}. Trace {} (thread {}) wrote {:?}, Trace {} (thread {}) wrote {:?}",
                                var1,
                                &event1.trace_id.to_string()[..8],
                                event1.metadata.thread_id,
                                new1,
                                &event2.trace_id.to_string()[..8],
                                event2.metadata.thread_id,
                                new2
                            ))
                        } else if is_write1 || is_write2 {
                            ("WARNING", format!(
                                "Cross-trace read-write race on {}. One thread read while another wrote across different traces.",
                                var1
                            ))
                        } else {
                            ("INFO", format!(
                                "Concurrent reads on {} across traces. Generally safe but indicates potential race.",
                                var1
                            ))
                        };

                        race_details.push(RaceDetail {
                            severity: severity.to_string(),
                            variable: var1.clone(),
                            trace1_id: event1.trace_id.to_string(),
                            trace2_id: event2.trace_id.to_string(),
                            event1_thread: event1.metadata.thread_id.clone(),
                            event2_thread: event2.metadata.thread_id.clone(),
                            event1_location: loc1.clone(),
                            event2_location: loc2.clone(),
                            event1_timestamp: event1.timestamp.to_string(),
                            event2_timestamp: event2.timestamp.to_string(),
                            description,
                        });

                        // Create detailed, multi-line anomaly message
                        let event1_id_short = &event1.id.to_string()[..8];
                        let event2_id_short = &event2.id.to_string()[..8];
                        let trace1_short = &event1.trace_id.to_string()[..8];
                        let trace2_short = &event2.trace_id.to_string()[..8];

                        anomalies.push(format!(
                            "🚨 {} RACE on {}", severity, var1
                        ));
                        anomalies.push(format!(
                            "   Event 1: {} @ {} [{}]",
                            event1_id_short, loc1, event1.metadata.thread_id
                        ));
                        anomalies.push(format!(
                            "           Trace {} @ {}",
                            trace1_short, event1.timestamp.format("%H:%M:%S%.3f")
                        ));
                        if is_write1 {
                            anomalies.push(format!(
                                "           WRITE: {:?} → {:?}",
                                old1, new1
                            ));
                        } else {
                            anomalies.push(format!(
                                "           READ: {:?}",
                                new1
                            ));
                        }
                        anomalies.push(format!(
                            "   Event 2: {} @ {} [{}]",
                            event2_id_short, loc2, event2.metadata.thread_id
                        ));
                        anomalies.push(format!(
                            "           Trace {} @ {}",
                            trace2_short, event2.timestamp.format("%H:%M:%S%.3f")
                        ));
                        if is_write2 {
                            anomalies.push(format!(
                                "           WRITE: {:?} → {:?}",
                                old2, new2
                            ));
                        } else {
                            anomalies.push(format!(
                                "           READ: {:?}",
                                new2
                            ));
                        }
                        anomalies.push("".to_string()); // Blank line separator
                    }
                }
            }

            let analysis = GlobalAnalysis {
                total_traces: stats.total_traces,
                total_events: stats.total_events,
                concurrent_events: concurrent.len(),
                potential_races: concurrent.len(),
                anomalies,
                race_details,
            };

            Ok((StatusCode::OK, Json(ApiResponse::success(analysis))))
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error(format!(
                "Global analysis failed: {}",
                e
            ))),
        )),
    }
}

async fn get_trace_tree_handler(
    State(state): State<AppState>,
    Path(trace_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let trace_uuid = match Uuid::parse_str(&trace_id) {
        Ok(id) => id,
        Err(_) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::error(
                    "Invalid trace ID format".to_string(),
                )),
            ))
        }
    };

    match state.engine.graph().get_trace_tree(trace_uuid) {
        Ok(trees) => {
            #[derive(Serialize)]
            struct TreeResponse {
                trace_id: String,
                roots: Vec<raceway_core::graph::TreeNode>,
            }

            let response = TreeResponse {
                trace_id,
                roots: trees,
            };

            Ok((StatusCode::OK, Json(ApiResponse::success(response))))
        }
        Err(e) => Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error(format!(
                "Tree generation failed: {}",
                e
            ))),
        )),
    }
}

async fn get_critical_path_handler(
    State(state): State<AppState>,
    Path(trace_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let trace_uuid = match Uuid::parse_str(&trace_id) {
        Ok(id) => id,
        Err(_) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::error(
                    "Invalid trace ID format".to_string(),
                )),
            ))
        }
    };

    match state.engine.graph().get_critical_path(trace_uuid) {
        Ok(critical_path) => {
            #[derive(Serialize)]
            struct CriticalPathResponse {
                trace_id: String,
                path_events: usize,
                total_duration_ms: f64,
                trace_total_duration_ms: f64,
                percentage_of_total: f64,
                path: Vec<PathEvent>,
            }

            #[derive(Serialize)]
            struct PathEvent {
                id: String,
                kind: String,
                location: String,
                timestamp: String,
                duration_ms: f64,
            }

            let path_events: Vec<PathEvent> = critical_path
                .path
                .iter()
                .map(|event| {
                    let kind = match &event.kind {
                        raceway_core::event::EventKind::FunctionCall { function_name, .. } => {
                            format!("FunctionCall({})", function_name)
                        }
                        raceway_core::event::EventKind::AsyncSpawn { .. } => "AsyncSpawn".to_string(),
                        raceway_core::event::EventKind::StateChange { variable, .. } => {
                            format!("StateChange({})", variable)
                        }
                        raceway_core::event::EventKind::HttpRequest { method, url, .. } => {
                            format!("HttpRequest({} {})", method, url)
                        }
                        raceway_core::event::EventKind::DatabaseQuery { .. } => "DatabaseQuery".to_string(),
                        _ => "Other".to_string(),
                    };

                    let location = match &event.kind {
                        raceway_core::event::EventKind::FunctionCall { file, line, .. } => {
                            format!("{}:{}", file, line)
                        }
                        raceway_core::event::EventKind::StateChange { location, .. } => location.clone(),
                        raceway_core::event::EventKind::HttpRequest { url, .. } => url.clone(),
                        _ => "unknown".to_string(),
                    };

                    PathEvent {
                        id: event.id.to_string(),
                        kind,
                        location,
                        timestamp: event.timestamp.to_rfc3339(),
                        duration_ms: event.metadata.duration_ns.unwrap_or(0) as f64 / 1_000_000.0,
                    }
                })
                .collect();

            let response = CriticalPathResponse {
                trace_id,
                path_events: critical_path.path.len(),
                total_duration_ms: critical_path.total_duration_ms,
                trace_total_duration_ms: critical_path.trace_total_duration_ms,
                percentage_of_total: critical_path.percentage_of_total,
                path: path_events,
            };

            Ok((StatusCode::OK, Json(ApiResponse::success(response))))
        }
        Err(e) => Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error(format!(
                "Critical path calculation failed: {}",
                e
            ))),
        )),
    }
}

async fn get_anomalies_handler(
    State(state): State<AppState>,
    Path(trace_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    if state.verbose {
        println!("[{}] 🔍 get_anomalies_handler called for trace: {}",
            chrono::Local::now().format("%H:%M:%S%.3f"),
            &trace_id[..8]);
    }

    let trace_uuid = match Uuid::parse_str(&trace_id) {
        Ok(id) => id,
        Err(_) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::error(
                    "Invalid trace ID format".to_string(),
                )),
            ))
        }
    };

    if state.verbose {
        println!("[{}] 🔬 Calling detect_anomalies()...", chrono::Local::now().format("%H:%M:%S%.3f"));
    }

    match state.engine.graph().detect_anomalies(trace_uuid) {
        Ok(anomalies) => {
            if state.verbose {
                println!("[{}] ✅ detect_anomalies() returned {} anomalies",
                    chrono::Local::now().format("%H:%M:%S%.3f"),
                    anomalies.len());
            }

            #[derive(Serialize)]
            struct AnomaliesResponse {
                trace_id: String,
                anomaly_count: usize,
                anomalies: Vec<raceway_core::graph::Anomaly>,
            }

            let response = AnomaliesResponse {
                trace_id,
                anomaly_count: anomalies.len(),
                anomalies,
            };

            Ok((StatusCode::OK, Json(ApiResponse::success(response))))
        }
        Err(e) => Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error(format!(
                "Anomaly detection failed: {}",
                e
            ))),
        )),
    }
}

async fn get_dependencies_handler(
    State(state): State<AppState>,
    Path(trace_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let trace_uuid = match Uuid::parse_str(&trace_id) {
        Ok(id) => id,
        Err(_) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::error(
                    "Invalid trace ID format".to_string(),
                )),
            ))
        }
    };

    match state.engine.graph().get_service_dependencies(trace_uuid) {
        Ok(dependencies) => {
            Ok((StatusCode::OK, Json(ApiResponse::success(dependencies))))
        }
        Err(e) => Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error(format!(
                "Dependencies analysis failed: {}",
                e
            ))),
        )),
    }
}

async fn get_audit_trail_handler(
    State(state): State<AppState>,
    Path((trace_id, variable)): Path<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let trace_uuid = match Uuid::parse_str(&trace_id) {
        Ok(id) => id,
        Err(_) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::error(
                    "Invalid trace ID format".to_string(),
                )),
            ))
        }
    };

    match state.engine.graph().get_audit_trail(trace_uuid, &variable) {
        Ok(audit_trail) => {
            Ok((StatusCode::OK, Json(ApiResponse::success(audit_trail))))
        }
        Err(e) => Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error(format!(
                "Audit trail generation failed: {}",
                e
            ))),
        )),
    }
}

async fn analyze_trace_handler(
    State(state): State<AppState>,
    Path(trace_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let trace_uuid = match Uuid::parse_str(&trace_id) {
        Ok(id) => id,
        Err(_) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::error(
                    "Invalid trace ID format".to_string(),
                )),
            ))
        }
    };

    match state.engine.graph().find_concurrent_events(trace_uuid) {
        Ok(concurrent) => {
            #[derive(Serialize)]
            struct RaceDetail {
                severity: String,
                variable: String,
                event1_thread: String,
                event2_thread: String,
                event1_location: String,
                event2_location: String,
                description: String,
            }

            #[derive(Serialize)]
            struct Analysis {
                trace_id: String,
                concurrent_events: usize,
                potential_races: usize,
                anomalies: Vec<String>,
                race_details: Vec<RaceDetail>,
            }

            let mut anomalies = Vec::new();
            let mut race_details = Vec::new();

            if !concurrent.is_empty() {
                anomalies.push(format!(
                    "Found {} pairs of concurrent events - potential race conditions",
                    concurrent.len()
                ));

                // Analyze each race for details
                for (event1, event2) in &concurrent {
                    use raceway_core::event::EventKind;

                    if let (EventKind::StateChange { variable: var1, old_value: old1, new_value: new1, location: loc1, access_type: access1 },
                            EventKind::StateChange { variable: var2, old_value: old2, new_value: new2, location: loc2, access_type: access2 }) =
                        (&event1.kind, &event2.kind) {

                        // Determine severity using AccessType
                        use raceway_core::event::AccessType;
                        let is_write1 = *access1 == AccessType::Write;
                        let is_write2 = *access2 == AccessType::Write;

                        let (severity, description) = if is_write1 && is_write2 {
                            ("CRITICAL", format!(
                                "Write-Write race on {}. Both threads modified the same variable without synchronization.",
                                var1
                            ))
                        } else if is_write1 || is_write2 {
                            ("WARNING", format!(
                                "Read-Write race on {}. One thread read while another wrote.",
                                var1
                            ))
                        } else {
                            ("INFO", format!(
                                "Concurrent reads on {}. Generally safe but indicates potential race.",
                                var1
                            ))
                        };

                        race_details.push(RaceDetail {
                            severity: severity.to_string(),
                            variable: var1.clone(),
                            event1_thread: event1.metadata.thread_id.clone(),
                            event2_thread: event2.metadata.thread_id.clone(),
                            event1_location: loc1.clone(),
                            event2_location: loc2.clone(),
                            description,
                        });

                        // Create detailed, multi-line anomaly message
                        let event1_id_short = &event1.id.to_string()[..8];
                        let event2_id_short = &event2.id.to_string()[..8];

                        anomalies.push(format!(
                            "🚨 {} RACE on {}", severity, var1
                        ));
                        anomalies.push(format!(
                            "   Event 1: {} @ {} [{}]",
                            event1_id_short, loc1, event1.metadata.thread_id
                        ));
                        anomalies.push(format!(
                            "           @ {}",
                            event1.timestamp.format("%H:%M:%S%.3f")
                        ));
                        if is_write1 {
                            anomalies.push(format!(
                                "           WRITE: {:?} → {:?}",
                                old1, new1
                            ));
                        } else {
                            anomalies.push(format!(
                                "           READ: {:?}",
                                new1
                            ));
                        }
                        anomalies.push(format!(
                            "   Event 2: {} @ {} [{}]",
                            event2_id_short, loc2, event2.metadata.thread_id
                        ));
                        anomalies.push(format!(
                            "           @ {}",
                            event2.timestamp.format("%H:%M:%S%.3f")
                        ));
                        if is_write2 {
                            anomalies.push(format!(
                                "           WRITE: {:?} → {:?}",
                                old2, new2
                            ));
                        } else {
                            anomalies.push(format!(
                                "           READ: {:?}",
                                new2
                            ));
                        }
                        anomalies.push("".to_string()); // Blank line separator
                    }
                }
            }

            let analysis = Analysis {
                trace_id,
                concurrent_events: concurrent.len(),
                potential_races: concurrent.len(),
                anomalies,
                race_details,
            };

            Ok((StatusCode::OK, Json(ApiResponse::success(analysis))))
        }
        Err(e) => Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error(format!(
                "Analysis failed: {}",
                e
            ))),
        )),
    }
}
