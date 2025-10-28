use crate::context::{RacewayContext, RACEWAY_CONTEXT};
use crate::trace_context::{
    build_propagation_headers, increment_clock_vector, parse_incoming_headers,
};
use crate::types::*;
use axum::{extract::Request, http::HeaderMap, middleware::Next, response::Response};
use parking_lot::RwLock;
use serde::Serialize;
use std::collections::HashMap;
use std::env;
use std::process;
use std::sync::Arc;

#[derive(Clone)]
pub struct RacewayClient {
    endpoint: String,
    service_name: String,
    module_name: String,
    instance_id: String,
    traces: Arc<RwLock<HashMap<String, TraceContext>>>,
    event_buffer: Arc<RwLock<Vec<Event>>>,
    http_client: reqwest::Client,
}

impl RacewayClient {
    pub fn new(endpoint: &str, service_name: &str) -> Self {
        Self::new_with_api_key(endpoint, service_name, None)
    }

    pub fn new_with_api_key(endpoint: &str, service_name: &str, api_key: Option<&str>) -> Self {
        Self::with_module(endpoint, service_name, "app", api_key)
    }

    pub fn with_module(
        endpoint: &str,
        service_name: &str,
        module_name: &str,
        api_key: Option<&str>,
    ) -> Self {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Some(key) = api_key {
            let bearer = format!("Bearer {}", key.trim());
            if let Ok(value) = reqwest::header::HeaderValue::from_str(&bearer) {
                headers.insert(reqwest::header::AUTHORIZATION, value);
            }
            if let Ok(value) = reqwest::header::HeaderValue::from_str(key.trim()) {
                headers.insert("X-Raceway-Key", value);
            }
        }

        let instance_id = resolve_instance_id();

        let client = Self {
            endpoint: endpoint.to_string(),
            service_name: service_name.to_string(),
            module_name: module_name.to_string(),
            instance_id,
            traces: Arc::new(RwLock::new(HashMap::new())),
            event_buffer: Arc::new(RwLock::new(Vec::new())),
            http_client: reqwest::Client::builder()
                .default_headers(headers)
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
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
        let parsed = parse_incoming_headers(&headers, &client.service_name, &client.instance_id);

        let mut ctx = RacewayContext::new(
            parsed.trace_id.clone(),
            client.service_name.clone(),
            client.instance_id.clone(),
        );
        ctx.span_id = parsed.span_id.clone();
        ctx.parent_span_id = parsed.parent_span_id.clone();
        ctx.distributed = parsed.distributed;
        ctx.clock_vector = parsed.clock_vector.clone();
        ctx.tracestate = parsed.tracestate.clone();

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

                let updated_vector =
                    increment_clock_vector(&ctx.clock_vector, &ctx.service_name, &ctx.instance_id);

                // Phase 2: Always pass distributed metadata (not gated by distributed flag)
                // This ensures entry-point services also create distributed spans
                let distributed_metadata = Some((
                    ctx.instance_id.clone(),
                    ctx.span_id.clone(),
                    ctx.parent_span_id.clone(),
                ));

                let event_id = self.capture_event(
                    &ctx.trace_id,
                    ctx.parent_id.clone(),
                    updated_vector.clone(),
                    EventKind::StateChange(StateChangeData {
                        variable: variable.to_string(),
                        old_value: serde_json::to_value(old_value)
                            .unwrap_or(serde_json::Value::Null),
                        new_value: serde_json::to_value(new_value)
                            .unwrap_or(serde_json::Value::Null),
                        location,
                        access_type: access_type.to_string(),
                    }),
                    None,
                    distributed_metadata,
                );

                // Update context: new parent and increment clock
                let mut ctx_mut = ctx_cell.borrow_mut();
                if ctx_mut.root_id.is_none() {
                    ctx_mut.root_id = Some(event_id.clone());
                }
                ctx_mut.parent_id = Some(event_id);
                ctx_mut.clock += 1;
                ctx_mut.clock_vector = updated_vector;
            })
            .ok();
    }

    pub fn track_function_call<T: Serialize>(&self, function_name: &str, args: T) {
        self.track_function_call_with_duration(function_name, args, None);
    }

    pub fn track_function_call_with_duration<T: Serialize>(
        &self,
        function_name: &str,
        args: T,
        duration_ns: Option<u64>,
    ) {
        RACEWAY_CONTEXT
            .try_with(|ctx_cell| {
                let ctx = ctx_cell.borrow().clone();

                let updated_vector =
                    increment_clock_vector(&ctx.clock_vector, &ctx.service_name, &ctx.instance_id);

                // Phase 2: Always pass distributed metadata (not gated by distributed flag)
                // This ensures entry-point services also create distributed spans
                let distributed_metadata = Some((
                    ctx.instance_id.clone(),
                    ctx.span_id.clone(),
                    ctx.parent_span_id.clone(),
                ));

                let event_id = self.capture_event(
                    &ctx.trace_id,
                    ctx.parent_id.clone(),
                    updated_vector.clone(),
                    EventKind::FunctionCall(FunctionCallData {
                        function_name: function_name.to_string(),
                        module: self.module_name.clone(),
                        args: serde_json::to_value(args).unwrap_or(serde_json::Value::Null),
                        file: file!().to_string(),
                        line: line!(),
                    }),
                    duration_ns,
                    distributed_metadata,
                );

                // Update context
                let mut ctx_mut = ctx_cell.borrow_mut();
                if ctx_mut.root_id.is_none() {
                    ctx_mut.root_id = Some(event_id.clone());
                }
                ctx_mut.parent_id = Some(event_id);
                ctx_mut.clock += 1;
                ctx_mut.clock_vector = updated_vector;
            })
            .ok();
    }

    /// Track a function with automatic duration measurement (async)
    pub async fn track_function<F, T>(&self, function_name: &str, args: impl Serialize, f: F) -> T
    where
        F: std::future::Future<Output = T>,
    {
        let start = std::time::Instant::now();
        let result = f.await;
        let duration_ns = start.elapsed().as_nanos() as u64;

        self.track_function_call_with_duration(function_name, args, Some(duration_ns));
        result
    }

    /// Track a function with automatic duration measurement (sync)
    pub fn track_function_sync<F, T>(&self, function_name: &str, args: impl Serialize, f: F) -> T
    where
        F: FnOnce() -> T,
    {
        let start = std::time::Instant::now();
        let result = f();
        let duration_ns = start.elapsed().as_nanos() as u64;

        self.track_function_call_with_duration(function_name, args, Some(duration_ns));
        result
    }

    fn track_http_request(&self, method: &str, url: &str) {
        RACEWAY_CONTEXT
            .try_with(|ctx_cell| {
                let ctx = ctx_cell.borrow().clone();

                let updated_vector =
                    increment_clock_vector(&ctx.clock_vector, &ctx.service_name, &ctx.instance_id);

                // Phase 2: Always pass distributed metadata (not gated by distributed flag)
                // This ensures entry-point services also create distributed spans
                let distributed_metadata = Some((
                    ctx.instance_id.clone(),
                    ctx.span_id.clone(),
                    ctx.parent_span_id.clone(),
                ));

                let event_id = self.capture_event(
                    &ctx.trace_id,
                    ctx.parent_id.clone(),
                    updated_vector.clone(),
                    EventKind::HttpRequest(HttpRequestData {
                        method: method.to_string(),
                        url: url.to_string(),
                        headers: HashMap::new(),
                        body: None,
                    }),
                    None,
                    distributed_metadata,
                );

                // Update context
                let mut ctx_mut = ctx_cell.borrow_mut();
                if ctx_mut.root_id.is_none() {
                    ctx_mut.root_id = Some(event_id.clone());
                }
                ctx_mut.parent_id = Some(event_id);
                ctx_mut.clock += 1;
                ctx_mut.clock_vector = updated_vector;
            })
            .ok();
    }

    pub fn track_http_response(&self, status: u16, duration_ms: u64) {
        RACEWAY_CONTEXT
            .try_with(|ctx_cell| {
                let ctx = ctx_cell.borrow().clone();

                // Convert duration from ms to ns for metadata
                let duration_ns = duration_ms * 1_000_000;

                let updated_vector =
                    increment_clock_vector(&ctx.clock_vector, &ctx.service_name, &ctx.instance_id);

                // Phase 2: Always pass distributed metadata (not gated by distributed flag)
                // This ensures entry-point services also create distributed spans
                let distributed_metadata = Some((
                    ctx.instance_id.clone(),
                    ctx.span_id.clone(),
                    ctx.parent_span_id.clone(),
                ));

                let event_id = self.capture_event(
                    &ctx.trace_id,
                    ctx.parent_id.clone(),
                    updated_vector.clone(),
                    EventKind::HttpResponse(HttpResponseData {
                        status,
                        headers: HashMap::new(),
                        body: None,
                        duration_ms,
                    }),
                    Some(duration_ns),
                    distributed_metadata,
                );

                // Update context
                let mut ctx_mut = ctx_cell.borrow_mut();
                ctx_mut.parent_id = Some(event_id);
                ctx_mut.clock += 1;
                ctx_mut.clock_vector = updated_vector;
            })
            .ok();
    }

    /// Track acquiring a lock.
    /// Location is automatically captured from the call site.
    pub fn track_lock_acquire(&self, lock_id: &str, lock_type: &str) {
        RACEWAY_CONTEXT
            .try_with(|ctx_cell| {
                let ctx = ctx_cell.borrow().clone();
                let location = format!("{}:{}", file!(), line!());

                let updated_vector =
                    increment_clock_vector(&ctx.clock_vector, &ctx.service_name, &ctx.instance_id);

                let distributed_metadata = Some((
                    ctx.instance_id.clone(),
                    ctx.span_id.clone(),
                    ctx.parent_span_id.clone(),
                ));

                let event_id = self.capture_event(
                    &ctx.trace_id,
                    ctx.parent_id.clone(),
                    updated_vector.clone(),
                    EventKind::LockAcquire(crate::types::LockAcquireData {
                        lock_id: lock_id.to_string(),
                        lock_type: lock_type.to_string(),
                        location,
                    }),
                    None,
                    distributed_metadata,
                );

                // Update context
                let mut ctx_mut = ctx_cell.borrow_mut();
                if ctx_mut.root_id.is_none() {
                    ctx_mut.root_id = Some(event_id.clone());
                }
                ctx_mut.parent_id = Some(event_id);
                ctx_mut.clock += 1;
                ctx_mut.clock_vector = updated_vector;
            })
            .ok();
    }

    /// Track releasing a lock.
    /// Location is automatically captured from the call site.
    pub fn track_lock_release(&self, lock_id: &str, lock_type: &str) {
        RACEWAY_CONTEXT
            .try_with(|ctx_cell| {
                let ctx = ctx_cell.borrow().clone();
                let location = format!("{}:{}", file!(), line!());

                let updated_vector =
                    increment_clock_vector(&ctx.clock_vector, &ctx.service_name, &ctx.instance_id);

                let distributed_metadata = Some((
                    ctx.instance_id.clone(),
                    ctx.span_id.clone(),
                    ctx.parent_span_id.clone(),
                ));

                let event_id = self.capture_event(
                    &ctx.trace_id,
                    ctx.parent_id.clone(),
                    updated_vector.clone(),
                    EventKind::LockRelease(crate::types::LockReleaseData {
                        lock_id: lock_id.to_string(),
                        lock_type: lock_type.to_string(),
                        location,
                    }),
                    None,
                    distributed_metadata,
                );

                // Update context
                let mut ctx_mut = ctx_cell.borrow_mut();
                ctx_mut.parent_id = Some(event_id);
                ctx_mut.clock += 1;
                ctx_mut.clock_vector = updated_vector;
            })
            .ok();
    }

    pub fn propagation_headers(
        &self,
        extra: Option<HashMap<String, String>>,
    ) -> Result<HashMap<String, String>, String> {
        RACEWAY_CONTEXT
            .try_with(|ctx_cell| {
                let mut ctx = ctx_cell.borrow_mut();
                let result = build_propagation_headers(
                    &ctx.trace_id,
                    &ctx.span_id,
                    ctx.tracestate.as_deref(),
                    &ctx.clock_vector,
                    &ctx.service_name,
                    &ctx.instance_id,
                );

                ctx.clock_vector = result.clock_vector.clone();
                ctx.distributed = true;
                ctx.parent_span_id = Some(ctx.span_id.clone());
                ctx.span_id = result.child_span_id.clone();

                let mut headers_map = HashMap::new();
                for (key, value) in result.headers.iter() {
                    if let Ok(val_str) = value.to_str() {
                        headers_map.insert(key.to_string(), val_str.to_string());
                    }
                }

                if let Some(additional) = extra {
                    for (key, value) in additional {
                        headers_map.insert(key, value);
                    }
                }

                Ok(headers_map)
            })
            .map_err(|_| "Raceway context is not active".to_string())?
    }

    fn capture_event(
        &self,
        trace_id: &str,
        parent_id: Option<String>,
        clock_vector: Vec<(String, u64)>,
        kind: EventKind,
        duration_ns: Option<u64>,
        distributed_metadata: Option<(String, String, Option<String>)>, // (instance_id, span_id, upstream_span_id)
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

        let (instance_id, distributed_span_id, upstream_span_id) =
            if let Some((inst, span, upstream)) = distributed_metadata {
                (Some(inst), Some(span), upstream)
            } else {
                (None, None, None)
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
                tags: {
                    let mut tags = HashMap::new();
                    tags.insert("sdk_language".to_string(), "rust".to_string());
                    tags
                },
                duration_ns,
                // Phase 2: Distributed tracing fields
                instance_id,
                distributed_span_id,
                upstream_span_id,
            },
            causality_vector: clock_vector,
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
                    buffer.extend(trace.events.drain(..));
                }
            }
        }

        // Now flush the buffer
        let events: Vec<Event> = self.event_buffer.write().drain(..).collect();
        if events.is_empty() {
            return;
        }

        let payload = serde_json::json!({ "events": events });
        match self
            .http_client
            .post(format!("{}/events", self.endpoint))
            .json(&payload)
            .send()
            .await
        {
            Ok(response) => {
                let status = response.status();
                if !status.is_success() {
                    let body = response
                        .text()
                        .await
                        .unwrap_or_else(|_| "No body".to_string());
                    eprintln!("[Raceway] Server returned {}: {}", status, body);
                }
            }
            Err(e) => {
                eprintln!("[Raceway] Error sending events: {}", e);
            }
        }
    }

    /// Shutdown the client and flush all buffered events synchronously.
    /// This should be called before the application exits.
    pub fn shutdown(&self) {
        // Use tokio's block_in_place to allow blocking in async context
        tokio::task::block_in_place(|| {
            let rt = tokio::runtime::Handle::current();
            rt.block_on(async {
                self.flush().await;
            });
        });
    }
}

fn resolve_instance_id() -> String {
    if let Ok(explicit) = env::var("RACEWAY_INSTANCE_ID") {
        return explicit;
    }
    if let Ok(host) = env::var("HOSTNAME") {
        return format!("{}-{}", host, process::id());
    }
    if let Ok(host) = env::var("COMPUTERNAME") {
        return format!("{}-{}", host, process::id());
    }
    format!("instance-{}", process::id())
}
