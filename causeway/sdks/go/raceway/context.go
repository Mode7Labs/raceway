package raceway

import (
	"context"

	"github.com/google/uuid"
)

type contextKey int

const racewayContextKey contextKey = 0

// RacewayContext holds the trace context for a request.
type RacewayContext struct {
	TraceID  string
	ThreadID string  // Unique virtual thread ID for this goroutine/request
	ParentID *string
	RootID   *string
	Clock    int
}

// NewContext creates a new context with Raceway tracing enabled.
// If traceID is empty, a new UUID will be generated.
func NewContext(ctx context.Context, traceID string) context.Context {
	if traceID == "" {
		traceID = uuid.New().String()
	}

	// Generate unique virtual thread ID for this context
	threadID := uuid.New().String()

	rctx := &RacewayContext{
		TraceID:  traceID,
		ThreadID: threadID,
		ParentID: nil,
		RootID:   nil,
		Clock:    0,
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

// WithTraceID creates a new context with the specified trace ID.
func WithTraceID(ctx context.Context, traceID string) context.Context {
	return NewContext(ctx, traceID)
}
