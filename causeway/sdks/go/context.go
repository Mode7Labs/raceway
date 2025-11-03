package raceway

import (
	"context"
	"strings"

	"github.com/google/uuid"
)

type contextKey int

const racewayContextKey contextKey = 0

// RacewayContext holds the trace context for a request.
type RacewayContext struct {
	TraceID      string
	ThreadID     string // Unique virtual thread ID for this goroutine/request
	ParentID     *string
	RootID       *string
	Clock        int
	SpanID       string
	ParentSpanID *string
	Distributed  bool
	ClockVector  []CausalityEntry
	TraceState   *string
	ServiceName  string
	InstanceID   string
}

// NewContext creates a new context with Raceway tracing enabled.
// If traceID is empty, a new UUID will be generated.
func NewContext(ctx context.Context, traceID, serviceName, instanceID string) context.Context {
	if traceID == "" {
		traceID = uuid.New().String()
	}

	// Generate unique virtual thread ID for this context
	threadID := uuid.New().String()

	component := clockComponent(serviceName, instanceID)

	rctx := &RacewayContext{
		TraceID:      traceID,
		ThreadID:     threadID,
		ParentID:     nil,
		RootID:       nil,
		Clock:        0,
		SpanID:       generateSpanID(),
		ParentSpanID: nil,
		Distributed:  false,
		ClockVector:  []CausalityEntry{NewCausalityEntry(component, 0)},
		TraceState:   nil,
		ServiceName:  serviceName,
		InstanceID:   instanceID,
	}

	return context.WithValue(ctx, racewayContextKey, rctx)
}

// FromContext retrieves the RacewayContext from a context.Context.
// Returns nil if no RacewayContext is present.
func FromContext(ctx context.Context) *RacewayContext {
	rctx, ok := ctx.Value(racewayContextKey).(*RacewayContext)
	if !ok {
		return nil
	}
	return rctx
}

// WithTraceID creates a new context with the specified trace ID (legacy helper).
func WithTraceID(ctx context.Context, traceID string) context.Context {
	return NewContext(ctx, traceID, "unknown-service", "instance")
}

// WithTraceIDAndInstance creates a context with explicit service/instance identifiers.
func WithTraceIDAndInstance(ctx context.Context, traceID, serviceName, instanceID string) context.Context {
	return NewContext(ctx, traceID, serviceName, instanceID)
}

func clockComponent(serviceName, instanceID string) string {
	return serviceName + "#" + instanceID
}

func generateSpanID() string {
	return strings.ReplaceAll(uuid.New().String(), "-", "")[:16]
}
