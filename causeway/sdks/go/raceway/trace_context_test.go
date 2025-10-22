package raceway

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"testing"
)

const (
	validTraceparent = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
	validTraceID     = "0af76519-16cd-43dd-8448-eb211c80319c"
	validSpanID      = "b7ad6b7169203331"
)

func TestParseIncomingHeaders(t *testing.T) {
	t.Run("parse valid W3C traceparent", func(t *testing.T) {
		headers := http.Header{}
		headers.Set("traceparent", validTraceparent)

		result := ParseIncomingHeaders(headers, "test-service", "instance-1")

		if result.TraceID != validTraceID {
			t.Errorf("expected trace ID %s, got %s", validTraceID, result.TraceID)
		}
		if result.ParentSpanID == nil || *result.ParentSpanID != validSpanID {
			t.Errorf("expected parent span ID %s, got %v", validSpanID, result.ParentSpanID)
		}
		if !result.Distributed {
			t.Error("expected distributed=true")
		}
		if len(result.SpanID) != 16 {
			t.Errorf("expected span ID length 16, got %d", len(result.SpanID))
		}
	})

	t.Run("parse valid raceway-clock", func(t *testing.T) {
		clockPayload := map[string]interface{}{
			"trace_id":       validTraceID,
			"span_id":        validSpanID,
			"parent_span_id": nil,
			"service":        "upstream-service",
			"instance":       "upstream-1",
			"clock": [][]interface{}{
				{"upstream-service#upstream-1", float64(5)},
				{"other-service#other-1", float64(3)},
			},
		}
		payloadJSON, _ := json.Marshal(clockPayload)
		encoded := base64.RawURLEncoding.EncodeToString(payloadJSON)

		headers := http.Header{}
		headers.Set("raceway-clock", "v1;"+encoded)

		result := ParseIncomingHeaders(headers, "test-service", "instance-1")

		if result.TraceID != validTraceID {
			t.Errorf("expected trace ID %s, got %s", validTraceID, result.TraceID)
		}
		if result.ParentSpanID == nil || *result.ParentSpanID != validSpanID {
			t.Errorf("expected parent span ID %s, got %v", validSpanID, result.ParentSpanID)
		}
		if !result.Distributed {
			t.Error("expected distributed=true")
		}
		if !hasClockComponent(result.ClockVector, "upstream-service#upstream-1", 5) {
			t.Error("expected upstream-service#upstream-1:5 in clock vector")
		}
		if !hasClockComponent(result.ClockVector, "other-service#other-1", 3) {
			t.Error("expected other-service#other-1:3 in clock vector")
		}
	})

	t.Run("combine traceparent and raceway-clock", func(t *testing.T) {
		clockPayload := map[string]interface{}{
			"trace_id":       validTraceID,
			"span_id":        validSpanID,
			"parent_span_id": nil,
			"service":        "upstream",
			"instance":       "up-1",
			"clock":          [][]interface{}{{"upstream#up-1", float64(10)}},
		}
		payloadJSON, _ := json.Marshal(clockPayload)
		encoded := base64.RawURLEncoding.EncodeToString(payloadJSON)

		headers := http.Header{}
		headers.Set("traceparent", validTraceparent)
		headers.Set("raceway-clock", "v1;"+encoded)

		result := ParseIncomingHeaders(headers, "test-service", "instance-1")

		if result.TraceID != validTraceID {
			t.Errorf("expected trace ID %s, got %s", validTraceID, result.TraceID)
		}
		if result.ParentSpanID == nil || *result.ParentSpanID != validSpanID {
			t.Errorf("expected parent span ID %s, got %v", validSpanID, result.ParentSpanID)
		}
		if !result.Distributed {
			t.Error("expected distributed=true")
		}
		if !hasClockComponent(result.ClockVector, "upstream#up-1", 10) {
			t.Error("expected upstream#up-1:10 in clock vector")
		}
	})

	t.Run("generate new trace when no headers", func(t *testing.T) {
		headers := http.Header{}

		result := ParseIncomingHeaders(headers, "test-service", "instance-1")

		if len(result.TraceID) != 36 {
			t.Errorf("expected UUID length 36, got %d", len(result.TraceID))
		}
		if result.ParentSpanID != nil {
			t.Errorf("expected nil parent span ID, got %v", *result.ParentSpanID)
		}
		if result.Distributed {
			t.Error("expected distributed=false")
		}
		if len(result.SpanID) != 16 {
			t.Errorf("expected span ID length 16, got %d", len(result.SpanID))
		}
	})

	t.Run("initialize local clock component", func(t *testing.T) {
		headers := http.Header{}

		result := ParseIncomingHeaders(headers, "test-service", "instance-1")

		if !hasClockComponent(result.ClockVector, "test-service#instance-1", 0) {
			t.Error("expected test-service#instance-1:0 in clock vector")
		}
	})

	t.Run("preserve existing local clock component", func(t *testing.T) {
		clockPayload := map[string]interface{}{
			"trace_id":       validTraceID,
			"span_id":        validSpanID,
			"parent_span_id": nil,
			"service":        "test-service",
			"instance":       "instance-1",
			"clock":          [][]interface{}{{"test-service#instance-1", float64(42)}},
		}
		payloadJSON, _ := json.Marshal(clockPayload)
		encoded := base64.RawURLEncoding.EncodeToString(payloadJSON)

		headers := http.Header{}
		headers.Set("raceway-clock", "v1;"+encoded)

		result := ParseIncomingHeaders(headers, "test-service", "instance-1")

		if !hasClockComponent(result.ClockVector, "test-service#instance-1", 42) {
			t.Error("expected test-service#instance-1:42 in clock vector")
		}
		// Should not duplicate
		count := 0
		for _, entry := range result.ClockVector {
			if entry.Component() == "test-service#instance-1" {
				count++
			}
		}
		if count != 1 {
			t.Errorf("expected 1 instance of test-service#instance-1, got %d", count)
		}
	})

	t.Run("handle malformed traceparent", func(t *testing.T) {
		headers := http.Header{}
		headers.Set("traceparent", "invalid-format")

		result := ParseIncomingHeaders(headers, "test-service", "instance-1")

		if result.Distributed {
			t.Error("expected distributed=false")
		}
		if result.ParentSpanID != nil {
			t.Error("expected nil parent span ID")
		}
	})

	t.Run("handle malformed raceway-clock", func(t *testing.T) {
		headers := http.Header{}
		headers.Set("raceway-clock", "v1;invalid-base64!!!")

		result := ParseIncomingHeaders(headers, "test-service", "instance-1")

		if result.Distributed {
			t.Error("expected distributed=false")
		}
		if len(result.ClockVector) != 1 {
			t.Errorf("expected 1 clock entry, got %d", len(result.ClockVector))
		}
	})

	t.Run("handle wrong version prefix", func(t *testing.T) {
		clockPayload := map[string]interface{}{
			"clock": [][]interface{}{{"service#1", float64(1)}},
		}
		payloadJSON, _ := json.Marshal(clockPayload)
		encoded := base64.RawURLEncoding.EncodeToString(payloadJSON)

		headers := http.Header{}
		headers.Set("raceway-clock", "v99;"+encoded)

		result := ParseIncomingHeaders(headers, "test-service", "instance-1")

		if result.Distributed {
			t.Error("expected distributed=false")
		}
	})

	t.Run("parse tracestate header", func(t *testing.T) {
		headers := http.Header{}
		headers.Set("traceparent", validTraceparent)
		headers.Set("tracestate", "congo=t61rcWkgMzE,rojo=00f067aa0ba902b7")

		result := ParseIncomingHeaders(headers, "test-service", "instance-1")

		if result.TraceState == nil || *result.TraceState != "congo=t61rcWkgMzE,rojo=00f067aa0ba902b7" {
			t.Error("expected tracestate to be preserved")
		}
	})
}

func TestBuildPropagationHeaders(t *testing.T) {
	t.Run("build valid traceparent", func(t *testing.T) {
		result := BuildPropagationHeaders(
			validTraceID,
			"current-span-id",
			nil,
			[]CausalityEntry{},
			"test-service",
			"instance-1",
		)

		traceparent, ok := result.Headers["traceparent"]
		if !ok {
			t.Fatal("traceparent header not found")
		}
		// Should have format: 00-<32-hex>-<16-hex>-01
		if len(traceparent) != 55 { // 00-32-16-01 with dashes
			t.Errorf("expected traceparent length 55, got %d", len(traceparent))
		}
	})

	t.Run("build valid raceway-clock", func(t *testing.T) {
		result := BuildPropagationHeaders(
			validTraceID,
			"current-span-id",
			nil,
			[]CausalityEntry{NewCausalityEntry("test-service#instance-1", 5)},
			"test-service",
			"instance-1",
		)

		racewayClock, ok := result.Headers["raceway-clock"]
		if !ok {
			t.Fatal("raceway-clock header not found")
		}
		if racewayClock[:3] != "v1;" {
			t.Error("expected raceway-clock to start with 'v1;'")
		}

		// Decode and verify
		encoded := racewayClock[3:]
		decoded, _ := base64.RawURLEncoding.DecodeString(encoded)
		var payload map[string]interface{}
		_ = json.Unmarshal(decoded, &payload)

		if payload["trace_id"] != validTraceID {
			t.Error("expected trace_id in payload")
		}
		if payload["parent_span_id"] != "current-span-id" {
			t.Error("expected parent_span_id in payload")
		}
		if payload["service"] != "test-service" {
			t.Error("expected service in payload")
		}
		clock := payload["clock"].([]interface{})
		if len(clock) == 0 {
			t.Error("expected clock in payload")
		}
	})

	t.Run("generate new child span ID", func(t *testing.T) {
		result := BuildPropagationHeaders(
			validTraceID,
			"parent-span",
			nil,
			[]CausalityEntry{},
			"test-service",
			"instance-1",
		)

		if len(result.ChildSpanID) != 16 {
			t.Errorf("expected child span ID length 16, got %d", len(result.ChildSpanID))
		}
		if result.ChildSpanID == "parent-span" {
			t.Error("child span ID should not equal parent span ID")
		}
	})

	t.Run("include tracestate when present", func(t *testing.T) {
		traceState := "vendor=value"
		result := BuildPropagationHeaders(
			validTraceID,
			"current-span",
			&traceState,
			[]CausalityEntry{},
			"test-service",
			"instance-1",
		)

		if ts, ok := result.Headers["tracestate"]; !ok || ts != "vendor=value" {
			t.Error("expected tracestate header")
		}
	})

	t.Run("increment clock vector", func(t *testing.T) {
		result := BuildPropagationHeaders(
			validTraceID,
			"current-span",
			nil,
			[]CausalityEntry{
				NewCausalityEntry("test-service#instance-1", 10),
				NewCausalityEntry("other-service#other-1", 5),
			},
			"test-service",
			"instance-1",
		)

		if !hasClockComponent(result.ClockVector, "test-service#instance-1", 11) {
			t.Error("expected test-service#instance-1:11")
		}
		if !hasClockComponent(result.ClockVector, "other-service#other-1", 5) {
			t.Error("expected other-service#other-1:5")
		}
	})
}

func TestIncrementClockVector(t *testing.T) {
	t.Run("increment existing component", func(t *testing.T) {
		vector := []CausalityEntry{NewCausalityEntry("my-service#inst-1", 5)}

		result := incrementClockVector(vector, "my-service", "inst-1")

		if !hasClockComponent(result, "my-service#inst-1", 6) {
			t.Error("expected my-service#inst-1:6")
		}
	})

	t.Run("add new component when not present", func(t *testing.T) {
		vector := []CausalityEntry{NewCausalityEntry("other-service#other", 3)}

		result := incrementClockVector(vector, "my-service", "inst-1")

		if !hasClockComponent(result, "my-service#inst-1", 1) {
			t.Error("expected my-service#inst-1:1")
		}
		if !hasClockComponent(result, "other-service#other", 3) {
			t.Error("expected other-service#other:3")
		}
	})

	t.Run("handle empty vector", func(t *testing.T) {
		vector := []CausalityEntry{}

		result := incrementClockVector(vector, "my-service", "inst-1")

		if len(result) != 1 {
			t.Errorf("expected 1 entry, got %d", len(result))
		}
		if !hasClockComponent(result, "my-service#inst-1", 1) {
			t.Error("expected my-service#inst-1:1")
		}
	})

	t.Run("not mutate original vector", func(t *testing.T) {
		vector := []CausalityEntry{NewCausalityEntry("my-service#inst-1", 5)}
		original := make([]CausalityEntry, len(vector))
		copy(original, vector)

		incrementClockVector(vector, "my-service", "inst-1")

		if len(vector) != len(original) || vector[0].Value() != original[0].Value() {
			t.Error("original vector was mutated")
		}
	})

	t.Run("preserve other components unchanged", func(t *testing.T) {
		vector := []CausalityEntry{
			NewCausalityEntry("service-a#1", 10),
			NewCausalityEntry("my-service#inst-1", 5),
			NewCausalityEntry("service-b#2", 7),
		}

		result := incrementClockVector(vector, "my-service", "inst-1")

		if !hasClockComponent(result, "service-a#1", 10) {
			t.Error("expected service-a#1:10")
		}
		if !hasClockComponent(result, "my-service#inst-1", 6) {
			t.Error("expected my-service#inst-1:6")
		}
		if !hasClockComponent(result, "service-b#2", 7) {
			t.Error("expected service-b#2:7")
		}
	})
}

func TestEndToEndScenarios(t *testing.T) {
	t.Run("full request flow", func(t *testing.T) {
		// Service A receives request
		incomingHeaders := http.Header{}
		incomingHeaders.Set("traceparent", validTraceparent)

		parsed := ParseIncomingHeaders(incomingHeaders, "service-a", "a1")

		// Service A calls Service B
		outgoing := BuildPropagationHeaders(
			parsed.TraceID,
			parsed.SpanID,
			parsed.TraceState,
			parsed.ClockVector,
			"service-a",
			"a1",
		)

		// Service B receives request
		outgoingHeaders := http.Header{}
		for k, v := range outgoing.Headers {
			outgoingHeaders.Set(k, v)
		}
		parsedB := ParseIncomingHeaders(outgoingHeaders, "service-b", "b1")

		// Verify trace continuity
		if parsedB.TraceID != parsed.TraceID {
			t.Error("trace ID should be preserved")
		}
		if parsedB.ParentSpanID == nil || *parsedB.ParentSpanID != outgoing.ChildSpanID {
			t.Error("parent span ID should match child span ID")
		}
		if !parsedB.Distributed {
			t.Error("expected distributed=true")
		}

		// Verify clock propagation
		if !hasClockComponent(parsedB.ClockVector, "service-a#a1", 1) {
			t.Error("expected service-a#a1:1")
		}
		if !hasClockComponent(parsedB.ClockVector, "service-b#b1", 0) {
			t.Error("expected service-b#b1:0")
		}
	})

	t.Run("multi-hop propagation", func(t *testing.T) {
		// Service A (initial)
		headersAB := BuildPropagationHeaders(
			validTraceID,
			"span-a",
			nil,
			[]CausalityEntry{NewCausalityEntry("service-a#a1", 0)},
			"service-a",
			"a1",
		)

		// A → B
		headersABHttp := http.Header{}
		for k, v := range headersAB.Headers {
			headersABHttp.Set(k, v)
		}
		parsedB := ParseIncomingHeaders(headersABHttp, "service-b", "b1")

		// B → C
		headersBC := BuildPropagationHeaders(
			parsedB.TraceID,
			parsedB.SpanID,
			parsedB.TraceState,
			parsedB.ClockVector,
			"service-b",
			"b1",
		)

		headersBCHttp := http.Header{}
		for k, v := range headersBC.Headers {
			headersBCHttp.Set(k, v)
		}
		parsedC := ParseIncomingHeaders(headersBCHttp, "service-c", "c1")

		// Verify full chain
		if parsedC.TraceID != validTraceID {
			t.Error("trace ID should be preserved")
		}
		if !hasClockComponent(parsedC.ClockVector, "service-a#a1", 1) {
			t.Error("expected service-a#a1:1")
		}
		if !hasClockComponent(parsedC.ClockVector, "service-b#b1", 1) {
			t.Error("expected service-b#b1:1")
		}
		if !hasClockComponent(parsedC.ClockVector, "service-c#c1", 0) {
			t.Error("expected service-c#c1:0")
		}
	})
}

// Helper function
func hasClockComponent(vector []CausalityEntry, component string, value uint64) bool {
	for _, entry := range vector {
		if entry.Component() == component && entry.Value() == value {
			return true
		}
	}
	return false
}
