use axum::http::{HeaderMap, HeaderValue};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde_json::Value;
use uuid::Uuid;

const TRACEPARENT_HEADER: &str = "traceparent";
const TRACESTATE_HEADER: &str = "tracestate";
const RACEWAY_CLOCK_HEADER: &str = "raceway-clock";

const TRACEPARENT_VERSION: &str = "00";
const TRACE_FLAGS: &str = "01";
const CLOCK_VERSION_PREFIX: &str = "v1;";

#[derive(Debug, Clone)]
pub struct ParsedTraceContext {
    pub trace_id: String,
    pub span_id: String,
    pub parent_span_id: Option<String>,
    pub tracestate: Option<String>,
    pub clock_vector: Vec<(String, u64)>,
    pub distributed: bool,
}

#[derive(Debug, Clone)]
pub struct PropagationHeaders {
    pub headers: HeaderMap,
    pub clock_vector: Vec<(String, u64)>,
    pub child_span_id: String,
}

pub fn parse_incoming_headers(
    headers: &HeaderMap,
    service_name: &str,
    instance_id: &str,
) -> ParsedTraceContext {
    let mut trace_id = Uuid::new_v4().to_string();
    let mut span_id: Option<String> = None;
    let mut parent_span_id: Option<String> = None;
    let mut distributed = false;

    if let Some(raw) = headers
        .get(TRACEPARENT_HEADER)
        .and_then(|v| v.to_str().ok())
    {
        if let Some(parsed) = parse_traceparent(raw) {
            trace_id = parsed.trace_id;
            span_id = parsed.parent_span_id; // This is the span ID for THIS service
            distributed = true;
        }
    }

    let mut clock_vector: Vec<(String, u64)> = Vec::new();
    if let Some(raw) = headers
        .get(RACEWAY_CLOCK_HEADER)
        .and_then(|v| v.to_str().ok())
    {
        if let Some(parsed) = parse_raceway_clock(raw) {
            if let Some(id) = parsed.trace_id {
                trace_id = id;
            }
            // Raceway clock has more accurate span IDs
            if let Some(id) = parsed.span_id {
                span_id = Some(id);
            }
            if let Some(id) = parsed.parent_span_id {
                parent_span_id = Some(id);
            }
            clock_vector = parsed.clock;
            distributed = true;
        }
    }

    let tracestate = headers
        .get(TRACESTATE_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let component = format!("{}#{}", service_name, instance_id);
    if !clock_vector.iter().any(|(c, _)| c == &component) {
        clock_vector.push((component.clone(), 0));
    }

    ParsedTraceContext {
        trace_id,
        span_id: span_id.unwrap_or_else(generate_span_id), // Use received span ID, or generate if not provided
        parent_span_id,
        tracestate,
        clock_vector,
        distributed,
    }
}

pub fn build_propagation_headers(
    trace_id: &str,
    current_span_id: &str,
    tracestate: Option<&str>,
    clock_vector: &[(String, u64)],
    service_name: &str,
    instance_id: &str,
) -> PropagationHeaders {
    let next_vector = increment_clock_vector(clock_vector, service_name, instance_id);
    let child_span_id = generate_span_id();

    let traceparent = format!(
        "{}-{}-{}-{}",
        TRACEPARENT_VERSION,
        uuid_to_traceparent(trace_id),
        &child_span_id,
        TRACE_FLAGS
    );

    let payload = serde_json::json!({
        "trace_id": trace_id,
        "span_id": child_span_id,
        "parent_span_id": current_span_id,
        "service": service_name,
        "instance": instance_id,
        "clock": encode_clock_vector(&next_vector),
    });

    let encoded = URL_SAFE_NO_PAD.encode(payload.to_string().as_bytes());
    let mut headers = HeaderMap::new();
    headers.insert(
        TRACEPARENT_HEADER,
        HeaderValue::from_str(&traceparent).unwrap(),
    );
    headers.insert(
        RACEWAY_CLOCK_HEADER,
        HeaderValue::from_str(&format!("{}{}", CLOCK_VERSION_PREFIX, encoded)).unwrap(),
    );
    if let Some(state) = tracestate {
        headers.insert(TRACESTATE_HEADER, HeaderValue::from_str(state).unwrap());
    }

    PropagationHeaders {
        headers,
        clock_vector: next_vector,
        child_span_id,
    }
}

pub fn increment_clock_vector(
    clock_vector: &[(String, u64)],
    service_name: &str,
    instance_id: &str,
) -> Vec<(String, u64)> {
    let component = format!("{}#{}", service_name, instance_id);
    let mut next = Vec::with_capacity(clock_vector.len() + 1);
    let mut found = false;
    for (comp, value) in clock_vector.iter() {
        if comp == &component {
            next.push((comp.clone(), value + 1));
            found = true;
        } else {
            next.push((comp.clone(), *value));
        }
    }
    if !found {
        next.push((component, 1));
    }
    next
}

struct ParsedTraceparent {
    trace_id: String,
    parent_span_id: Option<String>,
}

fn parse_traceparent(value: &str) -> Option<ParsedTraceparent> {
    let parts: Vec<&str> = value.trim().split('-').collect();
    if parts.len() != 4 {
        return None;
    }
    let trace_id_hex = parts[1];
    let span_id_hex = parts[2];
    if trace_id_hex.len() != 32 || span_id_hex.len() != 16 {
        return None;
    }
    if hex::decode(trace_id_hex).is_err() || hex::decode(span_id_hex).is_err() {
        return None;
    }
    Some(ParsedTraceparent {
        trace_id: traceparent_to_uuid(trace_id_hex),
        parent_span_id: Some(span_id_hex.to_string()),
    })
}

struct ParsedClock {
    trace_id: Option<String>,
    span_id: Option<String>,
    parent_span_id: Option<String>,
    clock: Vec<(String, u64)>,
}

fn parse_raceway_clock(value: &str) -> Option<ParsedClock> {
    if !value.starts_with(CLOCK_VERSION_PREFIX) {
        return None;
    }
    let encoded = &value[CLOCK_VERSION_PREFIX.len()..];
    let decoded = URL_SAFE_NO_PAD.decode(encoded.as_bytes()).ok()?;
    let v: Value = serde_json::from_slice(&decoded).ok()?;

    let trace_id = v
        .get("trace_id")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string());
    let span_id = v
        .get("span_id")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string());
    // Use actual upstream span ID
    let parent_span_id = v
        .get("parent_span_id")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string());

    let mut clock = Vec::new();
    if let Some(entries) = v.get("clock").and_then(|c| c.as_array()) {
        for entry in entries {
            if let Some(pair) = entry.as_array() {
                if pair.len() == 2 {
                    if let (Some(component), Some(value)) = (pair[0].as_str(), pair[1].as_u64()) {
                        clock.push((component.to_string(), value));
                    }
                }
            }
        }
    }

    Some(ParsedClock {
        trace_id,
        span_id,
        parent_span_id,
        clock,
    })
}

fn uuid_to_traceparent(value: &str) -> String {
    value.replace('-', "")
}

fn traceparent_to_uuid(value: &str) -> String {
    format!(
        "{}-{}-{}-{}-{}",
        &value[0..8],
        &value[8..12],
        &value[12..16],
        &value[16..20],
        &value[20..32]
    )
}

fn generate_span_id() -> String {
    let source = Uuid::new_v4().to_string().replace('-', "");
    source.chars().take(16).collect()
}

fn encode_clock_vector(clock_vector: &[(String, u64)]) -> Vec<Vec<Value>> {
    clock_vector
        .iter()
        .map(|(component, value)| vec![Value::String(component.clone()), Value::from(*value)])
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    const VALID_TRACEPARENT: &str = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
    const VALID_TRACE_ID: &str = "0af76519-16cd-43dd-8448-eb211c80319c";
    const VALID_SPAN_ID: &str = "b7ad6b7169203331";

    #[test]
    fn test_parse_valid_w3c_traceparent() {
        let mut headers = HeaderMap::new();
        headers.insert(TRACEPARENT_HEADER, VALID_TRACEPARENT.parse().unwrap());

        let result = parse_incoming_headers(&headers, "test-service", "instance-1");

        assert_eq!(result.trace_id, VALID_TRACE_ID);
        assert_eq!(result.span_id, VALID_SPAN_ID);
        assert!(result.parent_span_id.is_none());
        assert!(result.distributed);
    }

    #[test]
    fn test_parse_valid_raceway_clock() {
        let clock_payload = serde_json::json!({
            "trace_id": VALID_TRACE_ID,
            "span_id": VALID_SPAN_ID,
            "parent_span_id": "parent-span-1111",
            "service": "upstream-service",
            "instance": "upstream-1",
            "clock": [
                ["upstream-service#upstream-1", 5],
                ["other-service#other-1", 3],
            ],
        });
        let encoded = URL_SAFE_NO_PAD.encode(clock_payload.to_string().as_bytes());

        let mut headers = HeaderMap::new();
        headers.insert(
            RACEWAY_CLOCK_HEADER,
            format!("v1;{}", encoded).parse().unwrap(),
        );

        let result = parse_incoming_headers(&headers, "test-service", "instance-1");

        assert_eq!(result.trace_id, VALID_TRACE_ID);
        assert_eq!(result.span_id, VALID_SPAN_ID);
        assert_eq!(result.parent_span_id.as_deref(), Some("parent-span-1111"));
        assert!(result.distributed);
        assert!(result
            .clock_vector
            .contains(&("upstream-service#upstream-1".to_string(), 5)));
        assert!(result
            .clock_vector
            .contains(&("other-service#other-1".to_string(), 3)));
    }

    #[test]
    fn test_combine_traceparent_and_raceway_clock() {
        let clock_payload = serde_json::json!({
            "trace_id": VALID_TRACE_ID,
            "span_id": VALID_SPAN_ID,
            "parent_span_id": "upstream-parent",
            "service": "upstream",
            "instance": "up-1",
            "clock": [["upstream#up-1", 10]],
        });
        let encoded = URL_SAFE_NO_PAD.encode(clock_payload.to_string().as_bytes());

        let mut headers = HeaderMap::new();
        headers.insert(TRACEPARENT_HEADER, VALID_TRACEPARENT.parse().unwrap());
        headers.insert(
            RACEWAY_CLOCK_HEADER,
            format!("v1;{}", encoded).parse().unwrap(),
        );

        let result = parse_incoming_headers(&headers, "test-service", "instance-1");

        assert_eq!(result.trace_id, VALID_TRACE_ID);
        assert_eq!(result.span_id, VALID_SPAN_ID);
        assert_eq!(result.parent_span_id.as_deref(), Some("upstream-parent"));
        assert!(result.distributed);
        assert!(result
            .clock_vector
            .contains(&("upstream#up-1".to_string(), 10)));
    }

    #[test]
    fn test_generate_new_trace_when_no_headers() {
        let headers = HeaderMap::new();
        let result = parse_incoming_headers(&headers, "test-service", "instance-1");

        assert_eq!(result.trace_id.len(), 36); // UUID format
        assert!(result.parent_span_id.is_none());
        assert!(!result.distributed);
        assert_eq!(result.span_id.len(), 16);
    }

    #[test]
    fn test_initialize_local_clock_component() {
        let headers = HeaderMap::new();
        let result = parse_incoming_headers(&headers, "test-service", "instance-1");

        assert!(result
            .clock_vector
            .contains(&("test-service#instance-1".to_string(), 0)));
    }

    #[test]
    fn test_preserve_existing_local_clock_component() {
        let clock_payload = serde_json::json!({
            "trace_id": VALID_TRACE_ID,
            "span_id": VALID_SPAN_ID,
            "parent_span_id": null,
            "service": "test-service",
            "instance": "instance-1",
            "clock": [["test-service#instance-1", 42]],
        });
        let encoded = URL_SAFE_NO_PAD.encode(clock_payload.to_string().as_bytes());

        let mut headers = HeaderMap::new();
        headers.insert(
            RACEWAY_CLOCK_HEADER,
            format!("v1;{}", encoded).parse().unwrap(),
        );

        let result = parse_incoming_headers(&headers, "test-service", "instance-1");

        assert!(result
            .clock_vector
            .contains(&("test-service#instance-1".to_string(), 42)));
        // Should not duplicate
        let count = result
            .clock_vector
            .iter()
            .filter(|(c, _)| c == "test-service#instance-1")
            .count();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_handle_malformed_traceparent() {
        let mut headers = HeaderMap::new();
        headers.insert(TRACEPARENT_HEADER, "invalid-format".parse().unwrap());

        let result = parse_incoming_headers(&headers, "test-service", "instance-1");

        assert!(!result.distributed);
        assert!(result.parent_span_id.is_none());
    }

    #[test]
    fn test_handle_malformed_raceway_clock() {
        let mut headers = HeaderMap::new();
        headers.insert(
            RACEWAY_CLOCK_HEADER,
            "v1;invalid-base64!!!".parse().unwrap(),
        );

        let result = parse_incoming_headers(&headers, "test-service", "instance-1");

        assert!(!result.distributed);
        assert_eq!(result.clock_vector.len(), 1);
        assert_eq!(result.clock_vector[0].0, "test-service#instance-1");
    }

    #[test]
    fn test_handle_wrong_version_prefix() {
        let clock_payload = serde_json::json!({
            "clock": [["service#1", 1]],
        });
        let encoded = URL_SAFE_NO_PAD.encode(clock_payload.to_string().as_bytes());

        let mut headers = HeaderMap::new();
        headers.insert(
            RACEWAY_CLOCK_HEADER,
            format!("v99;{}", encoded).parse().unwrap(),
        );

        let result = parse_incoming_headers(&headers, "test-service", "instance-1");

        assert!(!result.distributed);
    }

    #[test]
    fn test_parse_tracestate_header() {
        let mut headers = HeaderMap::new();
        headers.insert(TRACEPARENT_HEADER, VALID_TRACEPARENT.parse().unwrap());
        headers.insert(
            TRACESTATE_HEADER,
            "congo=t61rcWkgMzE,rojo=00f067aa0ba902b7".parse().unwrap(),
        );

        let result = parse_incoming_headers(&headers, "test-service", "instance-1");

        assert_eq!(
            result.tracestate.as_deref(),
            Some("congo=t61rcWkgMzE,rojo=00f067aa0ba902b7")
        );
    }

    #[test]
    fn test_build_valid_traceparent() {
        let result = build_propagation_headers(
            VALID_TRACE_ID,
            "current-span-id",
            None,
            &[],
            "test-service",
            "instance-1",
        );

        let traceparent = result
            .headers
            .get(TRACEPARENT_HEADER)
            .and_then(|v| v.to_str().ok())
            .unwrap();
        assert_eq!(traceparent.len(), 55); // 00-32hex-16hex-01 with dashes
        assert!(traceparent.starts_with("00-"));
    }

    #[test]
    fn test_build_valid_raceway_clock() {
        let result = build_propagation_headers(
            VALID_TRACE_ID,
            "current-span-id",
            None,
            &[("test-service#instance-1".to_string(), 5)],
            "test-service",
            "instance-1",
        );

        let raceway_clock = result
            .headers
            .get(RACEWAY_CLOCK_HEADER)
            .and_then(|v| v.to_str().ok())
            .unwrap();
        assert!(raceway_clock.starts_with("v1;"));

        // Decode and verify
        let encoded = &raceway_clock[3..];
        let decoded = URL_SAFE_NO_PAD.decode(encoded.as_bytes()).unwrap();
        let payload: serde_json::Value = serde_json::from_slice(&decoded).unwrap();

        assert_eq!(payload["trace_id"].as_str().unwrap(), VALID_TRACE_ID);
        assert_eq!(payload["parent_span_id"].as_str().unwrap(), "current-span-id");
        assert_eq!(payload["service"].as_str().unwrap(), "test-service");
        assert_eq!(payload["instance"].as_str().unwrap(), "instance-1");
    }

    #[test]
    fn test_generate_new_child_span_id() {
        let result = build_propagation_headers(
            VALID_TRACE_ID,
            "parent-span",
            None,
            &[],
            "test-service",
            "instance-1",
        );

        assert_eq!(result.child_span_id.len(), 16);
        assert_ne!(result.child_span_id, "parent-span");
    }

    #[test]
    fn test_include_tracestate_when_present() {
        let result = build_propagation_headers(
            VALID_TRACE_ID,
            "current-span",
            Some("vendor=value"),
            &[],
            "test-service",
            "instance-1",
        );

        let tracestate = result
            .headers
            .get(TRACESTATE_HEADER)
            .and_then(|v| v.to_str().ok())
            .unwrap();
        assert_eq!(tracestate, "vendor=value");
    }

    #[test]
    fn test_increment_clock_vector_in_headers() {
        let result = build_propagation_headers(
            VALID_TRACE_ID,
            "current-span",
            None,
            &[
                ("test-service#instance-1".to_string(), 10),
                ("other-service#other-1".to_string(), 5),
            ],
            "test-service",
            "instance-1",
        );

        assert!(result
            .clock_vector
            .contains(&("test-service#instance-1".to_string(), 11)));
        assert!(result
            .clock_vector
            .contains(&("other-service#other-1".to_string(), 5)));
    }

    #[test]
    fn test_increment_existing_component() {
        let vector = vec![("my-service#inst-1".to_string(), 5)];
        let result = increment_clock_vector(&vector, "my-service", "inst-1");

        assert!(result.contains(&("my-service#inst-1".to_string(), 6)));
    }

    #[test]
    fn test_add_new_component_when_not_present() {
        let vector = vec![("other-service#other".to_string(), 3)];
        let result = increment_clock_vector(&vector, "my-service", "inst-1");

        assert!(result.contains(&("my-service#inst-1".to_string(), 1)));
        assert!(result.contains(&("other-service#other".to_string(), 3)));
    }

    #[test]
    fn test_handle_empty_vector() {
        let vector = vec![];
        let result = increment_clock_vector(&vector, "my-service", "inst-1");

        assert_eq!(result.len(), 1);
        assert!(result.contains(&("my-service#inst-1".to_string(), 1)));
    }

    #[test]
    fn test_not_mutate_original_vector() {
        let vector = vec![("my-service#inst-1".to_string(), 5)];
        let original = vector.clone();

        increment_clock_vector(&vector, "my-service", "inst-1");

        assert_eq!(vector, original);
    }

    #[test]
    fn test_preserve_other_components_unchanged() {
        let vector = vec![
            ("service-a#1".to_string(), 10),
            ("my-service#inst-1".to_string(), 5),
            ("service-b#2".to_string(), 7),
        ];

        let result = increment_clock_vector(&vector, "my-service", "inst-1");

        assert!(result.contains(&("service-a#1".to_string(), 10)));
        assert!(result.contains(&("my-service#inst-1".to_string(), 6)));
        assert!(result.contains(&("service-b#2".to_string(), 7)));
    }

    #[test]
    fn test_full_request_flow() {
        // Service A receives request
        let mut incoming_headers = HeaderMap::new();
        incoming_headers.insert(TRACEPARENT_HEADER, VALID_TRACEPARENT.parse().unwrap());

        let parsed = parse_incoming_headers(&incoming_headers, "service-a", "a1");

        // Service A calls Service B
        let outgoing = build_propagation_headers(
            &parsed.trace_id,
            &parsed.span_id,
            parsed.tracestate.as_deref(),
            &parsed.clock_vector,
            "service-a",
            "a1",
        );

        // Service B receives request
        let parsed_b = parse_incoming_headers(&outgoing.headers, "service-b", "b1");

        // Verify trace continuity
        assert_eq!(parsed_b.trace_id, parsed.trace_id);
        assert_eq!(parsed_b.span_id, outgoing.child_span_id);
        assert_eq!(parsed_b.parent_span_id.as_deref(), Some(parsed.span_id.as_str()));
        assert!(parsed_b.distributed);

        // Verify clock propagation
        assert!(parsed_b.clock_vector.contains(&("service-a#a1".to_string(), 1)));
        assert!(parsed_b.clock_vector.contains(&("service-b#b1".to_string(), 0)));
    }

    #[test]
    fn test_multi_hop_propagation() {
        // Service A (initial)
        let headers_ab = build_propagation_headers(
            VALID_TRACE_ID,
            "span-a",
            None,
            &[("service-a#a1".to_string(), 0)],
            "service-a",
            "a1",
        );

        // A → B
        let parsed_b = parse_incoming_headers(&headers_ab.headers, "service-b", "b1");

        // B → C
        let headers_bc = build_propagation_headers(
            &parsed_b.trace_id,
            &parsed_b.span_id,
            parsed_b.tracestate.as_deref(),
            &parsed_b.clock_vector,
            "service-b",
            "b1",
        );

        let parsed_c = parse_incoming_headers(&headers_bc.headers, "service-c", "c1");

        // Verify full chain
        assert_eq!(parsed_c.trace_id, VALID_TRACE_ID);
        assert!(parsed_c.clock_vector.contains(&("service-a#a1".to_string(), 1)));
        assert!(parsed_c.clock_vector.contains(&("service-b#b1".to_string(), 1)));
        assert!(parsed_c.clock_vector.contains(&("service-c#c1".to_string(), 0)));
    }
}
