use crate::context::{RacewayContext, RACEWAY_CONTEXT};
use crate::types::*;
use axum::{extract::Request, http::HeaderMap, middleware::Next, response::Response};
use parking_lot::RwLock;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Clone)]
pub struct RacewayClient {
    endpoint: String,
    service_name: String,
    module_name: String,
    traces: Arc<RwLock<HashMap<String, TraceContext>>>,
    event_buffer: Arc<RwLock<Vec<Event>>>,
    http_client: reqwest::Client,
}

impl RacewayClient {
    pub fn new(endpoint: &str, service_name: &str) -> Self {
        Self::with_module(endpoint, service_name, "app")
    }

    pub fn with_module(endpoint: &str, service_name: &str, module_name: &str) -> Self {
        let client = Self {
            endpoint: endpoint.to_string(),
            service_name: service_name.to_string(),
            module_name: module_name.to_string(),
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
            .scope(std::cell::RefCell::new(ctx), async move {
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
        RACEWAY_CONTEXT
            .try_with(|ctx_cell| {
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
                            old_value: serde_json::to_value(old_value)
                                .unwrap_or(serde_json::Value::Null),
                            new_value: serde_json::to_value(new_value)
                                .unwrap_or(serde_json::Value::Null),
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
            })
            .ok();
    }

    pub fn track_function_call<T: Serialize>(&self, function_name: &str, args: T) {
        RACEWAY_CONTEXT
            .try_with(|ctx_cell| {
                let ctx = ctx_cell.borrow().clone();

                let event_id = self.capture_event(
                    &ctx.trace_id,
                    ctx.parent_id.clone(),
                    ctx.root_id.clone(),
                    ctx.clock,
                    EventKind::FunctionCall {
                        function_call: FunctionCallData {
                            function_name: function_name.to_string(),
                            module: self.module_name.clone(),
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
            })
            .ok();
    }

    fn track_http_request(&self, method: &str, url: &str) {
        RACEWAY_CONTEXT
            .try_with(|ctx_cell| {
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
            })
            .ok();
    }

    pub fn track_http_response(&self, status: u16, duration_ms: u64) {
        RACEWAY_CONTEXT
            .try_with(|ctx_cell| {
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
            })
            .ok();
    }

    fn capture_event(
        &self,
        trace_id: &str,
        parent_id: Option<String>,
        root_event_id: Option<String>,
        clock: u64,
        kind: EventKind,
    ) -> String {
        // Get or create trace
        let mut traces = self.traces.write();

        // Create trace if it doesn't exist
        if !traces.contains_key(trace_id) {
            traces.insert(
                trace_id.to_string(),
                TraceContext {
                    trace_id: trace_id.to_string(),
                    events: Vec::new(),
                },
            );
        }

        let trace = traces.get_mut(trace_id).unwrap();

        // Build causality vector
        let causality_vector = if let Some(root_id) = root_event_id {
            vec![(root_id, clock)]
        } else {
            vec![] // Root event has empty vector
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
                    eprintln!(
                        "[Raceway] Moving {} events from trace {} to buffer",
                        event_count, trace.trace_id
                    );
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
            eprintln!(
                "[Raceway] Successfully sent {} events",
                events.len()
            );
        }
    }
}
