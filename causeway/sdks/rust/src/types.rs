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
    // Phase 2: Distributed tracing fields
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distributed_span_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream_span_id: Option<String>,
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

#[derive(Debug, Clone)]
pub struct ClientConfig {
    pub endpoint: String,
    pub service_name: String,
    pub module_name: String,
    pub api_key: Option<String>,
    pub instance_id: Option<String>,
}

impl ClientConfig {
    pub fn new(endpoint: &str, service_name: &str) -> Self {
        Self {
            endpoint: endpoint.to_string(),
            service_name: service_name.to_string(),
            module_name: "app".to_string(),
            api_key: None,
            instance_id: None,
        }
    }

    pub fn with_api_key(mut self, key: Option<String>) -> Self {
        self.api_key = key;
        self
    }

    pub fn module(mut self, module: &str) -> Self {
        self.module_name = module.to_string();
        self
    }

    pub fn with_instance_id(mut self, instance: &str) -> Self {
        self.instance_id = Some(instance.to_string());
        self
    }
}
