#![allow(dead_code)]

use serde::Deserialize;

#[derive(Deserialize)]
pub struct ServerStatus {
    pub data: Option<StatusData>,
}

#[derive(Deserialize)]
pub struct StatusData {
    pub events_captured: usize,
    pub traces_active: usize,
}

#[derive(Deserialize)]
pub struct TracesListResponse {
    pub success: bool,
    pub data: Option<TracesListData>,
}

#[derive(Deserialize)]
pub struct TracesListData {
    pub total_traces: usize,
    pub page: usize,
    pub page_size: usize,
    pub total_pages: usize,
    pub traces: Vec<TraceMetadata>,
}

#[derive(Deserialize, Clone)]
pub struct TraceMetadata {
    pub trace_id: String,
    pub event_count: usize,
    pub first_timestamp: String,
    pub last_timestamp: String,
}

#[derive(Deserialize)]
pub struct TraceResponse {
    pub success: bool,
    pub data: Option<TraceData>,
}

#[derive(Deserialize)]
pub struct TraceData {
    pub trace_id: String,
    pub event_count: usize,
    pub events: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
pub struct AnalysisResponse {
    pub success: bool,
    pub data: Option<AnalysisData>,
}

#[derive(Deserialize)]
pub struct AnalysisData {
    #[serde(default)]
    pub trace_id: Option<String>,
    pub concurrent_events: usize,
    pub potential_races: usize,
    pub anomalies: Vec<String>,
    #[serde(default)]
    pub race_details: Option<Vec<RaceDetail>>,
}

#[derive(Deserialize)]
pub struct RaceDetail {
    pub severity: String,
    pub variable: String,
    pub event1_thread: String,
    pub event2_thread: String,
    pub event1_location: String,
    pub event2_location: String,
    pub description: String,
}

#[derive(Deserialize)]
pub struct GlobalAnalysisResponse {
    pub success: bool,
    pub data: Option<GlobalAnalysisData>,
}

#[derive(Deserialize)]
pub struct GlobalAnalysisData {
    pub total_traces: usize,
    pub total_events: usize,
    pub concurrent_events: usize,
    pub potential_races: usize,
    pub anomalies: Vec<String>,
    pub race_details: Option<Vec<GlobalRaceDetail>>,
}

#[derive(Deserialize)]
pub struct GlobalRaceDetail {
    pub severity: String,
    pub variable: String,
    pub trace1_id: String,
    pub trace2_id: String,
    pub event1_thread: String,
    pub event2_thread: String,
    pub event1_location: String,
    pub event2_location: String,
    pub event1_timestamp: String,
    pub event2_timestamp: String,
    pub description: String,
}

// New API response types
#[derive(Deserialize)]
pub struct CriticalPathResponse {
    pub success: bool,
    pub data: Option<CriticalPathData>,
}

#[derive(Deserialize, Clone)]
pub struct CriticalPathData {
    pub trace_id: String,
    pub path_events: usize,
    pub total_duration_ms: f64,
    pub trace_total_duration_ms: f64,
    pub percentage_of_total: f64,
    pub path: Vec<PathEvent>,
}

#[derive(Deserialize, Clone)]
pub struct PathEvent {
    pub id: String,
    pub kind: String,
    pub location: String,
    pub timestamp: String,
    pub duration_ms: f64,
}

#[derive(Deserialize)]
pub struct AnomaliesResponse {
    pub success: bool,
    pub data: Option<AnomaliesData>,
}

#[derive(Deserialize, Clone)]
pub struct AnomaliesData {
    pub trace_id: String,
    pub anomaly_count: usize,
    pub anomalies: Vec<DetectedAnomaly>,
}

#[derive(Deserialize, Clone)]
pub struct DetectedAnomaly {
    pub event_id: String,
    pub event_kind: String,
    pub severity: String,
    pub actual_duration_ms: f64,
    pub expected_duration_ms: f64,
    pub std_dev_from_mean: f64,
    pub description: String,
    pub location: String,
    pub timestamp: String,
}

#[derive(Clone)]
pub struct CachedTraceData {
    pub events: Vec<String>,
    pub event_data: Vec<serde_json::Value>,
    pub anomalies: Vec<String>,
    pub has_races: bool,
    pub anomalies_data: Option<AnomaliesData>,
    pub critical_path_data: Option<CriticalPathData>,
    pub dependencies_data: Option<DependenciesData>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Panel {
    Traces,
    Events,
    Details,
    Anomalies,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ViewMode {
    Events,       // Default event timeline view
    Tree,         // Tree view showing causal relationships
    CriticalPath, // Show critical path analysis
    Anomalies,    // Show detected anomalies with details
    Dependencies, // Show service dependencies graph
    AuditTrail,   // Show audit trail for a variable
    CrossTrace,   // Show cross-trace race detection (lazy loaded)
}

// Dependencies response types
#[derive(Deserialize, Clone)]
pub struct DependenciesResponse {
    pub success: bool,
    pub data: Option<DependenciesData>,
}

#[derive(Deserialize, Clone)]
pub struct DependenciesData {
    pub trace_id: String,
    pub services: Vec<ServiceInfo>,
    pub dependencies: Vec<ServiceDependency>,
}

#[derive(Deserialize, Clone)]
pub struct ServiceInfo {
    pub name: String,
    pub event_count: usize,
}

#[derive(Deserialize, Clone)]
pub struct ServiceDependency {
    pub from: String,
    pub to: String,
    pub call_count: usize,
}

// Audit trail response types
#[derive(Deserialize, Clone)]
pub struct AuditTrailResponse {
    pub success: bool,
    pub data: Option<AuditTrailData>,
}

#[derive(Deserialize, Clone)]
pub struct AuditTrailData {
    pub trace_id: String,
    pub variable: String,
    pub accesses: Vec<VariableAccess>,
}

#[derive(Deserialize, Clone)]
pub struct VariableAccess {
    pub event_id: String,
    pub timestamp: String,
    pub thread_id: String,
    pub service_name: String,
    pub access_type: String,
    pub old_value: Option<serde_json::Value>,
    pub new_value: serde_json::Value,
    pub location: String,
    pub has_causal_link_to_previous: bool,
    pub is_race: bool,
}

// Full trace analysis response (single endpoint with ALL data)
#[derive(Deserialize)]
pub struct FullTraceAnalysisResponse {
    pub success: bool,
    pub data: Option<FullTraceAnalysisData>,
}

#[derive(Deserialize)]
pub struct FullTraceAnalysisData {
    pub trace_id: String,
    pub events: Vec<serde_json::Value>,
    pub audit_trails: std::collections::HashMap<String, Vec<VariableAccess>>,
    pub analysis: AnalysisData,
    pub critical_path: Option<serde_json::Value>, // Will be parsed to CriticalPathData if present
    pub anomalies: Vec<serde_json::Value>,        // Will be parsed to Vec<DetectedAnomaly>
    pub dependencies: Option<DependenciesData>,
}
