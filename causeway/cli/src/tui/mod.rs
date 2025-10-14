pub mod types;
pub mod critical_path;
pub mod anomalies_view;
pub mod tree_view;
pub mod dependencies_view;
pub mod audit_trail_view;

pub use types::*;

use anyhow::Result;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, MouseEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::{Backend, CrosstermBackend},
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    widgets::{Block, Borders, List, ListItem, Paragraph, Wrap, Clear},
    Frame, Terminal,
};
use reqwest;
use std::collections::{HashMap, HashSet};
use std::io;
use std::time::Instant;

struct App {
    server_url: String,
    traces: Vec<String>,
    trace_ids: Vec<String>,  // Actual trace IDs for API calls
    selected_trace: usize,
    events: Vec<String>,
    event_data: Vec<serde_json::Value>,  // Actual event data
    selected_event: usize,
    event_detail: String,
    anomalies: Vec<String>,
    status_message: String,
    client: reqwest::blocking::Client,  // Reusable HTTP client
    trace_cache: HashMap<usize, CachedTraceData>,  // Cache for all traces
    auto_refresh: bool,  // Auto-refresh toggle
    refresh_interval_secs: u64,  // Configurable refresh interval
    last_refresh: Instant,  // Track last refresh time
    show_help: bool,  // Show help modal

    // Panel focus and scroll state
    focused_panel: Panel,
    traces_scroll: u16,
    events_scroll: u16,
    details_scroll: u16,
    anomalies_scroll: u16,

    // Race condition tracking
    traces_with_races: HashSet<usize>,  // Indices of traces with races
    current_trace_has_races: bool,  // Does current trace have races
    events_in_races: HashSet<String>,  // Event IDs involved in races (short form - first 8 chars)
    last_global_analysis_trace_count: usize,  // Track when we last did global analysis

    // View mode and additional data
    view_mode: ViewMode,
    critical_path_data: Option<CriticalPathData>,
    anomalies_data: Option<AnomaliesData>,
    dependencies_data: Option<DependenciesData>,
    audit_trail_data: Option<AuditTrailData>,
    selected_variable: Option<String>,
}

impl App {
    fn new(server_url: String) -> Self {
        // Create a single reusable HTTP client
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(2))
            .pool_max_idle_per_host(1)  // Prevent connection leak
            .build()
            .unwrap_or_else(|_| reqwest::blocking::Client::new());

        Self {
            server_url,
            traces: vec!["Loading...".to_string()],
            trace_ids: vec![],
            selected_trace: 0,
            events: vec![
                "Connecting to server...".to_string(),
                "".to_string(),
                "Press 'r' to refresh".to_string(),
                "Press 'q' to quit".to_string(),
            ],
            event_data: vec![],
            selected_event: 0,
            event_detail: "Waiting for data...".to_string(),
            anomalies: vec![
                "No anomalies detected yet".to_string(),
            ],
            status_message: "Starting...".to_string(),
            client,
            trace_cache: HashMap::new(),
            auto_refresh: true,  // Auto-refresh enabled by default
            refresh_interval_secs: 20,  // Default: 20 seconds
            last_refresh: Instant::now(),
            show_help: false,  // Help modal hidden by default

            // Panel focus and scroll - start with Events panel
            focused_panel: Panel::Events,
            traces_scroll: 0,
            events_scroll: 0,
            details_scroll: 0,
            anomalies_scroll: 0,

            // Race tracking
            traces_with_races: HashSet::new(),
            current_trace_has_races: false,
            events_in_races: HashSet::new(),
            last_global_analysis_trace_count: 0,

            // View mode - default to Events view
            view_mode: ViewMode::Events,
            critical_path_data: None,
            anomalies_data: None,
            dependencies_data: None,
            audit_trail_data: None,
            selected_variable: None,
        }
    }

    fn scroll_focused_up(&mut self) {
        match self.focused_panel {
            Panel::Traces => {
                self.traces_scroll = self.traces_scroll.saturating_sub(1);
            }
            Panel::Events => {
                if self.selected_event > 0 {
                    self.selected_event -= 1;
                    self.details_scroll = 0;
                    if self.selected_event < self.event_data.len() {
                        let event = &self.event_data[self.selected_event];
                        self.event_detail = format!("{:#}", event);
                    }
                }
            }
            Panel::Details => {
                self.details_scroll = self.details_scroll.saturating_sub(3);
            }
            Panel::Anomalies => {
                self.anomalies_scroll = self.anomalies_scroll.saturating_sub(3);
            }
        }
    }

    fn scroll_focused_down(&mut self) {
        match self.focused_panel {
            Panel::Traces => {
                self.traces_scroll = self.traces_scroll.saturating_add(1);
            }
            Panel::Events => {
                if self.selected_event < self.events.len().saturating_sub(1) {
                    self.selected_event += 1;
                    self.details_scroll = 0;
                    if self.selected_event < self.event_data.len() {
                        let event = &self.event_data[self.selected_event];
                        self.event_detail = format!("{:#}", event);
                    }
                }
            }
            Panel::Details => {
                self.details_scroll = self.details_scroll.saturating_add(3);
            }
            Panel::Anomalies => {
                self.anomalies_scroll = self.anomalies_scroll.saturating_add(3);
            }
        }
    }

    fn handle_click(&mut self, x: u16, y: u16, terminal_width: u16, terminal_height: u16) {
        // Calculate panel boundaries based on layout
        // Header is 3 lines, footer is 3 lines
        let content_start_y = 3;
        let content_end_y = terminal_height.saturating_sub(3);

        if y < content_start_y || y >= content_end_y {
            return; // Click was in header or footer
        }

        // Horizontal layout: 20% traces, 40% events, 40% right (details + anomalies)
        let traces_end_x = terminal_width * 20 / 100;
        let events_end_x = traces_end_x + (terminal_width * 40 / 100);

        // Right panel is split 60/40 vertically
        let content_height = content_end_y - content_start_y;
        let details_end_y = content_start_y + (content_height * 60 / 100);

        if x < traces_end_x {
            self.focused_panel = Panel::Traces;
        } else if x < events_end_x {
            self.focused_panel = Panel::Events;
        } else if y < details_end_y {
            self.focused_panel = Panel::Details;
        } else {
            self.focused_panel = Panel::Anomalies;
        }
    }

    fn should_refresh(&self) -> bool {
        self.auto_refresh &&
        self.last_refresh.elapsed().as_secs() >= self.refresh_interval_secs
    }

    fn fetch_status(&mut self) -> Result<()> {
        // Fetch the list of traces with IDs
        let traces_url = format!("{}/api/traces", self.server_url);
        match self.client.get(&traces_url).send() {
            Ok(response) => {
                if let Ok(traces_resp) = response.json::<TracesListResponse>() {
                    if let Some(traces_data) = traces_resp.data {
                        self.status_message = format!(
                            "Connected | Events: {} | Traces: {}",
                            traces_data.total_events,
                            traces_data.total_traces
                        );

                        if !traces_data.trace_ids.is_empty() {
                            // Check if trace count changed
                            let trace_count_changed = self.trace_ids.len() != traces_data.trace_ids.len();

                            // Store the actual trace IDs
                            self.trace_ids = traces_data.trace_ids.clone();

                            // Display traces with their IDs
                            self.traces = traces_data.trace_ids.iter()
                                .enumerate()
                                .map(|(i, id)| format!("🔍 Trace {}: {}...", i + 1, &id[..8]))
                                .collect();

                            // Only clear cache if trace count changed (new traces added)
                            if trace_count_changed {
                                self.trace_cache.clear();
                                self.last_global_analysis_trace_count = 0; // Force global analysis refresh
                            }

                            // Fetch details for the selected trace
                            if self.selected_trace < self.trace_ids.len() {
                                self.fetch_trace_details();
                            }
                        } else {
                            self.traces = vec!["No traces yet - send some events!".to_string()];
                            self.trace_ids = vec![];
                            self.events = vec![
                                "⏳ Waiting for traces...".to_string(),
                                "".to_string(),
                                "Run the integration test:".to_string(),
                                "  node integration-test.js".to_string(),
                            ];
                            self.event_detail = "No trace data available.\n\nRun integration-test.js to generate test events.".to_string();
                            self.anomalies = vec!["⏳ No data to analyze yet".to_string()];
                        }
                    }
                }
            }
            Err(e) => {
                self.status_message = format!("❌ Connection failed: {}", e);
                self.traces = vec!["Server not running!".to_string()];
                self.trace_ids = vec![];
                self.events = vec![
                    "Unable to connect to Causeway server".to_string(),
                    "".to_string(),
                    "Make sure the server is running:".to_string(),
                    "  cargo run --release -- serve".to_string(),
                ];
                self.event_detail = format!(
                    "❌ Connection Error\n\n\
                    Unable to connect to server at:\n\
                    {}\n\n\
                    Error: {}\n\n\
                    Make sure the Raceway server is running:\n\
                    cargo run --release -- serve\n\n\
                    Then press 'r' to refresh.",
                    self.server_url, e
                );
                self.anomalies = vec![
                    "⚠️  Server not responding".to_string(),
                    "".to_string(),
                    "Start the server first!".to_string(),
                ];
            }
        }

        Ok(())
    }

    fn fetch_trace_details(&mut self) {
        if self.selected_trace >= self.trace_ids.len() {
            return;
        }

        // CACHE CHECK: Skip fetch if we already have this trace's data
        if let Some(cached) = self.trace_cache.get(&self.selected_trace) {
            // Restore from cache
            self.events = cached.events.clone();
            self.event_data = cached.event_data.clone();
            self.anomalies = cached.anomalies.clone();
            self.current_trace_has_races = cached.has_races;
            self.anomalies_data = cached.anomalies_data.clone();

            // Update event detail for current selection
            if self.selected_event < self.event_data.len() {
                let event = &self.event_data[self.selected_event];
                self.event_detail = format!("{:#}", event);
            }

            // Only fetch global analysis if we haven't done it yet or trace count changed
            if self.last_global_analysis_trace_count != self.trace_ids.len() {
                self.fetch_global_analysis();
            }

            return;
        }

        let trace_id = &self.trace_ids[self.selected_trace];

        // Fetch trace events
        let trace_url = format!("{}/api/traces/{}", self.server_url, trace_id);
        if let Ok(response) = self.client.get(&trace_url).send() {
            if let Ok(trace_resp) = response.json::<TraceResponse>() {
                if let Some(trace_data) = trace_resp.data {
                    // Store event data
                    self.event_data = trace_data.events.clone();

                    // Display events in timeline
                    self.events = trace_data.events.iter()
                        .enumerate()
                        .map(|(i, event)| {
                            let kind = event.get("kind").and_then(|k| {
                                if let Some(obj) = k.as_object() {
                                    obj.keys().next().map(|s| s.as_str())
                                } else {
                                    None
                                }
                            }).unwrap_or("Unknown");

                            let timestamp = event.get("timestamp")
                                .and_then(|t| t.as_str())
                                .unwrap_or("?");

                            format!("{}. [{}] {}", i + 1, &timestamp[11..19], kind)
                        })
                        .collect();

                    // Show details of selected event
                    if self.selected_event < self.event_data.len() {
                        let event = &self.event_data[self.selected_event];
                        self.event_detail = format!("{:#}", event);
                    }
                }
            }
        }

        // Fetch per-trace analysis
        let has_races;
        let analysis_url = format!("{}/api/traces/{}/analyze", self.server_url, trace_id);
        if let Ok(response) = self.client.get(&analysis_url).send() {
            if let Ok(analysis_resp) = response.json::<AnalysisResponse>() {
                if let Some(analysis) = analysis_resp.data {
                    has_races = analysis.potential_races > 0;
                    self.current_trace_has_races = has_races;

                    if has_races {
                        self.traces_with_races.insert(self.selected_trace);
                        self.anomalies = vec![
                            format!("🚨 RACE CONDITIONS DETECTED! 🚨"),
                            "".to_string(),
                            format!("⚠️  {} concurrent event pairs found", analysis.concurrent_events),
                            format!("⚠️  {} potential race conditions", analysis.potential_races),
                            "".to_string(),
                        ];

                        for anomaly in &analysis.anomalies {
                            self.anomalies.push(anomaly.clone());
                        }

                        self.anomalies.push("".to_string());
                        self.anomalies.push("💡 These events accessed shared state".to_string());
                        self.anomalies.push("   without proper synchronization!".to_string());
                    } else {
                        self.anomalies = vec![
                            "✅ No race conditions in this trace".to_string(),
                            "".to_string(),
                            format!("Analyzed {} events", self.event_data.len()),
                        ];
                    }
                } else {
                    has_races = false;
                    self.current_trace_has_races = false;
                }
            } else {
                has_races = false;
                self.current_trace_has_races = false;
            }
        } else {
            has_races = false;
            self.current_trace_has_races = false;
        }

        // Fetch global cross-trace analysis
        self.fetch_global_analysis();

        // Fetch performance anomalies for caching
        let trace_id = &self.trace_ids[self.selected_trace];
        let anomalies_url = format!("{}/api/traces/{}/anomalies", self.server_url, trace_id);
        let fetched_anomalies_data = if let Ok(response) = self.client.get(&anomalies_url).send() {
            if let Ok(anom_resp) = response.json::<AnomaliesResponse>() {
                anom_resp.data
            } else {
                None
            }
        } else {
            None
        };
        self.anomalies_data = fetched_anomalies_data.clone();

        // Store in cache
        self.trace_cache.insert(self.selected_trace, CachedTraceData {
            events: self.events.clone(),
            event_data: self.event_data.clone(),
            anomalies: self.anomalies.clone(),
            has_races,
            anomalies_data: fetched_anomalies_data,
        });
    }

    fn fetch_global_analysis(&mut self) {
        // Mark that we've run global analysis for this trace count
        self.last_global_analysis_trace_count = self.trace_ids.len();

        let global_url = format!("{}/api/analyze/global", self.server_url);
        if let Ok(response) = self.client.get(&global_url).send() {
            if let Ok(global_resp) = response.json::<GlobalAnalysisResponse>() {
                if let Some(global) = global_resp.data {
                    if global.potential_races > 0 {
                        let current_trace_id = &self.trace_ids[self.selected_trace];
                        let current_trace_short = &current_trace_id[..8];
                        let mut current_trace_involved = false;
                        let mut events_in_this_trace = HashSet::new();

                        // Parse trace IDs and event IDs from anomaly messages
                        // Track the most recently seen event ID to associate it with a trace
                        let mut current_event_id: Option<String> = None;

                        for anomaly in &global.anomalies {
                            // Extract trace IDs from messages like "Trace bbbbbbbb" or "Trace aaaaaaaa"
                            if anomaly.contains("Trace ") {
                                for (i, trace_id) in self.trace_ids.iter().enumerate() {
                                    let trace_short = &trace_id[..8];
                                    if anomaly.contains(trace_short) {
                                        self.traces_with_races.insert(i);
                                        if trace_short == current_trace_short {
                                            current_trace_involved = true;

                                            // If we just saw an event ID, associate it with this trace
                                            if let Some(ref event_id) = current_event_id {
                                                events_in_this_trace.insert(event_id.clone());
                                            }
                                        }
                                    }
                                }
                                // Clear the current event after processing trace line
                                current_event_id = None;
                            }

                            // Extract event IDs from messages like "Event 1: 11111111" or "Event 2: 22222222"
                            if anomaly.contains("Event ") && anomaly.contains(": ") {
                                if let Some(colon_pos) = anomaly.find(": ") {
                                    let after_colon = &anomaly[colon_pos + 2..];
                                    if let Some(space_pos) = after_colon.find(' ') {
                                        let event_id = &after_colon[..space_pos];
                                        if event_id.len() == 8 {
                                            self.events_in_races.insert(event_id.to_string());
                                            current_event_id = Some(event_id.to_string());
                                        }
                                    }
                                }
                            }
                        }

                        // Update anomalies with clearer messaging
                        if current_trace_involved {
                            // Remove any existing cross-trace messaging to regenerate it fresh
                            if let Some(separator_pos) = self.anomalies.iter().position(|a| a.contains("─────────────────────────────────")) {
                                self.anomalies.truncate(separator_pos.saturating_sub(1));
                            }

                            if !self.current_trace_has_races {
                                // No per-trace races, but involved in cross-trace races
                                self.current_trace_has_races = true;
                                self.traces_with_races.insert(self.selected_trace);

                                // Replace the "no races" message with a better one
                                if self.anomalies.iter().any(|a| a.contains("✅ No race conditions")) {
                                    self.anomalies = vec![
                                        format!("⚠️  This trace is involved in CROSS-TRACE races"),
                                        "".to_string(),
                                        format!("✅ No races within this trace alone"),
                                        format!("🌐 But {} event(s) race with other traces", events_in_this_trace.len()),
                                        "".to_string(),
                                    ];
                                }
                            } else {
                                // Has per-trace races, update the event count line
                                if self.anomalies.iter().any(|a| a.contains("🌐 But")) {
                                    if let Some(pos) = self.anomalies.iter().position(|a| a.contains("🌐 But")) {
                                        self.anomalies[pos] = format!("🌐 But {} event(s) race with other traces", events_in_this_trace.len());
                                    }
                                }
                            }

                            // Add separator
                            self.anomalies.push("".to_string());
                            self.anomalies.push("─────────────────────────────────".to_string());
                            self.anomalies.push("🌐 CROSS-TRACE RACE DETAILS".to_string());
                            self.anomalies.push("─────────────────────────────────".to_string());
                            self.anomalies.push("".to_string());

                            // Add global race info
                            for anomaly in &global.anomalies {
                                // Only show races involving current trace
                                if anomaly.contains(current_trace_short) || !anomaly.contains("Event ") {
                                    self.anomalies.push(anomaly.clone());
                                }
                            }

                            self.anomalies.push("".to_string());
                            self.anomalies.push(format!("💡 Events marked in red are involved in races"));
                            self.anomalies.push("   Switch traces to see other race participants".to_string());
                        }
                    }
                }
            }
        }
    }

    fn select_next_trace(&mut self) {
        if self.selected_trace < self.traces.len().saturating_sub(1) {
            self.selected_trace += 1;
            self.selected_event = 0;
            self.details_scroll = 0;

            // Clear view data for new trace (except anomalies_data which is cached)
            self.critical_path_data = None;
            self.dependencies_data = None;
            self.audit_trail_data = None;
            self.selected_variable = None;

            self.fetch_trace_details();

            // Fetch current view data only if not cached
            match self.view_mode {
                ViewMode::CriticalPath => {
                    if self.critical_path_data.is_none() {
                        self.fetch_critical_path();
                    }
                }
                ViewMode::Anomalies => {
                    if self.anomalies_data.is_none() {
                        self.fetch_anomalies();
                    }
                }
                ViewMode::Dependencies => {
                    if self.dependencies_data.is_none() {
                        self.fetch_dependencies();
                    }
                }
                ViewMode::AuditTrail => {
                    if self.audit_trail_data.is_none() && self.selected_variable.is_none() {
                        self.fetch_first_race_variable();
                    }
                }
                ViewMode::Events | ViewMode::Tree => {}
            }
        }
    }

    fn select_prev_trace(&mut self) {
        if self.selected_trace > 0 {
            self.selected_trace -= 1;
            self.selected_event = 0;
            self.details_scroll = 0;

            // Clear view data for new trace (except anomalies_data which is cached)
            self.critical_path_data = None;
            self.dependencies_data = None;
            self.audit_trail_data = None;
            self.selected_variable = None;

            self.fetch_trace_details();

            // Fetch current view data only if not cached
            match self.view_mode {
                ViewMode::CriticalPath => {
                    if self.critical_path_data.is_none() {
                        self.fetch_critical_path();
                    }
                }
                ViewMode::Anomalies => {
                    if self.anomalies_data.is_none() {
                        self.fetch_anomalies();
                    }
                }
                ViewMode::Dependencies => {
                    if self.dependencies_data.is_none() {
                        self.fetch_dependencies();
                    }
                }
                ViewMode::AuditTrail => {
                    if self.audit_trail_data.is_none() && self.selected_variable.is_none() {
                        self.fetch_first_race_variable();
                    }
                }
                ViewMode::Events | ViewMode::Tree => {}
            }
        }
    }

    fn fetch_critical_path(&mut self) {
        if self.selected_trace >= self.trace_ids.len() {
            return;
        }

        let trace_id = &self.trace_ids[self.selected_trace];
        let url = format!("{}/api/traces/{}/critical-path", self.server_url, trace_id);

        if let Ok(response) = self.client.get(&url).send() {
            if let Ok(cp_resp) = response.json::<CriticalPathResponse>() {
                self.critical_path_data = cp_resp.data;
            }
        }
    }

    fn fetch_anomalies(&mut self) {
        if self.selected_trace >= self.trace_ids.len() {
            return;
        }

        let trace_id = &self.trace_ids[self.selected_trace];
        let url = format!("{}/api/traces/{}/anomalies", self.server_url, trace_id);

        if let Ok(response) = self.client.get(&url).send() {
            if let Ok(anom_resp) = response.json::<AnomaliesResponse>() {
                self.anomalies_data = anom_resp.data;
            }
        }
    }

    fn cycle_view_mode(&mut self) {
        self.view_mode = match self.view_mode {
            ViewMode::Events => ViewMode::Tree,
            ViewMode::Tree => ViewMode::CriticalPath,
            ViewMode::CriticalPath => ViewMode::Anomalies,
            ViewMode::Anomalies => ViewMode::Dependencies,
            ViewMode::Dependencies => ViewMode::AuditTrail,
            ViewMode::AuditTrail => ViewMode::Events,
        };

        // Fetch data for the new view mode if needed
        match self.view_mode {
            ViewMode::CriticalPath => {
                if self.critical_path_data.is_none() {
                    self.fetch_critical_path();
                }
            }
            ViewMode::Anomalies => {
                if self.anomalies_data.is_none() {
                    self.fetch_anomalies();
                }
            }
            ViewMode::Dependencies => {
                if self.dependencies_data.is_none() {
                    self.fetch_dependencies();
                }
            }
            ViewMode::AuditTrail => {
                // Auto-load audit trail for first variable if none selected
                if self.audit_trail_data.is_none() && self.selected_variable.is_none() {
                    // Try to find a variable from race conditions
                    self.fetch_first_race_variable();
                }
            }
            ViewMode::Events | ViewMode::Tree => {} // Already have event data
        }
    }

    fn fetch_dependencies(&mut self) {
        if self.selected_trace >= self.trace_ids.len() {
            return;
        }

        let trace_id = &self.trace_ids[self.selected_trace];
        let url = format!("{}/api/traces/{}/dependencies", self.server_url, trace_id);

        if let Ok(response) = self.client.get(&url).send() {
            if let Ok(deps_resp) = response.json::<DependenciesResponse>() {
                self.dependencies_data = deps_resp.data;
            }
        }
    }

    fn fetch_first_race_variable(&mut self) {
        // Try to extract a variable name from race anomalies
        // Clone the variable name first to avoid borrowing issues
        let variable_name = self.anomalies.iter()
            .find_map(|anomaly| {
                if anomaly.contains("RACE on ") {
                    anomaly.find("RACE on ").and_then(|start| {
                        let after = &anomaly[start + 8..];
                        after.find(|c: char| c.is_whitespace()).map(|end| {
                            after[..end].to_string()
                        })
                    })
                } else {
                    None
                }
            });

        if let Some(variable) = variable_name {
            self.selected_variable = Some(variable.clone());
            self.fetch_audit_trail(&variable);
        }
    }

    fn fetch_audit_trail(&mut self, variable: &str) {
        if self.selected_trace >= self.trace_ids.len() {
            return;
        }

        let trace_id = &self.trace_ids[self.selected_trace];
        let url = format!("{}/api/traces/{}/audit-trail/{}",
            self.server_url, trace_id,
            urlencoding::encode(variable));

        if let Ok(response) = self.client.get(&url).send() {
            if let Ok(trail_resp) = response.json::<AuditTrailResponse>() {
                self.audit_trail_data = trail_resp.data;
            }
        }
    }
}

pub async fn launch_tui(server: &str) -> Result<()> {
    launch_tui_blocking(server)
}

fn launch_tui_blocking(server: &str) -> Result<()> {
    // Print before entering TUI mode
    println!("Starting Raceway TUI...");
    println!("Connecting to: {}", server);

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app = App::new(server.to_string());

    // Try to fetch data (with short timeout)
    if let Err(e) = app.fetch_status() {
        app.status_message = format!("Failed to connect: {}", e);
    }

    let res = run_app(&mut terminal, &mut app);

    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;

    if let Err(err) = res {
        println!("Error: {:?}", err);
    }

    Ok(())
}

fn run_app<B: Backend>(terminal: &mut Terminal<B>, app: &mut App) -> Result<()> {
    loop {
        terminal.draw(|f| ui(f, app))?;

        // Check if we should auto-refresh
        if app.should_refresh() {
            let _ = app.fetch_status();
            app.last_refresh = Instant::now();
        }

        // Non-blocking event check
        if event::poll(std::time::Duration::from_millis(100))? {
            match event::read()? {
                Event::Key(key) => {
                    if app.show_help {
                        // When help is showing, only allow closing it
                        match key.code {
                            KeyCode::Char('?') | KeyCode::F(1) | KeyCode::Esc => app.show_help = false,
                            _ => {}
                        }
                    } else {
                        match key.code {
                            KeyCode::Char('q') => return Ok(()),
                            KeyCode::Char('?') | KeyCode::F(1) => app.show_help = true,

                            // Global navigation
                            KeyCode::Char('h') | KeyCode::Left => app.select_prev_trace(),
                            KeyCode::Char('l') | KeyCode::Right => app.select_next_trace(),

                            // Panel-specific controls (shown in headers)
                            // Traces panel: w/s
                            KeyCode::Char('w') if matches!(app.focused_panel, Panel::Traces) => {
                                if app.selected_trace > 0 {
                                    app.selected_trace -= 1;
                                    app.selected_event = 0;
                                    app.details_scroll = 0;
                                    app.fetch_trace_details();
                                }
                            }
                            KeyCode::Char('s') if matches!(app.focused_panel, Panel::Traces) => {
                                if app.selected_trace < app.traces.len().saturating_sub(1) {
                                    app.selected_trace += 1;
                                    app.selected_event = 0;
                                    app.details_scroll = 0;
                                    app.fetch_trace_details();
                                }
                            }

                            // Events panel: j/k (vi-style)
                            KeyCode::Char('j') | KeyCode::Down => app.scroll_focused_down(),
                            KeyCode::Char('k') | KeyCode::Up => app.scroll_focused_up(),

                            // Details panel: u/d
                            KeyCode::Char('u') | KeyCode::PageUp => {
                                if matches!(app.focused_panel, Panel::Details) {
                                    app.scroll_focused_up();
                                }
                            }
                            KeyCode::Char('d') | KeyCode::PageDown => {
                                if matches!(app.focused_panel, Panel::Details) {
                                    app.scroll_focused_down();
                                }
                            }

                            // Anomalies panel: p/n (previous/next)
                            KeyCode::Char('p') if matches!(app.focused_panel, Panel::Anomalies) => app.scroll_focused_up(),
                            KeyCode::Char('n') if matches!(app.focused_panel, Panel::Anomalies) => app.scroll_focused_down(),

                            // Global actions
                            KeyCode::Char('r') => {
                                let _ = app.fetch_status();
                                app.last_refresh = Instant::now();
                            }
                            KeyCode::Char('a') => {
                                app.auto_refresh = !app.auto_refresh;
                                if app.auto_refresh {
                                    app.last_refresh = Instant::now();
                                }
                            }
                            KeyCode::Tab | KeyCode::Char('v') => {
                                app.cycle_view_mode();
                            }
                            _ => {}
                        }
                    }
                }
                Event::Mouse(mouse) => {
                    match mouse.kind {
                        MouseEventKind::Down(_button) => {
                            let size = terminal.size()?;
                            app.handle_click(mouse.column, mouse.row, size.width, size.height);
                        }
                        MouseEventKind::ScrollDown => app.scroll_focused_down(),
                        MouseEventKind::ScrollUp => app.scroll_focused_up(),
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }
}

fn render_help_modal(f: &mut Frame) {
    let area = f.size();

    // Create centered modal area (60% width, 70% height)
    let modal_width = (area.width * 60) / 100;
    let modal_height = (area.height * 70) / 100;
    let modal_x = (area.width - modal_width) / 2;
    let modal_y = (area.height - modal_height) / 2;

    let modal_area = ratatui::layout::Rect {
        x: modal_x,
        y: modal_y,
        width: modal_width,
        height: modal_height,
    };

    // Create help content
    let help_text = vec![
        "🔍 RACEWAY - KEYBOARD & MOUSE SHORTCUTS",
        "",
        "┌─ MOUSE CONTROLS ─────────────────────────────────────┐",
        "│  Click Panel    Focus panel (shows ● indicator)     │",
        "│  Mouse Wheel    Scroll focused panel up/down        │",
        "└──────────────────────────────────────────────────────┘",
        "",
        "┌─ PANEL-SPECIFIC KEYS (when focused) ────────────────┐",
        "│  w / s          Traces panel - select trace         │",
        "│  j / k / ↑↓     Events panel - select event         │",
        "│  u / d          Details panel - scroll content      │",
        "│  p / n          Anomalies panel - scroll list       │",
        "└──────────────────────────────────────────────────────┘",
        "",
        "┌─ GLOBAL NAVIGATION ──────────────────────────────────┐",
        "│  ← / h          Switch to previous trace            │",
        "│  → / l          Switch to next trace                │",
        "└──────────────────────────────────────────────────────┘",
        "",
        "┌─ ACTIONS ────────────────────────────────────────────┐",
        "│  r              Manual refresh (fetch latest data)  │",
        "│  a              Toggle auto-refresh on/off          │",
        "│                 (Auto-refresh: every 20 seconds)    │",
        "│  Tab / v        Cycle view mode (Events/Path/Anom)  │",
        "└──────────────────────────────────────────────────────┘",
        "",
        "┌─ GENERAL ────────────────────────────────────────────┐",
        "│  ? / F1         Toggle this help screen             │",
        "│  Esc            Close help screen                   │",
        "│  q              Quit Raceway                        │",
        "└──────────────────────────────────────────────────────┘",
        "",
        "TIP: Click any panel to focus it, then use its specific keys!",
        "Press ? or Esc to close this help screen",
    ];

    let help_content = help_text.join("\n");

    // Clear the area behind the modal (this removes background widgets)
    f.render_widget(Clear, modal_area);

    // Render help text with background
    let help_widget = Paragraph::new(help_content)
        .block(Block::default()
            .borders(Borders::ALL)
            .title("📖 Help")
            .style(Style::default().bg(Color::Black).fg(Color::Cyan)))
        .style(Style::default().bg(Color::Black).fg(Color::White))
        .wrap(Wrap { trim: false });

    f.render_widget(help_widget, modal_area);
}

fn ui(f: &mut Frame, app: &App) {
    let size = f.size();

    // Create main layout
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(10),
            Constraint::Length(3),
        ])
        .split(size);

    // Header with status
    let auto_refresh_status = if app.auto_refresh {
        let seconds_until_refresh = app.refresh_interval_secs
            .saturating_sub(app.last_refresh.elapsed().as_secs());
        format!("Auto-refresh: ON (next in {}s)",
                seconds_until_refresh)
    } else {
        "Auto-refresh: OFF".to_string()
    };

    let header_text = format!("🏁 Raceway - Concurrency Debugger | {} | {}",
                              auto_refresh_status, app.status_message);
    let header = Paragraph::new(header_text)
        .style(Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))
        .block(Block::default().borders(Borders::ALL));
    f.render_widget(header, chunks[0]);

    // Main content area
    let main_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(20),
            Constraint::Percentage(40),
            Constraint::Percentage(40),
        ])
        .split(chunks[1]);

    // Left panel: Traces
    let traces: Vec<ListItem> = app
        .traces
        .iter()
        .enumerate()
        .map(|(i, trace)| {
            let has_race = app.traces_with_races.contains(&i);
            let is_selected = i == app.selected_trace;

            let style = match (is_selected, has_race) {
                (true, true) => Style::default().fg(Color::Red).add_modifier(Modifier::BOLD).add_modifier(Modifier::REVERSED),
                (true, false) => Style::default().fg(Color::Green).add_modifier(Modifier::BOLD).add_modifier(Modifier::REVERSED),
                (false, true) => Style::default().fg(Color::Red),
                (false, false) => Style::default(),
            };

            ListItem::new(trace.as_str()).style(style)
        })
        .collect();

    let traces_focused = matches!(app.focused_panel, Panel::Traces);
    let traces_title = if traces_focused {
        "📊 Traces [w/s] ●"
    } else {
        "📊 Traces [w/s]"
    };
    let traces_block = Block::default()
        .borders(Borders::ALL)
        .title(traces_title)
        .border_style(if traces_focused {
            Style::default().fg(Color::Cyan)
        } else {
            Style::default()
        });
    let traces_widget = List::new(traces).block(traces_block);
    f.render_widget(traces_widget, main_chunks[0]);

    // Middle panel: Render based on view mode
    let events_focused = matches!(app.focused_panel, Panel::Events);

    match app.view_mode {
        ViewMode::Events => {
            // Original events list view
            let events: Vec<ListItem> = app
                .events
                .iter()
                .enumerate()
                .map(|(i, event)| {
                    // Check if this event is involved in a race
                    let event_in_race = if i < app.event_data.len() {
                        app.event_data[i]
                            .get("id")
                            .and_then(|id| id.as_str())
                            .map(|id_str| {
                                let event_id_short = &id_str[..8.min(id_str.len())];
                                app.events_in_races.contains(event_id_short)
                            })
                            .unwrap_or(false)
                    } else {
                        false
                    };

                    let is_selected = i == app.selected_event;

                    let style = match (is_selected, event_in_race) {
                        (true, true) => Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
                        (true, false) => Style::default().fg(Color::Green).add_modifier(Modifier::BOLD),
                        (false, true) => Style::default().fg(Color::Red),
                        (false, false) => Style::default(),
                    };

                    ListItem::new(event.as_str()).style(style)
                })
                .collect();

            let events_title = if events_focused {
                "⚡ Event Timeline [j/k] ●"
            } else {
                "⚡ Event Timeline [j/k]"
            };
            let events_block = Block::default()
                .borders(Borders::ALL)
                .title(events_title)
                .border_style(if events_focused {
                    Style::default().fg(Color::Cyan)
                } else {
                    Style::default()
                });
            let events_widget = List::new(events).block(events_block);
            f.render_widget(events_widget, main_chunks[1]);
        }
        ViewMode::Tree => {
            // Render tree view showing causal relationships
            tree_view::render_tree_view(
                f,
                main_chunks[1],
                &app.event_data,
                events_focused,
                app.selected_event,
                &app.events_in_races,
            );
        }
        ViewMode::CriticalPath => {
            // Render critical path view
            critical_path::render_critical_path_list(
                f,
                main_chunks[1],
                &app.critical_path_data,
                events_focused,
                app.selected_event,
            );
        }
        ViewMode::Anomalies => {
            // Render anomalies list view
            anomalies_view::render_anomalies_list(
                f,
                main_chunks[1],
                &app.anomalies_data,
                events_focused,
                app.selected_event,
            );
        }
        ViewMode::Dependencies => {
            // Render service dependencies view
            dependencies_view::render_dependencies_view(
                f,
                main_chunks[1],
                &app.dependencies_data,
                events_focused,
            );
        }
        ViewMode::AuditTrail => {
            // Render audit trail view for a variable
            audit_trail_view::render_audit_trail_view(
                f,
                main_chunks[1],
                &app.audit_trail_data,
                events_focused,
            );
        }
    }

    // Right panel: Event details and anomalies
    let right_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Percentage(60), Constraint::Percentage(40)])
        .split(main_chunks[2]);

    let details_focused = matches!(app.focused_panel, Panel::Details);
    let details_title = if details_focused {
        "📝 Event Details [u/d] ●"
    } else {
        "📝 Event Details [u/d]"
    };
    let details_block = Block::default()
        .borders(Borders::ALL)
        .title(details_title)
        .border_style(if details_focused {
            Style::default().fg(Color::Cyan)
        } else {
            Style::default()
        });
    let detail_widget = Paragraph::new(app.event_detail.as_str())
        .block(details_block)
        .wrap(Wrap { trim: true })
        .scroll((app.details_scroll, 0));
    f.render_widget(detail_widget, right_chunks[0]);

    let anomalies_focused = matches!(app.focused_panel, Panel::Anomalies);
    let anomalies_title = if anomalies_focused {
        "🚨 Anomalies [p/n] ●"
    } else {
        "🚨 Anomalies [p/n]"
    };
    let anomalies_block = Block::default()
        .borders(Borders::ALL)
        .title(anomalies_title)
        .border_style(if anomalies_focused {
            Style::default().fg(Color::Cyan)
        } else {
            Style::default()
        });

    // Join anomalies with newlines for paragraph display with wrapping
    let anomalies_text = app.anomalies.join("\n");
    let anomalies_widget = Paragraph::new(anomalies_text)
        .block(anomalies_block)
        .style(Style::default().fg(Color::Red))
        .wrap(Wrap { trim: true })
        .scroll((app.anomalies_scroll, 0));
    f.render_widget(anomalies_widget, right_chunks[1]);

    // Footer
    let view_mode_text = match app.view_mode {
        ViewMode::Events => "Events",
        ViewMode::Tree => "Tree",
        ViewMode::CriticalPath => "Critical Path",
        ViewMode::Anomalies => "Anomalies",
        ViewMode::Dependencies => "Dependencies",
        ViewMode::AuditTrail => "Audit Trail",
    };
    let footer_text = format!(
        "View: {} | Tab/v: Cycle view | ←→/hl: Switch trace | r: Refresh | ?: Help | q: Quit",
        view_mode_text
    );
    let footer = Paragraph::new(footer_text)
        .style(Style::default().fg(Color::DarkGray))
        .block(Block::default().borders(Borders::ALL));
    f.render_widget(footer, chunks[2]);

    // Render help modal if active
    if app.show_help {
        render_help_modal(f);
    }
}
