use anyhow::Result;
use axum::{
    body::Body,
    extract::{ConnectInfo, Path, Query, State},
    http::{HeaderMap, Method, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use chrono::Local;
use governor::{clock::DefaultClock, state::keyed::DefaultKeyedStateStore, Quota, RateLimiter};
use raceway_core::analysis::{WarmupPhase, WarmupStatus};
use raceway_core::engine::EngineConfig;
use raceway_core::graph::{Anomaly, ServiceDependencies, VariableAccess};
use raceway_core::storage::{TraceAnalysisData, TraceSummary};
use raceway_core::{create_storage_backend, Config, Event, RacewayEngine};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::num::NonZeroU32;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;
#[derive(Clone)]
struct AppState {
    engine: Arc<RacewayEngine>,
    verbose: bool,
    auth: AuthConfig,
}

#[derive(Clone)]
struct AuthConfig {
    enabled: bool,
    valid_keys: Arc<HashSet<String>>,
    rate_limiter: Option<Arc<KeyedRateLimiter>>,
}

type KeyedRateLimiter = RateLimiter<String, DefaultKeyedStateStore<String>, DefaultClock>;

impl AuthConfig {
    fn from_server_config(cfg: &raceway_core::config::ServerConfig) -> Self {
        let valid_keys: HashSet<String> = cfg.api_keys.iter().cloned().collect();

        let rate_limiter = if cfg.rate_limit_enabled {
            if let Some(rpm) = NonZeroU32::new(cfg.rate_limit_rpm) {
                let quota = Quota::per_minute(rpm);
                Some(Arc::new(RateLimiter::keyed(quota)))
            } else {
                None
            }
        } else {
            None
        };

        Self {
            enabled: cfg.auth_enabled,
            valid_keys: Arc::new(valid_keys),
            rate_limiter,
        }
    }

    fn is_authorized(&self, provided: Option<&str>) -> bool {
        if !self.enabled {
            return true;
        }

        match provided {
            Some(key) => self.valid_keys.contains(key),
            None => false,
        }
    }

    fn check_rate_limit(&self, key: &str) -> bool {
        if let Some(limiter) = &self.rate_limiter {
            let key_owned = key.to_string();
            limiter.check_key(&key_owned).is_ok()
        } else {
            true
        }
    }
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

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
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

    let engine = Arc::new(RacewayEngine::new(engine_config, storage, config.clone()).await?);
    engine.start().await?;
    Ok(engine)
}

pub fn build_router(config: &Config, engine: Arc<RacewayEngine>) -> Router {
    let auth = AuthConfig::from_server_config(&config.server);
    let state = AppState {
        engine,
        verbose: config.server.verbose,
        auth,
    };
    let auth_state = state.clone();

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
        .route("/api/analyze/global", get(analyze_global_handler))
        .route("/api/services", get(list_services_handler))
        .route("/api/services/health", get(get_service_health_handler))
        .route(
            "/api/services/:service_name/traces",
            get(get_service_traces_handler),
        )
        .route(
            "/api/services/:service_name/dependencies",
            get(get_service_dependencies_handler),
        )
        .route(
            "/api/performance/metrics",
            get(get_performance_metrics_handler),
        )
        .route("/api/distributed/edges", get(get_distributed_edges_handler))
        .route(
            "/api/distributed/global-races",
            get(get_global_races_handler),
        )
        .route(
            "/api/distributed/hotspots",
            get(get_system_hotspots_handler),
        )
        .layer(middleware::from_fn_with_state(auth_state, auth_middleware))
        .layer(build_cors(config))
        .with_state(state)
}

async fn auth_middleware(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Result<Response, (StatusCode, Json<ApiResponse<String>>)> {
    let headers = req.headers().clone();
    let auth_key = extract_api_key(&headers);

    if !state.auth.is_authorized(auth_key.as_deref()) {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ApiResponse::error("Unauthorized".to_string())),
        ));
    }

    let limiter_key = extract_client_identifier(&req, &headers, auth_key.as_deref());
    if !state.auth.check_rate_limit(&limiter_key) {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(ApiResponse::error("Too Many Requests".to_string())),
        ));
    }

    Ok(next.run(req).await)
}

fn extract_api_key(headers: &HeaderMap) -> Option<String> {
    if let Some(value) = headers.get(axum::http::header::AUTHORIZATION) {
        if let Ok(value) = value.to_str() {
            if let Some(token) = value.strip_prefix("Bearer ") {
                return Some(token.trim().to_string());
            }
            if let Some(token) = value.strip_prefix("bearer ") {
                return Some(token.trim().to_string());
            }
        }
    }

    if let Some(value) = headers.get("x-raceway-key") {
        if let Ok(value) = value.to_str() {
            if !value.trim().is_empty() {
                return Some(value.trim().to_string());
            }
        }
    }

    None
}

fn extract_client_identifier(
    req: &Request<Body>,
    headers: &HeaderMap,
    auth_key: Option<&str>,
) -> String {
    if let Some(key) = auth_key {
        return key.to_string();
    }

    if let Some(header) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = header.split(',').next() {
            let trimmed = first.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }

    if let Some(connect) = req.extensions().get::<ConnectInfo<SocketAddr>>() {
        return connect.0.ip().to_string();
    }

    "anonymous".to_string()
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
        service_count: usize,
        services: Vec<String>,
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

            // Build trace metadata with service information from distributed_spans
            let traces: Vec<TraceMetadata> = summaries
                .into_iter()
                .map(|summary| TraceMetadata {
                    trace_id: summary.trace_id.to_string(),
                    event_count: summary.event_count as usize,
                    first_timestamp: summary.first_timestamp.to_rfc3339(),
                    last_timestamp: summary.last_timestamp.to_rfc3339(),
                    service_count: summary.service_count,
                    services: summary.services,
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

                    use raceway_core::event::AccessType;

                    let is_write1 = matches!(
                        access1,
                        AccessType::Write | AccessType::AtomicWrite | AccessType::AtomicRMW
                    );
                    let is_write2 = matches!(
                        access2,
                        AccessType::Write | AccessType::AtomicWrite | AccessType::AtomicRMW
                    );

                    let severity_desc = match (is_write1, is_write2) {
                        (true, true) => (
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
                        (true, false) | (false, true) => (
                            "WARNING",
                            format!(
                                "Cross-trace read-write race on {}. One thread read while another wrote across different traces.",
                                var1
                            ),
                        ),
                        (false, false) => (
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

            let is_write1 = matches!(
                access1,
                AccessType::Write | AccessType::AtomicWrite | AccessType::AtomicRMW
            );
            let is_write2 = matches!(
                access2,
                AccessType::Write | AccessType::AtomicWrite | AccessType::AtomicRMW
            );

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

            let is_write1 = matches!(
                access1,
                AccessType::Write | AccessType::AtomicWrite | AccessType::AtomicRMW
            );
            let is_write2 = matches!(
                access2,
                AccessType::Write | AccessType::AtomicWrite | AccessType::AtomicRMW
            );

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

async fn list_services_handler(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    #[derive(Serialize)]
    struct ServiceInfo {
        name: String,
        event_count: usize,
        trace_count: usize,
    }

    #[derive(Serialize)]
    struct ServicesResponse {
        total_services: usize,
        services: Vec<ServiceInfo>,
    }

    // Use optimized storage method to get all services directly
    let services_data = state
        .engine
        .storage()
        .get_all_services()
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::error(format!(
                    "Failed to fetch services: {}",
                    e
                ))),
            )
        })?;

    let services: Vec<ServiceInfo> = services_data
        .into_iter()
        .map(|(name, event_count, trace_count)| ServiceInfo {
            name,
            event_count,
            trace_count,
        })
        .collect();

    let response = ServicesResponse {
        total_services: services.len(),
        services,
    };

    Ok((StatusCode::OK, Json(ApiResponse::success(response))))
}

async fn get_service_dependencies_handler(
    State(state): State<AppState>,
    Path(service_name): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    #[derive(Serialize)]
    struct ServiceDependencyInfo {
        to: String,
        total_calls: usize,
        trace_count: usize,
    }

    #[derive(Serialize)]
    struct ServiceDependenciesResponse {
        service_name: String,
        calls_to: Vec<ServiceDependencyInfo>,
        called_by: Vec<ServiceDependencyInfo>,
    }

    // Use optimized storage method to get dependencies directly
    let (calls_to_data, called_by_data) = state
        .engine
        .storage()
        .get_service_dependencies_global(&service_name)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::error(format!(
                    "Failed to fetch dependencies: {}",
                    e
                ))),
            )
        })?;

    let calls_to: Vec<ServiceDependencyInfo> = calls_to_data
        .into_iter()
        .map(|(to, total_calls, trace_count)| ServiceDependencyInfo {
            to,
            total_calls,
            trace_count,
        })
        .collect();

    let called_by: Vec<ServiceDependencyInfo> = called_by_data
        .into_iter()
        .map(|(to, total_calls, trace_count)| ServiceDependencyInfo {
            to,
            total_calls,
            trace_count,
        })
        .collect();

    let response = ServiceDependenciesResponse {
        service_name,
        calls_to,
        called_by,
    };

    Ok((StatusCode::OK, Json(ApiResponse::success(response))))
}

async fn get_service_health_handler(
    State(state): State<AppState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let time_window_minutes = params
        .get("time_window_minutes")
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(60); // Default to 60 minutes

    let services = state
        .engine
        .storage()
        .get_service_health(time_window_minutes)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::error(format!(
                    "Failed to fetch service health: {}",
                    e
                ))),
            )
        })?;

    Ok((StatusCode::OK, Json(ApiResponse::success(services))))
}

async fn get_service_traces_handler(
    State(state): State<AppState>,
    Path(service_name): Path<String>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let page = params
        .get("page")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(1);

    let page_size = params
        .get("page_size")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(100);

    #[derive(Serialize)]
    struct ServiceTracesResponse {
        service_name: String,
        total_traces: usize,
        page: usize,
        page_size: usize,
        total_pages: usize,
        traces: Vec<TraceSummary>,
    }

    let (traces, total) = state
        .engine
        .storage()
        .get_trace_summaries_by_service(&service_name, page, page_size)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::error(format!("Failed to fetch traces: {}", e))),
            )
        })?;

    let total_pages = (total + page_size - 1) / page_size;

    let response = ServiceTracesResponse {
        service_name,
        total_traces: total,
        page,
        page_size,
        total_pages,
        traces,
    };

    Ok((StatusCode::OK, Json(ApiResponse::success(response))))
}

async fn get_performance_metrics_handler(
    State(state): State<AppState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let limit = params
        .get("limit")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(50);

    let metrics = state
        .engine
        .storage()
        .get_performance_metrics(limit)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::error(format!(
                    "Failed to fetch performance metrics: {}",
                    e
                ))),
            )
        })?;

    Ok((StatusCode::OK, Json(ApiResponse::success(metrics))))
}

async fn get_distributed_trace_analysis_handler(
    State(state): State<AppState>,
    Path(trace_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let trace_uuid = Uuid::parse_str(&trace_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error("Invalid trace ID format".to_string())),
        )
    })?;

    #[derive(Serialize)]
    struct ServiceStats {
        name: String,
        event_count: usize,
        total_duration_ms: f64,
    }

    #[derive(Serialize)]
    struct ServiceBreakdown {
        services: Vec<ServiceStats>,
        cross_service_calls: usize,
        total_services: usize,
    }

    #[derive(Serialize)]
    struct CriticalPathSummary {
        total_duration_ms: f64,
        trace_total_duration_ms: f64,
        percentage_of_total: f64,
        path_events: usize,
    }

    #[derive(Serialize)]
    struct RaceConditionSummary {
        total_races: usize,
        critical_races: usize,
        warning_races: usize,
    }

    #[derive(Serialize)]
    struct DistributedTraceAnalysis {
        trace_id: String,
        service_breakdown: ServiceBreakdown,
        critical_path: Option<CriticalPathSummary>,
        race_conditions: RaceConditionSummary,
        is_distributed: bool,
    }

    // Get service dependencies
    let dependencies = state
        .engine
        .analysis()
        .get_service_dependencies(trace_uuid)
        .await
        .map_err(|e| {
            (
                StatusCode::NOT_FOUND,
                Json(ApiResponse::error(format!(
                    "Failed to analyze trace: {}",
                    e
                ))),
            )
        })?;

    // Get all events for the trace to calculate durations
    let events = state
        .engine
        .storage()
        .get_trace_events(trace_uuid)
        .await
        .unwrap_or_default();

    // Calculate total duration per service
    let mut service_durations: HashMap<String, f64> = HashMap::new();
    for event in &events {
        let service_name = &event.metadata.service_name;
        if !service_name.is_empty() {
            let duration_ms = event.metadata.duration_ns.unwrap_or(0) as f64 / 1_000_000.0;
            *service_durations.entry(service_name.clone()).or_insert(0.0) += duration_ms;
        }
    }

    // Build service stats
    let mut service_stats: Vec<ServiceStats> = dependencies
        .services
        .iter()
        .map(|s| ServiceStats {
            name: s.name.clone(),
            event_count: s.event_count,
            total_duration_ms: *service_durations.get(&s.name).unwrap_or(&0.0),
        })
        .collect();

    // Sort by duration for useful ordering
    service_stats.sort_by(|a, b| {
        b.total_duration_ms
            .partial_cmp(&a.total_duration_ms)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let service_breakdown = ServiceBreakdown {
        total_services: dependencies.services.len(),
        cross_service_calls: dependencies.dependencies.len(),
        services: service_stats,
    };

    // Get critical path
    let critical_path = if let Ok(cp) = state.engine.analysis().get_critical_path(trace_uuid).await
    {
        Some(CriticalPathSummary {
            total_duration_ms: cp.total_duration_ms,
            trace_total_duration_ms: cp.trace_total_duration_ms,
            percentage_of_total: cp.percentage_of_total,
            path_events: cp.path.len(),
        })
    } else {
        None
    };

    // Analyze race conditions
    let concurrent = state
        .engine
        .analysis()
        .find_concurrent_events(trace_uuid)
        .await
        .unwrap_or_default();

    let mut critical_races = 0;
    let mut warning_races = 0;

    for (event1, event2) in &concurrent {
        use raceway_core::event::{AccessType, EventKind};

        if let (
            EventKind::StateChange {
                variable: var1,
                access_type: access1,
                ..
            },
            EventKind::StateChange {
                variable: var2,
                access_type: access2,
                ..
            },
        ) = (&event1.kind, &event2.kind)
        {
            if var1 == var2 {
                let is_write1 = matches!(
                    access1,
                    AccessType::Write | AccessType::AtomicWrite | AccessType::AtomicRMW
                );
                let is_write2 = matches!(
                    access2,
                    AccessType::Write | AccessType::AtomicWrite | AccessType::AtomicRMW
                );

                if is_write1 && is_write2 {
                    critical_races += 1;
                } else if is_write1 || is_write2 {
                    warning_races += 1;
                }
            }
        }
    }

    let race_conditions = RaceConditionSummary {
        total_races: concurrent.len(),
        critical_races,
        warning_races,
    };

    let is_distributed = dependencies.services.len() > 1;

    let response = DistributedTraceAnalysis {
        trace_id,
        service_breakdown,
        critical_path,
        race_conditions,
        is_distributed,
    };

    Ok((StatusCode::OK, Json(ApiResponse::success(response))))
}

async fn get_distributed_edges_handler(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let edges = state
        .engine
        .storage()
        .get_all_distributed_edges()
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::error(format!(
                    "Failed to fetch distributed edges: {}",
                    e
                ))),
            )
        })?;

    let response = serde_json::json!({
        "total_edges": edges.len(),
        "edges": edges,
    });

    Ok((StatusCode::OK, Json(ApiResponse::success(response))))
}

async fn get_global_races_handler(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let races = state
        .engine
        .storage()
        .get_global_race_candidates()
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::error(format!(
                    "Failed to fetch global races: {}",
                    e
                ))),
            )
        })?;

    let response = serde_json::json!({
        "total_races": races.len(),
        "races": races,
    });

    Ok((StatusCode::OK, Json(ApiResponse::success(response))))
}

async fn get_system_hotspots_handler(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<String>>)> {
    let (top_variables, top_service_calls) = state
        .engine
        .storage()
        .get_system_hotspots()
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::error(format!(
                    "Failed to fetch system hotspots: {}",
                    e
                ))),
            )
        })?;

    let response = serde_json::json!({
        "top_variables": top_variables,
        "top_service_calls": top_service_calls,
    });

    Ok((StatusCode::OK, Json(ApiResponse::success(response))))
}
