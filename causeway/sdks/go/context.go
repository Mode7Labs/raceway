package raceway

import (
	"context"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
)

var goroutineCounter uint64

// RacewayContext holds trace-related state for the current execution
type RacewayContext struct {
	TraceID     string  // UUID identifying this trace
	GoroutineID string  // Unique ID for this goroutine/execution chain
	ParentID    *string // ID of parent event (nil for roots)
	RootID      *string // ID of root event in this chain
	Clock       uint64  // Logical clock for this event chain
	mu          sync.Mutex
}

// Context key for storing RacewayContext
type contextKey string

const racewayContextKey contextKey = "raceway_context"

// NewRacewayContext creates a new context for a trace
func NewRacewayContext(traceID string) *RacewayContext {
	// Generate unique goroutine ID
	gid := atomic.AddUint64(&goroutineCounter, 1)
	goroutineID := fmt.Sprintf("go-%d-%d", os.Getpid(), gid)

	return &RacewayContext{
		TraceID:     traceID,
		GoroutineID: goroutineID,
		ParentID:    nil,
		RootID:      nil,
		Clock:       0,
	}
}

// Update updates the context after an event (thread-safe)
func (rc *RacewayContext) Update(eventID string, isFirstEvent bool) {
	rc.mu.Lock()
	defer rc.mu.Unlock()

	if isFirstEvent && rc.RootID == nil {
		rc.RootID = &eventID
	}
	rc.ParentID = &eventID
	rc.Clock++
}

// GetRacewayContext extracts RacewayContext from context.Context
func GetRacewayContext(ctx context.Context) *RacewayContext {
	if ctx == nil {
		return nil
	}
	raceCtx, ok := ctx.Value(racewayContextKey).(*RacewayContext)
	if !ok {
		return nil
	}
	return raceCtx
}

// WithRacewayContext adds RacewayContext to a context.Context
func WithRacewayContext(ctx context.Context, raceCtx *RacewayContext) context.Context {
	return context.WithValue(ctx, racewayContextKey, raceCtx)
}
