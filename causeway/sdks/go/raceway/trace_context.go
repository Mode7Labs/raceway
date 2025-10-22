package raceway

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"
)

const (
	traceparentHeader  = "traceparent"
	tracestateHeader   = "tracestate"
	racewayClockHeader = "raceway-clock"

	traceparentVersion = "00"
	traceFlags         = "01"
	clockVersionPrefix = "v1;"
)

type ParsedTraceContext struct {
	TraceID      string
	SpanID       string
	ParentSpanID *string
	TraceState   *string
	ClockVector  []CausalityEntry
	Distributed  bool
}

type PropagationResult struct {
	Headers     map[string]string
	ClockVector []CausalityEntry
	ChildSpanID string
}

type racewayClockPayload struct {
	TraceID      string          `json:"trace_id"`
	SpanID       string          `json:"span_id"`
	ParentSpanID string          `json:"parent_span_id"`
	Service      string          `json:"service"`
	Instance     string          `json:"instance"`
	Clock        [][]interface{} `json:"clock"`
}

func ParseIncomingHeaders(headers http.Header, serviceName, instanceID string) ParsedTraceContext {
	traceID := uuid.New().String()
	var parentSpanID *string
	var traceState *string
	distributed := false

	if raw := headers.Get(traceparentHeader); raw != "" {
		if parsedTrace, ok := parseTraceparent(raw); ok {
			traceID = parsedTrace.traceID
			parentSpanID = parsedTrace.parentSpanID
			distributed = true
		}
	}

	clockVector := []CausalityEntry{}
	if raw := headers.Get(racewayClockHeader); raw != "" {
		if parsedClock, ok := parseRacewayClock(raw); ok {
			if parsedClock.traceID != "" {
				traceID = parsedClock.traceID
			}
			if parsedClock.parentSpanID != nil {
				parentSpanID = parsedClock.parentSpanID
			}
			clockVector = parsedClock.clock
			distributed = true
		}
	}

	if raw := headers.Get(tracestateHeader); raw != "" {
		traceState = &raw
	}

	component := clockComponent(serviceName, instanceID)
	hasComponent := false
	for _, entry := range clockVector {
		if entry.Component() == component {
			hasComponent = true
			break
		}
	}
	if !hasComponent {
		clockVector = append(clockVector, NewCausalityEntry(component, 0))
	}

	return ParsedTraceContext{
		TraceID:      traceID,
		SpanID:       generateSpanID(),
		ParentSpanID: parentSpanID,
		TraceState:   traceState,
		ClockVector:  clockVector,
		Distributed:  distributed,
	}
}

func BuildPropagationHeaders(traceID, currentSpanID string, traceState *string, clockVector []CausalityEntry, serviceName, instanceID string) PropagationResult {
	nextVector := incrementClockVector(clockVector, serviceName, instanceID)
	childSpanID := generateSpanID()

	traceparent := strings.Join([]string{
		traceparentVersion,
		uuidToTraceparent(traceID),
		childSpanID,
		traceFlags,
	}, "-")

	payload := map[string]interface{}{
		"trace_id":       traceID,
		"span_id":        childSpanID,
		"parent_span_id": currentSpanID,
		"service":        serviceName,
		"instance":       instanceID,
		"clock":          encodeClockVector(nextVector),
	}

	payloadJSON, _ := json.Marshal(payload)
	racewayClock := clockVersionPrefix + base64.RawURLEncoding.EncodeToString(payloadJSON)

	headers := map[string]string{
		traceparentHeader:  traceparent,
		racewayClockHeader: racewayClock,
	}
	if traceState != nil {
		headers[tracestateHeader] = *traceState
	}

	return PropagationResult{
		Headers:     headers,
		ClockVector: nextVector,
		ChildSpanID: childSpanID,
	}
}

func incrementClockVector(clockVector []CausalityEntry, serviceName, instanceID string) []CausalityEntry {
	component := clockComponent(serviceName, instanceID)
	next := make([]CausalityEntry, 0, len(clockVector)+1)
	found := false
	for _, entry := range clockVector {
		if entry.Component() == component {
			next = append(next, NewCausalityEntry(entry.Component(), entry.Value()+1))
			found = true
		} else {
			next = append(next, entry)
		}
	}
	if !found {
		next = append(next, NewCausalityEntry(component, 1))
	}
	return next
}

type parsedTraceparent struct {
	traceID      string
	parentSpanID *string
}

func parseTraceparent(value string) (parsedTraceparent, bool) {
	parts := strings.Split(strings.TrimSpace(value), "-")
	if len(parts) != 4 {
		return parsedTraceparent{}, false
	}

	traceIDHex := parts[1]
	spanIDHex := parts[2]
	if len(traceIDHex) != 32 || len(spanIDHex) != 16 {
		return parsedTraceparent{}, false
	}

	if _, err := hex.DecodeString(traceIDHex); err != nil {
		return parsedTraceparent{}, false
	}
	if _, err := hex.DecodeString(spanIDHex); err != nil {
		return parsedTraceparent{}, false
	}

	traceID := traceparentToUUID(traceIDHex)
	parentSpanID := spanIDHex

	return parsedTraceparent{
		traceID:      traceID,
		parentSpanID: &parentSpanID,
	}, true
}

type parsedClock struct {
	traceID      string
	parentSpanID *string
	clock        []CausalityEntry
}

func parseRacewayClock(value string) (parsedClock, bool) {
	if !strings.HasPrefix(value, clockVersionPrefix) {
		return parsedClock{}, false
	}

	encoded := strings.TrimPrefix(value, clockVersionPrefix)
	decoded, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return parsedClock{}, false
	}

	var payload racewayClockPayload
	if err := json.Unmarshal(decoded, &payload); err != nil {
		return parsedClock{}, false
	}

	entries := make([]CausalityEntry, 0, len(payload.Clock))
	for _, item := range payload.Clock {
		if len(item) != 2 {
			continue
		}
		component, ok := item[0].(string)
		if !ok {
			continue
		}
		var valueUint uint64
		switch v := item[1].(type) {
		case float64:
			valueUint = uint64(v)
		case int:
			valueUint = uint64(v)
		case int64:
			valueUint = uint64(v)
		case uint64:
			valueUint = v
		default:
			continue
		}
		entries = append(entries, NewCausalityEntry(component, valueUint))
	}

	var parentSpanID *string
	if payload.SpanID != "" {
		// span_id from sender becomes parent for receiver
		parentSpanID = &payload.SpanID
	}

	return parsedClock{
		traceID:      payload.TraceID,
		parentSpanID: parentSpanID,
		clock:        entries,
	}, true
}

func uuidToTraceparent(value string) string {
	cleaned := strings.ReplaceAll(value, "-", "")
	if len(cleaned) < 32 {
		cleaned = cleaned + strings.Repeat("0", 32-len(cleaned))
	}
	return cleaned[:32]
}

func traceparentToUUID(value string) string {
	return strings.Join([]string{
		value[0:8],
		value[8:12],
		value[12:16],
		value[16:20],
		value[20:32],
	}, "-")
}

func encodeClockVector(clockVector []CausalityEntry) [][]interface{} {
	encoded := make([][]interface{}, 0, len(clockVector))
	for _, entry := range clockVector {
		encoded = append(encoded, []interface{}{entry.Component(), entry.Value()})
	}
	return encoded
}
