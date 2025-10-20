use anyhow::Result;
use axum::{
    extract::{Path, Query, State},
    http::{Method, StatusCode},
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use chrono::Local;
use raceway_core::analysis::{WarmupPhase, WarmupStatus};
use raceway_core::engine::EngineConfig;
use raceway_core::graph::{Anomaly, ServiceDependencies, VariableAccess};
use raceway_core::storage::TraceAnalysisData;
use raceway_core::{create_storage_backend, Config, Event, RacewayEngine};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
    warmup: WarmupSummary,
}

#[derive(Debug, Serialize)]
struct WarmupSummary {
    phase: String,
    ready: bool,
    total_traces: usize,
    processed_traces: usize,
    last_trace: Option<String>,
    started_at: Option<String>,
    completed_at: Option<String>,
    last_error: Option<String>,
}

impl From<WarmupStatus> for WarmupSummary {
    fn from(status: WarmupStatus) -> Self {
        let WarmupStatus {
            phase,
            total_traces,
            processed_traces,
            last_trace,
            started_at,
            completed_at,
            last_error,
        } = status;

        let ready = matches!(phase, WarmupPhase::Completed);
        let phase_label = match phase {
            WarmupPhase::Idle => "idle",
            WarmupPhase::Replaying => "replaying",
            WarmupPhase::Completed => "completed",
            WarmupPhase::Failed => "failed",
        }
        .to_string();

        Self {
            phase: phase_label,
            ready,
            total_traces,
            processed_traces,
            last_trace: last_trace.map(|id| id.to_string()),
            started_at: started_at.map(|ts| ts.to_rfc3339()),
            completed_at: completed_at.map(|ts| ts.to_rfc3339()),
            last_error,
        }
    }
}

pub async fn start_server(config: Config) -> Result<()> {
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

    let engine = init_engine(&config).await?;
    let app = build_router(&config, Arc::clone(&engine));

    let addr = format!("{}:{}", config.server.host, config.server.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;

    println!(
        "\n🏁 Raceway Server Started!\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n   🌐 Server:        http://{}\n   📥 Ingest:        http://{}/events\n   📊 Status:        http://{}/status\n   🔍 List traces:   http://{}/api/traces\n   🎯 Get trace:     http://{}/api/traces/:id\n   🤖 Analyze:       http://{}/api/traces/:id/analyze\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n✨ Ready to detect races!\n",
        addr, addr, addr, addr, addr, addr
    );

    axum::serve(listener, app).await?;
    Ok(())
}

pub async fn init_engine(config: &Config) -> Result<Arc<RacewayEngine>> {
    let storage = create_storage_backend(&config.storage).await?;

    let engine_config = EngineConfig {
        buffer_size: config.engine.buffer_size,
        batch_size: config.engine.batch_size,
        flush_interval_ms: config.engine.flush_interval_ms,
        enable_anomaly_detection: config.anomaly_detection.enabled,
        enable_race_detection: config.race_detection.enabled,
    };

    let engine = Arc::new(RacewayEngine::new(engine_config, storage).await?);
    engine.start().await?;
    Ok(engine)
}

pub fn build_router(config: &Config, engine: Arc<RacewayEngine>) -> Router {
    let state = AppState {
        engine,
        verbose: config.server.verbose,
    };

    Router::new()
        .route("/", get(root_handler))
        .route("/health", get(health_handler))
        .route("/status", get(status_handler))
        .route("/events", post(ingest_events_handler))
        .route("/api/traces", get(list_traces_handler))
        .route(
            "/api/traces/:trace_id",
            get(get_full_trace_analysis_handler),
        )
        .route("/api/traces/:trace_id/analyze", get(analyze_trace_handler))
        .route(
            "/api/traces/:trace_id/critical-path",
            get(get_critical_path_handler),
        )
        .route(
            "/api/traces/:trace_id/anomalies",
            get(get_anomalies_handler),
        )
        .route(
            "/api/traces/:trace_id/dependencies",
            get(get_dependencies_handler),
        )
        .route(
            "/api/traces/:trace_id/audit-trail/:variable",
            get(get_audit_trail_handler),
        )
        .route("/api/analyze/global", get(analyze_global_handler))
        .layer(build_cors(config))
        .with_state(state)
}

fn build_cors(config: &Config) -> CorsLayer {
    if config.server.cors_enabled {
        if config.development.cors_allow_all
            || config.server.cors_origins.contains(&"*".to_string())
        {
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
                .allow_headers(Any)
        } else {
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
    }
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
            margin-right: 10px;
            font-weight: bold;
        }
        .get { background: rgba(72, 182, 255, 0.2); color: #48b6ff; }
        .post { background: rgba(72, 255, 145, 0.2); color: #48ff91; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🏁 Raceway</h1>
        <div class="tagline">Concurrency debugging for distributed systems</div>
        <div class="endpoints">
            <div class="endpoint"><span class="method get">GET</span> /health</div>
            <div class="endpoint"><span class="method get">GET</span> /status</div>
            <div class="endpoint"><span class="method post">POST</span> /events</div>
            <div class="endpoint"><span class="method get">GET</span> /api/traces</div>
            <div class="endpoint"><span class="method get">GET</span> /api/traces/:id</div>
            <div class="endpoint"><span class="method get">GET</span> /api/traces/:id/analyze</div>
        </div>
    </div>
</body>
</html>
    "#;

    (StatusCode::OK, [("content-type", "text/html")], html)
}

async fn health_handler(State(state): State<AppState>) -> impl IntoResponse {
    let warmup_status = state.engine.analysis().warmup_status().await;
    if matches!(warmup_status.phase, WarmupPhase::Failed) {
        let response = ApiResponse::<WarmupSummary> {
            success: false,
            data: None,
            error: Some(
                warmup_status
                    .last_error
                    .clone()
                    .unwrap_or_else(|| "warmup failed".to_string()),
            ),
        };
        (StatusCode::SERVICE_UNAVAILABLE, Json(response))
    } else {
        (
            StatusCode::OK,
            Json(ApiResponse::success(warmup_status.into())),
        )
    }
}

async fn status_handler(State(state): State<AppState>) -> impl IntoResponse {
    // Get counts directly from storage
    let all_events = state
        .engine
        .storage()
        .get_all_events()
        .await
        .unwrap_or_default();
    let all_traces = state
        .engine
        .storage()
        .get_all_trace_ids()
        .await
        .unwrap_or_default();

    let status = ServerStatus {
        version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_seconds: 0,
        events_captured: all_events.len(),
        traces_active: all_traces.len(),
        warmup: state.engine.analysis().warmup_status().await.into(),
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
        match state.engine.capture().capture(event) {
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

async fn list_traces_handler(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let page: usize = params.get("page").and_then(|p| p.parse().ok()).unwrap_or(1);
    let page_size: usize = params
        .get("page_size")
        .and_then(|p| p.parse().ok())
        .unwrap_or(20);

    if state.verbose {
        println!(
            "[{}] 📋 list_traces_handler -> page: {}, page_size: {}",
            Local::now().format("%H:%M:%S.%3f"),
            page,
            page_size
        );
    }

    #[derive(Serialize)]
    struct TraceMetadata {
        trace_id: String,
        event_count: usize,
        first_timestamp: String,
        last_timestamp: String,
    }

    #[derive(Serialize)]
    struct TracesListResponse {
        total_traces: usize,
        page: usize,
        page_size: usize,
        total_pages: usize,
        traces: Vec<TraceMetadata>,
    }

    // Use storage trait method for paginated trace summaries
    match state
        .engine
        .storage()
        .get_trace_summaries(page, page_size)
        .await
    {
        Ok((summaries, total_traces)) => {
            let total_pages = (total_traces + page_size - 1) / page_size;

            let traces: Vec<TraceMetadata> = summaries
                .into_iter()
                .map(|summary| TraceMetadata {
                    trace_id: summary.trace_id.to_string(),
                    event_count: summary.event_count as usize,
                    first_timestamp: summary.first_timestamp.to_rfc3339(),
                    last_timestamp: summary.last_timestamp.to_rfc3339(),
                })
                .collect();

            let response = TracesListResponse {
                total_traces,
                page,
                page_size,
                total_pages,
                traces,
            };

            Ok((StatusCode::OK, Json(ApiResponse::success(response))))
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error(format!(
                "Failed to fetch trace summaries: {}",
                e
            ))),
        )),
    }
}

async fn analyze_global_handler(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
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

    match state
        .engine
        .analysis()
        .find_global_concurrent_events()
        .await
    {
        Ok(concurrent) => {
            // Get counts directly from storage
            let all_events = state
                .engine
                .storage()
                .get_all_events()
                .await
                .unwrap_or_default();
            let all_traces = state
                .engine
                .storage()
                .get_all_trace_ids()
                .await
                .unwrap_or_default();

            let mut anomalies = Vec::new();
            let mut race_details = Vec::new();

            for (event1, event2) in &concurrent {
                if let (
                    raceway_core::event::EventKind::StateChange {
                        variable: var1,
                        old_value: _old1,
                        new_value: new1,
                        location: loc1,
                        access_type: access1,
                    },
                    raceway_core::event::EventKind::StateChange {
                        variable: var2,
                        old_value: _old2,
                        new_value: new2,
                        location: loc2,
                        access_type: access2,
                    },
                ) = (&event1.kind, &event2.kind)
                {
                    if var1 != var2 {
                        continue;
                    }

                    let severity_desc = match (
                        access1,
                        access2,
                    ) {
                        (raceway_core::event::AccessType::Write, raceway_core::event::AccessType::Write) => (
                            "CRITICAL",
                            format!(
                                "Cross-trace write-write race on {}. Trace {} (thread {}) wrote {:?}, Trace {} (thread {}) wrote {:?}",
                                var1,
                                &event1.trace_id.to_string()[..8],
                                event1.metadata.thread_id,
                                new1,
                                &event2.trace_id.to_string()[..8],
                                event2.metadata.thread_id,
                                new2
                            ),
                        ),
                        (raceway_core::event::AccessType::Write, _) | (_, raceway_core::event::AccessType::Write) => (
                            "WARNING",
                            format!(
                                "Cross-trace read-write race on {}. One thread read while another wrote across different traces.",
                                var1
                            ),
                        ),
                        _ => (
                            "INFO",
                            format!(
                                "Concurrent reads on {} across traces. Generally safe but indicates potential race.",
                                var1
                            ),
                        ),
                    };

                    race_details.push(RaceDetail {
                        severity: severity_desc.0.to_string(),
                        variable: var1.clone(),
                        trace1_id: event1.trace_id.to_string(),
                        trace2_id: event2.trace_id.to_string(),
                        event1_thread: event1.metadata.thread_id.clone(),
                        event2_thread: event2.metadata.thread_id.clone(),
                        event1_location: loc1.clone(),
                        event2_location: loc2.clone(),
                        event1_timestamp: event1.timestamp.to_string(),
                        event2_timestamp: event2.timestamp.to_string(),
                        description: severity_desc.1,
                    });
                }
            }

            if !race_details.is_empty() {
                anomalies.push(format!(
                    "🌐 GLOBAL: Found {} pairs of concurrent events across all traces",
                    race_details.len()
                ));
            }

            let analysis = GlobalAnalysis {
                total_traces: all_traces.len(),
                total_events: all_events.len(),
                concurrent_events: concurrent.len(),
                potential_races: concurrent.len(),
                anomalies,
                race_details,
            };

            Ok((StatusCode::OK, Json(ApiResponse::success(analysis))))
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::error(format!("Global analysis failed: {}", e))),
        )),
    }
}

async fn get_audit_trail_handler(
    State(state): State<AppState>,
    Path((trace_id, variable)): Path<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let trace_uuid = Uuid::parse_str(&trace_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("Invalid trace ID format".to_string())),
        )
    })?;

    // Use storage backend directly - no graph reconstruction
    match state
        .engine
        .analysis()
        .get_audit_trail(trace_uuid, &variable)
        .await
    {
        Ok(audit_trail) => Ok((StatusCode::OK, Json(ApiResponse::success(audit_trail)))),
        Err(e) => Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error(format!(
                "Audit trail generation failed: {}",
                e
            ))),
        )),
    }
}

async fn get_full_trace_analysis_handler(
    State(state): State<AppState>,
    Path(trace_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let trace_uuid = Uuid::parse_str(&trace_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("Invalid trace ID format".to_string())),
        )
    })?;

    // Use storage backend directly - preserves all accumulated baselines and caches
    let analysis_data = state
        .engine
        .analysis()
        .get_trace_analysis_data(trace_uuid)
        .await
        .map_err(|e| {
            (
                StatusCode::NOT_FOUND,
                Json(ApiResponse::error(format!("Failed to fetch trace: {}", e))),
            )
        })?;

    let concurrent = state
        .engine
        .analysis()
        .find_concurrent_events(trace_uuid)
        .await
        .unwrap_or_default();

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
    struct RaceAnalysis {
        concurrent_events: usize,
        potential_races: usize,
        anomalies: Vec<String>,
        race_details: Vec<RaceDetail>,
    }

    #[derive(Serialize)]
    struct FullTraceAnalysis {
        trace_id: String,
        events: Vec<serde_json::Value>,
        audit_trails: HashMap<String, Vec<VariableAccess>>,
        analysis: RaceAnalysis,
        critical_path: Option<serde_json::Value>,
        anomalies: Vec<serde_json::Value>,
        dependencies: Option<ServiceDependencies>,
    }

    let mut anomalies = Vec::new();
    let mut race_details = Vec::new();

    for (event1, event2) in &concurrent {
        use raceway_core::event::{AccessType, EventKind};

        if let (
            EventKind::StateChange {
                variable: var1,
                old_value: old1,
                new_value: new1,
                location: loc1,
                access_type: access1,
            },
            EventKind::StateChange {
                variable: var2,
                old_value: old2,
                new_value: new2,
                location: loc2,
                access_type: access2,
            },
        ) = (&event1.kind, &event2.kind)
        {
            if var1 != var2 {
                continue;
            }

            let is_write1 = *access1 == AccessType::Write;
            let is_write2 = *access2 == AccessType::Write;

            let (severity, description) = if is_write1 && is_write2 {
                (
                    "CRITICAL",
                    format!(
                        "Write-Write race on {}. Both threads modified the same variable without synchronization.",
                        var1
                    ),
                )
            } else if is_write1 || is_write2 {
                (
                    "WARNING",
                    format!(
                        "Read-Write race on {}. One thread read while another wrote.",
                        var1
                    ),
                )
            } else {
                (
                    "INFO",
                    format!(
                        "Concurrent reads on {}. Generally safe but indicates potential race.",
                        var1
                    ),
                )
            };

            let event1_id_short = &event1.id.to_string()[..8];
            let event2_id_short = &event2.id.to_string()[..8];

            race_details.push(RaceDetail {
                severity: severity.to_string(),
                variable: var1.clone(),
                event1_thread: event1.metadata.thread_id.clone(),
                event2_thread: event2.metadata.thread_id.clone(),
                event1_location: loc1.clone(),
                event2_location: loc2.clone(),
                description: description.clone(),
            });

            anomalies.push(format!("🚨 {} RACE on {}", severity, var1));
            anomalies.push(format!(
                "   Event 1: {} @ {} [{}]",
                event1_id_short, loc1, event1.metadata.thread_id
            ));
            anomalies.push(format!(
                "           @ {}",
                event1.timestamp.format("%H:%M:%S%.3f")
            ));
            if is_write1 {
                anomalies.push(format!("           WRITE: {:?} → {:?}", old1, new1));
            } else {
                anomalies.push(format!("           READ: {:?}", new1));
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
                anomalies.push(format!("           WRITE: {:?} → {:?}", old2, new2));
            } else {
                anomalies.push(format!("           READ: {:?}", new2));
            }
            anomalies.push(String::new());
        }
    }

    if anomalies.is_empty() {
        anomalies.push("No potential races detected for this trace".to_string());
    }

    let TraceAnalysisData {
        events,
        audit_trails,
        critical_path,
        anomalies: detected_anomalies,
        dependencies,
    } = analysis_data;

    let events_json: Vec<serde_json::Value> = events
        .iter()
        .map(|e| serde_json::to_value(e).unwrap_or(serde_json::json!({})))
        .collect();

    let critical_path_json = critical_path.map(|cp| {
        #[derive(Serialize)]
        struct PathEvent {
            id: String,
            kind: String,
            location: String,
            timestamp: String,
            duration_ms: f64,
        }

        let path_events: Vec<PathEvent> = cp
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
                    raceway_core::event::EventKind::DatabaseQuery { .. } => {
                        "DatabaseQuery".to_string()
                    }
                    _ => "Other".to_string(),
                };

                let location = match &event.kind {
                    raceway_core::event::EventKind::FunctionCall { file, line, .. } => {
                        format!("{}:{}", file, line)
                    }
                    raceway_core::event::EventKind::StateChange { location, .. } => {
                        location.clone()
                    }
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

        serde_json::json!({
            "trace_id": trace_id.clone(),
            "path_events": cp.path.len(),
            "total_duration_ms": cp.total_duration_ms,
            "trace_total_duration_ms": cp.trace_total_duration_ms,
            "percentage_of_total": cp.percentage_of_total,
            "path": path_events,
        })
    });

    let anomalies_json: Vec<serde_json::Value> = detected_anomalies
        .iter()
        .map(|a| serde_json::to_value(a).unwrap_or(serde_json::json!({})))
        .collect();

    let response = FullTraceAnalysis {
        trace_id: trace_id.clone(),
        events: events_json,
        audit_trails,
        analysis: RaceAnalysis {
            concurrent_events: concurrent.len(),
            potential_races: concurrent.len(),
            anomalies,
            race_details,
        },
        critical_path: critical_path_json,
        anomalies: anomalies_json,
        dependencies,
    };

    Ok((StatusCode::OK, Json(ApiResponse::success(response))))
}

async fn analyze_trace_handler(
    State(state): State<AppState>,
    Path(trace_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let trace_uuid = Uuid::parse_str(&trace_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("Invalid trace ID format".to_string())),
        )
    })?;

    // Use storage backend directly
    let concurrent = state
        .engine
        .analysis()
        .find_concurrent_events(trace_uuid)
        .await
        .unwrap_or_default();

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

    for (event1, event2) in &concurrent {
        use raceway_core::event::{AccessType, EventKind};

        if let (
            EventKind::StateChange {
                variable: var1,
                old_value: _old1,
                new_value: _new1,
                location: loc1,
                access_type: access1,
            },
            EventKind::StateChange {
                variable: var2,
                old_value: _old2,
                new_value: _new2,
                location: loc2,
                access_type: access2,
            },
        ) = (&event1.kind, &event2.kind)
        {
            if var1 != var2 {
                continue;
            }

            let is_write1 = *access1 == AccessType::Write;
            let is_write2 = *access2 == AccessType::Write;

            let (severity, description) = if is_write1 && is_write2 {
                (
                    "CRITICAL",
                    format!(
                        "Write-Write race on {}. Both threads modified the same variable without synchronization.",
                        var1
                    ),
                )
            } else if is_write1 || is_write2 {
                (
                    "WARNING",
                    format!(
                        "Read-Write race on {}. One thread read while another wrote.",
                        var1
                    ),
                )
            } else {
                (
                    "INFO",
                    format!(
                        "Concurrent reads on {}. Generally safe but indicates potential race.",
                        var1
                    ),
                )
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
        }
    }

    if race_details.is_empty() {
        anomalies.push("No evident race conditions for this trace".to_string());
    } else {
        anomalies.push(format!(
            "Found {} pairs of concurrent events - potential race conditions",
            race_details.len()
        ));
    }

    let analysis = Analysis {
        trace_id,
        concurrent_events: concurrent.len(),
        potential_races: race_details.len(),
        anomalies,
        race_details,
    };

    Ok((StatusCode::OK, Json(ApiResponse::success(analysis))))
}

async fn get_critical_path_handler(
    State(state): State<AppState>,
    Path(trace_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let trace_uuid = Uuid::parse_str(&trace_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("Invalid trace ID format".to_string())),
        )
    })?;

    // Use storage backend directly
    match state.engine.analysis().get_critical_path(trace_uuid).await {
        Ok(critical_path) => {
            #[derive(Serialize)]
            struct PathEvent {
                id: String,
                kind: String,
                location: String,
                timestamp: String,
                duration_ms: f64,
            }

            #[derive(Serialize)]
            struct CriticalPathResponse {
                trace_id: String,
                path_events: usize,
                total_duration_ms: f64,
                trace_total_duration_ms: f64,
                percentage_of_total: f64,
                path: Vec<PathEvent>,
            }

            let path = critical_path
                .path
                .iter()
                .map(|event| {
                    let kind = match &event.kind {
                        raceway_core::event::EventKind::FunctionCall { function_name, .. } => {
                            format!("FunctionCall({})", function_name)
                        }
                        raceway_core::event::EventKind::StateChange { variable, .. } => {
                            format!("StateChange({})", variable)
                        }
                        raceway_core::event::EventKind::AsyncSpawn { .. } => {
                            "AsyncSpawn".to_string()
                        }
                        raceway_core::event::EventKind::HttpRequest { method, url, .. } => {
                            format!("HttpRequest({} {})", method, url)
                        }
                        raceway_core::event::EventKind::DatabaseQuery { .. } => {
                            "DatabaseQuery".to_string()
                        }
                        _ => "Other".to_string(),
                    };

                    let location = match &event.kind {
                        raceway_core::event::EventKind::FunctionCall { file, line, .. } => {
                            format!("{}:{}", file, line)
                        }
                        raceway_core::event::EventKind::StateChange { location, .. } => {
                            location.clone()
                        }
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
                path,
            };

            Ok((StatusCode::OK, Json(ApiResponse::success(response))))
        }
        Err(e) => Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error(format!(
                "Critical path analysis failed: {}",
                e
            ))),
        )),
    }
}

async fn get_anomalies_handler(
    State(state): State<AppState>,
    Path(trace_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let trace_uuid = Uuid::parse_str(&trace_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("Invalid trace ID format".to_string())),
        )
    })?;

    // Update baselines first to ensure fresh metrics for anomaly detection
    let _ = state.engine.analysis().update_baselines(trace_uuid).await;

    // Detect anomalies with updated baselines
    let anomalies = state
        .engine
        .analysis()
        .detect_anomalies(trace_uuid)
        .await
        .unwrap_or_default();

    #[derive(Serialize)]
    struct AnomaliesResponse {
        trace_id: String,
        anomaly_count: usize,
        anomalies: Vec<Anomaly>,
    }

    let response = AnomaliesResponse {
        trace_id,
        anomaly_count: anomalies.len(),
        anomalies,
    };

    Ok((StatusCode::OK, Json(ApiResponse::success(response))))
}

async fn get_dependencies_handler(
    State(state): State<AppState>,
    Path(trace_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let trace_uuid = Uuid::parse_str(&trace_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("Invalid trace ID format".to_string())),
        )
    })?;

    // Use storage backend directly
    match state
        .engine
        .analysis()
        .get_service_dependencies(trace_uuid)
        .await
    {
        Ok(deps) => Ok((StatusCode::OK, Json(ApiResponse::success(deps)))),
        Err(e) => Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error(format!(
                "Dependency analysis failed: {}",
                e
            ))),
        )),
    }
}
