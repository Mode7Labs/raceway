use std::collections::HashMap;

use anyhow::{anyhow, Context, Result};
use clap::{Parser, Subcommand};
use reqwest::Client;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use raceway::{server, tui};
use raceway_core::Config;

const DEFAULT_PAGE_SIZE: usize = 20;

#[derive(Parser)]
#[command(name = "raceway")]
#[command(about = "Causal debugging for distributed systems", long_about = None)]
struct Cli {
    /// Path to configuration file
    #[arg(short, long, default_value = "raceway.toml")]
    config: std::path::PathBuf,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the Raceway server
    Serve {
        /// Override verbose setting from config
        #[arg(short, long)]
        verbose: bool,
    },

    /// Launch interactive TUI for trace visualization
    Tui {
        /// Override server URL from config
        #[arg(short, long)]
        server: Option<String>,
    },

    /// List traces (mirrors Web UI trace list)
    Traces {
        /// Page number (1-indexed)
        #[arg(long, default_value_t = 1)]
        page: usize,
        /// Page size
        #[arg(long, default_value_t = DEFAULT_PAGE_SIZE)]
        page_size: usize,
        /// Output raw JSON response
        #[arg(long)]
        json: bool,
        /// Override server URL from config
        #[arg(long)]
        server: Option<String>,
    },

    /// Show a specific trace with full analysis bundle
    Trace {
        #[arg(short = 'i', long = "id")]
        trace_id: String,
        /// Output raw JSON response
        #[arg(long)]
        json: bool,
        /// Show the first N events (default 0 = summary only)
        #[arg(long, default_value_t = 0)]
        events: usize,
        /// Override server URL from config
        #[arg(long)]
        server: Option<String>,
    },

    /// List services and basic statistics
    Services {
        #[arg(long)]
        json: bool,
        #[arg(long)]
        server: Option<String>,
    },

    /// Inspect a specific service (overview, traces, dependencies)
    Service {
        #[arg(long)]
        server: Option<String>,
        #[command(subcommand)]
        action: ServiceCommand,
    },

    /// Show global race conditions across traces
    Races {
        #[arg(long)]
        json: bool,
        #[arg(long)]
        server: Option<String>,
    },

    /// Show variable and service hotspots
    Hotspots {
        #[arg(long)]
        json: bool,
        #[arg(long)]
        server: Option<String>,
    },

    /// Show service health status
    Health {
        /// Time window in minutes
        #[arg(long, default_value_t = 60)]
        window: u64,
        #[arg(long)]
        json: bool,
        #[arg(long)]
        server: Option<String>,
    },

    /// Show system performance metrics
    Performance {
        /// Number of slow traces to include
        #[arg(long, default_value_t = 50)]
        limit: usize,
        #[arg(long)]
        json: bool,
        #[arg(long)]
        server: Option<String>,
    },

    /// Show distributed edges between services
    Edges {
        #[arg(long)]
        json: bool,
        #[arg(long)]
        server: Option<String>,
    },

    /// Legacy alias for `trace --json`
    Analyze {
        #[arg(short, long)]
        trace_id: String,
        #[arg(long)]
        server: Option<String>,
    },

    /// Export trace data to a file
    Export {
        #[arg(short, long)]
        trace_id: String,
        #[arg(short, long)]
        output: String,
        #[arg(long)]
        server: Option<String>,
    },
}

#[derive(Subcommand)]
enum ServiceCommand {
    /// Show service overview metrics
    Overview {
        name: String,
        #[arg(long)]
        json: bool,
    },
    /// List traces that include this service
    Traces {
        name: String,
        #[arg(long, default_value_t = 1)]
        page: usize,
        #[arg(long, default_value_t = 100)]
        page_size: usize,
        #[arg(long)]
        json: bool,
    },
    /// Show upstream/downstream dependencies
    Dependencies {
        name: String,
        #[arg(long)]
        json: bool,
    },
}

#[derive(Debug, Deserialize, Serialize)]
struct ApiResponse<T> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct TracesListData {
    total_traces: usize,
    page: usize,
    page_size: usize,
    total_pages: usize,
    traces: Vec<TraceMetadata>,
}

#[derive(Debug, Deserialize, Serialize)]
struct TraceMetadata {
    trace_id: String,
    event_count: usize,
    first_timestamp: String,
    last_timestamp: String,
    service_count: usize,
    services: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, Default)]
struct FullTraceAnalysis {
    trace_id: String,
    #[serde(default)]
    events: Vec<Event>,
    #[serde(default)]
    audit_trails: HashMap<String, Vec<VariableAccess>>,
    analysis: TraceAnalysisSummary,
    #[serde(default)]
    critical_path: Option<CriticalPath>,
    #[serde(default)]
    anomalies: Vec<DetectedAnomaly>,
    #[serde(default)]
    dependencies: Option<TraceDependencies>,
}

#[derive(Debug, Deserialize, Serialize, Default)]
struct Event {
    id: String,
    #[serde(default)]
    timestamp: String,
    #[serde(default)]
    trace_id: String,
    #[serde(default)]
    metadata: EventMetadata,
    #[serde(default)]
    kind: Value,
}

#[derive(Debug, Deserialize, Serialize, Default)]
struct EventMetadata {
    #[serde(default)]
    thread_id: String,
    #[serde(default)]
    service_name: String,
    #[serde(default)]
    duration_ns: Option<u64>,
}

#[derive(Debug, Deserialize, Serialize, Default)]
struct TraceAnalysisSummary {
    #[serde(default)]
    concurrent_events: usize,
    #[serde(default)]
    potential_races: usize,
    #[serde(default)]
    anomalies: Vec<String>,
    #[serde(default)]
    race_details: Vec<RaceDetail>,
}

#[derive(Debug, Deserialize, Serialize, Default)]
struct RaceDetail {
    variable: String,
    event1_thread: String,
    event2_thread: String,
    event1_location: String,
    event2_location: String,
    severity: String,
    description: String,
}

#[derive(Debug, Deserialize, Serialize, Default)]
struct CriticalPath {
    #[serde(default)]
    path_events: usize,
    #[serde(default)]
    total_duration_ms: f64,
    #[serde(default)]
    trace_total_duration_ms: f64,
    #[serde(default)]
    percentage_of_total: f64,
    #[serde(default)]
    path: Vec<PathEvent>,
}

#[derive(Debug, Deserialize, Serialize, Default)]
struct PathEvent {
    id: String,
    kind: String,
    location: String,
    timestamp: String,
    #[serde(default)]
    duration_ms: f64,
}

#[derive(Debug, Deserialize, Serialize, Default)]
struct DetectedAnomaly {
    event_id: String,
    event_kind: String,
    severity: String,
    description: String,
}

#[derive(Debug, Deserialize, Serialize, Default)]
struct TraceDependencies {
    services: Vec<ServiceInfo>,
    dependencies: Vec<ServiceDependency>,
}

#[derive(Debug, Deserialize, Serialize, Default)]
struct ServiceInfo {
    name: String,
    #[serde(default)]
    event_count: usize,
}

#[derive(Debug, Deserialize, Serialize, Default)]
struct ServiceDependency {
    from: String,
    to: String,
    call_count: usize,
}

#[derive(Debug, Deserialize, Serialize)]
struct ServicesListData {
    total_services: usize,
    services: Vec<ServiceListItem>,
}

#[derive(Debug, Deserialize, Serialize)]
struct ServiceListItem {
    name: String,
    event_count: usize,
    trace_count: usize,
}

#[derive(Debug, Deserialize, Serialize)]
struct ServiceTracesData {
    service_name: String,
    total_traces: usize,
    page: usize,
    page_size: usize,
    total_pages: usize,
    traces: Vec<TraceMetadata>,
}

#[derive(Debug, Deserialize, Serialize)]
struct ServiceDependenciesData {
    service_name: String,
    calls_to: Vec<ServiceDependencyInfo>,
    called_by: Vec<ServiceDependencyInfo>,
}

#[derive(Debug, Deserialize, Serialize)]
struct ServiceDependencyInfo {
    to: String,
    total_calls: usize,
    trace_count: usize,
}

#[derive(Debug, Deserialize, Serialize)]
struct GlobalRacesData {
    total_races: usize,
    races: Vec<GlobalRace>,
}

#[derive(Debug, Deserialize, Serialize)]
struct GlobalRace {
    variable: String,
    trace_count: usize,
    access_count: usize,
    access_types: Vec<String>,
    thread_count: usize,
    severity: String,
    trace_ids: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct HotspotsData {
    top_variables: Vec<VariableHotspot>,
    top_service_calls: Vec<ServiceCallHotspot>,
}

#[derive(Debug, Deserialize, Serialize)]
struct VariableHotspot {
    variable: String,
    access_count: usize,
    trace_count: usize,
    services: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct ServiceCallHotspot {
    from_service: String,
    to_service: String,
    call_count: usize,
}

#[derive(Debug, Deserialize, Serialize)]
struct ServiceHealthEntry {
    name: String,
    status: String,
    trace_count: usize,
    last_activity: String,
    avg_events_per_trace: f64,
    minutes_since_last_activity: f64,
}

#[derive(Debug, Deserialize, Serialize)]
struct PerformanceMetrics {
    trace_latency: TraceLatencyMetrics,
    event_performance: EventPerformanceMetrics,
    service_latency: Vec<ServiceLatency>,
    throughput: ThroughputMetrics,
}

#[derive(Debug, Deserialize, Serialize)]
struct TraceLatencyMetrics {
    avg_ms: f64,
    p50_ms: f64,
    p95_ms: f64,
    p99_ms: f64,
    slowest_traces: Vec<SlowTrace>,
}

#[derive(Debug, Deserialize, Serialize)]
struct SlowTrace {
    trace_id: String,
    duration_ms: f64,
    services: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct EventPerformanceMetrics {
    by_type: Vec<EventTypePerformance>,
}

#[derive(Debug, Deserialize, Serialize)]
struct EventTypePerformance {
    #[serde(rename = "type")]
    type_name: String,
    count: usize,
    avg_duration_ms: f64,
}

#[derive(Debug, Deserialize, Serialize)]
struct ServiceLatency {
    service: String,
    avg_duration_ms: f64,
    event_count: usize,
}

#[derive(Debug, Deserialize, Serialize)]
struct ThroughputMetrics {
    events_per_second: f64,
    traces_per_second: f64,
    time_range_seconds: f64,
}

#[derive(Debug, Deserialize, Serialize)]
struct DistributedEdgesData {
    total_edges: usize,
    edges: Vec<DistributedEdge>,
}

#[derive(Debug, Deserialize, Serialize)]
struct DistributedEdge {
    from_service: String,
    to_service: String,
    link_type: String,
    call_count: usize,
}

#[derive(Debug, Deserialize, Serialize, Default)]
struct VariableAccess {
    event_id: String,
    timestamp: String,
    thread_id: String,
    service_name: String,
    access_type: String,
    #[serde(default)]
    location: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Load configuration
    let mut config = if cli.config.exists() {
        println!("📝 Loading configuration from {:?}", cli.config);
        Config::from_file(&cli.config)?
    } else {
        println!(
            "⚠️  Config file not found at {:?}, using defaults",
            cli.config
        );
        Config::default()
    };

    // Validate configuration
    config.validate()?;

    let default_server = format!("http://{}:{}", config.server.host, config.server.port);

    match cli.command {
        Commands::Serve { verbose } => {
            if verbose {
                config.server.verbose = true;
            }

            println!(
                "🚀 Starting Raceway server on {}:{}",
                config.server.host, config.server.port
            );
            server::start_server(config).await?;
        }
        Commands::Tui { server } => {
            let server_url = server.unwrap_or(default_server);
            println!("🎨 Launching Raceway TUI (connecting to {})...", server_url);
            tui::launch_tui(&server_url).await?;
        }
        Commands::Traces {
            page,
            page_size,
            json,
            server,
        } => {
            let server_url = server.unwrap_or(default_server);
            let client = Client::new();
            handle_traces(&client, &server_url, page, page_size, json).await?;
        }
        Commands::Trace {
            trace_id,
            json,
            events,
            server,
        } => {
            let server_url = server.unwrap_or(default_server);
            let client = Client::new();
            handle_trace(&client, &server_url, &trace_id, json, events).await?;
        }
        Commands::Services { json, server } => {
            let server_url = server.unwrap_or(default_server);
            let client = Client::new();
            handle_services(&client, &server_url, json).await?;
        }
        Commands::Service { server, action } => {
            let server_url = server.unwrap_or(default_server);
            let client = Client::new();
            match action {
                ServiceCommand::Overview { name, json } => {
                    handle_service_overview(&client, &server_url, &name, json).await?;
                }
                ServiceCommand::Traces {
                    name,
                    page,
                    page_size,
                    json,
                } => {
                    handle_service_traces(&client, &server_url, &name, page, page_size, json)
                        .await?;
                }
                ServiceCommand::Dependencies { name, json } => {
                    handle_service_dependencies(&client, &server_url, &name, json).await?;
                }
            }
        }
        Commands::Races { json, server } => {
            let server_url = server.unwrap_or(default_server);
            let client = Client::new();
            handle_global_races(&client, &server_url, json).await?;
        }
        Commands::Hotspots { json, server } => {
            let server_url = server.unwrap_or(default_server);
            let client = Client::new();
            handle_hotspots(&client, &server_url, json).await?;
        }
        Commands::Health {
            window,
            json,
            server,
        } => {
            let server_url = server.unwrap_or(default_server);
            let client = Client::new();
            handle_health(&client, &server_url, window, json).await?;
        }
        Commands::Performance {
            limit,
            json,
            server,
        } => {
            let server_url = server.unwrap_or(default_server);
            let client = Client::new();
            handle_performance(&client, &server_url, limit, json).await?;
        }
        Commands::Edges { json, server } => {
            let server_url = server.unwrap_or(default_server);
            let client = Client::new();
            handle_edges(&client, &server_url, json).await?;
        }
        Commands::Analyze { trace_id, server } => {
            let server_url = server.unwrap_or(default_server);
            let client = Client::new();
            // Preserve legacy behaviour by printing JSON
            handle_trace(&client, &server_url, &trace_id, true, 0).await?;
        }
        Commands::Export {
            trace_id,
            output,
            server,
        } => {
            let server_url = server.unwrap_or(default_server);
            export_trace(&trace_id, &output, &server_url).await?;
        }
    }

    Ok(())
}

async fn handle_traces(
    client: &Client,
    server: &str,
    page: usize,
    page_size: usize,
    json: bool,
) -> Result<()> {
    let url = format!(
        "{}/api/traces?page={}&page_size={}",
        server, page, page_size
    );
    let response: ApiResponse<TracesListData> = get_json(client, &url).await?;
    if !response.success {
        return Err(anyhow!(response
            .error
            .unwrap_or_else(|| "Unknown error".into())));
    }

    let data = response
        .data
        .ok_or_else(|| anyhow!("Trace list response missing data"))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&data)?);
        return Ok(());
    }

    println!(
        "📋 Traces (page {} of {}, total {} traces)",
        data.page, data.total_pages, data.total_traces
    );
    println!(
        "{:<38} {:>8} {:>8} {:<24} {}",
        "TRACE ID", "EVENTS", "SVCS", "LAST SEEN", "SERVICES"
    );

    for trace in data.traces {
        println!(
            "{:<38} {:>8} {:>8} {:<24} {}",
            trace.trace_id,
            trace.event_count,
            trace.service_count,
            trace.last_timestamp,
            if trace.services.is_empty() {
                "-".into()
            } else {
                trace.services.join(",")
            }
        );
    }

    Ok(())
}

async fn handle_trace(
    client: &Client,
    server: &str,
    trace_id: &str,
    json: bool,
    show_events: usize,
) -> Result<()> {
    let url = format!("{}/api/traces/{}", server, trace_id);
    let response: ApiResponse<FullTraceAnalysis> = get_json(client, &url).await?;
    if !response.success {
        return Err(anyhow!(response
            .error
            .unwrap_or_else(|| "Unknown error".into())));
    }

    let data = response
        .data
        .ok_or_else(|| anyhow!("Trace response missing data"))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&data)?);
        return Ok(());
    }

    println!("🔍 Trace {}", data.trace_id);
    println!(
        "• Events: {}  • Potential races: {}  • Concurrent events: {}  • Anomalies: {}",
        data.events.len(),
        data.analysis.potential_races,
        data.analysis.concurrent_events,
        data.anomalies.len()
    );

    if let Some(cp) = &data.critical_path {
        println!(
            "• Critical path: {:.2} ms ({:.1}% of {:.2} ms total)",
            cp.total_duration_ms, cp.percentage_of_total, cp.trace_total_duration_ms
        );
    }

    if let Some(deps) = &data.dependencies {
        println!(
            "• Services: {}  • Cross-service calls: {}",
            deps.services.len(),
            deps.dependencies.len()
        );
    }

    if !data.analysis.race_details.is_empty() {
        println!("\n⚠️  Race conditions:");
        for detail in data.analysis.race_details.iter().take(5) {
            println!(
                "  [{}] {} ({} ↔ {}, {} ↔ {})",
                detail.severity,
                detail.variable,
                detail.event1_thread,
                detail.event2_thread,
                detail.event1_location,
                detail.event2_location
            );
        }
        if data.analysis.race_details.len() > 5 {
            println!(
                "  … {} more (use --json for full details)",
                data.analysis.race_details.len() - 5
            );
        }
    }

    if !data.anomalies.is_empty() {
        println!("\n📈 Performance anomalies:");
        for anomaly in data.anomalies.iter().take(5) {
            println!(
                "  [{}] {} — {}",
                anomaly.severity, anomaly.event_kind, anomaly.description
            );
        }
        if data.anomalies.len() > 5 {
            println!(
                "  … {} more (use --json for full details)",
                data.anomalies.len() - 5
            );
        }
    }

    if show_events > 0 {
        println!("\n🪵 Events (showing first {}):", show_events);
        for event in data.events.iter().take(show_events) {
            let kind = if let Some(obj) = event.kind.as_object() {
                obj.keys()
                    .next()
                    .cloned()
                    .unwrap_or_else(|| "Unknown".to_string())
            } else {
                "Unknown".to_string()
            };
            println!(
                "  {}  {:<12} {:<16} {}",
                event.timestamp,
                short_id(&event.id),
                event.metadata.service_name,
                kind
            );
        }
        if data.events.len() > show_events {
            println!(
                "  … {} more events (use --json to dump everything)",
                data.events.len() - show_events
            );
        }
    }

    Ok(())
}

async fn handle_services(client: &Client, server: &str, json: bool) -> Result<()> {
    let url = format!("{}/api/services", server);
    let response: ApiResponse<ServicesListData> = get_json(client, &url).await?;
    if !response.success {
        return Err(anyhow!(response
            .error
            .unwrap_or_else(|| "Unknown error".into())));
    }

    let data = response
        .data
        .ok_or_else(|| anyhow!("Services response missing data"))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&data)?);
        return Ok(());
    }

    println!("🗂  Services (total {})", data.total_services);
    println!("{:<24} {:>10} {:>10}", "SERVICE", "EVENTS", "TRACES");
    for svc in data.services {
        println!(
            "{:<24} {:>10} {:>10}",
            svc.name, svc.event_count, svc.trace_count
        );
    }

    Ok(())
}

async fn handle_service_overview(
    client: &Client,
    server: &str,
    name: &str,
    json: bool,
) -> Result<()> {
    let services = fetch_services(client, server).await?;
    let service = services
        .services
        .iter()
        .find(|svc| svc.name == name)
        .ok_or_else(|| anyhow!("Service '{}' not found", name))?;

    if json {
        println!("{}", serde_json::to_string_pretty(service)?);
        return Ok(());
    }

    println!("🛠  Service {}", service.name);
    println!("• Events: {}", service.event_count);
    println!("• Traces: {}", service.trace_count);
    println!(
        "• Avg events per trace: {:.1}",
        if service.trace_count > 0 {
            service.event_count as f64 / service.trace_count as f64
        } else {
            0.0
        }
    );

    Ok(())
}

async fn handle_service_traces(
    client: &Client,
    server: &str,
    name: &str,
    page: usize,
    page_size: usize,
    json: bool,
) -> Result<()> {
    let url = format!(
        "{}/api/services/{}/traces?page={}&page_size={}",
        server,
        urlencoding::encode(name),
        page,
        page_size
    );
    let response: ApiResponse<ServiceTracesData> = get_json(client, &url).await?;
    if !response.success {
        return Err(anyhow!(response
            .error
            .unwrap_or_else(|| "Unknown error".into())));
    }
    let data = response
        .data
        .ok_or_else(|| anyhow!("Service traces response missing data"))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&data)?);
        return Ok(());
    }

    println!(
        "🧵 Traces for {} (page {} of {}, total {})",
        data.service_name, data.page, data.total_pages, data.total_traces
    );
    println!(
        "{:<12} {:>8} {:>8} {}",
        "TRACE", "EVENTS", "SVCS", "LAST SEEN"
    );
    for trace in data.traces {
        println!(
            "{:<12} {:>8} {:>8} {}",
            short_id(&trace.trace_id),
            trace.event_count,
            trace.service_count,
            trace.last_timestamp
        );
    }

    Ok(())
}

async fn handle_service_dependencies(
    client: &Client,
    server: &str,
    name: &str,
    json: bool,
) -> Result<()> {
    let url = format!(
        "{}/api/services/{}/dependencies",
        server,
        urlencoding::encode(name)
    );
    let response: ApiResponse<ServiceDependenciesData> = get_json(client, &url).await?;
    if !response.success {
        return Err(anyhow!(response
            .error
            .unwrap_or_else(|| "Unknown error".into())));
    }
    let data = response
        .data
        .ok_or_else(|| anyhow!("Service dependency response missing data"))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&data)?);
        return Ok(());
    }

    println!("🔗 Dependencies for {}", data.service_name);
    if data.called_by.is_empty() {
        println!("• Upstream: none");
    } else {
        println!("• Upstream:");
        for dep in &data.called_by {
            println!(
                "  ← {:<24} {:>6} calls across {:>4} traces",
                dep.to, dep.total_calls, dep.trace_count
            );
        }
    }

    if data.calls_to.is_empty() {
        println!("• Downstream: none");
    } else {
        println!("• Downstream:");
        for dep in &data.calls_to {
            println!(
                "  → {:<24} {:>6} calls across {:>4} traces",
                dep.to, dep.total_calls, dep.trace_count
            );
        }
    }

    Ok(())
}

async fn handle_global_races(client: &Client, server: &str, json: bool) -> Result<()> {
    let url = format!("{}/api/distributed/global-races", server);
    let response: ApiResponse<GlobalRacesData> = get_json(client, &url).await?;
    if !response.success {
        return Err(anyhow!(response
            .error
            .unwrap_or_else(|| "Unknown error".into())));
    }
    let data = response
        .data
        .ok_or_else(|| anyhow!("Global races response missing data"))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&data)?);
        return Ok(());
    }

    println!("🌐 Global race conditions ({} total)", data.total_races);
    if data.races.is_empty() {
        println!("No concurrent access issues detected.");
        return Ok(());
    }

    println!(
        "{:<24} {:<10} {:>7} {:>7} {:>7}",
        "VARIABLE", "SEVERITY", "TRACES", "ACCESSES", "THREADS"
    );
    for race in data.races {
        println!(
            "{:<24} {:<10} {:>7} {:>7} {:>7}",
            race.variable, race.severity, race.trace_count, race.access_count, race.thread_count
        );
    }

    Ok(())
}

async fn handle_hotspots(client: &Client, server: &str, json: bool) -> Result<()> {
    let url = format!("{}/api/distributed/hotspots", server);
    let response: ApiResponse<HotspotsData> = get_json(client, &url).await?;
    if !response.success {
        return Err(anyhow!(response
            .error
            .unwrap_or_else(|| "Unknown error".into())));
    }
    let data = response
        .data
        .ok_or_else(|| anyhow!("Hotspots response missing data"))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&data)?);
        return Ok(());
    }

    println!("🔥 Variable hotspots:");
    if data.top_variables.is_empty() {
        println!("  none");
    } else {
        for var in &data.top_variables {
            println!(
                "  {:<24} {:>6} accesses across {:>4} traces (services: {})",
                var.variable,
                var.access_count,
                var.trace_count,
                if var.services.is_empty() {
                    "-".into()
                } else {
                    var.services.join(",")
                }
            );
        }
    }

    println!("\n📞 Service call hotspots:");
    if data.top_service_calls.is_empty() {
        println!("  none");
    } else {
        for call in &data.top_service_calls {
            println!(
                "  {:<16} → {:<16} {:>6} calls",
                call.from_service, call.to_service, call.call_count
            );
        }
    }

    Ok(())
}

async fn handle_health(client: &Client, server: &str, window: u64, json: bool) -> Result<()> {
    let url = format!(
        "{}/api/services/health?time_window_minutes={}",
        server, window
    );
    let response: ApiResponse<Vec<ServiceHealthEntry>> = get_json(client, &url).await?;
    if !response.success {
        return Err(anyhow!(response
            .error
            .unwrap_or_else(|| "Unknown error".into())));
    }
    let data = response
        .data
        .ok_or_else(|| anyhow!("Health response missing data"))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&data)?);
        return Ok(());
    }

    println!("💓 Service health (last {} minutes)", window);
    println!(
        "{:<24} {:<9} {:>8} {:>12} {:>10}",
        "SERVICE", "STATUS", "TRACES", "LAST ACTIVITY", "AVG EVENTS"
    );
    for svc in data {
        println!(
            "{:<24} {:<9} {:>8} {:>12.0} {:>10.1}",
            svc.name,
            svc.status,
            svc.trace_count,
            svc.minutes_since_last_activity,
            svc.avg_events_per_trace
        );
    }

    Ok(())
}

async fn handle_performance(client: &Client, server: &str, limit: usize, json: bool) -> Result<()> {
    let url = format!("{}/api/performance/metrics?limit={}", server, limit);
    let response: ApiResponse<PerformanceMetrics> = get_json(client, &url).await?;
    if !response.success {
        return Err(anyhow!(response
            .error
            .unwrap_or_else(|| "Unknown error".into())));
    }
    let data = response
        .data
        .ok_or_else(|| anyhow!("Performance response missing data"))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&data)?);
        return Ok(());
    }

    println!("⚙️  System performance metrics");
    println!(
        "• Trace latency avg {:.2} ms (p50 {:.2}, p95 {:.2}, p99 {:.2})",
        data.trace_latency.avg_ms,
        data.trace_latency.p50_ms,
        data.trace_latency.p95_ms,
        data.trace_latency.p99_ms
    );
    println!(
        "• Throughput: {:.2} events/s, {:.2} traces/s (window {:.0}s)",
        data.throughput.events_per_second,
        data.throughput.traces_per_second,
        data.throughput.time_range_seconds
    );

    if !data.trace_latency.slowest_traces.is_empty() {
        println!("\n🐢 Slowest traces:");
        for trace in data.trace_latency.slowest_traces.iter().take(10) {
            println!(
                "  {:<12} {:>8.2} ms services: {}",
                short_id(&trace.trace_id),
                trace.duration_ms,
                if trace.services.is_empty() {
                    "-".into()
                } else {
                    trace.services.join(",")
                }
            );
        }
    }

    if !data.event_performance.by_type.is_empty() {
        println!("\n⏱  Event duration by type:");
        println!("{:<24} {:>10} {:>12}", "TYPE", "COUNT", "AVG MS");
        for event in &data.event_performance.by_type {
            println!(
                "{:<24} {:>10} {:>12.2}",
                event.type_name, event.count, event.avg_duration_ms
            );
        }
    }

    Ok(())
}

async fn handle_edges(client: &Client, server: &str, json: bool) -> Result<()> {
    let url = format!("{}/api/distributed/edges", server);
    let response: ApiResponse<DistributedEdgesData> = get_json(client, &url).await?;
    if !response.success {
        return Err(anyhow!(response
            .error
            .unwrap_or_else(|| "Unknown error".into())));
    }
    let data = response
        .data
        .ok_or_else(|| anyhow!("Edges response missing data"))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&data)?);
        return Ok(());
    }

    println!("🔀 Distributed edges ({} total)", data.total_edges);
    println!("{:<16} {:<16} {:<12} {:>6}", "FROM", "TO", "TYPE", "CALLS");
    for edge in data.edges {
        println!(
            "{:<16} {:<16} {:<12} {:>6}",
            edge.from_service, edge.to_service, edge.link_type, edge.call_count
        );
    }
    Ok(())
}

async fn export_trace(trace_id: &str, output: &str, server: &str) -> Result<()> {
    let client = Client::new();
    let response = client
        .get(format!("{}/api/traces/{}", server, trace_id))
        .send()
        .await
        .context("Failed to request trace")?;

    let trace_data = response
        .text()
        .await
        .context("Failed to read response body")?;
    std::fs::write(output, trace_data).with_context(|| format!("Failed to write {}", output))?;

    println!("✅ Trace exported to {}", output);
    Ok(())
}

async fn get_json<T: DeserializeOwned>(client: &Client, url: &str) -> Result<ApiResponse<T>> {
    let response = client
        .get(url)
        .send()
        .await
        .with_context(|| format!("Failed to GET {}", url))?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("Request to {} failed: {} {}", url, status, text));
    }
    let parsed = response.json::<ApiResponse<T>>().await?;
    Ok(parsed)
}

async fn fetch_services(client: &Client, server: &str) -> Result<ServicesListData> {
    let url = format!("{}/api/services", server);
    let response: ApiResponse<ServicesListData> = get_json(client, &url).await?;
    if !response.success {
        return Err(anyhow!(response
            .error
            .unwrap_or_else(|| "Unknown error".into())));
    }
    response
        .data
        .ok_or_else(|| anyhow!("Services response missing data"))
}

fn short_id(id: &str) -> String {
    if id.len() <= 8 {
        id.to_string()
    } else {
        id[..8].to_string()
    }
}
