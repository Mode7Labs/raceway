use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Metadata {
    pub thread_id: String,
    pub process_id: u32,
    pub service_name: String,
    pub environment: String,
    pub tags: HashMap<String, String>,
    pub duration_ns: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EventKind {
    StateChange(StateChangeData),
    FunctionCall(FunctionCallData),
    HttpRequest(HttpRequestData),
    HttpResponse(HttpResponseData),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateChangeData {
    pub variable: String,
    pub old_value: serde_json::Value,
    pub new_value: serde_json::Value,
    pub location: String,
    pub access_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCallData {
    pub function_name: String,
    pub module: String,
    pub args: serde_json::Value,
    pub file: String,
    pub line: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpRequestData {
    pub method: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpResponseData {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: Option<serde_json::Value>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    pub trace_id: String,
    pub parent_id: Option<String>,
    pub timestamp: String,
    pub kind: EventKind,
    pub metadata: Metadata,
    pub causality_vector: Vec<(String, u64)>,
    pub lock_set: Vec<String>,
}

pub struct TraceContext {
    pub trace_id: String,
    pub events: Vec<Event>,
}
