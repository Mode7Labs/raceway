use crate::event::Event;
use crate::graph::{Anomaly, CriticalPath, ServiceDependencies, VariableAccess};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// Statistics for duration measurements
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DurationStats {
    pub count: usize,
    pub total_duration_us: u64,
    pub min_duration_us: u64,
    pub max_duration_us: u64,
    pub mean_duration_us: f64,
    pub variance: f64,
    pub std_dev: f64,
}

/// Cross-trace race information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossTraceRace {
    pub variable: String,
    pub event1_id: Uuid,
    pub event1_trace_id: Uuid,
    pub event1_timestamp: DateTime<Utc>,
    pub event1_thread_id: String,
    pub event1_value: serde_json::Value,
    pub event1_location: String,
    pub event2_id: Uuid,
    pub event2_trace_id: Uuid,
    pub event2_timestamp: DateTime<Utc>,
    pub event2_thread_id: String,
    pub event2_value: serde_json::Value,
    pub event2_location: String,
    pub confidence: f64, // 0.0 to 1.0 - how confident we are this is a real race
}

/// Audit trail data for a specific variable
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditTrailData {
    pub trace_id: String,
    pub variable: String,
    pub accesses: Vec<VariableAccessData>,
    pub total_accesses: usize,
    pub race_count: usize,
}

/// A single variable access in the audit trail
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariableAccessData {
    pub event_id: String,
    pub timestamp: DateTime<Utc>,
    pub thread_id: String,
    pub service_name: String,
    pub access_type: String,
    pub old_value: Option<serde_json::Value>,
    pub new_value: serde_json::Value,
    pub location: String,
    pub has_causal_link_to_previous: bool,
    pub is_race: bool,
}

/// Batch data fetch for trace analysis (includes ALL computed data in single query)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceAnalysisData {
    pub events: Vec<Event>,
    pub audit_trails: HashMap<String, Vec<VariableAccess>>,
    pub critical_path: Option<CriticalPath>,
    pub anomalies: Vec<Anomaly>,
    pub dependencies: Option<ServiceDependencies>,
}

/// Summary metadata for a single trace (used for listing/pagination)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceSummary {
    pub trace_id: Uuid,
    pub event_count: i64,
    pub first_timestamp: DateTime<Utc>,
    pub last_timestamp: DateTime<Utc>,
}
